import type { BridgeEventEnvelope } from "../server"

/**
 * The bridge topic vocabulary this lane normalizes onto. Nine of the ten are exactly the
 * frame types the repo's own `run` launcher handles; `server.connected` is the tenth — the
 * first live SSE frame a v2.1.4 harness sends, and the frame this lane's integration test
 * asserts. Types outside the vocabulary are dropped, not guessed onto a topic.
 */
export const OPENCODE_BRIDGE_TOPICS = [
  "server.connected",
  "message.part.delta",
  "message.part.updated",
  "message.updated",
  "session.idle",
  "session.error",
  "session.status",
  "tool.execute",
  "tool.result",
  "tui.toast",
] as const

export type OpencodeBridgeTopic = (typeof OPENCODE_BRIDGE_TOPICS)[number]

const TOPIC_SET: ReadonlySet<string> = new Set(OPENCODE_BRIDGE_TOPICS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Maps one parsed harness frame onto the bridge envelope. The v2 wire shape is
 * `{id, type, data}` (payload in `data`); the v1 wire shape is `{type, properties}`
 * (payload in `properties`) — the first of the two that is a record becomes the envelope
 * payload, and a frame carrying neither travels whole. `null` means the frame is not
 * bridge vocabulary and the tap skips it.
 */
export function normalizeOpencodeEvent(frame: unknown): BridgeEventEnvelope | null {
  if (!isRecord(frame)) {
    return null
  }
  const type = frame["type"]
  if (typeof type !== "string" || !TOPIC_SET.has(type)) {
    return null
  }
  const data = isRecord(frame["data"]) ? frame["data"] : isRecord(frame["properties"]) ? frame["properties"] : frame
  return { topic: type, data }
}
