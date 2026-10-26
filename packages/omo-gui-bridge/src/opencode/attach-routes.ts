import type { BridgeRoute } from "../server"
import type { OpencodeAttach } from "./opencode-attach"
import { OpencodeAttachError } from "./opencode-attach-error"

/** GET /opencode/attach — the attach status surface: target, resolved prefix, nothing inferred. */
function handleAttachStatus(attach: OpencodeAttach) {
  return {
    status: 200,
    body: { baseUrl: attach.baseUrl, apiPrefix: attach.apiPrefix() ?? null },
  }
}

/**
 * GET /opencode/sessions?directory=<dir> — the session list, proxied from the harness with
 * the attach client's credentials. A missing `directory` is refused with 400 (the bridge
 * never guesses which project the GUI means); an attach failure surfaces as 502 with the
 * typed reason on the wire rather than a silent empty list.
 */
async function handleSessions(attach: OpencodeAttach, url: URL) {
  const directory = url.searchParams.get("directory")
  if (directory === null) {
    return {
      status: 400,
      body: { error: { kind: "missing-directory", message: "the directory query parameter is required" } },
    }
  }
  const cursor = url.searchParams.get("cursor") ?? undefined
  try {
    return { status: 200, body: await attach.listSessions({ directory, cursor }) }
  } catch (error) {
    if (error instanceof OpencodeAttachError) {
      return { status: 502, body: { error: { kind: error.kind, message: error.message } } }
    }
    return {
      status: 502,
      body: { error: { kind: "unexpected", message: error instanceof Error ? error.message : String(error) } },
    }
  }
}

/**
 * Token-gated bridge routes for the OpenCode attach lane. The bridge's request gate admits
 * these handlers the same way it admits `/` and `/events`, so the one-time token covers
 * the session list and the attach status exactly like every other bridge surface; each
 * handler answers with the JSON the bridge serializes onto the wire.
 */
export function createOpencodeAttachRoutes(options: { readonly attach: OpencodeAttach }): readonly BridgeRoute[] {
  const attach = options.attach
  return [
    {
      method: "GET",
      pathname: "/opencode/attach",
      handle: () => handleAttachStatus(attach),
    },
    {
      method: "GET",
      pathname: "/opencode/sessions",
      handle: ({ url }) => handleSessions(attach, url),
    },
  ]
}
