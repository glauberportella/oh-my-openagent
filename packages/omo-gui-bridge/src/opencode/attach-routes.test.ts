import { createServer, type IncomingMessage, type Server } from "node:http"
import type { ServerResponse } from "node:http"
import { afterEach, describe, expect, test } from "bun:test"
import { createBridgeServer } from "../server/create-bridge-server"
import { createOpencodeAttachRoutes } from "./attach-routes"
import { createOpencodeAttach } from "./opencode-attach"

const DIRECTORY = "/tmp/fixture-project"
const PASSWORD = "secret"
const AUTHORIZATION = `Basic ${Buffer.from(`opencode:${PASSWORD}`, "utf8").toString("base64")}`

describe("createOpencodeAttachRoutes", () => {
  const servers: Server[] = []
  const bridges: { close: () => Promise<void> }[] = []

  afterEach(async () => {
    for (const bridge of bridges.splice(0)) {
      await bridge.close()
    }
    for (const server of servers.splice(0)) {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  function serveOpencodeFixture(options: { readonly refuseAfterFirstAnswer?: boolean } = {}): Promise<string> {
    let answered = false
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      if (url.pathname !== "/api/session") {
        response.writeHead(404).end("not found")
        return
      }
      if (request.headers.authorization !== AUTHORIZATION) {
        response.writeHead(401).end("unauthorized")
        return
      }
      if (options.refuseAfterFirstAnswer === true) {
        if (answered) {
          response.writeHead(401).end("unauthorized")
          return
        }
        answered = true
      }
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            data: [{ id: "ses_1", title: "fixture session", directory: DIRECTORY, time: { created: 1, updated: 2 } }],
            cursor: { previous: null, next: null },
          }),
        )
    })
    servers.push(server)
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address()
        if (address === null || typeof address === "string") {
          throw new Error("fixture bound an unexpected address")
        }
        resolve(`http://127.0.0.1:${address.port}`)
      })
    })
  }

  test("#given a bridge wired to a token-gated attach lane #when the session route is called with the one-time token #then the harness answer reaches the caller as JSON rows", async () => {
    // given
    const opencodeOrigin = await serveOpencodeFixture()
    const attach = createOpencodeAttach({ baseUrl: opencodeOrigin, password: PASSWORD })
    await attach.detectApiPrefix()
    const bridge = await createBridgeServer({ routes: createOpencodeAttachRoutes({ attach }) })
    bridges.push(bridge)

    // when
    const sessionsUrl = new URL("/opencode/sessions", bridge.origin)
    sessionsUrl.searchParams.set("directory", DIRECTORY)
    sessionsUrl.searchParams.set("token", bridge.token)
    const withToken = await fetch(sessionsUrl)

    // then
    expect(withToken.status).toBe(200)
    expect(await withToken.json()).toEqual({
      rows: [{ id: "ses_1", title: "fixture session", directory: DIRECTORY, timeCreated: 1, timeUpdated: 2 }],
      nextCursor: null,
      previousCursor: null,
    })
  })

  test("#given the same bridge #when the attach routes are called without the token or with a missing directory #then the gate and the route refuse", async () => {
    // given
    const opencodeOrigin = await serveOpencodeFixture()
    const attach = createOpencodeAttach({ baseUrl: opencodeOrigin, password: PASSWORD })
    await attach.detectApiPrefix()
    const bridge = await createBridgeServer({ routes: createOpencodeAttachRoutes({ attach }) })
    bridges.push(bridge)

    // when
    const withoutToken = await fetch(new URL("/opencode/sessions?directory=/x", bridge.origin))
    const statusUrl = new URL("/opencode/attach", bridge.origin)
    statusUrl.searchParams.set("token", bridge.token)
    const status = await fetch(statusUrl)
    const missingDirectory = new URL("/opencode/sessions", bridge.origin)
    missingDirectory.searchParams.set("token", bridge.token)
    const refused = await fetch(missingDirectory)

    // then
    expect(withoutToken.status).toBe(401)
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({ baseUrl: opencodeOrigin, apiPrefix: "/api" })
    expect(refused.status).toBe(400)
  })

  test("#given an attach whose credentials the harness revokes after the probe #when the session route is called #then the typed failure surfaces as 502, never an empty list", async () => {
    // given — the probe answers, then the harness's gate refuses every later call, so the
    // failure surfaces through the route rather than at attach time.
    const opencodeOrigin = await serveOpencodeFixture({ refuseAfterFirstAnswer: true })
    const attach = createOpencodeAttach({ baseUrl: opencodeOrigin, password: PASSWORD })
    await attach.detectApiPrefix()
    const bridge = await createBridgeServer({ routes: createOpencodeAttachRoutes({ attach }) })
    bridges.push(bridge)

    // when
    const sessionsUrl = new URL("/opencode/sessions", bridge.origin)
    sessionsUrl.searchParams.set("directory", DIRECTORY)
    sessionsUrl.searchParams.set("token", bridge.token)
    const refused = await fetch(sessionsUrl)

    // then
    expect(refused.status).toBe(502)
    expect(await refused.json()).toMatchObject({ error: { kind: "auth-refused" } })
  })
})
