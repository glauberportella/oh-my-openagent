import type { ServerResponse } from "node:http"
import type { BridgeEventEnvelope } from "./bridge-topics"

export const SSE_CONTENT_TYPE = "text/event-stream"

/** Encodes one SSE event frame: the monotonic id line, a single `data:` JSON line, and the blank terminator. */
export function encodeSseEvent(id: number, event: BridgeEventEnvelope): string {
  return `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`
}

/** Encodes the keepalive frame: SSE parsers skip comment lines, proxies refresh the idle connection. */
export function encodeSseHeartbeat(): string {
  return ": heartbeat\n\n"
}

export type SseOutlet = {
  /** Write one event frame with the next monotonic id. */
  readonly write: (event: BridgeEventEnvelope) => void
  /** Write one keepalive comment frame. */
  readonly heartbeat: () => void
}

/**
 * Wraps an admitted response into an SSE stream. The 200 head is written and flushed
 * immediately — `writeHead` alone buffers until the first write, and an SSE client must
 * observe the open stream before any event flows. Ids are monotonic per stream,
 * matching SSE `Last-Event-ID` semantics.
 */
export function createSseOutlet(response: ServerResponse): SseOutlet {
  response.writeHead(200, {
    "content-type": SSE_CONTENT_TYPE,
    "cache-control": "no-store",
    connection: "keep-alive",
  })
  response.flushHeaders()
  let nextId = 1
  return {
    write(event) {
      response.write(encodeSseEvent(nextId, event))
      nextId += 1
    },
    heartbeat() {
      response.write(encodeSseHeartbeat())
    },
  }
}
