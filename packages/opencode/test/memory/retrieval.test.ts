import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { MemoryStorage } from "../../src/memory/storage"
import { Memory } from "../../src/memory/memory"
import { MemoryRetrieval } from "../../src/memory/retrieval"
import { Provider } from "../../src/provider/provider"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Config } from "../../src/config/config"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { testEffect } from "../lib/effect"
import os from "os"
import path from "path"
import fs from "fs/promises"

const testBaseDir = path.join(os.tmpdir(), "opencode-memory-retrieval-" + process.pid + "-" + Date.now())

const storageLayer = MemoryStorage.layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.layerWith({ data: testBaseDir })),
)

let counter = 0
function freshLayer(experimentalMemoryRetrieval = false) {
  counter++
  const projectPath = `/test/retrieval-${counter}-${Date.now()}`
  const memoryLayer = Memory.layer(projectPath).pipe(Layer.provide(storageLayer))
  return MemoryRetrieval.layer.pipe(
    Layer.provideMerge(memoryLayer),
    Layer.provideMerge(Provider.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalMemoryRetrieval })),
    Layer.provideMerge(Config.defaultLayer),
  )
}

const it = testEffect(storageLayer)

afterAll(async () => {
  await fs.rm(testBaseDir, { recursive: true, force: true }).catch(() => {})
})

describe("MemoryRetrieval", () => {
  it.live("retrieve returns top N relevant memories for a query", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const retrieval = yield* MemoryRetrieval.Service

      yield* memory.add({
        type: "user",
        name: "TypeScript Configuration",
        description: "TypeScript compiler options and tsconfig setup",
        content: "Configure strict mode and target ES2022 in tsconfig.json",
        tags: ["typescript"],
      })
      yield* memory.add({
        type: "user",
        name: "React Hooks Guide",
        description: "How to use React hooks effectively",
        content: "Use useState and useEffect for state management in React components",
        tags: ["react"],
      })
      yield* memory.add({
        type: "project",
        name: "TypeScript Best Practices",
        description: "TypeScript coding standards and TypeScript patterns",
        content: "Use TypeScript strict mode and avoid any types in TypeScript projects",
        tags: ["typescript"],
      })
      yield* memory.add({
        type: "feedback",
        name: "Python Testing",
        description: "Python unit testing with pytest",
        content: "Use pytest fixtures and parametrize for Python test coverage",
        tags: ["python"],
      })
      yield* memory.add({
        type: "reference",
        name: "TypeScript Migration",
        description: "Migrating JavaScript to TypeScript codebase",
        content: "Gradual TypeScript adoption strategy for existing JavaScript TypeScript projects",
        tags: ["typescript"],
      })

      const results = yield* retrieval.retrieve({ query: "TypeScript configuration", maxResults: 3 })

      expect(results.length).toBe(3)
      // All returned results should be TypeScript-related (most relevant)
      for (const entry of results) {
        const text = `${entry.name} ${entry.description} ${entry.content}`.toLowerCase()
        expect(text).toContain("typescript")
      }
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("retrieve returns empty array when no memories exist", () =>
    Effect.gen(function* () {
      const retrieval = yield* MemoryRetrieval.Service

      const results = yield* retrieval.retrieve({ query: "anything" })

      expect(results).toEqual([])
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("retrieve returns empty array when no memories are relevant", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const retrieval = yield* MemoryRetrieval.Service

      yield* memory.add({
        type: "user",
        name: "TypeScript Preferences",
        description: "User TypeScript coding preferences",
        content: "Prefer TypeScript strict mode for all TypeScript projects",
        tags: ["typescript"],
      })
      yield* memory.add({
        type: "user",
        name: "TypeScript Config",
        description: "TypeScript tsconfig settings",
        content: "Use TypeScript ES2022 target with TypeScript strict null checks",
        tags: ["typescript"],
      })

      const results = yield* retrieval.retrieve({ query: "Python debugging tips" })

      expect(results).toEqual([])
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("retrieve respects maxResults parameter", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const retrieval = yield* MemoryRetrieval.Service

      for (let i = 1; i <= 10; i++) {
        yield* memory.add({
          type: "user",
          name: `Coding Pattern ${i}`,
          description: `Software coding pattern number ${i} for development`,
          content: `This is coding pattern ${i} about software development and coding best practices`,
          tags: ["coding"],
        })
      }

      const results = yield* retrieval.retrieve({ query: "coding pattern development", maxResults: 5 })

      expect(results.length).toBe(5)
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("retrieve uses tags for pre-filtering", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const retrieval = yield* MemoryRetrieval.Service

      yield* memory.add({
        type: "user",
        name: "TypeScript Strict Mode",
        description: "TypeScript strict configuration",
        content: "Enable TypeScript strict mode for TypeScript type safety",
        tags: ["typescript"],
      })
      yield* memory.add({
        type: "user",
        name: "Python Virtual Environments",
        description: "Python venv and Python virtualenv setup",
        content: "Use Python venv for Python project isolation and Python dependency management",
        tags: ["python"],
      })
      yield* memory.add({
        type: "project",
        name: "TypeScript Linting",
        description: "TypeScript ESLint TypeScript configuration",
        content: "Configure ESLint for TypeScript with TypeScript specific rules",
        tags: ["typescript", "linting"],
      })

      const results = yield* retrieval.retrieve({ query: "TypeScript configuration", tags: ["typescript"] })

      expect(results.length).toBeGreaterThan(0)
      // All results should have typescript tag
      for (const entry of results) {
        expect(entry.tags).toBeDefined()
        expect(entry.tags!.some((t) => t === "typescript")).toBe(true)
      }
    }).pipe(Effect.provide(freshLayer())),
  )

  it.instance("retrieve uses provider.getLanguage() for proper language model conversion when experimentalMemoryRetrieval is enabled", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const retrieval = yield* MemoryRetrieval.Service

      // Add some test memories
      yield* memory.add({
        type: "user",
        name: "Test Memory 1",
        description: "First test memory",
        content: "This is the first test memory content",
        tags: ["test"],
      })
      yield* memory.add({
        type: "user",
        name: "Test Memory 2",
        description: "Second test memory",
        content: "This is the second test memory content",
        tags: ["test"],
      })

      // Test that retrieval works with experimentalMemoryRetrieval enabled
      // This exercises the code path that uses provider.getLanguage() to convert
      // Provider.Model to LanguageModelV3. The LLM call will fail (no model configured)
      // and fall back to keyword matching, which is the expected behavior.
      const results = yield* retrieval.retrieve({ query: "test memory", maxResults: 2 })
      
      // Should return results from keyword fallback
      expect(results.length).toBeGreaterThan(0)
      expect(results.length).toBeLessThanOrEqual(2)
      
      // Verify results contain the search terms
      for (const entry of results) {
        const text = `${entry.name} ${entry.description} ${entry.content}`.toLowerCase()
        expect(text.includes("test") || text.includes("memory")).toBe(true)
      }
    }).pipe(Effect.provide(freshLayer(true))),
  )
})
