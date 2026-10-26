import { describe, expect, test } from "bun:test"
import { BRIDGE_TOKEN_BYTES, createBridgeTokenAuthority } from "./bridge-token"

describe("createBridgeTokenAuthority", () => {
  test("#given a fresh authority #when the token is read #then it is base64url for the full entropy", () => {
    // given
    const authority = createBridgeTokenAuthority()

    // when
    const token = authority.current

    // then
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Buffer.from(token, "base64url").length).toBe(BRIDGE_TOKEN_BYTES)
  })

  test("#given the minted token #when a token is presented #then only the minted one verifies", () => {
    // given
    const authority = createBridgeTokenAuthority()
    let other = authority.current
    while (other === authority.current) {
      other = createBridgeTokenAuthority().current
    }

    // when
    const mintedVerifies = authority.verify(authority.current)
    const sameLengthImpostorVerifies = authority.verify(other)
    const longerImpostorVerifies = authority.verify(`${other}x`)

    // then
    expect(mintedVerifies).toBe(true)
    expect(sameLengthImpostorVerifies).toBe(false)
    expect(longerImpostorVerifies).toBe(false)
  })

  test("#given a rotated authority #when the previous token is presented #then it fails and the new one passes", () => {
    // given
    const authority = createBridgeTokenAuthority()
    const previous = authority.current

    // when
    const next = authority.rotate()

    // then
    expect(next).not.toBe(previous)
    expect(authority.current).toBe(next)
    expect(authority.verify(previous)).toBe(false)
    expect(authority.verify(next)).toBe(true)
  })
})
