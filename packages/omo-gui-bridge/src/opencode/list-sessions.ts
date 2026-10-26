import { OpencodeAttachError } from "./opencode-attach-error"

/** One session as the bridge renders it: absent optional fields are `null`, never inferred. */
export type BridgeSessionRow = {
  readonly id: string
  readonly title: string | null
  readonly directory: string | null
  readonly timeCreated: number | string | null
  readonly timeUpdated: number | string | null
}

/** One cursor page of sessions, normalized from the harness answer. */
export type OpencodeSessionPage = {
  readonly rows: readonly BridgeSessionRow[]
  readonly nextCursor: string | null
  readonly previousCursor: string | null
}

export type ListOpencodeSessionsOptions = {
  readonly baseUrl: string
  readonly apiPrefix: string
  readonly authorization: string
  readonly directory: string
  readonly cursor?: string
  readonly fetch?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readStringOrNumber(record: Record<string, unknown>, key: string): number | string | null {
  const value = record[key]
  if (typeof value === "number" || typeof value === "string") {
    return value
  }
  return null
}

/**
 * Normalizes one raw harness row. The v1 row carries `time: {created, updated}` epoch
 * milliseconds; v2 may flatten them, so both spellings are read. A row without a string
 * `id` cannot be addressed by any later call and degrades to a skip, never a crash.
 */
export function toBridgeSessionRow(raw: unknown): BridgeSessionRow | null {
  if (!isRecord(raw) || typeof raw["id"] !== "string") {
    return null
  }
  const time = isRecord(raw["time"]) ? raw["time"] : undefined
  const title = typeof raw["title"] === "string" ? raw["title"] : null
  const directory = typeof raw["directory"] === "string" ? raw["directory"] : null
  return {
    id: raw["id"],
    title,
    directory,
    timeCreated: time ? readStringOrNumber(time, "created") : readStringOrNumber(raw, "timeCreated"),
    timeUpdated: time ? readStringOrNumber(time, "updated") : readStringOrNumber(raw, "timeUpdated"),
  }
}

/**
 * `GET {prefix}/session?directory=<dir>` — the live-verified v2.1.4 answer is
 * `{"data":[...],"cursor":{"previous":...,"next":...}}`. The cursor travels back untouched
 * so the GUI pages with it; the harness's own gate answers 401 without credentials.
 */
export async function listOpencodeSessions(options: ListOpencodeSessionsOptions): Promise<OpencodeSessionPage> {
  const doFetch = options.fetch ?? fetch
  const url = new URL(`${options.apiPrefix}/session`, options.baseUrl)
  url.searchParams.set("directory", options.directory)
  if (options.cursor !== undefined) {
    url.searchParams.set("cursor", options.cursor)
  }
  const response = await doFetch(url, {
    headers: { authorization: options.authorization, accept: "application/json" },
  })
  if (response.status === 401) {
    throw new OpencodeAttachError("auth-refused", "opencode refused the credentials on the session list (401)", 401)
  }
  if (response.status !== 200) {
    throw new OpencodeAttachError("http-error", `opencode session list answered ${response.status}`, response.status)
  }
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new OpencodeAttachError("malformed-response", "opencode session list did not answer JSON")
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["data"]) || !isRecord(parsed["cursor"])) {
    throw new OpencodeAttachError("malformed-response", "opencode session list JSON is not a cursor-paged data object")
  }
  const cursor = parsed["cursor"] as Record<string, unknown>
  const readCursor = (key: string): string | null => (typeof cursor[key] === "string" ? (cursor[key] as string) : null)
  const rows: BridgeSessionRow[] = []
  for (const raw of parsed["data"]) {
    const row = toBridgeSessionRow(raw)
    if (row !== null) {
      rows.push(row)
    }
  }
  return { rows, nextCursor: readCursor("next"), previousCursor: readCursor("previous") }
}
