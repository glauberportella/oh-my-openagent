import { OpencodeAttachError } from "./opencode-attach-error"

/**
 * Candidate API prefixes, newest surface first. opencode v2 serves its API under `/api`
 * while an SPA catch-all answers HTML at the v1-era unprefixed paths — the exact failure
 * both stock QA scripts hit on v2.1.4 — so the detector probes both and trusts neither.
 */
export const OPENCODE_API_PREFIX_CANDIDATES = ["/api", ""] as const

export type OpencodeApiPrefix = (typeof OPENCODE_API_PREFIX_CANDIDATES)[number]

export type DetectApiPrefixOptions = {
  readonly baseUrl: string
  readonly authorization: string
  readonly fetch?: typeof fetch
}

/**
 * Probes each candidate prefix with `GET {prefix}/session` and reports which API surface
 * the installed harness serves. Any JSON answer is the API — v2 answers a cursor-paged
 * object, v1 an array of sessions — while a non-JSON answer is the v2 SPA catch-all at a
 * legacy path and only proves the prefix is NOT the API; a 401 means the harness answered
 * its Basic-auth gate and refused the credentials.
 */
export async function detectOpencodeApiPrefix(options: DetectApiPrefixOptions): Promise<OpencodeApiPrefix> {
  const doFetch = options.fetch ?? fetch
  for (const prefix of OPENCODE_API_PREFIX_CANDIDATES) {
    const response = await doFetch(`${options.baseUrl}${prefix}/session`, {
      headers: { authorization: options.authorization, accept: "application/json" },
    })
    if (response.status === 401) {
      throw new OpencodeAttachError("auth-refused", `opencode refused the credentials at ${prefix || "/"} (401)`, 401)
    }
    if (response.status !== 200) {
      continue
    }
    const body = await response.text()
    try {
      JSON.parse(body)
    } catch {
      continue
    }
    return prefix
  }
  throw new OpencodeAttachError(
    "surface-missing",
    `no opencode API surface found at ${options.baseUrl} (probed ${[...OPENCODE_API_PREFIX_CANDIDATES].map((p) => `${p || "/"} -> /session`).join(", ")})`,
  )
}
