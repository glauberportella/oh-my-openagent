import { afterEach, describe, expect, test } from "bun:test"
import { createBridgeServer, type BridgeServer } from "./create-bridge-server"
import { encodeSseEvent, encodeSseHeartbeat, SSE_CONTENT_TYPE } from "./sse-outlet"
import type { BridgeEventEnvelope } from "./bridge-topics"

const SSE_SETTLE_TIMEOUT_MS = 5_000

const servers: BridgeServer[] = []

function track(server: BridgeServer): BridgeServer {
  servers.push(server)
  return server
}

/**
 * Opens the SSE stream the way the repo's own SSE consumer reads one: `fetch`, then
 * async-iterate the body while splitting `\n\n` frames. The read loop is attached when
 * the head arrives, before the test publishes anything.
 */
function openSseStream(
  url: string,
  frameCount: number,
): { readonly opened: Promise<{ status: number; contentType: string }>; readonly settled: Promise<string> } {
  const controller = new AbortController()
  const opened = Promise.withResolvers<{ status: number; contentType: string }>()
  const settled = Promise.withResolvers<string>()

  void (async () => {
    try {
      const response = await fetch(url, { headers: { accept: SSE_CONTENT_TYPE }, signal: controller.signal })
      opened.resolve({ status: response.status, contentType: response.headers.get("content-type") ?? "" })
      if (response.body === null) throw new Error("SSE response carries no body")
      const decoder = new TextDecoder()
      let text = ""
      for await (const chunk of response.body) {
        text += decoder.decode(chunk, { stream: true })
        if (text.split("\n\n").length > frameCount) break
      }
      settled.resolve(text)
    } catch (error) {
      settled.reject(error instanceof Error ? error : new Error("SSE stream failed", { cause: error }))
    }
  })()

  const timer = setTimeout(() => {
    controller.abort()
    settled.reject(new Error(`waited ${SSE_SETTLE_TIMEOUT_MS}ms for ${frameCount} SSE frames`))
  }, SSE_SETTLE_TIMEOUT_MS)
  timer.unref()
  void settled.promise.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer),
  )
  return { opened: opened.promise, settled: settled.promise }
}

function parseFrames(text: string): { id: number; event: BridgeEventEnvelope }[] {
  return text
    .split("\n\n")
    .filter((frame) => frame !== "")
    .map((frame) => {
      const [idLine, dataLine] = frame.split("\n")
      expect(idLine).toMatch(/^id: \d+$/)
      expect(dataLine).toStartWith("data: ")
      return { id: Number(idLine.slice("id: ".length)), event: JSON.parse(dataLine.slice("data: ".length)) }
    })
}

describe("sse outlet", () => {
  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()
      if (server !== undefined) await server.close()
    }
  })

  test("#given an admitted events stream #when the bridge publishes #then frames carry monotonic ids and the envelopes", async () => {
    // given
    const server = track(await createBridgeServer())
    const stream = openSseStream(`${server.origin}/events?token=${encodeURIComponent(server.token)}`, 2)

    // when — the stream is open before anything is published
    const opened = await stream.opened
    server.publish({ topic: "server.connected", data: { source: "opencode" } })
    server.publish({ topic: "task.updated", data: { id: "st_1" } })

    // then
    expect(opened.status).toBe(200)
    expect(opened.contentType).toContain(SSE_CONTENT_TYPE)
    const frames = parseFrames(await stream.settled)
    expect(frames.map((frame) => frame.id)).toEqual([1, 2])
    expect(frames[0]?.event).toEqual({ topic: "server.connected", data: { source: "opencode" } })
    expect(frames[1]?.event).toEqual({ topic: "task.updated", data: { id: "st_1" } })
  })

  test("#given an envelope #when a frame is encoded #then it is one id line, one data line, and a blank terminator", () => {
    // given
    const event: BridgeEventEnvelope = { topic: "server.connected", data: null }

    // when
    const frame = encodeSseEvent(7, event)

    // then
    expect(frame).toBe('id: 7\ndata: {"topic":"server.connected","data":null}\n\n')
  })

  test("#given a keepalive #when it is encoded #then it is a comment frame parsers skip", () => {
    // given / when
    const frame = encodeSseHeartbeat()

    // then
    expect(frame).toBe(": heartbeat\n\n")
  })
})
