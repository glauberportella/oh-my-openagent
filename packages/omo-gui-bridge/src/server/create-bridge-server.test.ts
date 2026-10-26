import { afterEach, describe, expect, test } from "bun:test"
import { connect } from "node:net"
import { networkInterfaces } from "node:os"
import { createBridgeServer, type BridgeServer } from "./create-bridge-server"

const CONNECT_REFUSAL_TIMEOUT_MS = 2_000

const servers: BridgeServer[] = []

function track(server: BridgeServer): BridgeServer {
  servers.push(server)
  return server
}

function nonLoopbackIpv4Addresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address)
    }
  }
  return addresses
}

function connectRefused(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, host)
    const settle = (outcome: boolean) => {
      socket.destroy()
      resolve(outcome)
    }
    socket.once("error", (error) => settle("code" in error && error.code === "ECONNREFUSED"))
    socket.once("connect", () => settle(false))
    const timer = setTimeout(() => settle(false), CONNECT_REFUSAL_TIMEOUT_MS)
    timer.unref()
    socket.once("close", () => clearTimeout(timer))
  })
}

describe("createBridgeServer", () => {
  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()
      if (server !== undefined) await server.close()
    }
  })

  test("#given a running bridge server #when a request arrives without a token #then it answers 401", async () => {
    // given
    const server = track(await createBridgeServer())

    // when
    const response = await fetch(server.origin)

    // then
    expect(response.status).toBe(401)
    expect(await response.text()).toBe("Unauthorized")
  })

  test("#given a running bridge server #when the token rides in the URL #then it answers 200 with the status body", async () => {
    // given
    const server = track(await createBridgeServer())

    // when
    const response = await fetch(`${server.origin}/?token=${encodeURIComponent(server.token)}`)

    // then
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(await response.json()).toEqual({ ok: true })
  })

  test("#given a running bridge server #when the listening address is probed #then it is bound to 127.0.0.1 only", async () => {
    // given
    const server = track(await createBridgeServer())
    const nonLoopbackAddresses = nonLoopbackIpv4Addresses()

    // when
    const loopbackReachable = await fetch(`${server.origin}/?token=${encodeURIComponent(server.token)}`)
    const nonLoopbackAnswers = await Promise.all(
      nonLoopbackAddresses.map((address) => connectRefused(address, server.port)),
    )

    // then
    expect(server.origin).toBe(`http://127.0.0.1:${server.port}`)
    expect(loopbackReachable.status).toBe(200)
    // The loopback-only bind is only observable against an interface that exists; CI and
    // every developer host carry one, and there the connection must be refused.
    if (nonLoopbackAnswers.length > 0) {
      expect(nonLoopbackAnswers.every((refused) => refused)).toBe(true)
    }
  })
})
