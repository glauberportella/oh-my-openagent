import type { BridgeEventEnvelope } from "../server"
import { detectOpencodeApiPrefix, type OpencodeApiPrefix } from "./detect-api-prefix"
import { createOpencodeEventTap, type OpencodeEventTap } from "./event-tap"
import { listOpencodeSessions, type OpencodeSessionPage } from "./list-sessions"
import { normalizeOpencodeEvent } from "./opencode-event-normalizer"
import { OpencodeAttachError } from "./opencode-attach-error"

/** The username the harness's own auth helper defaults to when none is configured. */
export const OPENCODE_DEFAULT_USERNAME = "opencode"

export type OpencodeAttachOptions = {
  readonly baseUrl: string
  readonly password: string
  readonly username?: string
  readonly fetch?: typeof fetch
}

export type OpencodeListSessionsRequest = {
  readonly directory: string
  readonly cursor?: string
}

export type OpencodeTapEventsRequest = {
  readonly directory: string
  readonly onEvent: (envelope: BridgeEventEnvelope) => void
  readonly onFailure?: (error: OpencodeAttachError) => void
  readonly retryDelayMs?: number
}

export type OpencodeAttach = {
  readonly baseUrl: string
  /** The prefix the last `detectApiPrefix()` resolved, `undefined` before the first detection. */
  readonly apiPrefix: () => OpencodeApiPrefix | undefined
  /** Probes the candidate prefixes and caches the answer every later call requires. */
  readonly detectApiPrefix: () => Promise<OpencodeApiPrefix>
  readonly listSessions: (request: OpencodeListSessionsRequest) => Promise<OpencodeSessionPage>
  /** Taps the harness SSE stream and delivers every bridge-vocabulary envelope to `onEvent`. */
  readonly tapEvents: (request: OpencodeTapEventsRequest) => OpencodeEventTap
}

/**
 * Attach client for an OpenCode server on 127.0.0.1. Credentials are explicit constructor
 * options — the package never reads the environment — so the same client serves the
 * Electron main and deterministic tests; the default username mirrors the harness's own
 * auth default (`OPENCODE_SERVER_USERNAME ?? "opencode"`). Listing and tapping require a
 * detected API prefix first: the installed harness decides whether it serves `/api/*` or
 * the v1 unprefixed paths, never the pinned SDK paths.
 */
export function createOpencodeAttach(options: OpencodeAttachOptions): OpencodeAttach {
  const doFetch = options.fetch ?? fetch
  const username = options.username ?? OPENCODE_DEFAULT_USERNAME
  const authorization = `Basic ${Buffer.from(`${username}:${options.password}`, "utf8").toString("base64")}`
  let resolvedPrefix: OpencodeApiPrefix | undefined

  const requirePrefix = (): OpencodeApiPrefix => {
    if (resolvedPrefix === undefined) {
      throw new OpencodeAttachError(
        "prefix-unresolved",
        "no API prefix detected yet — call detectApiPrefix() before listing or tapping",
      )
    }
    return resolvedPrefix
  }

  return {
    baseUrl: options.baseUrl,
    apiPrefix: () => resolvedPrefix,
    detectApiPrefix: async () => {
      resolvedPrefix = await detectOpencodeApiPrefix({
        baseUrl: options.baseUrl,
        authorization,
        fetch: doFetch,
      })
      return resolvedPrefix
    },
    listSessions: async (request) =>
      listOpencodeSessions({
        baseUrl: options.baseUrl,
        apiPrefix: requirePrefix(),
        authorization,
        directory: request.directory,
        cursor: request.cursor,
        fetch: doFetch,
      }),
    tapEvents: (request) => {
      const prefix = requirePrefix()
      const url = new URL(`${prefix}/event`, options.baseUrl)
      url.searchParams.set("directory", request.directory)
      return createOpencodeEventTap({
        url: url.toString(),
        authorization,
        fetch: doFetch,
        retryDelayMs: request.retryDelayMs,
        onFailure: request.onFailure,
        onEvent: (frame) => {
          const envelope = normalizeOpencodeEvent(frame)
          if (envelope !== null) {
            request.onEvent(envelope)
          }
        },
      })
    },
  }
}
