/** Why an OpenCode attach call failed; every failure the lane can observe is one of these kinds. */
export type OpencodeAttachErrorKind =
  | "auth-refused"
  | "surface-missing"
  | "http-error"
  | "prefix-unresolved"
  | "malformed-response"

/** Typed failure for every OpenCode attach surface (detector, session list, event tap, routes). */
export class OpencodeAttachError extends Error {
  override readonly name = "OpencodeAttachError"
  constructor(
    readonly kind: OpencodeAttachErrorKind,
    message: string,
    /** HTTP status of the harness answer that produced the failure, when there was one. */
    readonly status?: number,
  ) {
    super(message)
  }
}
