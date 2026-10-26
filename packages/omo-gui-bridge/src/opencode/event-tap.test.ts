import { createServer, type IncomingMessage, type Server } from "node:http"
import type { ServerResponse } from "node:http"
import { afterEach, describe, expect, test } from "bun:test"
import { createOpencodeEventTap } from "./event-tap"
import type { OpencodeAttachError } from "./opencode-attach-error"

const AUTH = "Basic dGVzdA=="

function awaitWithTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`waited ${ms}ms for ${what}, never fired`)), ms)
      timer.unref?.()
    }),
  ])
}

describe("createOpencodeEventTap", () => {
  const servers: Server[] = []

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  function serve(handler: (request: IncomingMessage, response: ServerResponse, connectionCount: number) => void): Promise<string> {
    const server = createServer()
    let connections = 0
    server.on("request", (request, response) => {
      connections += 1
      handler(request, response, connections)
    })
    servers.push(server)
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address()
        if (address === null || typeof address === "string") {
          throw new Error("fixture bound an unexpected address")
        }
        resolve(`http://127.0.0.1:${address.port}`)
      })
    })
  }

  test("#given a stream that ends and must be reconnected #when frames arrive across two connections #then every parsed data frame is delivered in order and the heartbeat produces nothing", async () => {
    // given — connection 1 delivers server.connected plus a heartbeat comment and ends;
    // connection 2 delivers a second frame, proving the bounded reconnect.
    const origin = await serve((_request, response, connection) => {
      response.writeHead(200, { "content-type": "text/event-stream" })
      if (connection === 1) {
        response.write(`data: {"id":"evt_1","type":"server.connected","data":{}}\n\n`)
        response.write(`: heartbeat\n\n`)
        response.end()
        return
      }
      response.write(`data: {"id":"evt_2","type":"session.idle","properties":{"sessionID":"ses_1"}}\n\n`)
    })
    const frames: unknown[] = []
    let resolveSecondFrame: () => void = () => {}
    const secondFrame = new Promise<void>((resolve) => {
      resolveSecondFrame = resolve
    })

    // when — the collector is registered before the tap starts (subscribe first).
    const tap = createOpencodeEventTap({
      url: origin,
      authorization: AUTH,
      retryDelayMs: 25,
      onEvent: (frame) => {
        frames.push(frame)
        if (frames.length >= 2) {
          resolveSecondFrame()
        }
      },
    })
    try {
      await awaitWithTimeout(secondFrame, 5_000, "two SSE frames across a reconnect")

      // then
      expect(frames).toEqual([
        { id: "evt_1", type: "server.connected", data: {} },
        { id: "evt_2", type: "session.idle", properties: { sessionID: "ses_1" } },
      ])
      expect(tap.state()).toBe("streaming")
    } finally {
      tap.stop()
    }
  })

  test("#given a harness whose auth gate refuses the tap #when the stream is tapped #then it fails once and never reports streaming", async () => {
    // given
    const origin = await serve((_request, response) => {
      response.writeHead(401).end("unauthorized")
    })
    let failure: OpencodeAttachError | undefined
    let resolveFailure: () => void = () => {}
    const failed = new Promise<void>((resolve) => {
      resolveFailure = resolve
    })

    // when — the failure listener is registered before the tap starts.
    const tap = createOpencodeEventTap({
      url: origin,
      authorization: AUTH,
      retryDelayMs: 25,
      onEvent: () => {},
      onFailure: (error) => {
        failure = error
        resolveFailure()
      },
    })
    try {
      await awaitWithTimeout(failed, 5_000, "the tap's auth failure")

      // then
      expect(failure).toMatchObject({ kind: "auth-refused", status: 401 })
      expect(tap.state()).toBe("failed")
    } finally {
      tap.stop()
    }
  })

  test("#given a live stream #when the tap is stopped #then its state reports stopped", async () => {
    // given
    const origin = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write(`data: {"type":"server.connected","data":{}}\n\n`)
    })
    let resolveFirstFrame: () => void = () => {}
    const firstFrame = new Promise<void>((resolve) => {
      resolveFirstFrame = resolve
    })

    // when — the first frame proves the stream is up, then stop() is synchronous.
    const tap = createOpencodeEventTap({
      url: origin,
      authorization: AUTH,
      onEvent: () => {
        resolveFirstFrame()
      },
    })
    try {
      await awaitWithTimeout(firstFrame, 5_000, "the first SSE frame")

      // then
      tap.stop()
      expect(tap.state()).toBe("stopped")
    } finally {
      tap.stop()
    }
  })
})
