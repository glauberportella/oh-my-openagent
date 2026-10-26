import type { BridgeEventEnvelope } from "./bridge-topics"

export type BridgeEventListener = (event: BridgeEventEnvelope) => void

export type BridgeEventBus = {
  /** Fan an envelope out to every current subscriber. */
  readonly publish: (event: BridgeEventEnvelope) => void
  /** Subscribe a listener; the returned function unsubscribes it. */
  readonly subscribe: (listener: BridgeEventListener) => () => void
}

/**
 * In-process publish/subscribe bus: attach clients publish onto it and the SSE outlet
 * taps it. Fan-out is synchronous. A listener that throws is a dead sink — it is
 * dropped so the publisher and the remaining sinks keep flowing.
 */
export function createBridgeEventBus(): BridgeEventBus {
  const listeners = new Set<BridgeEventListener>()
  return {
    publish(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event)
        } catch {
          listeners.delete(listener)
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
