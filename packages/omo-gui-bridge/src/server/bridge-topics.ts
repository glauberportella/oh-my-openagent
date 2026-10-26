// Normalized bridge event vocabulary shared by every attach lane and the GUI web layer.

/**
 * Dot-case topic name a bridge event is published under (for example `server.connected`).
 * Each attach lane owns the vocabulary it normalizes onto; the bridge only transports
 * envelopes, so the skeleton keeps the topic a plain string.
 */
export type BridgeTopicName = string

/**
 * The envelope every attach lane publishes onto the bridge event bus and every SSE
 * stream carries to the GUI. `data` is the topic-specific payload; the SSE outlet adds
 * the monotonic per-stream event id when it writes the wire frame.
 */
export type BridgeEventEnvelope = {
  readonly topic: BridgeTopicName
  readonly data: unknown
}
