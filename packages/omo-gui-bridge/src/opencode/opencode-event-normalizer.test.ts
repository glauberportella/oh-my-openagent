import { describe, expect, test } from "bun:test"
import { normalizeOpencodeEvent, OPENCODE_BRIDGE_TOPICS } from "./opencode-event-normalizer"

describe("normalizeOpencodeEvent", () => {
  test("#given the v2 wire shape #when server.connected is normalized #then the payload is the frame's data record", () => {
    // given
    const frame = { id: "evt_1", type: "server.connected", data: {} }

    // when
    const envelope = normalizeOpencodeEvent(frame)

    // then
    expect(envelope).toEqual({ topic: "server.connected", data: {} })
  })

  test("#given the v1 wire shape #when session.error is normalized #then the payload is the frame's properties record", () => {
    // given
    const frame = { type: "session.error", properties: { sessionID: "ses_1", error: "boom" } }

    // when
    const envelope = normalizeOpencodeEvent(frame)

    // then
    expect(envelope).toEqual({ topic: "session.error", data: { sessionID: "ses_1", error: "boom" } })
  })

  test("#given a flat v1 frame without a nested payload #when it is normalized #then the frame travels whole", () => {
    // given
    const frame = { type: "message.part.delta", sessionID: "ses_1", partID: "prt_1" }

    // when
    const envelope = normalizeOpencodeEvent(frame)

    // then
    expect(envelope).toEqual({ topic: "message.part.delta", data: frame })
  })

  test("#given a frame whose type is not bridge vocabulary #when it is normalized #then it is dropped", () => {
    // given — session.created is real v1 vocabulary the run/ launcher does not handle;
    // the bridge transports the ten-topic vocabulary and nothing else.
    expect(OPENCODE_BRIDGE_TOPICS).toContain("server.connected")
    expect(OPENCODE_BRIDGE_TOPICS).not.toContain("session.created")

    // when / then
    expect(normalizeOpencodeEvent({ type: "session.created", properties: {} })).toBe(null)
    expect(normalizeOpencodeEvent({ type: "totally.unknown" })).toBe(null)
    expect(normalizeOpencodeEvent("data: string")).toBe(null)
    expect(normalizeOpencodeEvent(42)).toBe(null)
    expect(normalizeOpencodeEvent(null)).toBe(null)
  })
})
