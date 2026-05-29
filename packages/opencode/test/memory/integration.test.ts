import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { MemoryStorage } from "../../src/memory/storage"
import { Memory } from "../../src/memory/memory"
import { MemoryRetrieval } from "../../src/memory/retrieval"
import { SystemPrompt } from "../../src/session/system"
import { SystemCache } from "../../src/session/system-cache"
import { Skill } from "../../src/skill"
import { Provider } from "../../src/provider/provider"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Config } from "../../src/config/config"
import { testEffect } from "../lib/effect"
import os from "os"
import path from "path"
import fs from "fs/promises"

const testBaseDir = path.join(os.tmpdir(), "opencode-memory-integration-" + process.pid + "-" + Date.now())

const storageLayer = MemoryStorage.layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.layerWith({ data: testBaseDir })),
)

const mockSkillLayer = Layer.succeed(
  Skill.Service,
  Skill.Service.of({
    get: () => Effect.succeed(undefined),
    require: () => Effect.succeed(undefined as any),
    all: () => Effect.succeed([]),
    dirs: () => Effect.succeed([]),
    available: () => Effect.succeed([]),
  }),
)

let counter = 0
function freshLayer() {
  counter++
  const projectPath = `/test/integration-${counter}-${Date.now()}`
  const memoryLayer = Memory.layer(projectPath).pipe(Layer.provide(storageLayer))
  const retrievalLayer = MemoryRetrieval.layer.pipe(
    Layer.provideMerge(memoryLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(RuntimeFlags.defaultLayer),
    Layer.provide(Config.defaultLayer),
  )
  return SystemPrompt.layer.pipe(
    Layer.provide(mockSkillLayer),
    Layer.provide(SystemCache.layer),
    Layer.provideMerge(retrievalLayer),
  )
}

const it = testEffect(storageLayer)

afterAll(async () => {
  await fs.rm(testBaseDir, { recursive: true, force: true }).catch(() => {})
})

describe("Memory integration with system prompt", () => {
  it.live("relevant memories injected into dynamic system parts", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const sys = yield* SystemPrompt.Service

      yield* memory.add({
        type: "user",
        name: "TypeScript Preferences",
        description: "User TypeScript coding preferences",
        content: "Prefer strict mode and ES2022 target in TypeScript projects",
        tags: ["typescript"],
      })
      yield* memory.add({
        type: "project",
        name: "React Patterns",
        description: "React component patterns and best practices",
        content: "Use functional components with hooks for React development",
        tags: ["react"],
      })

      const result = yield* sys.memories({ query: "TypeScript configuration preferences" })

      expect(result).toBeDefined()
      expect(result).toContain("TypeScript Preferences")
      expect(result).toContain("Prefer strict mode")
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("memory injection is a dynamic part (not cached in static)", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const sys = yield* SystemPrompt.Service

      // First call with no memories
      const first = yield* sys.memories({ query: "coding patterns" })
      expect(first).toBeUndefined()

      // Add a memory
      yield* memory.add({
        type: "user",
        name: "Coding Style",
        description: "Preferred coding style and patterns",
        content: "Use functional programming patterns and avoid mutation",
        tags: ["coding"],
      })

      // Second call should now return the memory
      const second = yield* sys.memories({ query: "coding patterns" })
      expect(second).toBeDefined()
      expect(second).toContain("Coding Style")
      expect(second).toContain("functional programming")

      // Add another memory
      yield* memory.add({
        type: "feedback",
        name: "Code Review Feedback",
        description: "Feedback from code reviews about coding patterns",
        content: "Always add error handling and use Result types for coding patterns",
        tags: ["coding"],
      })

      // Third call should return both memories
      const third = yield* sys.memories({ query: "coding patterns" })
      expect(third).toBeDefined()
      expect(third).toContain("Coding Style")
      expect(third).toContain("Code Review Feedback")

      // Results should differ (not cached)
      expect(second).not.toBe(third)
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("no memory injection when no memories exist", () =>
    Effect.gen(function* () {
      const sys = yield* SystemPrompt.Service

      const result = yield* sys.memories({ query: "anything at all" })

      expect(result).toBeUndefined()
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("memory section has clear header/footer markers", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const sys = yield* SystemPrompt.Service

      yield* memory.add({
        type: "user",
        name: "Testing Strategy",
        description: "Testing approach and strategy for projects",
        content: "Write unit tests first using TDD approach for all modules",
        tags: ["testing"],
      })
      yield* memory.add({
        type: "project",
        name: "Build Configuration",
        description: "Build system configuration and setup",
        content: "Use Bun as the runtime and bundler for all TypeScript projects",
        tags: ["build"],
      })

      const result = yield* sys.memories({ query: "testing build configuration" })

      expect(result).toBeDefined()
      // Check header/footer markers
      expect(result!.startsWith("<memories>")).toBe(true)
      expect(result!.endsWith("</memories>")).toBe(true)
      // Check structure
      expect(result).toContain("## Relevant Memories")
      expect(result).toContain("- **Testing Strategy**:")
      expect(result).toContain("- **Build Configuration**:")
    }).pipe(Effect.provide(freshLayer())),
  )
})
