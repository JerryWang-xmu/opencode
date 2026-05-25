import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { Agent } from "../../src/agent/agent"
import { SessionCompaction } from "../../src/session/compaction"
import * as Log from "@opencode-ai/core/util/log"
import { Plugin } from "../../src/plugin"
import { provideTmpdirInstance } from "../fixture/fixture"
import { Session as SessionNs } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { ProviderTest } from "../fake/provider"
import type { Provider } from "@/provider/provider"
import * as SessionProcessorModule from "../../src/session/processor"
import { Token } from "@/util/token"

void Log.init({ print: false })

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

function createModel(opts: { context: number; output: number }): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: { context: opts.context, input: opts.context, output: opts.output },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

const wide = () => ProviderTest.fake({ model: createModel({ context: 100_000, output: 32_000 }) })

function fakeProcessor(input: Parameters<SessionProcessorModule.SessionProcessor.Interface["create"]>[0]) {
  const msg = input.assistantMessage
  return {
    get message() { return msg },
    updateToolCall: Effect.fn("Test.updateToolCall")(() => Effect.succeed(undefined)),
    completeToolCall: Effect.fn("Test.completeToolCall")(() => Effect.void),
    process: Effect.fn("Test.process")(() => Effect.succeed("continue" as const)),
  } satisfies SessionProcessorModule.SessionProcessor.Handle
}

const processorLayer = Layer.succeed(
  SessionProcessorModule.SessionProcessor.Service,
  SessionProcessorModule.SessionProcessor.Service.of({
    create: Effect.fn("Test.create")((input) => Effect.succeed(fakeProcessor(input))),
  }),
)

const deps = Layer.mergeAll(
  wide().layer,
  processorLayer,
  Agent.defaultLayer,
  Plugin.defaultLayer,
  Bus.layer,
  Config.defaultLayer,
  SyncEvent.defaultLayer,
  RuntimeFlags.layer({ experimentalEventSystem: true }),
  EventV2Bridge.defaultLayer,
)

const env = Layer.mergeAll(
  SessionNs.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  SessionCompaction.layer.pipe(Layer.provide(SessionNs.defaultLayer), Layer.provideMerge(deps)),
)

const it = testEffect(env)

function createToolPart(
  sessionID: SessionID,
  messageID: MessageID,
  tool: string,
  timeEnd: number,
  output: string = "tool output",
) {
  return SessionNs.Service.use((ssn) =>
    ssn.updatePart({
      id: PartID.ascending(),
      messageID,
      sessionID,
      type: "tool",
      callID: crypto.randomUUID(),
      tool,
      state: {
        status: "completed",
        input: {},
        output,
        title: "done",
        metadata: {},
        time: { start: timeEnd - 1000, end: timeEnd },
      },
    } as MessageV2.ToolPart),
  )
}

function setupSession(dir: string) {
  return Effect.gen(function* () {
    const ssn = yield* SessionNs.Service
    const info = yield* ssn.create({})
    const userMsg = yield* ssn.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID: info.id,
      agent: "build",
      model: ref,
      time: { created: Date.now() },
    })
    yield* ssn.updatePart({
      id: PartID.ascending(),
      messageID: userMsg.id,
      sessionID: info.id,
      type: "text",
      text: "hello",
    })
    const assistantMsg = yield* ssn.updateMessage({
      id: MessageID.ascending(),
      role: "assistant",
      sessionID: info.id,
      mode: "build",
      agent: "build",
      path: { cwd: dir, root: dir },
      cost: 0,
      tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: ref.modelID,
      providerID: ref.providerID,
      parentID: userMsg.id,
      time: { created: Date.now() },
      finish: "end_turn",
    })
    return { sessionID: info.id, assistantMsgID: assistantMsg.id }
  })
}

describe("session.compaction.microCompact", () => {
  it.live(
    "clears tool outputs older than age_minutes",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const ssn = yield* SessionNs.Service
          const { sessionID, assistantMsgID } = yield* setupSession(dir)

          const now = Date.now()
          const fifteenMinAgo = now - 15 * 60 * 1000
          const fiveMinAgo = now - 5 * 60 * 1000

          yield* createToolPart(sessionID, assistantMsgID, "read", fifteenMinAgo, "old read output")
          yield* createToolPart(sessionID, assistantMsgID, "grep", fiveMinAgo, "recent grep output")

          yield* compact.microCompact({ sessionID })

          const msgs = yield* ssn.messages({ sessionID })
          const toolParts = msgs.flatMap((m) => m.parts).filter((p): p is MessageV2.ToolPart => p.type === "tool")

          const readPart = toolParts.find((p) => p.tool === "read")
          const grepPart = toolParts.find((p) => p.tool === "grep")

          expect(readPart?.state.status).toBe("completed")
          if (readPart?.state.status === "completed") {
            expect(readPart.state.time.compacted).toBeNumber()
          }

          expect(grepPart?.state.status).toBe("completed")
          if (grepPart?.state.status === "completed") {
            expect(grepPart.state.time.compacted).toBeUndefined()
          }
        }),
      {
        config: {
          micro_compact: { enabled: true, age_minutes: 10, tools: ["read", "grep", "glob", "lsp"] },
        },
      },
    ),
  )

  it.live(
    "only clears eligible tool types",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const ssn = yield* SessionNs.Service
          const { sessionID, assistantMsgID } = yield* setupSession(dir)

          const old = Date.now() - 15 * 60 * 1000

          yield* createToolPart(sessionID, assistantMsgID, "read", old, "read output")
          yield* createToolPart(sessionID, assistantMsgID, "grep", old, "grep output")
          yield* createToolPart(sessionID, assistantMsgID, "edit", old, "edit output")
          yield* createToolPart(sessionID, assistantMsgID, "shell", old, "shell output")

          yield* compact.microCompact({ sessionID })

          const msgs = yield* ssn.messages({ sessionID })
          const toolParts = msgs.flatMap((m) => m.parts).filter((p): p is MessageV2.ToolPart => p.type === "tool")

          const readPart = toolParts.find((p) => p.tool === "read")
          const grepPart = toolParts.find((p) => p.tool === "grep")
          const editPart = toolParts.find((p) => p.tool === "edit")
          const shellPart = toolParts.find((p) => p.tool === "shell")

          if (readPart?.state.status === "completed") expect(readPart.state.time.compacted).toBeNumber()
          if (grepPart?.state.status === "completed") expect(grepPart.state.time.compacted).toBeNumber()
          if (editPart?.state.status === "completed") expect(editPart.state.time.compacted).toBeUndefined()
          if (shellPart?.state.status === "completed") expect(shellPart.state.time.compacted).toBeUndefined()
        }),
      {
        config: {
          micro_compact: { enabled: true, age_minutes: 10, tools: ["read", "grep", "glob", "lsp"] },
        },
      },
    ),
  )

  it.live(
    "skips already-compacted parts",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const ssn = yield* SessionNs.Service
          const { sessionID, assistantMsgID } = yield* setupSession(dir)

          const old = Date.now() - 15 * 60 * 1000
          const priorCompactTime = Date.now() - 60 * 60 * 1000

          yield* SessionNs.Service.use((s) =>
            s.updatePart({
              id: PartID.ascending(),
              messageID: assistantMsgID,
              sessionID,
              type: "tool",
              callID: crypto.randomUUID(),
              tool: "read",
              state: {
                status: "completed",
                input: {},
                output: "already compacted",
                title: "done",
                metadata: {},
                time: { start: old - 1000, end: old, compacted: priorCompactTime },
              },
            } as MessageV2.ToolPart),
          )

          yield* compact.microCompact({ sessionID })

          const msgs = yield* ssn.messages({ sessionID })
          const toolPart = msgs
            .flatMap((m) => m.parts)
            .find((p): p is MessageV2.ToolPart => p.type === "tool" && p.tool === "read")

          expect(toolPart?.state.status).toBe("completed")
          if (toolPart?.state.status === "completed") {
            expect(toolPart.state.time.compacted).toBe(priorCompactTime)
          }
        }),
      {
        config: {
          micro_compact: { enabled: true, age_minutes: 10, tools: ["read", "grep", "glob", "lsp"] },
        },
      },
    ),
  )

  it.live(
    "respects PRUNE_PROTECTED_TOOLS",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const ssn = yield* SessionNs.Service
          const { sessionID, assistantMsgID } = yield* setupSession(dir)

          const old = Date.now() - 15 * 60 * 1000

          yield* createToolPart(sessionID, assistantMsgID, "skill", old, "skill output")

          yield* compact.microCompact({ sessionID })

          const msgs = yield* ssn.messages({ sessionID })
          const skillPart = msgs
            .flatMap((m) => m.parts)
            .find((p): p is MessageV2.ToolPart => p.type === "tool" && p.tool === "skill")

          expect(skillPart?.state.status).toBe("completed")
          if (skillPart?.state.status === "completed") {
            expect(skillPart.state.time.compacted).toBeUndefined()
          }
        }),
      {
        config: {
          micro_compact: { enabled: true, age_minutes: 10, tools: ["read", "grep", "glob", "lsp", "skill"] },
        },
      },
    ),
  )

  it.live(
    "returns count of compacted parts",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const { sessionID, assistantMsgID } = yield* setupSession(dir)

          const old = Date.now() - 15 * 60 * 1000

          yield* createToolPart(sessionID, assistantMsgID, "read", old, "read 1")
          yield* createToolPart(sessionID, assistantMsgID, "grep", old, "grep 1")
          yield* createToolPart(sessionID, assistantMsgID, "glob", old, "glob 1")

          const count = yield* compact.microCompact({ sessionID })

          expect(count).toBe(3)
        }),
      {
        config: {
          micro_compact: { enabled: true, age_minutes: 10, tools: ["read", "grep", "glob", "lsp"] },
        },
      },
    ),
  )

  it.live(
    "no-op when micro_compact disabled in config",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const { sessionID, assistantMsgID } = yield* setupSession(dir)

          const old = Date.now() - 15 * 60 * 1000
          yield* createToolPart(sessionID, assistantMsgID, "read", old, "read output")

          const count = yield* compact.microCompact({ sessionID })

          expect(count).toBe(0)
        }),
      {
        config: {
          micro_compact: { enabled: false },
        },
      },
    ),
  )

  it.live(
    "no-op when no eligible parts exist",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const ssn = yield* SessionNs.Service
          const info = yield* ssn.create({})

          const count = yield* compact.microCompact({ sessionID: info.id })

          expect(count).toBe(0)
        }),
      {
        config: {
          micro_compact: { enabled: true, age_minutes: 10, tools: ["read", "grep", "glob", "lsp"] },
        },
      },
    ),
  )

  it.live(
    "compacts old tool outputs across multi-step conversation before next LLM call",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const ssn = yield* SessionNs.Service

          // Step 1: create session with first turn (user + assistant with tool calls)
          const info = yield* ssn.create({})
          const user1 = yield* ssn.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: info.id,
            agent: "build",
            model: ref,
            time: { created: Date.now() },
          })
          yield* ssn.updatePart({
            id: PartID.ascending(),
            messageID: user1.id,
            sessionID: info.id,
            type: "text",
            text: "read the file",
          })
          const assistant1 = yield* ssn.updateMessage({
            id: MessageID.ascending(),
            role: "assistant",
            sessionID: info.id,
            mode: "build",
            agent: "build",
            path: { cwd: dir, root: dir },
            cost: 0,
            tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ref.modelID,
            providerID: ref.providerID,
            parentID: user1.id,
            time: { created: Date.now() },
            finish: "end_turn",
          })

          // Tool result from step 1 - aged past threshold
          const oldTime = Date.now() - 20 * 60 * 1000
          yield* createToolPart(info.id, assistant1.id, "read", oldTime, "step1 read output")
          yield* createToolPart(info.id, assistant1.id, "grep", oldTime, "step1 grep output")

          // Step 2: second user message (simulating prompt loop about to call LLM again)
          const user2 = yield* ssn.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: info.id,
            agent: "build",
            model: ref,
            time: { created: Date.now() },
          })
          yield* ssn.updatePart({
            id: PartID.ascending(),
            messageID: user2.id,
            sessionID: info.id,
            type: "text",
            text: "now edit it",
          })

          // microCompact runs before the LLM call for step 2
          const count = yield* compact.microCompact({ sessionID: info.id })

          // Both old tool outputs from step 1 should be compacted
          expect(count).toBe(2)
          const msgs = yield* ssn.messages({ sessionID: info.id })
          const toolParts = msgs.flatMap((m) => m.parts).filter((p): p is MessageV2.ToolPart => p.type === "tool")
          const readPart = toolParts.find((p) => p.tool === "read")
          const grepPart = toolParts.find((p) => p.tool === "grep")
          if (readPart?.state.status === "completed") expect(readPart.state.time.compacted).toBeNumber()
          if (grepPart?.state.status === "completed") expect(grepPart.state.time.compacted).toBeNumber()
        }),
      {
        config: {
          micro_compact: { enabled: true, age_minutes: 10, tools: ["read", "grep", "glob", "lsp"] },
        },
      },
    ),
  )

  it.live(
    "does not compact tool outputs when disabled even if old",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const ssn = yield* SessionNs.Service

          // Create session with a turn containing old tool outputs
          const info = yield* ssn.create({})
          const user1 = yield* ssn.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: info.id,
            agent: "build",
            model: ref,
            time: { created: Date.now() },
          })
          yield* ssn.updatePart({
            id: PartID.ascending(),
            messageID: user1.id,
            sessionID: info.id,
            type: "text",
            text: "read the file",
          })
          const assistant1 = yield* ssn.updateMessage({
            id: MessageID.ascending(),
            role: "assistant",
            sessionID: info.id,
            mode: "build",
            agent: "build",
            path: { cwd: dir, root: dir },
            cost: 0,
            tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ref.modelID,
            providerID: ref.providerID,
            parentID: user1.id,
            time: { created: Date.now() },
            finish: "end_turn",
          })

          // Tool result aged well past threshold
          const oldTime = Date.now() - 30 * 60 * 1000
          yield* createToolPart(info.id, assistant1.id, "read", oldTime, "old read output")
          yield* createToolPart(info.id, assistant1.id, "grep", oldTime, "old grep output")

          // microCompact called but disabled - should be no-op
          const count = yield* compact.microCompact({ sessionID: info.id })

          expect(count).toBe(0)
          const msgs = yield* ssn.messages({ sessionID: info.id })
          const toolParts = msgs.flatMap((m) => m.parts).filter((p): p is MessageV2.ToolPart => p.type === "tool")
          const readPart = toolParts.find((p) => p.tool === "read")
          const grepPart = toolParts.find((p) => p.tool === "grep")
          if (readPart?.state.status === "completed") expect(readPart.state.time.compacted).toBeUndefined()
          if (grepPart?.state.status === "completed") expect(grepPart.state.time.compacted).toBeUndefined()
        }),
      {
        config: {
          micro_compact: { enabled: false },
        },
      },
    ),
  )

  it.live(
    "micro-compact delays full compaction",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const ssn = yield* SessionNs.Service
          const { sessionID, assistantMsgID } = yield* setupSession(dir)

          const now = Date.now()
          const fifteenMinAgo = now - 15 * 60 * 1000

          // Create many read tool results with large outputs that would normally
          // consume enough context to trigger full compaction.
          const largeOutput = "x".repeat(5_000)
          for (let i = 0; i < 8; i++) {
            yield* createToolPart(sessionID, assistantMsgID, "read", fifteenMinAgo, largeOutput)
          }

          // Measure token estimate of tool outputs before micro-compact.
          const msgsBefore = yield* ssn.messages({ sessionID })
          const partsBefore = msgsBefore
            .flatMap((m) => m.parts)
            .filter((p): p is MessageV2.ToolPart & { state: MessageV2.ToolStateCompleted } => p.type === "tool" && p.state.status === "completed")
          const tokensBefore = partsBefore.reduce((sum, p) => sum + Token.estimate(p.state.output), 0)

          // Run micro-compact — should clear all old read outputs.
          const count = yield* compact.microCompact({ sessionID })

          expect(count).toBeGreaterThan(0)

          // Verify all old parts are marked as compacted, meaning their outputs
          // will be stripped when building model messages — reducing context size
          // and delaying the need for full compaction.
          const msgsAfter = yield* ssn.messages({ sessionID })
          const partsAfter = msgsAfter
            .flatMap((m) => m.parts)
            .filter((p): p is MessageV2.ToolPart & { state: MessageV2.ToolStateCompleted } => p.type === "tool" && p.state.status === "completed")
          const compactedCount = partsAfter.filter((p) => p.state.time.compacted !== undefined).length
          expect(compactedCount).toBe(8)

          // Effective token load is reduced because compacted outputs are stripped.
          const tokensAfter = partsAfter
            .filter((p) => !p.state.time.compacted)
            .reduce((sum, p) => sum + Token.estimate(p.state.output), 0)
          expect(tokensAfter).toBeLessThan(tokensBefore)
        }),
      {
        config: {
          micro_compact: { enabled: true, age_minutes: 10, tools: ["read", "grep", "glob", "lsp"] },
        },
      },
    ),
  )

  it.live(
    "micro-compact preserves recent tool outputs",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const ssn = yield* SessionNs.Service
          const { sessionID, assistantMsgID } = yield* setupSession(dir)

          const now = Date.now()
          const fifteenMinAgo = now - 15 * 60 * 1000
          const twoMinAgo = now - 2 * 60 * 1000

          // Old results: aged past the micro_compact threshold.
          yield* createToolPart(sessionID, assistantMsgID, "read", fifteenMinAgo, "old read 1")
          yield* createToolPart(sessionID, assistantMsgID, "grep", fifteenMinAgo, "old grep 1")
          yield* createToolPart(sessionID, assistantMsgID, "glob", fifteenMinAgo, "old glob 1")

          // Recent results: within the threshold, should be preserved.
          yield* createToolPart(sessionID, assistantMsgID, "read", twoMinAgo, "recent read 1")
          yield* createToolPart(sessionID, assistantMsgID, "grep", twoMinAgo, "recent grep 1")

          const count = yield* compact.microCompact({ sessionID })

          // Only the 3 old parts should be compacted.
          expect(count).toBe(3)

          const msgs = yield* ssn.messages({ sessionID })
          const toolParts = msgs.flatMap((m) => m.parts).filter((p): p is MessageV2.ToolPart => p.type === "tool")

          // Old parts (time.end = fifteenMinAgo) must be marked compacted.
          const oldParts = toolParts.filter(
            (p) => p.state.status === "completed" && p.state.time.end <= fifteenMinAgo + 1000,
          )
          expect(oldParts.length).toBe(3)
          for (const part of oldParts) {
            if (part.state.status === "completed") {
              expect(part.state.time.compacted).toBeNumber()
            }
          }

          // Recent parts (time.end = twoMinAgo) must NOT be compacted.
          const recentParts = toolParts.filter(
            (p) => p.state.status === "completed" && p.state.time.end >= twoMinAgo - 1000,
          )
          expect(recentParts.length).toBe(2)
          for (const part of recentParts) {
            if (part.state.status === "completed") {
              expect(part.state.time.compacted).toBeUndefined()
            }
          }
        }),
      {
        config: {
          micro_compact: { enabled: true, age_minutes: 10, tools: ["read", "grep", "glob", "lsp"] },
        },
      },
    ),
  )
})
