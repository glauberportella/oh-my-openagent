import { afterEach, describe, expect, test } from "bun:test"
import { request } from "node:http"
import { createBridgeServer, type BridgeServer } from "./create-bridge-server"

const servers: BridgeServer[] = []

function track(server: BridgeServer): BridgeServer {
  servers.push(server)
  return server
}

function rawRequest(
  port: number,
  headers: Record<string, string>,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (response) => {
        response.setEncoding("utf8")
        let body = ""
        response.on("data", (chunk: string) => {
          body += chunk
        })
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }))
      },
    )
    outgoing.on("error", reject)
    outgoing.end()
  })
}

describe("createBridgeRequestGate", () => {
  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop()
      if (server !== undefined) await server.close()
    }
  })

  test("#given a running bridge #when the Host header names another origin #then the request is refused", async () => {
    // given
    const server = track(await createBridgeServer())

    // when
    const answer = await rawRequest(server.port, { host: "example.com" }, "/")

    // then
    expect(answer.status).toBe(404)
  })

  test("#given a valid token #when the Host header still names another origin #then the request is refused", async () => {
    // given — the transport-shape checks run before the token is ever consulted
    const server = track(await createBridgeServer())

    // when
    const answer = await rawRequest(server.port, { host: "example.com" }, `/?token=${server.token}`)

    // then
    expect(answer.status).toBe(404)
  })

  test("#given a valid token and host #when a proxy header rides along #then the request is refused", async () => {
    // given
    const server = track(await createBridgeServer())
    const host = `127.0.0.1:${server.port}`
    const path = `/?token=${server.token}`

    // when
    const forwardedFor = await rawRequest(server.port, { host, "x-forwarded-for": "203.0.113.7" }, path)
    const forwarded = await rawRequest(server.port, { host, forwarded: "for=203.0.113.7" }, path)

    // then
    expect(forwardedFor.status).toBe(404)
    expect(forwarded.status).toBe(404)
  })

  test("#given a request offering several tokens #when it is admitted #then it answers 401", async () => {
    // given — exactly one token parameter is the contract; ambiguity is a refusal
    const server = track(await createBridgeServer())
    const host = `127.0.0.1:${server.port}`

    // when
    const answer = await rawRequest(server.port, { host }, `/?token=${server.token}&token=${server.token}`)

    // then
    expect(answer.status).toBe(401)
  })
})
