import { describe, expect } from "bun:test"
import path from "path"
import { Effect, FileSystem, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { InstanceRef } from "../../src/effect/instance-ref"
import type { Agent } from "../../src/agent/agent"
import type { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Permission } from "../../src/permission"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Instruction } from "../../src/session/instruction"
import { SystemCache } from "../../src/session/system-cache"
import { MemoryRetrieval } from "../../src/memory/retrieval"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { provideInstance, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"

const it = testEffect(SystemCache.layer)

const baseInput = {
  modelID: "anthropic/claude-sonnet-4-20250514",
  agentName: "build",
  instructions: ["Instructions from: /tmp/AGENTS.md\n# Project rules"],
  skills: "<skills><name>git-master</name></skills>",
}

const testModel: Provider.Model = {
  id: ModelID.make("claude-sonnet-4-20250514"),
  providerID: ProviderID.anthropic,
  api: { id: "claude-sonnet-4-20250514", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
  name: "Claude Sonnet 4",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 200000, output: 8192 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2025-05-14",
}

const testModelB: Provider.Model = {
  id: ModelID.make("gpt-4o"),
  providerID: ProviderID.openai,
  api: { id: "gpt-4o", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
  name: "GPT-4o",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 128000, output: 4096 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2024-05-13",
}

const testSkills: Skill.Info[] = [
  { name: "test-skill", description: "Test skill.", location: "/tmp/test-skill/SKILL.md", content: "# test" },
]

const testAgent: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const mockSkillLayer = Layer.succeed(
  Skill.Service,
  Skill.Service.of({
    get: (name) => Effect.succeed(testSkills.find((s) => s.name === name)),
    require: (name) => {
      const info = testSkills.find((s) => s.name === name)
      if (info) return Effect.succeed(info)
      return Effect.fail(new Skill.NotFoundError({ name, available: testSkills.map((s) => s.name) }))
    },
    all: () => Effect.succeed(testSkills),
    dirs: () => Effect.succeed([]),
    available: () => Effect.succeed(testSkills),
  }),
)

const mockRetrievalLayer = Layer.succeed(
  MemoryRetrieval.Service,
  MemoryRetrieval.Service.of({
    retrieve: () => Effect.succeed([]),
  }),
)

const mockInstanceContext = {
  directory: "/tmp/test",
  worktree: "/tmp/test",
  project: {
    id: "project-test" as any,
    worktree: "/tmp/test",
    vcs: "git" as const,
    time: { created: 0, updated: 0 },
    sandboxes: [] as string[],
  },
}

const systemIt = testEffect(
  SystemPrompt.layer.pipe(
    Layer.provide(mockSkillLayer),
    Layer.provide(mockRetrievalLayer),
    Layer.provideMerge(SystemCache.layer),
  ),
)

const configLayer = TestConfig.layer()

const instructionLayer = (global: Partial<Global.Interface>, flags: Partial<RuntimeFlags.Info> = {}) =>
  Instruction.layer.pipe(
    Layer.provide(configLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Global.layerWith(global)),
    Layer.provide(RuntimeFlags.layer(flags)),
    Layer.provideMerge(SystemCache.layer),
  )

const provideInstruction =
  (global: Partial<Global.Interface>, flags?: Partial<RuntimeFlags.Info>) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(Effect.provide(instructionLayer(global, flags)))

const write = (filepath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.dirname(filepath), { recursive: true })
    yield* fs.writeFileString(filepath, content)
  })

const writeFiles = (dir: string, files: Record<string, string>) =>
  Effect.all(
    Object.entries(files).map(([file, content]) => write(path.join(dir, file), content)),
    { discard: true },
  )

const instructionIt = testEffect(
  Layer.mergeAll(CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer),
)

describe("session.system-cache", () => {
  it.effect("caches static prefix by (modelID, agentName, instructionsHash, skillsHash)", () =>
    Effect.gen(function* () {
      const cache = yield* SystemCache.Service
      const key = yield* cache.computeKey(baseInput)
      const value = ["prompt line 1", "prompt line 2"]
      yield* cache.set(key, value)
      const first = yield* cache.get(key)
      const second = yield* cache.get(key)
      expect(first).toBe(second)
      expect(first).toEqual(value)
    }),
  )

  it.effect("invalidates on model change", () =>
    Effect.gen(function* () {
      const cache = yield* SystemCache.Service
      const keyA = yield* cache.computeKey(baseInput)
      const keyB = yield* cache.computeKey({ ...baseInput, modelID: "openai/gpt-4o" })
      yield* cache.set(keyA, ["model A prompt"])
      const resultA = yield* cache.get(keyA)
      const resultB = yield* cache.get(keyB)
      expect(resultA).toEqual(["model A prompt"])
      expect(resultB).toBeUndefined()
    }),
  )

  it.effect("invalidates on instruction file change", () =>
    Effect.gen(function* () {
      const cache = yield* SystemCache.Service
      const keyA = yield* cache.computeKey(baseInput)
      const keyB = yield* cache.computeKey({
        ...baseInput,
        instructions: ["Instructions from: /tmp/AGENTS.md\n# Updated rules"],
      })
      yield* cache.set(keyA, ["old prompt"])
      const resultA = yield* cache.get(keyA)
      const resultB = yield* cache.get(keyB)
      expect(resultA).toEqual(["old prompt"])
      expect(resultB).toBeUndefined()
    }),
  )

  it.effect("invalidates on skill list change", () =>
    Effect.gen(function* () {
      const cache = yield* SystemCache.Service
      const keyA = yield* cache.computeKey(baseInput)
      const keyB = yield* cache.computeKey({
        ...baseInput,
        skills: "<skills><name>git-master</name><name>review-work</name></skills>",
      })
      yield* cache.set(keyA, ["prompt with one skill"])
      const resultA = yield* cache.get(keyA)
      const resultB = yield* cache.get(keyB)
      expect(resultA).toEqual(["prompt with one skill"])
      expect(resultB).toBeUndefined()
    }),
  )

  it.effect("cache key computation is stable", () =>
    Effect.gen(function* () {
      const cache = yield* SystemCache.Service
      const key1 = yield* cache.computeKey(baseInput)
      const key2 = yield* cache.computeKey(baseInput)
      expect(key1.modelID).toBe(key2.modelID)
      expect(key1.agentName).toBe(key2.agentName)
      expect(key1.instructionsHash).toBe(key2.instructionsHash)
      expect(key1.skillsHash).toBe(key2.skillsHash)
    }),
  )

  it.effect("returns undefined on cache miss", () =>
    Effect.gen(function* () {
      const cache = yield* SystemCache.Service
      const key = yield* cache.computeKey(baseInput)
      const result = yield* cache.get(key)
      expect(result).toBeUndefined()
    }),
  )

  it.effect("cache invalidates when AGENTS.md content hash changes", () =>
    Effect.gen(function* () {
      const cache = yield* SystemCache.Service
      const instructionsOriginal = ["Instructions from: /tmp/AGENTS.md\n# Project rules"]
      const instructionsModified = ["Instructions from: /tmp/AGENTS.md\n# Updated project rules\nNew section added"]
      const keyBefore = yield* cache.computeKey({
        modelID: "",
        agentName: "",
        instructions: instructionsOriginal,
        skills: undefined,
      })
      const keyAfter = yield* cache.computeKey({
        modelID: "",
        agentName: "",
        instructions: instructionsModified,
        skills: undefined,
      })
      expect(keyBefore.instructionsHash).not.toBe(keyAfter.instructionsHash)
      yield* cache.set(keyBefore, ["cached system prompt"])
      const hitBefore = yield* cache.get(keyBefore)
      const missAfter = yield* cache.get(keyAfter)
      expect(hitBefore).toEqual(["cached system prompt"])
      expect(missAfter).toBeUndefined()
    }),
  )
})

describe("session.system-cache integration", () => {
  systemIt.effect("SystemPrompt.environment returns cached result on second call", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const first = yield* prompt.environment(testModel)
      const second = yield* prompt.environment(testModel)
      expect(first).toBe(second)
    }).pipe(Effect.provideService(InstanceRef, mockInstanceContext)),
  )

  systemIt.effect("SystemPrompt.skills returns cached result on second call", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const first = yield* prompt.skills(testAgent)
      const second = yield* prompt.skills(testAgent)
      expect(first).toBe(second)
    }),
  )

  instructionIt.live("Instruction.system returns cached result on second call", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "AGENTS.md": "# Test Instructions" })
        return yield* Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const first = yield* svc.system()
          const second = yield* svc.system()
          expect(first).toBe(second)
        }).pipe(provideInstruction({ home: dir, config: dir }))
      }),
    ).pipe(Effect.provide(instructionLayer({ home: "/tmp", config: "/tmp" }))),
  )

  instructionIt.live("cache invalidates when instruction files change on disk", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* writeFiles(dir, { "AGENTS.md": "# Original Instructions" })
        return yield* Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const first = yield* svc.system()

          const fs = yield* FileSystem.FileSystem
          yield* fs.writeFileString(path.join(dir, "AGENTS.md"), "# Updated Instructions")

          const second = yield* svc.system()
          expect(first).not.toBe(second)
          expect(first[0]).toContain("Original Instructions")
          expect(second[0]).toContain("Updated Instructions")
        }).pipe(provideInstruction({ home: dir, config: dir }))
      }),
    ).pipe(Effect.provide(instructionLayer({ home: "/tmp", config: "/tmp" }))),
  )

  systemIt.effect("cache survives across turns in same session", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const env1 = yield* prompt.environment(testModel)
      const env2 = yield* prompt.environment(testModel)
      const env3 = yield* prompt.environment(testModel)
      expect(env1).toBe(env2)
      expect(env2).toBe(env3)

      const skills1 = yield* prompt.skills(testAgent)
      const skills2 = yield* prompt.skills(testAgent)
      const skills3 = yield* prompt.skills(testAgent)
      expect(skills1).toBe(skills2)
      expect(skills2).toBe(skills3)
    }).pipe(Effect.provideService(InstanceRef, mockInstanceContext)),
  )

  systemIt.effect("cache invalidates on model switch mid-session", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const envA = yield* prompt.environment(testModel)
      const envB = yield* prompt.environment(testModelB)
      expect(envA).not.toBe(envB)
      expect(envA[0]).toContain("claude-sonnet-4-20250514")
      expect(envB[0]).toContain("gpt-4o")
    }).pipe(Effect.provideService(InstanceRef, mockInstanceContext)),
  )

  systemIt.effect("full prompt loop: static prefix stable, dynamic suffix varies per turn", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const cache = yield* SystemCache.Service

      // Turn 1
      const env1 = yield* prompt.environment(testModel)
      const skills1 = yield* prompt.skills(testAgent)

      // Turn 2
      const env2 = yield* prompt.environment(testModel)
      const skills2 = yield* prompt.skills(testAgent)

      // Turn 3
      const env3 = yield* prompt.environment(testModel)
      const skills3 = yield* prompt.skills(testAgent)

      // Static parts are cached and reused across all turns
      expect(env1).toBe(env2)
      expect(env2).toBe(env3)
      expect(skills1).toBe(skills2)
      expect(skills2).toBe(skills3)

      // Dynamic parts: different instruction input produces different cache key per turn
      const turn1Key = yield* cache.computeKey({
        modelID: "anthropic/claude-sonnet-4-20250514",
        agentName: "build",
        instructions: ["turn 1 context"],
        skills: undefined,
      })
      const turn2Key = yield* cache.computeKey({
        modelID: "anthropic/claude-sonnet-4-20250514",
        agentName: "build",
        instructions: ["turn 2 context with new info"],
        skills: undefined,
      })
      const turn3Key = yield* cache.computeKey({
        modelID: "anthropic/claude-sonnet-4-20250514",
        agentName: "build",
        instructions: ["turn 3 context with structured output"],
        skills: undefined,
      })
      expect(turn1Key.instructionsHash).not.toBe(turn2Key.instructionsHash)
      expect(turn2Key.instructionsHash).not.toBe(turn3Key.instructionsHash)
      expect(turn1Key.instructionsHash).not.toBe(turn3Key.instructionsHash)
    }).pipe(Effect.provideService(InstanceRef, mockInstanceContext)),
  )
})
