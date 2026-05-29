import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Plugin } from "@/plugin"
import { Question } from "@/question"
import { Todo } from "@/session/todo"
import { Skill } from "@/skill"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Provider } from "@/provider/provider"
import { Git } from "@/git"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "@/session/instruction"
import { Bus } from "@/bus"
import { FetchHttpClient } from "effect/unstable/http"
import { Format } from "@/format"
import { Ripgrep } from "@/file/ripgrep"
import * as Truncate from "@/tool/truncate"
import { InstanceState } from "@/effect/instance-state"
import { Reference } from "@/reference/reference"
import { RepositoryCache } from "@/reference/repository-cache"
import { MessageID, SessionID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"

const node = CrossSpawnSpawner.defaultLayer
const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

const registryLayer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  ToolRegistry.layer
    .pipe(
      Layer.provide(configLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(Question.defaultLayer),
      Layer.provide(Todo.defaultLayer),
      Layer.provide(Skill.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(Layer.mergeAll(SessionStatus.defaultLayer, BackgroundJob.defaultLayer)),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(Layer.mergeAll(Git.defaultLayer, RepositoryCache.defaultLayer)),
      Layer.provide(Reference.defaultLayer),
      Layer.provide(LSP.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(AppFileSystem.defaultLayer),
      Layer.provide(Bus.layer),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Format.defaultLayer),
      Layer.provide(node),
      Layer.provide(Ripgrep.defaultLayer),
      Layer.provide(Truncate.defaultLayer),
    )
    .pipe(Layer.provide(RuntimeFlags.layer(flags)))

const scout = testEffect(
  Layer.mergeAll(registryLayer({ experimentalScout: true }), node, Agent.defaultLayer),
)

afterEach(async () => {
  await disposeAllInstances()
})

function makeToolContext(agentName: string): Tool.Context {
  return {
    sessionID: SessionID.make("ses_test"),
    messageID: MessageID.make("msg_test"),
    agent: agentName,
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

describe("tool_search activation", () => {
  scout.instance("tool_search activates matched deferred tools into the registry", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const info = yield* agent.defaultInfo()

      // Before search: deferred tools are NOT in all()
      const beforeIds = (yield* registry.all()).map((t) => t.id)
      expect(beforeIds).not.toContain("repo_clone")
      expect(beforeIds).not.toContain("repo_overview")

      // Deferred tools exist
      const deferred = yield* registry.deferred()
      expect(deferred.length).toBeGreaterThan(0)
      expect(deferred.map((t) => t.id)).toContain("repo_clone")

      // Get tool_search and execute it
      const allTools = yield* registry.all()
      const searchTool = allTools.find((t) => t.id === "tool_search")
      if (!searchTool) throw new Error("tool_search not found in registry")

      yield* searchTool.execute(
        { query: "repo_clone" },
        makeToolContext(info.name),
      )

      // After search: matched deferred tool IS in all()
      const afterIds = (yield* registry.all()).map((t) => t.id)
      expect(afterIds).toContain("repo_clone")
    }),
  )

  scout.instance("tool_search returns activation confirmation in output", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const info = yield* agent.defaultInfo()

      const allTools = yield* registry.all()
      const searchTool = allTools.find((t) => t.id === "tool_search")
      if (!searchTool) throw new Error("tool_search not found in registry")

      const result = yield* searchTool.execute(
        { query: "repo" },
        makeToolContext(info.name),
      )

      // Output should confirm activation, not say "simply call it by name"
      expect(result.output).not.toContain("simply call it by name")
      expect(result.output.toLowerCase()).toContain("activated")
    }),
  )

  scout.instance("tool_search with no matches does not modify active set", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const info = yield* agent.defaultInfo()

      const beforeIds = (yield* registry.all()).map((t) => t.id)

      const allTools = yield* registry.all()
      const searchTool = allTools.find((t) => t.id === "tool_search")
      if (!searchTool) throw new Error("tool_search not found in registry")

      yield* searchTool.execute(
        { query: "zzz_nonexistent_tool_zzz" },
        makeToolContext(info.name),
      )

      const afterIds = (yield* registry.all()).map((t) => t.id)
      expect(afterIds).toEqual(beforeIds)
    }),
  )
})
