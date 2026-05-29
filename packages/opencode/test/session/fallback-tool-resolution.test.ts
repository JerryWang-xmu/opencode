import { afterAll, beforeAll, beforeEach, describe, expect } from "bun:test"
import path from "path"
import { tool } from "ai"
import { Effect, Layer, Stream } from "effect"
import { LLM } from "../../src/session/llm"
import { Provider } from "@/provider/provider"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { testEffect } from "../lib/effect"
import type { Agent } from "../../src/agent/agent"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID } from "../../src/session/schema"
import { Session as SessionNs } from "@/session/session"
import z from "zod"
import type { Config } from "@/config/config"

type ConfigModel = NonNullable<NonNullable<Config.Info["provider"]>[string]["models"]>[string]

const it = testEffect(Layer.mergeAll(LLM.defaultLayer, Provider.defaultLayer, SessionNs.defaultLayer))

const drain = (input: LLM.StreamInput) => LLM.Service.use((svc) => svc.stream(input).pipe(Stream.runDrain))

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

function configModel(model: ModelsDev.Model) {
  return {
    id: model.id,
    name: model.name,
    family: model.family,
    release_date: model.release_date,
    attachment: model.attachment,
    reasoning: model.reasoning,
    temperature: model.temperature,
    tool_call: model.tool_call,
    interleaved: model.interleaved,
    cost: model.cost ? { ...model.cost, tiers: undefined } : undefined,
    limit: model.limit,
    modalities: model.modalities,
    status: model.status,
    provider: model.provider,
  }
}

type Capture = {
  url: URL
  headers: Headers
  body: Record<string, unknown>
}

const state = {
  server: null as ReturnType<typeof Bun.serve> | null,
  queue: [] as Array<{
    path: string
    response: Response | ((req: Request, capture: Capture) => Response)
    resolve: (value: Capture) => void
  }>,
}

function deferred<T>() {
  const result = {} as { promise: Promise<T>; resolve: (value: T) => void }
  result.promise = new Promise((resolve) => {
    result.resolve = resolve
  })
  return result
}

function waitRequest(pathname: string, response: Response | ((req: Request, capture: Capture) => Response)) {
  const pending = deferred<Capture>()
  state.queue.push({ path: pathname, response, resolve: pending.resolve })
  return pending.promise
}

function createChatStream(text: string) {
  const payload =
    [
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

beforeAll(() => {
  state.server = Bun.serve({
    port: 0,
    async fetch(req) {
      const next = state.queue.shift()
      if (!next) {
        return new Response("unexpected request", { status: 500 })
      }

      const url = new URL(req.url)
      const body = (await req.json()) as Record<string, unknown>
      next.resolve({ url, headers: req.headers, body })

      if (!url.pathname.endsWith(next.path)) {
        return new Response("not found", { status: 404 })
      }

      return typeof next.response === "function"
        ? next.response(req, { url, headers: req.headers, body })
        : next.response
    },
  })
})

beforeEach(() => {
  state.queue.length = 0
})

afterAll(() => {
  void state.server?.stop()
})

describe("fallback tool resolution", () => {
  // runWithModel must filter tools based on the actual model being used.
  // This ensures fallback models get the correct tool set (GPT vs non-GPT).

  const nonGptFixture = loadFixture("vivgrid", "gemini-3.1-pro-preview")

  it.instance(
    "fallback model re-resolves tools for the new model",
    () =>
      Effect.gen(function* () {
        // Use a non-GPT model (gemini) - should exclude apply_patch, keep edit/write
        const request = waitRequest(
          "/chat/completions",
          new Response(createChatStream("hello"), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        )

        const resolved = yield* Provider.use.getModel(
          ProviderID.make("vivgrid"),
          ModelID.make(nonGptFixture.model.id),
        )
        const sessionID = SessionID.make("session-fallback-tools")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("msg_user-fallback-tools"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make("vivgrid"), modelID: resolved.id },
        } satisfies MessageV2.User

        // Pass tools that include both GPT-specific and non-GPT-specific tools.
        // Simulates the scenario where tools were resolved for a GPT primary model
        // but the actual model (fallback) is non-GPT.
        const inputTools = {
          apply_patch: tool({
            description: "Apply a patch",
            inputSchema: z.object({ patch: z.string() }),
            execute: async () => ({ output: "patched" }),
          }),
          edit: tool({
            description: "Edit a file",
            inputSchema: z.object({ path: z.string() }),
            execute: async () => ({ output: "edited" }),
          }),
          write: tool({
            description: "Write a file",
            inputSchema: z.object({ path: z.string() }),
            execute: async () => ({ output: "written" }),
          }),
          bash: tool({
            description: "Run a command",
            inputSchema: z.object({ command: z.string() }),
            execute: async () => ({ output: "ran" }),
          }),
        }

        yield* drain({
          user,
          sessionID,
          model: resolved,
          agent,
          system: ["You are a helpful assistant."],
          messages: [{ role: "user", content: "Hello" }],
          tools: inputTools,
        })

        const capture = yield* Effect.promise(() => request)
        const tools = capture.body.tools as Array<{ function?: { name?: string } }> | undefined

        // Non-GPT model (gemini) should NOT have apply_patch
        expect(tools?.some((t) => t.function?.name === "apply_patch")).toBe(false)

        // edit and write SHOULD be present for non-GPT model
        expect(tools?.some((t) => t.function?.name === "edit")).toBe(true)
        expect(tools?.some((t) => t.function?.name === "write")).toBe(true)

        // bash should still be present (model-agnostic tool)
        expect(tools?.some((t) => t.function?.name === "bash")).toBe(true)
      }),
    {
      config: () => ({
        enabled_providers: ["vivgrid"],
        provider: {
          vivgrid: {
            options: { apiKey: "test-key", baseURL: `${state.server!.url.origin}/v1` },
            models: {
              [nonGptFixture.model.id]: JSON.parse(JSON.stringify(configModel(nonGptFixture.model))) as ConfigModel,
            },
          },
        },
      }),
    },
  )

  const gptFixture = loadFixture("vivgrid", "gpt-5-mini")

  it.instance(
    "primary model tools are not mutated by fallback",
    () =>
      Effect.gen(function* () {
        // Use a GPT model - should exclude edit/write, keep apply_patch
        const request = waitRequest(
          "/chat/completions",
          new Response(createChatStream("hello"), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        )

        const resolved = yield* Provider.use.getModel(
          ProviderID.make("vivgrid"),
          ModelID.make(gptFixture.model.id),
        )
        const sessionID = SessionID.make("session-fallback-no-mutate")
        const agent = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        } satisfies Agent.Info

        const user = {
          id: MessageID.make("msg_user-fallback-no-mutate"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make("vivgrid"), modelID: resolved.id },
        } satisfies MessageV2.User

        // Pass tools that include both GPT-specific and non-GPT-specific tools
        const inputTools = {
          apply_patch: tool({
            description: "Apply a patch",
            inputSchema: z.object({ patch: z.string() }),
            execute: async () => ({ output: "patched" }),
          }),
          edit: tool({
            description: "Edit a file",
            inputSchema: z.object({ path: z.string() }),
            execute: async () => ({ output: "edited" }),
          }),
          write: tool({
            description: "Write a file",
            inputSchema: z.object({ path: z.string() }),
            execute: async () => ({ output: "written" }),
          }),
          bash: tool({
            description: "Run a command",
            inputSchema: z.object({ command: z.string() }),
            execute: async () => ({ output: "ran" }),
          }),
        }

        const originalKeys = Object.keys(inputTools).sort()

        yield* drain({
          user,
          sessionID,
          model: resolved,
          agent,
          system: ["You are a helpful assistant."],
          messages: [{ role: "user", content: "Hello" }],
          tools: inputTools,
        })

        const capture = yield* Effect.promise(() => request)
        const tools = capture.body.tools as Array<{ function?: { name?: string } }> | undefined

        // GPT model should NOT have edit/write
        expect(tools?.some((t) => t.function?.name === "edit")).toBe(false)
        expect(tools?.some((t) => t.function?.name === "write")).toBe(false)

        // apply_patch SHOULD be present for GPT model
        expect(tools?.some((t) => t.function?.name === "apply_patch")).toBe(true)

        // bash should still be present
        expect(tools?.some((t) => t.function?.name === "bash")).toBe(true)

        // Verify original tools object was not mutated
        const afterKeys = Object.keys(inputTools).sort()
        expect(afterKeys).toEqual(originalKeys)
        expect(inputTools.apply_patch).toBeDefined()
        expect(inputTools.edit).toBeDefined()
        expect(inputTools.write).toBeDefined()
        expect(inputTools.bash).toBeDefined()
      }),
    {
      config: () => ({
        enabled_providers: ["vivgrid"],
        provider: {
          vivgrid: {
            options: { apiKey: "test-key", baseURL: `${state.server!.url.origin}/v1` },
            models: {
              [gptFixture.model.id]: JSON.parse(JSON.stringify(configModel(gptFixture.model))) as ConfigModel,
            },
          },
        },
      }),
    },
  )
})
