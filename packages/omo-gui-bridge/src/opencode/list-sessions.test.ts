import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, test } from "bun:test"
import { listOpencodeSessions, toBridgeSessionRow } from "./list-sessions"

const DIRECTORY = "/tmp/fixture-project"
const PASSWORD = "secret"
const AUTHORIZATION = `Basic ${Buffer.from(`opencode:${PASSWORD}`, "utf8").toString("base64")}`

describe("listOpencodeSessions", () => {
  const servers: Server[] = []

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  function serveFixture(): Promise<string> {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      if (url.pathname !== "/api/session") {
        response.writeHead(404).end("not found")
        return
      }
      if (request.headers.authorization !== AUTHORIZATION) {
        response.writeHead(401).end("unauthorized")
        return
      }
      if (url.searchParams.get("directory") !== DIRECTORY) {
        response.writeHead(400).end("missing directory")
        return
      }
      if (url.searchParams.get("cursor") === null) {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(
            JSON.stringify({
              data: [
                { id: "ses_v1", title: "v1 row", directory: DIRECTORY, time: { created: 1_769_000_000_000, updated: 1_769_000_001_000 } },
                { id: "ses_v2", title: "v2 row", directory: DIRECTORY, timeCreated: "2026-10-26T00:00:00.000Z", timeUpdated: "2026-10-26T00:01:00.000Z" },
                { title: "row without an id" },
              ],
              cursor: { previous: null, next: "cur_2" },
            }),
          )
        return
      }
      response.writeHead(200, { "content-type": "application/json" }).end(`{"data":[],"cursor":{"previous":"cur_2","next":null}}`)
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

  test("#given a cursor-paged harness answer #when sessions are listed #then rows normalize and the cursor travels back", async () => {
    // given
    const baseUrl = await serveFixture()

    // when
    const page = await listOpencodeSessions({ baseUrl, apiPrefix: "/api", authorization: AUTHORIZATION, directory: DIRECTORY })
    const nextPage = await listOpencodeSessions({
      baseUrl,
      apiPrefix: "/api",
      authorization: AUTHORIZATION,
      directory: DIRECTORY,
      cursor: page.nextCursor ?? undefined,
    })

    // then — the fixture answers 400 unless the cursor query is present, so nextPage proves the cursor was sent.
    expect(page.rows).toHaveLength(2)
    expect(page.rows[0]).toEqual({
      id: "ses_v1",
      title: "v1 row",
      directory: DIRECTORY,
      timeCreated: 1_769_000_000_000,
      timeUpdated: 1_769_000_001_000,
    })
    expect(page.rows[1]?.timeCreated).toBe("2026-10-26T00:00:00.000Z")
    expect(page.nextCursor).toBe("cur_2")
    expect(page.previousCursor).toBe(null)
    expect(nextPage.previousCursor).toBe("cur_2")
    expect(nextPage.nextCursor).toBe(null)
  })

  test("#given credentials the harness refuses #when sessions are listed #then it fails as an auth refusal", async () => {
    // given
    const baseUrl = await serveFixture()

    // when / then
    await expect(
      listOpencodeSessions({
        baseUrl,
        apiPrefix: "/api",
        authorization: `Basic ${Buffer.from("opencode:wrong", "utf8").toString("base64")}`,
        directory: DIRECTORY,
      }),
    ).rejects.toMatchObject({ kind: "auth-refused", status: 401 })
  })

  test("#given a harness answer without the cursor-paged shape #when sessions are listed #then it fails as malformed", async () => {
    // given
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" }).end(`{"unrelated":true}`)
    })
    servers.push(server)
    const baseUrl = await new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address()
        if (address === null || typeof address === "string") {
          throw new Error("fixture bound an unexpected address")
        }
        resolve(`http://127.0.0.1:${address.port}`)
      })
    })

    // when / then
    await expect(
      listOpencodeSessions({ baseUrl, apiPrefix: "/api", authorization: AUTHORIZATION, directory: DIRECTORY }),
    ).rejects.toMatchObject({ kind: "malformed-response" })
  })
})

describe("toBridgeSessionRow", () => {
  test("#given a row without a string id #when it is normalized #then it degrades to a skip, not a row", () => {
    // given / when / then
    expect(toBridgeSessionRow({ title: "no id" })).toBe(null)
    expect(toBridgeSessionRow("ses_string")).toBe(null)
    expect(toBridgeSessionRow(null)).toBe(null)
  })
})
