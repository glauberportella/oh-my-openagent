import type { IncomingMessage } from "node:http"

export type BridgeRouteMethod = "GET" | "POST"

/** An admitted request routed to a bridge route: past the gate, with its parsed URL. */
export type BridgeRouteRequest = {
  readonly request: IncomingMessage
  readonly url: URL
}

export type BridgeRouteResponse = {
  readonly status: number
  /** JSON-serialized response body; an absent body ends the response empty. */
  readonly body?: unknown
}

/** A token-gated route the bridge server dispatches after admission, before its built-in routes. */
export type BridgeRoute = {
  readonly method: BridgeRouteMethod
  readonly pathname: string
  readonly handle: (request: BridgeRouteRequest) => Promise<BridgeRouteResponse> | BridgeRouteResponse
}

/** Reads a request body to a string; used by POST routes that accept a JSON payload. */
export async function readBridgeRouteBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf-8")
}
