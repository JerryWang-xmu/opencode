import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Session } from "@/session/session"
import { SessionID } from "../../src/session/schema"
import { LLM } from "../../src/session/llm"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionSummary } from "../../src/session/summary"
import { MessageV2 } from "../../src/session/message-v2"
import * as Log from "@opencode-ai/core/util/log"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

import { NodeFileSystem } from "@effect/platform-node"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Git } from "../../src/git"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Question } from "../../src/question"
import { Image } from "../../src/image/image"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Todo } from "../../src/session/todo"
import { SessionCompaction } from "../../src/session/compaction"
import { Instruction } from "../../src/session/instruction"
import { MemoryExtraction } from "../../src/memory/extraction"
import { MemoryAutoDream } from "../../src/memory/autoDream"
import { SessionProcessor } from "../../src/session/processor"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "../../src/file/ripgrep"
import { Format } from "../../src/format"
import { Reference } from "../../src/reference/reference"
import { RepositoryCache } from "../../src/reference/repository-cache"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"

void Log.init({ print: false })

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

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeHttp() {
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
    status,
    SyncEvent.defaultLayer,
    EventV2Bridge.defaultLayer,
  ).pipe(Layer.provideMerge(infra))
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
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer.pipe(
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(proc),
    Layer.provideMerge(deps),
  )
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionSummary.defaultLayer,
    SessionPrompt.layer.pipe(
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(Image.defaultLayer),
      Layer.provide(Reference.defaultLayer),
      Layer.provide(MemoryExtraction.defaultLayer),
      Layer.provide(MemoryAutoDream.defaultLayer),
      Layer.provide(SessionSummary.defaultLayer),
      Layer.provideMerge(run),
      Layer.provideMerge(compact),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(SystemPrompt.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
      Layer.provideMerge(deps),
    ),
  )
}

const it = testEffect(makeHttp())

const providerCfg = (url: string) => ({
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
        baseURL: url,
      },
    },
  },
})

/** Seed a user message so prompt.loop() has something to process. */
const seedUser = (prompt: SessionPrompt.Interface, sessionID: SessionID, text: string) =>
  prompt.prompt({
    sessionID,
    agent: "build",
    noReply: true,
    parts: [{ type: "text", text }],
  })

/** Collect all parts across all messages in a session. */
const allParts = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const msgs = yield* MessageV2.filterCompactedEffect(sessionID)
    return msgs.flatMap((m) => m.parts)
  })

// ── Streaming chunk processing ──────────────────────────────────────────────

it.live(
  "processes text stream chunks into complete assistant message",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const session = yield* sessions.create({
          title: "stream-chunks-test",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.text("Hello world from the stream processor")
        yield* seedUser(prompt, session.id, "say hello")

        const result = yield* prompt.loop({ sessionID: session.id })
        expect(result.info.role).toBe("assistant")

        const textParts = result.parts.filter(
          (p): p is MessageV2.TextPart => p.type === "text",
        )
        const fullText = textParts.map((p) => p.text).join("")
        expect(fullText).toContain("Hello world from the stream processor")
      }),
      { git: true, config: providerCfg },
    ),
  30000,
)

it.live(
  "accumulates multiple text deltas into single text part",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const session = yield* sessions.create({
          title: "multi-delta-test",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.text("chunk1 chunk2 chunk3")
        yield* seedUser(prompt, session.id, "say something")

        const result = yield* prompt.loop({ sessionID: session.id })
        expect(result.info.role).toBe("assistant")

        const textParts = result.parts.filter(
          (p): p is MessageV2.TextPart => p.type === "text",
        )
        expect(textParts.length).toBeGreaterThan(0)
        const fullText = textParts.map((p) => p.text).join("")
        expect(fullText).toContain("chunk1 chunk2 chunk3")
      }),
      { git: true, config: providerCfg },
    ),
  30000,
)

it.live(
  "handles stream completion with step-finish tokens",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const session = yield* sessions.create({
          title: "step-finish-test",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.text("done", { usage: { input: 100, output: 50 } })
        yield* seedUser(prompt, session.id, "do something")

        const result = yield* prompt.loop({ sessionID: session.id })
        expect(result.info.role).toBe("assistant")

        const stepFinishParts = result.parts.filter(
          (p): p is MessageV2.StepFinishPart => p.type === "step-finish",
        )
        expect(stepFinishParts.length).toBeGreaterThan(0)
        const step = stepFinishParts[0]
        expect(step.tokens.input).toBe(100)
        expect(step.tokens.output).toBe(50)
      }),
      { git: true, config: providerCfg },
    ),
  30000,
)

// ── Doom-loop detection ────────────────────────────────────────────────────

it.live(
  "processes repeated tool calls without hanging (doom-loop path)",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const session = yield* sessions.create({
          title: "doom-loop-test",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        const command = `echo 'loop test' > ${dir}/loop.txt`

        // Queue 3 identical tool calls (DOOM_LOOP_THRESHOLD = 3)
        // The doom-loop detector fires permission.ask("doom_loop") after the 3rd.
        // With wildcard allow, it auto-approves and the loop continues.
        // Then queue a text response to break the loop.
        yield* llm.tool("bash", { command, description: "create file" })
        yield* llm.tool("bash", { command, description: "create file" })
        yield* llm.tool("bash", { command, description: "create file" })
        yield* llm.text("done creating files")

        yield* seedUser(prompt, session.id, "create the file repeatedly")

        const result = yield* prompt.loop({ sessionID: session.id })
        expect(result.info.role).toBe("assistant")

        // Read all messages to find tool parts (they span multiple messages)
        const parts = yield* allParts(session.id)
        const toolParts = parts.filter(
          (p): p is MessageV2.ToolPart => p.type === "tool",
        )
        expect(toolParts.length).toBeGreaterThanOrEqual(3)

        // All tool parts should be for the "bash" tool
        for (const part of toolParts) {
          expect(part.tool).toBe("bash")
        }
      }),
      { git: true, config: providerCfg },
    ),
  30000,
)

// ── Stream error handling ──────────────────────────────────────────────────

it.live(
  "propagates non-retryable HTTP errors to assistant message",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const session = yield* sessions.create({
          title: "stream-error-test",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // 401 is not retryable (only 5xx and explicitly retryable errors are retried)
        yield* llm.error(401, { error: "Unauthorized" })
        yield* seedUser(prompt, session.id, "trigger error")

        const result = yield* prompt.loop({ sessionID: session.id })
        expect(result.info.role).toBe("assistant")

        const assistant = result.info as MessageV2.Assistant
        expect(assistant.error).toBeDefined()
      }),
      { git: true, config: providerCfg },
    ),
  30000,
)

it.live(
  "retries transient stream errors and completes",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const session = yield* sessions.create({
          title: "retry-then-succeed",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        // First request fails with a stream error, retry gets a successful response
        yield* llm.fail("transient error")
        yield* llm.text("recovered after retry")
        yield* seedUser(prompt, session.id, "trigger retry")

        // The loop should complete without throwing - retry handles the transient error
        const result = yield* prompt.loop({ sessionID: session.id })
        expect(result.info.role).toBe("assistant")

        // The final assistant message should not have an error
        const assistant = result.info as MessageV2.Assistant
        expect(assistant.error).toBeUndefined()
      }),
      { git: true, config: providerCfg },
    ),
  30000,
)

// ── Tool call argument accumulation ────────────────────────────────────────

it.live(
  "accumulates tool call arguments from streamed JSON",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const session = yield* sessions.create({
          title: "tool-args-test",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        const toolInput = {
          command: `echo 'test' > ${dir}/args-test.txt`,
          description: "write test file with specific args",
        }
        yield* llm.tool("bash", toolInput)
        yield* llm.text("file created")

        yield* seedUser(prompt, session.id, "create a file")

        yield* prompt.loop({ sessionID: session.id })

        // Read all messages to find tool parts across the agent loop
        const parts = yield* allParts(session.id)
        const toolParts = parts.filter(
          (p): p is MessageV2.ToolPart => p.type === "tool",
        )
        expect(toolParts.length).toBeGreaterThan(0)

        const bashPart = toolParts.find((p) => p.tool === "bash")
        expect(bashPart).toBeDefined()
        expect(bashPart!.state.status).toBe("completed")
        if (bashPart!.state.status === "completed") {
          expect(bashPart!.state.input).toEqual(toolInput)
        }
      }),
      { git: true, config: providerCfg },
    ),
  30000,
)

it.live(
  "handles tool call with complex nested arguments",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const session = yield* sessions.create({
          title: "complex-args-test",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        const complexInput = {
          command: `mkdir -p ${dir}/nested && echo 'complex' > ${dir}/nested/file.txt`,
          description: "create nested directory structure",
        }
        yield* llm.tool("bash", complexInput)
        yield* llm.text("done")

        yield* seedUser(prompt, session.id, "create nested dirs")

        yield* prompt.loop({ sessionID: session.id })

        const parts = yield* allParts(session.id)
        const toolParts = parts.filter(
          (p): p is MessageV2.ToolPart => p.type === "tool",
        )
        const bashPart = toolParts.find((p) => p.tool === "bash")
        expect(bashPart).toBeDefined()
        expect(bashPart!.state.status).toBe("completed")
        if (bashPart!.state.status === "completed") {
          expect(bashPart!.state.input.command).toBe(complexInput.command)
          expect(bashPart!.state.input.description).toBe(complexInput.description)
        }
      }),
      { git: true, config: providerCfg },
    ),
  30000,
)

// ── Multi-tool coordination ────────────────────────────────────────────────

it.live(
  "processes tool call followed by text response in sequence",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const session = yield* sessions.create({
          title: "multi-tool-seq",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.tool("bash", {
          command: `echo 'seq test' > ${dir}/seq.txt`,
          description: "create file",
        })
        yield* llm.text("File created successfully")

        yield* seedUser(prompt, session.id, "create a file")

        yield* prompt.loop({ sessionID: session.id })

        const parts = yield* allParts(session.id)
        const toolParts = parts.filter(
          (p): p is MessageV2.ToolPart => p.type === "tool",
        )
        expect(toolParts.length).toBe(1)
        expect(toolParts[0].state.status).toBe("completed")

        const textParts = parts.filter(
          (p): p is MessageV2.TextPart => p.type === "text",
        )
        const fullText = textParts.map((p) => p.text).join("")
        expect(fullText).toContain("File created successfully")
      }),
      { git: true, config: providerCfg },
    ),
  30000,
)

it.live(
  "executes multiple tool calls across agent loop iterations",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const session = yield* sessions.create({
          title: "multi-tool-iter",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.tool("bash", {
          command: `echo 'file A' > ${dir}/a.txt`,
          description: "create file A",
        })
        yield* llm.tool("bash", {
          command: `echo 'file B' > ${dir}/b.txt`,
          description: "create file B",
        })
        yield* llm.text("Both files created")

        yield* seedUser(prompt, session.id, "create two files")

        yield* prompt.loop({ sessionID: session.id })

        const parts = yield* allParts(session.id)
        const toolParts = parts.filter(
          (p): p is MessageV2.ToolPart => p.type === "tool",
        )
        expect(toolParts.length).toBe(2)

        for (const part of toolParts) {
          expect(part.state.status).toBe("completed")
        }
      }),
      { git: true, config: providerCfg },
    ),
  30000,
)

it.live(
  "aggregates tool results across multiple steps",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const session = yield* sessions.create({
          title: "tool-result-agg",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.tool("bash", {
          command: `echo 'result1' > ${dir}/r1.txt`,
          description: "write result 1",
        })
        yield* llm.tool("bash", {
          command: `echo 'result2' > ${dir}/r2.txt`,
          description: "write result 2",
        })
        yield* llm.tool("bash", {
          command: `echo 'result3' > ${dir}/r3.txt`,
          description: "write result 3",
        })
        yield* llm.text("All results written")

        yield* seedUser(prompt, session.id, "write three files")

        yield* prompt.loop({ sessionID: session.id })

        const parts = yield* allParts(session.id)
        const toolParts = parts.filter(
          (p): p is MessageV2.ToolPart => p.type === "tool",
        )
        expect(toolParts.length).toBe(3)

        const completed = toolParts.filter((p) => p.state.status === "completed")
        expect(completed.length).toBe(3)

        for (const part of completed) {
          if (part.state.status === "completed") {
            expect(part.state.output).toBeDefined()
            expect(typeof part.state.output).toBe("string")
          }
        }
      }),
      { git: true, config: providerCfg },
    ),
  30000,
)

// ── Reasoning stream processing ────────────────────────────────────────────

it.live(
  "processes reasoning stream alongside text output",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const session = yield* sessions.create({
          title: "reasoning-test",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })

        yield* llm.reason("I am thinking about this problem", {
          text: "Here is my answer",
        })

        yield* seedUser(prompt, session.id, "think about this")

        const result = yield* prompt.loop({ sessionID: session.id })
        expect(result.info.role).toBe("assistant")

        const reasoningParts = result.parts.filter(
          (p): p is MessageV2.ReasoningPart => p.type === "reasoning",
        )
        expect(reasoningParts.length).toBeGreaterThan(0)
        expect(reasoningParts[0].text).toContain("I am thinking about this problem")

        const textParts = result.parts.filter(
          (p): p is MessageV2.TextPart => p.type === "text",
        )
        const fullText = textParts.map((p) => p.text).join("")
        expect(fullText).toContain("Here is my answer")
      }),
      { git: true, config: providerCfg },
    ),
  30000,
)
