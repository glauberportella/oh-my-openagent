import { OpencodeAttachError } from "./opencode-attach-error"

/** Delay between reconnect attempts, the `STREAM_RETRY_MS = 5_000` shape of the repo's hand-rolled SSE client. */
export const OPENCODE_EVENT_RETRY_MS = 5_000

export type OpencodeEventTapState = "connecting" | "streaming" | "failed" | "stopped"

export type OpencodeEventTapOptions = {
  /** Full SSE URL: `{prefix}/event?directory=<dir>` on the target harness. */
  readonly url: string
  readonly authorization: string
  readonly fetch?: typeof fetch
  /** Receives every parsed `data:` frame, in stream order. Heartbeat comments never arrive here. */
  readonly onEvent: (frame: unknown) => void
  /** Called at most once, when the tap gives up permanently: the harness's auth gate refused the credentials. */
  readonly onFailure?: (error: OpencodeAttachError) => void
  readonly retryDelayMs?: number
  readonly signal?: AbortSignal
}

export type OpencodeEventTap = {
  readonly stop: () => void
  readonly state: () => OpencodeEventTapState
}

/**
 * Consumes the harness SSE event stream (`accept: text/event-stream`), splitting frames on
 * `\n\n` and joining `data:` lines the way the repo's own SSE client does. Reconnects with
 * a bounded delay on stream end, network error, or a transient HTTP error; a 401/403 is
 * the harness's own auth gate refusing the credentials, so the tap fails permanently
 * instead of hammering the gate. A `data:` frame whose JSON is torn mid-stream is skipped
 * — the next reconnect re-establishes the stream — while stop() aborts everything in
 * flight and clears the pending retry timer so nothing lingers.
 */
export function createOpencodeEventTap(options: OpencodeEventTapOptions): OpencodeEventTap {
  const doFetch = options.fetch ?? fetch
  const retryDelayMs = options.retryDelayMs ?? OPENCODE_EVENT_RETRY_MS
  const abort = new AbortController()
  let state: OpencodeEventTapState = "connecting"
  let stopped = false
  let pendingTimer: ReturnType<typeof setTimeout> | undefined

  const stop = (): void => {
    stopped = true
    state = "stopped"
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer)
      pendingTimer = undefined
    }
    abort.abort()
  }

  options.signal?.addEventListener(
    "abort",
    () => {
      stop()
    },
    { once: true },
  )

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      pendingTimer = setTimeout(() => {
        pendingTimer = undefined
        resolve()
      }, ms)
    })

  void (async (): Promise<void> => {
    while (!stopped) {
      try {
        const response = await doFetch(options.url, {
          headers: { authorization: options.authorization, accept: "text/event-stream" },
          signal: abort.signal,
        })
        if (response.status === 401 || response.status === 403) {
          state = "failed"
          options.onFailure?.(
            new OpencodeAttachError(
              "auth-refused",
              `opencode refused the credentials on the event stream (${response.status})`,
              response.status,
            ),
          )
          return
        }
        if (!response.ok || response.body === null) {
          await wait(retryDelayMs)
          continue
        }
        state = "streaming"
        let buffer = ""
        const decoder = new TextDecoder()
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true })
          let end = buffer.indexOf("\n\n")
          while (end >= 0) {
            const frame = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            end = buffer.indexOf("\n\n")
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n")
            if (data === "") {
              continue
            }
            try {
              options.onEvent(JSON.parse(data))
            } catch (error) {
              if (!(error instanceof SyntaxError)) {
                throw error
              }
              // A torn frame mid-stream: skip it, the next reconnect re-establishes the stream.
            }
          }
        }
      } catch {
        if (stopped || abort.signal.aborted) {
          return
        }
        // A dropped or reset connection is transient: reconnect after the bounded delay.
      }
      if (stopped) {
        return
      }
      state = "connecting"
      await wait(retryDelayMs)
    }
  })()

  return {
    stop,
    state: () => state,
  }
}
