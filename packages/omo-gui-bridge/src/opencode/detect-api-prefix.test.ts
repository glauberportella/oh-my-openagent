import { createServer, type IncomingMessage, type Server } from "node:http"
import type { ServerResponse } from "node:http"
import { afterEach, describe, expect, test } from "bun:test"
import { detectOpencodeApiPrefix } from "./detect-api-prefix"

const AUTH = "Basic dGVzdA=="

type FixtureHandler = (request: IncomingMessage, response: ServerResponse) => void

describe("detectOpencodeApiPrefix", () => {
  const servers: Server[] = []

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  function serve(handler: FixtureHandler): Promise<string> {
    const server = createServer(handler)
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

  test("#given a v2-shaped harness (JSON under /api) #when the prefix is detected #then /api is reported", async () => {
    // given — the exact machine shape that broke both stock QA scripts on v2.1.4: the API
    // lives under /api while the legacy unprefixed path is an SPA catch-all answering HTML.
    const origin = await serve((request, response) => {
      if (request.url === "/api/session") {
        response.writeHead(200, { "content-type": "application/json" }).end(`{"data":[],"cursor":{"previous":null,"next":null}}`)
        return
      }
      if (request.url === "/session") {
        response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><html><body>SPA</body></html>")
        return
      }
      response.writeHead(404).end("not found")
    })

    // when
    const prefix = await detectOpencodeApiPrefix({ baseUrl: origin, authorization: AUTH })

    // then
    expect(prefix).toBe("/api")
  })

  test("#given a v1-shaped harness (session array at the unprefixed path, no /api) #when the prefix is detected #then the empty prefix is reported", async () => {
    // given
    const origin = await serve((request, response) => {
      if (request.url === "/session") {
        response.writeHead(200, { "content-type": "application/json" }).end(`[{"id":"ses_1"}]`)
        return
      }
      response.writeHead(404).end("not found")
    })

    // when
    const prefix = await detectOpencodeApiPrefix({ baseUrl: origin, authorization: AUTH })

    // then
    expect(prefix).toBe("")
  })

  test("#given a harness whose every 200 answer is HTML #when the prefix is detected #then it fails instead of trusting the legacy path", async () => {
    // given — a 200 at the legacy path is exactly what the stock QA scripts trusted on
    // v2.1.4; the detector must refuse to read SPA HTML as the API surface.
    const origin = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><html><body>SPA</body></html>")
    })

    // when / then
    await expect(detectOpencodeApiPrefix({ baseUrl: origin, authorization: AUTH })).rejects.toMatchObject({
      kind: "surface-missing",
    })
  })

  test("#given a harness whose Basic-auth gate refuses the credentials #when the prefix is detected #then it fails as an auth refusal", async () => {
    // given
    const origin = await serve((_request, response) => {
      response.writeHead(401).end("unauthorized")
    })

    // when / then
    await expect(detectOpencodeApiPrefix({ baseUrl: origin, authorization: AUTH })).rejects.toMatchObject({
      kind: "auth-refused",
      status: 401,
    })
  })
})
