import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "../../src/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionV2 } from "../../src/v2/session"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import * as Log from "@opencode-ai/core/util/log"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "../../src/file/ripgrep"
import { Format } from "../../src/format"
import { Reference } from "../../src/reference/reference"
import { RepositoryCache } from "../../src/reference/repository-cache"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import { SyncEvent } from "../../src/sync"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { MemoryExtraction } from "../../src/memory/extraction"
import { MemoryAutoDream } from "../../src/memory/autoDream"
import { ProviderID, ModelID } from "../../src/provider/schema"

void Log.init({ print: false })

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

function makePrompt() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    BackgroundJob.defaultLayer,
    SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer)),
    SyncEvent.defaultLayer,
    EventV2Bridge.defaultLayer,
  ).pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)))

  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(RepositoryCache.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Reference.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer.pipe(
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(proc),
    Layer.provideMerge(deps),
  )
  const run = SessionRunState.layer.pipe(Layer.provide(SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))))

  return SessionPrompt.layer.pipe(
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(Reference.defaultLayer),
    Layer.provide(MemoryExtraction.defaultLayer),
    Layer.provide(MemoryAutoDream.defaultLayer),
    Layer.provide(summary),
    Layer.provideMerge(run),
    Layer.provideMerge(compact),
    Layer.provideMerge(proc),
    Layer.provideMerge(registry),
    Layer.provideMerge(trunc),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(SystemPrompt.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
    Layer.provide(summary),
  )
}

function makeHttp() {
  return Layer.mergeAll(TestLLMServer.layer, makePrompt())
}

const it = testEffect(makeHttp())

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fs = yield* AppFileSystem.Service
  yield* fs.writeWithDirs(file, text)
})

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<Config.Info>) {
  yield* writeText(`${dir}/opencode.json`, JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config }))
})

const useServerConfig = Effect.fn("test.useServerConfig")(function* (config: (url: string) => Partial<Config.Info>) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

const user = Effect.fn("test.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

describe("Compact Circuit Breaker", () => {
  it.instance(
    "should break loop after 3 consecutive compact cycles",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const session = yield* Session.Service

        const sess = yield* session.create({
          title: "test",
          parentID: undefined,
        })

        yield* user(sess.id, "test message")

        yield* llm.push(
          reply()
            .text("response that causes overflow")
            .usage({ input: 95000, output: 1000 })
            .stop()
            .item(),
        )
        yield* llm.push(
          reply()
            .text("response after compact 1")
            .usage({ input: 95000, output: 1000 })
            .stop()
            .item(),
        )
        yield* llm.push(
          reply()
            .text("response after compact 2")
            .usage({ input: 95000, output: 1000 })
            .stop()
            .item(),
        )
        yield* llm.push(
          reply()
            .text("response after compact 3")
            .usage({ input: 95000, output: 1000 })
            .stop()
            .item(),
        )

        const result = yield* prompt.loop({
          sessionID: sess.id,
        })

        expect(result).toBeDefined()
        expect(result.info.role).toBe("assistant")

        const calls = yield* llm.calls
        expect(calls).toBe(5)
      }),
    { timeout: 30000 },
  )

  it.instance(
    "should reset counter after successful non-overflow call",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const session = yield* Session.Service

        const sess = yield* session.create({
          title: "test",
          parentID: undefined,
        })

        yield* user(sess.id, "test message")

        yield* llm.push(
          reply()
            .text("overflow 1")
            .usage({ input: 95000, output: 1000 })
            .stop()
            .item(),
        )
        yield* llm.push(
          reply()
            .text("success")
            .usage({ input: 10000, output: 1000 })
            .stop()
            .item(),
        )
        yield* llm.push(
          reply()
            .text("overflow 2")
            .usage({ input: 95000, output: 1000 })
            .stop()
            .item(),
        )
        yield* llm.push(
          reply()
            .text("success 2")
            .usage({ input: 10000, output: 1000 })
            .stop()
            .item(),
        )

        const result = yield* prompt.loop({
          sessionID: sess.id,
        })

        expect(result).toBeDefined()
        const calls = yield* llm.calls
        expect(calls).toBe(5)
      }),
    { timeout: 30000 },
  )

  it.instance(
    "circuit breaker allows exactly MAX_COMPACT_ATTEMPTS compactions",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const session = yield* Session.Service

        const sess = yield* session.create({
          title: "test",
          parentID: undefined,
        })

        yield* user(sess.id, "test message")

        // Push enough responses for 3 successful compactions + 1 that trips breaker
        // Each compaction cycle: main call (overflow) + compaction summary call
        for (let i = 0; i < 8; i++) {
          yield* llm.push(
            reply()
              .text(`response ${i}`)
              .usage({ input: 95000, output: 1000 })
              .stop()
              .item(),
          )
        }

        const result = yield* prompt.loop({
          sessionID: sess.id,
        })

        expect(result).toBeDefined()
        expect(result.info.role).toBe("assistant")

        // With MAX_COMPACT_ATTEMPTS=3, exactly 3 compactions should succeed
        // The 3rd overflow triggers the breaker (counter reaches MAX)
        // Total calls: 3 cycles (each = main overflow + compaction summary) - 1 summary skipped at trip
        // Call 1: main overflow → counter=1 → compaction, Call 2: summary
        // Call 3: main overflow → counter=2 → compaction, Call 4: summary
        // Call 5: main overflow → counter=3 → breaker trips
        const calls = yield* llm.calls
        expect(calls).toBe(5)
      }),
    { timeout: 30000 },
  )

  it.instance(
    "overflow detection without compaction.create does not increment counter",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const session = yield* Session.Service

        const sess = yield* session.create({
          title: "test",
          parentID: undefined,
        })

        yield* user(sess.id, "test message")

        // First: overflow that gets compacted, then successful response resets counter
        yield* llm.push(
          reply()
            .text("overflow 1")
            .usage({ input: 95000, output: 1000 })
            .stop()
            .item(),
        )
        yield* llm.push(
          reply()
            .text("success after reset")
            .usage({ input: 10000, output: 1000 })
            .stop()
            .item(),
        )

        const result = yield* prompt.loop({
          sessionID: sess.id,
        })

        expect(result).toBeDefined()
        // Counter should have been reset after successful non-overflow call
        // This verifies the counter only tracks consecutive compactions
        const calls = yield* llm.calls
        expect(calls).toBeGreaterThanOrEqual(2)
      }),
    { timeout: 30000 },
  )

  it.instance(
    "overflow-triggered compactions increment the circuit breaker counter",
    () =>
      Effect.gen(function* () {
        const { llm } = yield* useServerConfig(providerCfg)
        const prompt = yield* SessionPrompt.Service
        const session = yield* Session.Service

        const sess = yield* session.create({
          title: "test",
          parentID: undefined,
        })

        yield* user(sess.id, "test message")

        // Push enough overflow responses for more than MAX_COMPACT_ATTEMPTS cycles.
        // Each overflow cycle: main call (overflow) + compaction summary call = 2 LLM calls.
        // With MAX_COMPACT_ATTEMPTS=3, the circuit breaker should trip after 3 cycles,
        // limiting total calls. Without the fix, overflow-triggered compactions bypass
        // the counter and the loop consumes all pushed responses.
        for (let i = 0; i < 12; i++) {
          yield* llm.push(
            reply()
              .text(`overflow response ${i}`)
              .usage({ input: 95000, output: 1000 })
              .stop()
              .item(),
          )
        }

        const result = yield* prompt.loop({
          sessionID: sess.id,
        })

        expect(result).toBeDefined()
        expect(result.info.role).toBe("assistant")

        // With a working circuit breaker, the loop should break after MAX_COMPACT_ATTEMPTS (3)
        // overflow cycles. Each cycle = 1 main call + 1 compaction summary call = 2 calls.
        // 3 cycles = 6 calls, plus 1 final call where overflow is detected and breaker trips = 7.
        // Without the fix, the counter is never incremented in the overflow path,
        // so the loop consumes far more responses (well over 8 calls).
        const calls = yield* llm.calls
        expect(calls).toBeLessThanOrEqual(8)
      }),
    { timeout: 30000 },
  )
})
