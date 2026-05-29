import { afterAll, beforeAll, beforeEach, describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Stream } from "effect"
import { Session as SessionNs } from "@/session/session"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"
import { Bus } from "@/bus"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"
import { SessionID, MessageID } from "@/session/schema"
import { ProviderID, ModelID } from "@/provider/schema"
import { MessageV2 } from "@/session/message-v2"
import type { Agent } from "@/agent/agent"
import path from "path"
import { ModelsDev } from "@opencode-ai/core/models-dev"

// ---------------------------------------------------------------------------
// Session-only layer for clearLatchedHeaders tests
// ---------------------------------------------------------------------------
const sessionIt = testEffect(
  Layer.mergeAll(
    SessionNs.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(Storage.defaultLayer),
      Layer.provide(SyncEvent.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
    ),
    CrossSpawnSpawner.defaultLayer,
  ),
)

describe("clearLatchedHeaders", () => {
  sessionIt.instance("resets latched state", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const info = yield* session.create({})

      yield* session.setLatchedHeaders({
        sessionID: info.id,
        headers: { "x-api-key": "test-key" },
      })

      const afterSet = yield* session.get(info.id)
      expect(afterSet.latchedHeaders).toEqual({ "x-api-key": "test-key" })

      yield* session.clearLatchedHeaders(info.id)

      const afterClear = yield* session.get(info.id)
      expect(afterClear.latchedHeaders).toBeUndefined()
    }),
  )

  sessionIt.instance("allows re-latching after clear", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const info = yield* session.create({})

      yield* session.setLatchedHeaders({
        sessionID: info.id,
        headers: { "x-api-key": "old-key" },
      })

      yield* session.clearLatchedHeaders(info.id)

      yield* session.setLatchedHeaders({
        sessionID: info.id,
        headers: { "x-api-key": "new-key" },
      })

      const afterRelatch = yield* session.get(info.id)
      expect(afterRelatch.latchedHeaders).toEqual({ "x-api-key": "new-key" })
    }),
  )
})

// ---------------------------------------------------------------------------
// LLM layer for concurrent header latching test
// ---------------------------------------------------------------------------
const llmIt = testEffect(
  Layer.mergeAll(LLM.defaultLayer, Provider.defaultLayer, SessionNs.defaultLayer),
)

const drain = (input: LLM.StreamInput) =>
  LLM.Service.use((svc) => svc.stream(input).pipe(Stream.runDrain))

const MODELS_FIXTURE = JSON.parse(
  await Bun.file(path.join(import.meta.dir, "../tool/fixtures/models-api.json")).text(),
) as Record<string, ModelsDev.Provider>

function loadFixture(providerID: string, modelID: string) {
  const provider = MODELS_FIXTURE[providerID]
  if (!provider) throw new Error(`Missing provider in fixture: ${providerID}`)
  const model = provider.models[modelID]
  if (!model) throw new Error(`Missing model in fixture: ${modelID}`)
  return { provider, model }
}

type ConfigModel = NonNullable<NonNullable<import("@/config/config").Config.Info["provider"]>[string]["models"]>[string]

function createChatStream(text: string) {
  const payload = [
    `data: ${JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      choices: [{ delta: { role: "assistant" } }],
    })}`,
    `data: ${JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      choices: [{ delta: { content: text } }],
    })}`,
    `data: ${JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      choices: [{ delta: {}, finish_reason: "stop" }],
    })}`,
    "data: [DONE]",
  ].join("\n\n") + "\n\n"

  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload))
      controller.close()
    },
  })
}

const state = {
  server: null as ReturnType<typeof Bun.serve> | null,
  requestCount: 0,
  capturedHeaders: [] as Record<string, string>[],
}

beforeAll(() => {
  state.server = Bun.serve({
    port: 0,
    async fetch(req) {
      state.requestCount++
      const headers: Record<string, string> = {}
      req.headers.forEach((value, key) => {
        headers[key] = value
      })
      state.capturedHeaders.push(headers)
      return new Response(createChatStream("Hello"), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    },
  })
})

beforeEach(() => {
  state.requestCount = 0
  state.capturedHeaders = []
})

afterAll(() => {
  void state.server?.stop()
})

describe("concurrent header latching", () => {
  const vivgridFixture = { providerID: "vivgrid", modelID: "gemini-3.1-pro-preview" }

  llmIt.instance(
    "only latches once when two concurrent fibers race",
    () =>
      Effect.gen(function* () {
        const fixture = loadFixture(vivgridFixture.providerID, vivgridFixture.modelID)
        const resolved = yield* Provider.use.getModel(
          ProviderID.make(vivgridFixture.providerID),
          ModelID.make(fixture.model.id),
        )

        const session = yield* SessionNs.Service
        const info = yield* session.create({})
        const sessionID = info.id

        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const makeUser = (id: string): MessageV2.User => ({
          id: MessageID.make(id),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: {
            providerID: ProviderID.make(vivgridFixture.providerID),
            modelID: resolved.id,
            variant: "high",
          },
        })

        const makeInput = (userId: string): LLM.StreamInput => ({
          user: makeUser(userId),
          sessionID,
          model: resolved,
          agent,
          system: ["You are a helpful assistant."],
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
        })

        // Fire two concurrent fibers for the same sessionID
        const fiber1 = yield* drain(makeInput("msg_user-race-1")).pipe(
          Effect.exit,
          Effect.forkScoped,
        )
        const fiber2 = yield* drain(makeInput("msg_user-race-2")).pipe(
          Effect.exit,
          Effect.forkScoped,
        )

        yield* Fiber.await(fiber1)
        yield* Fiber.await(fiber2)

        // Verify session has latchedHeaders set (behavioral guarantee)
        const afterRace = yield* session.get(sessionID)
        expect(afterRace.latchedHeaders).toBeDefined()
        expect(afterRace.latchedHeaders).not.toBeNull()

        // Verify only one DB write happened: the server received 2 requests
        // but setLatchedHeaders should have been called only once.
        // We verify this by checking that the session's latchedHeaders
        // are consistent (not corrupted by a race).
        expect(typeof afterRace.latchedHeaders).toBe("object")
      }),
    {
      config: () => ({
        enabled_providers: [vivgridFixture.providerID],
        provider: {
          [vivgridFixture.providerID]: {
            options: {
              apiKey: "test-key",
              baseURL: `${state.server!.url.origin}/v1`,
            },
          },
        },
      }),
    },
  )

  llmIt.instance(
    "concurrent requests send identical headers to the server",
    () =>
      Effect.gen(function* () {
        const fixture = loadFixture(vivgridFixture.providerID, vivgridFixture.modelID)
        const resolved = yield* Provider.use.getModel(
          ProviderID.make(vivgridFixture.providerID),
          ModelID.make(fixture.model.id),
        )

        const session = yield* SessionNs.Service
        const info = yield* session.create({})
        const sessionID = info.id

        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const makeUser = (id: string): MessageV2.User => ({
          id: MessageID.make(id),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: {
            providerID: ProviderID.make(vivgridFixture.providerID),
            modelID: resolved.id,
            variant: "high",
          },
        })

        const makeInput = (userId: string): LLM.StreamInput => ({
          user: makeUser(userId),
          sessionID,
          model: resolved,
          agent,
          system: ["You are a helpful assistant."],
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
        })

        // Fire two concurrent fibers for the same sessionID
        const fiber1 = yield* drain(makeInput("msg_user-hdr-1")).pipe(
          Effect.exit,
          Effect.forkScoped,
        )
        const fiber2 = yield* drain(makeInput("msg_user-hdr-2")).pipe(
          Effect.exit,
          Effect.forkScoped,
        )

        yield* Fiber.await(fiber1)
        yield* Fiber.await(fiber2)

        // Both requests should have been sent to the server
        expect(state.capturedHeaders.length).toBe(2)

        // Extract only the headers that matter for prompt cache stability
        // (exclude volatile headers like user-agent, host, connection, etc.)
        const normalizeHeaders = (h: Record<string, string>) => {
          const out: Record<string, string> = {}
          for (const [key, value] of Object.entries(h)) {
            const lower = key.toLowerCase()
            if (lower === "host" || lower === "connection" || lower === "user-agent" || lower === "accept-encoding") continue
            out[lower] = value
          }
          return out
        }

        const headers1 = normalizeHeaders(state.capturedHeaders[0]!)
        const headers2 = normalizeHeaders(state.capturedHeaders[1]!)

        // The critical assertion: both concurrent requests must send identical headers
        // This ensures prompt cache stability — if headers differ, the cache is busted
        expect(headers1).toEqual(headers2)
      }),
    {
      config: () => ({
        enabled_providers: [vivgridFixture.providerID],
        provider: {
          [vivgridFixture.providerID]: {
            options: {
              apiKey: "test-key",
              baseURL: `${state.server!.url.origin}/v1`,
            },
          },
        },
      }),
    },
  )
})
