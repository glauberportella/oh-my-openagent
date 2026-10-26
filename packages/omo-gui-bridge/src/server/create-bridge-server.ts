import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { createBridgeTokenAuthority } from "./bridge-token"
import { createBridgeEventBus } from "./event-bus"
import { createBridgeRequestGate } from "./request-gate"
import { createSseOutlet } from "./sse-outlet"
import type { BridgeEventEnvelope } from "./bridge-topics"

/** The bridge never leaves the loopback interface; every later PR publishes onto this bind. */
export const BRIDGE_BIND_HOST = "127.0.0.1"

/** SSE keepalive cadence; the interval is unref'd so it never holds the process open. */
export const BRIDGE_HEARTBEAT_INTERVAL_MS = 15_000

export type BridgeServer = {
  readonly origin: string
  readonly port: number
  readonly token: string
  /** Publish an envelope onto the bus every SSE stream taps. */
  readonly publish: (event: BridgeEventEnvelope) => void
  /** Stop listening and drop every open connection. */
  readonly close: () => Promise<void>
}

function listenOnLoopback(server: ReturnType<typeof createServer>): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, BRIDGE_BIND_HOST, () => {
      server.off("error", reject)
      const address = server.address()
      if (address === null || typeof address === "string") {
        reject(new Error("bridge server bound an unexpected address"))
        return
      }
      resolve(address)
    })
  })
}

function writeStatus(response: ServerResponse): void {
  response.setHeader("content-type", "application/json")
  response.writeHead(200)
  response.end(JSON.stringify({ ok: true }))
}

function writeNotFound(response: ServerResponse): void {
  response.setHeader("content-type", "text/plain; charset=utf-8")
  response.writeHead(404).end("Not found")
}

/**
 * Loopback-only, token-gated HTTP+SSE server for the GUI bridge. Binds 127.0.0.1 on an
 * ephemeral port with `node:http` (never `Bun.serve`) so the same code runs as a Bun
 * daemon and inside the Electron main process. Every request passes the request gate
 * before routing; admitted requests reach the status route or the SSE event stream.
 */
export async function createBridgeServer(): Promise<BridgeServer> {
  const bus = createBridgeEventBus()
  const tokenAuthority = createBridgeTokenAuthority()
  const server = createServer()
  const address = await listenOnLoopback(server)
  const origin = `http://${BRIDGE_BIND_HOST}:${address.port}`
  const gate = createBridgeRequestGate({ origin, tokenAuthority })

  server.on("request", (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader("cache-control", "no-store")
    response.setHeader("referrer-policy", "no-referrer")
    const admission = gate.admit(request)
    if (!admission.admitted) {
      response.setHeader("content-type", "text/plain; charset=utf-8")
      response.writeHead(admission.status).end(admission.reason)
      return
    }
    if (request.method !== "GET") {
      writeNotFound(response)
      return
    }
    if (admission.url.pathname === "/") {
      writeStatus(response)
      return
    }
    if (admission.url.pathname === "/events") {
      const outlet = createSseOutlet(response)
      const unsubscribe = bus.subscribe((event) => outlet.write(event))
      const heartbeat = setInterval(() => outlet.heartbeat(), BRIDGE_HEARTBEAT_INTERVAL_MS)
      heartbeat.unref()
      request.on("close", () => {
        clearInterval(heartbeat)
        unsubscribe()
      })
      return
    }
    writeNotFound(response)
  })

  return {
    origin,
    port: address.port,
    token: tokenAuthority.current,
    publish: (event) => bus.publish(event),
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
