import { randomBytes, timingSafeEqual } from "node:crypto"

/** Token entropy: 32 random bytes, base64url-encoded on the wire (43 characters). */
export const BRIDGE_TOKEN_BYTES = 32

export type BridgeTokenAuthority = {
  /** The currently valid token; out-of-band delivery (launcher URL, Electron IPC) reads it once. */
  readonly current: string
  /** Timing-safe verification of a presented token. */
  readonly verify: (presented: string) => boolean
  /** Mint a fresh token, invalidating the previous one; returns the new token. */
  readonly rotate: () => string
}

function mintBridgeToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url")
}

function verifyBridgeToken(presented: string, expected: string): boolean {
  const presentedBuffer = Buffer.from(presented)
  const expectedBuffer = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, so the length is compared first — the
  // same shape as the loopback OAuth state check this token gate is modeled on.
  return presentedBuffer.length === expectedBuffer.length && timingSafeEqual(presentedBuffer, expectedBuffer)
}

/**
 * One-time token authority for a bridge server launch: the token is minted once,
 * delivered out of band (browser launcher URL or Electron IPC), and verified with a
 * constant-time comparison on every request. Rotating re-mints and invalidates the
 * previous token.
 */
export function createBridgeTokenAuthority(options: { readonly bytes?: number } = {}): BridgeTokenAuthority {
  const bytes = options.bytes ?? BRIDGE_TOKEN_BYTES
  let current = mintBridgeToken(bytes)
  return {
    get current() {
      return current
    },
    verify: (presented) => verifyBridgeToken(presented, current),
    rotate() {
      current = mintBridgeToken(bytes)
      return current
    },
  }
}
