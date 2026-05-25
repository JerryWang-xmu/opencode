import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { MemoryStorage } from "../../src/memory/storage"
import { Memory } from "../../src/memory/memory"
import { MemoryRetrieval } from "../../src/memory/retrieval"
import { MemoryExtraction } from "../../src/memory/extraction"
import { SystemPrompt } from "../../src/session/system"
import { SystemCache } from "../../src/session/system-cache"
import { Skill } from "../../src/skill"
import { testEffect } from "../lib/effect"
import os from "os"
import path from "path"
import fs from "fs/promises"

const testBaseDir = path.join(os.tmpdir(), "opencode-memory-lifecycle-" + process.pid + "-" + Date.now())

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

function fullPipelineLayer() {
  counter++
  const projectPath = `/test/lifecycle-${counter}-${Date.now()}`
  const memoryLayer = Memory.layer(projectPath).pipe(Layer.provide(storageLayer))
  const retrievalLayer = MemoryRetrieval.layer.pipe(Layer.provideMerge(memoryLayer))
  const extractionLayer = MemoryExtraction.layer.pipe(Layer.provideMerge(memoryLayer))
  const systemLayer = SystemPrompt.layer.pipe(
    Layer.provide(mockSkillLayer),
    Layer.provide(SystemCache.layer),
    Layer.provideMerge(retrievalLayer),
  )
  return Layer.mergeAll(systemLayer, extractionLayer, memoryLayer)
}

function crossSessionLayers(projectPath: string) {
  const memoryLayer = Memory.layer(projectPath).pipe(Layer.provide(storageLayer))
  const retrievalLayer = MemoryRetrieval.layer.pipe(Layer.provideMerge(memoryLayer))
  return Layer.mergeAll(memoryLayer, retrievalLayer)
}

function extractionOnlyLayer() {
  counter++
  const projectPath = `/test/lifecycle-dedup-${counter}-${Date.now()}`
  const memoryLayer = Memory.layer(projectPath).pipe(Layer.provide(storageLayer))
  const extractionLayer = MemoryExtraction.layer.pipe(Layer.provideMerge(memoryLayer))
  return Layer.mergeAll(extractionLayer, memoryLayer)
}

const it = testEffect(storageLayer)

afterAll(async () => {
  await fs.rm(testBaseDir, { recursive: true, force: true }).catch(() => {})
})

describe("Memory full lifecycle", () => {
  it.live("full lifecycle: extract → store → retrieve → inject", () =>
    Effect.gen(function* () {
      const extraction = yield* MemoryExtraction.Service
      const memory = yield* Memory.Service
      const sys = yield* SystemPrompt.Service

      // Turn 1: User states a preference, extraction creates a memory
      const turn1 = "I prefer TypeScript over JavaScript"
      const result = yield* extraction.extract({ conversation: turn1 })

      expect(result.count).toBeGreaterThan(0)
      expect(result.entries.length).toBe(result.count)

      // Verify the memory was stored
      const stored = yield* memory.list()
      expect(stored.length).toBeGreaterThan(0)
      const hasTypeScript = stored.some((e) => e.content.includes("TypeScript"))
      expect(hasTypeScript).toBe(true)

      // Turn 2: Memory is retrieved and injected into system prompt
      const injected = yield* sys.memories({ query: "TypeScript programming preferences" })

      expect(injected).toBeDefined()
      expect(injected).toContain("TypeScript")
      expect(injected).toContain("<memories>")
      expect(injected).toContain("</memories>")
      expect(injected).toContain("## Relevant Memories")
    }).pipe(Effect.provide(fullPipelineLayer())),
  )

  it.live("memories persist across sessions", () =>
    Effect.gen(function* () {
      const projectPath = `/test/lifecycle-persist-${Date.now()}`

      // Session 1: Create memories
      const session1Result = yield* Effect.gen(function* () {
        const memory = yield* Memory.Service
        yield* memory.add({
          type: "user",
          name: "TypeScript Preference",
          description: "User stated language preference",
          content: "I prefer TypeScript over JavaScript",
          tags: ["typescript"],
        })
        yield* memory.add({
          type: "project",
          name: "Runtime Choice",
          description: "Project runtime selection",
          content: "We use Bun as our runtime",
          tags: ["bun"],
        })
        return yield* memory.list()
      }).pipe(Effect.provide(crossSessionLayers(projectPath)))

      expect(session1Result.length).toBe(2)

      // Session 2: Memories are still available
      const session2Result = yield* Effect.gen(function* () {
        const memory = yield* Memory.Service
        const retrieval = yield* MemoryRetrieval.Service

        // Memory.list() should return memories from session 1
        const all = yield* memory.list()
        expect(all.length).toBe(2)

        const names = all.map((e) => e.name)
        expect(names).toContain("TypeScript Preference")
        expect(names).toContain("Runtime Choice")

        // MemoryRetrieval.retrieve() should also find them
        const retrieved = yield* retrieval.retrieve({ query: "TypeScript programming language" })
        expect(retrieved.length).toBeGreaterThan(0)
        const hasTypeScript = retrieved.some((e) => e.content.includes("TypeScript"))
        expect(hasTypeScript).toBe(true)

        return all
      }).pipe(Effect.provide(crossSessionLayers(projectPath)))

      expect(session2Result.length).toBe(2)
    }),
  )

  it.live("memory count stays manageable over long conversations", () =>
    Effect.gen(function* () {
      const extraction = yield* MemoryExtraction.Service
      const memory = yield* Memory.Service

      // 20 turns with various memorable content
      const turns = [
        "I prefer TypeScript over JavaScript",
        "I like functional programming",
        "We use Bun as our runtime",
        "Don't use var declarations",
        "This project uses Effect for error handling",
        "I prefer TypeScript over JavaScript", // duplicate of turn 1
        "I like functional programming", // duplicate of turn 2
        "Stop using console.log in production",
        "We use Drizzle for database ORM",
        "Our stack includes SolidJS for UI",
        "I want to use strict mode everywhere",
        "Please don't use any type annotations",
        "This project uses pnpm for package management",
        "We use Bun as our runtime", // duplicate of turn 3
        "Don't use var declarations", // duplicate of turn 4
        "Check https://effect.website for documentation",
        "I prefer const over let for variables",
        "We use GitHub Actions for CI",
        "Stop using console.log in production", // duplicate of turn 8
        "I like using pattern matching in TypeScript",
      ]

      let totalExtracted = 0
      for (const turn of turns) {
        const result = yield* extraction.extract({ conversation: turn, maxEntries: 5 })
        totalExtracted += result.count
      }

      // Verify memories were created
      const allEntries = yield* memory.list()
      expect(allEntries.length).toBeGreaterThan(0)

      // Deduplication should prevent unbounded growth:
      // 20 turns but many are duplicates, so total should be less than 20
      expect(allEntries.length).toBeLessThan(turns.length)

      // Total extracted across all turns should be reasonable
      expect(totalExtracted).toBeLessThanOrEqual(turns.length)

      // Verify no exact duplicate names exist in storage
      const names = allEntries.map((e) => e.name.toLowerCase())
      const uniqueNames = new Set(names)
      expect(uniqueNames.size).toBe(names.length)
    }).pipe(Effect.provide(extractionOnlyLayer())),
  )
})
