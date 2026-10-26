import type { IncomingMessage } from "node:http"
import type { BridgeTokenAuthority } from "./bridge-token"

export type BridgeAdmission =
  | { readonly admitted: true; readonly url: URL }
  | { readonly admitted: false; readonly status: 401 | 404; readonly reason: string }

export type BridgeRequestGate = {
  /** Admit or refuse a request; admitted requests carry the parsed request URL. */
  readonly admit: (request: IncomingMessage) => BridgeAdmission
}

/**
 * Reads the presented token: exactly one `token` query parameter, the channel a
 * launcher-embedded URL and an `EventSource` can both use. Any other shape — a missing
 * token, repeated `token` parameters — presents nothing and is refused.
 */
function readPresentedToken(url: URL): string | undefined {
  const queryTokens = url.searchParams.getAll("token")
  return queryTokens.length === 1 ? queryTokens[0] : undefined
}

/**
 * Per-request gate for the bridge, modeled on the repo's loopback callback server: the
 * `Host` header must equal the bound origin and the request URL must resolve to it,
 * and any `Forwarded` or `X-Forwarded-For` header is refused — a proxied request did
 * not arrive the way the bridge bound itself. Those transport-shape refusals answer
 * 404 without leaking why; only then is the one-time token verified (401 on failure).
 */
export function createBridgeRequestGate(options: {
  readonly origin: string
  readonly tokenAuthority: BridgeTokenAuthority
}): BridgeRequestGate {
  const originHost = new URL(options.origin).host
  return {
    admit(request) {
      const url = new URL(request.url ?? "/", options.origin)
      if (
        request.headers.host !== originHost ||
        url.origin !== options.origin ||
        request.headers.forwarded !== undefined ||
        request.headers["x-forwarded-for"] !== undefined
      ) {
        return { admitted: false, status: 404, reason: "Not found" }
      }
      const presented = readPresentedToken(url)
      if (presented === undefined || !options.tokenAuthority.verify(presented)) {
        return { admitted: false, status: 401, reason: "Unauthorized" }
      }
      return { admitted: true, url }
    },
  }
}
