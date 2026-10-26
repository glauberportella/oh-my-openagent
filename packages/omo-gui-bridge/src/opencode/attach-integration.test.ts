import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { createServer, type AddressInfo } from "node:net"
import { randomBytes } from "node:crypto"
import { describe, expect, test } from "bun:test"
import type { BridgeEventEnvelope } from "../server"
import { createOpencodeAttach } from "./opencode-attach"

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo
      server.close(() => resolve(address.port))
    })
  })
}

function awaitWithTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`waited ${ms}ms for ${what}, never fired`)), ms)
      timer.unref?.()
    }),
  ])
}

function resolveOpencodeBinary(): string | undefined {
  const onPath = Bun.which("opencode")
  if (onPath !== undefined && onPath !== null) {
    return onPath
  }
  const fallback = join(homedir(), ".opencode/bin/opencode")
  return existsSync(fallback) ? fallback : undefined
}

/**
 * Integration proof for the whole attach lane against a real sandboxed harness
 * (plan-bridge.md PR 2): a spawned `opencode serve` under isolated XDG roots (and its own
 * TMPDIR, so the Bun-compiled binary's runtime dylib lands inside the removed sandbox) must be
 * detected on its v2 `/api` prefix, must answer the session list with cursor-paged JSON,
 * and must deliver the first SSE frame `server.connected` through the event tap. The
 * sandbox's `OPENCODE_SERVER_PASSWORD` never leaves the child's explicit environment —
 * the test passes credentials straight to the client — and an unresolvable `opencode`
 * binary fails this test loudly: no silent skip, never a pass.
 */
describe("OpenCode attach integration (sandboxed opencode serve)", () => {
  test(
    "#given a sandboxed opencode serve with its own password #when the client attaches #then it detects /api, lists session JSON, and taps server.connected",
    async () => {
      // given
      const binary = resolveOpencodeBinary()
      expect(binary, "opencode binary not resolvable (PATH or ~/.opencode/bin) — the integration test refuses to skip silently").toBeDefined()
      const root = mkdtempSync(join(tmpdir(), "omo-gui-attach-"))
      const sandbox = {
        data: join(root, "data"),
        config: join(root, "config"),
        cache: join(root, "cache"),
        state: join(root, "state"),
        home: join(root, "home"),
        proj: join(root, "proj"),
        tmp: join(root, "tmp"),
      }
      for (const dir of Object.values(sandbox)) {
        mkdirSync(dir)
      }
      const password = randomBytes(16).toString("hex")
      const authorization = `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`
      const port = await freePort()
      const baseUrl = `http://127.0.0.1:${port}`
      const child = Bun.spawn([binary as string, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
        cwd: sandbox.proj,
        stdout: "ignore",
        stderr: "pipe",
        env: {
          ...process.env,
          HOME: sandbox.home,
          XDG_DATA_HOME: sandbox.data,
          XDG_CONFIG_HOME: sandbox.config,
          XDG_STATE_HOME: sandbox.state,
          XDG_CACHE_HOME: sandbox.cache,
          OPENCODE_SERVER_PASSWORD: password,
          OPENCODE_DISABLE_AUTOUPDATE: "1",
          OPENCODE_DISABLE_MODELS_FETCH: "1",
          TMPDIR: sandbox.tmp,
        },
      })
      let tap: { readonly stop: () => void } | undefined
      try {
        let reachable = false
        const deadline = Date.now() + 30_000
        while (Date.now() < deadline) {
          try {
            await fetch(`${baseUrl}/api/session?directory=${encodeURIComponent(sandbox.proj)}`, {
              headers: { authorization },
              signal: AbortSignal.timeout(500),
            })
            reachable = true
            break
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 150))
          }
        }
        if (!reachable) {
          const stderr = await new Response(child.stderr).text()
          throw new Error(`sandboxed opencode serve never answered on ${baseUrl}; stderr tail: ${stderr.slice(-2_000)}`)
        }

        // when — the harness's own gate first: no credentials, no API.
        const unauthenticated = await fetch(`${baseUrl}/api/session?directory=${encodeURIComponent(sandbox.proj)}`)
        expect(unauthenticated.status).toBe(401)

        const attach = createOpencodeAttach({ baseUrl, password })
        const prefix = await attach.detectApiPrefix()
        expect(prefix).toBe("/api")

        const page = await attach.listSessions({ directory: sandbox.proj })
        expect(Array.isArray(page.rows)).toBe(true)
        expect(page.nextCursor).toBe(null)
        expect(page.previousCursor).toBe(null)

        const envelopes: BridgeEventEnvelope[] = []
        let resolveFirst: () => void = () => {}
        const firstEnvelope = new Promise<BridgeEventEnvelope>((resolve) => {
          resolveFirst = () => resolve(envelopes[0] as BridgeEventEnvelope)
        })
        // subscribe first: the collector is registered before the tap connects.
        tap = attach.tapEvents({
          directory: sandbox.proj,
          retryDelayMs: 250,
          onEvent: (envelope) => {
            envelopes.push(envelope)
            resolveFirst()
          },
        })
        const first = await awaitWithTimeout(firstEnvelope, 10_000, "the first SSE envelope from the sandboxed opencode serve")

        // then — the first live frame on a v2.1.4 harness is server.connected.
        expect(first.topic).toBe("server.connected")
      } finally {
        tap?.stop()
        child.kill()
        await awaitWithTimeout(Promise.resolve(child.exited), 10_000, "the sandboxed opencode serve to exit")
        rmSync(root, { recursive: true, force: true })
      }
    },
    60_000,
  )
})
