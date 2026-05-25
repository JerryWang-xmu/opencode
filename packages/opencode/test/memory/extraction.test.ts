import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { MemoryStorage } from "../../src/memory/storage"
import { Memory } from "../../src/memory/memory"
import { MemoryExtraction } from "../../src/memory/extraction"
import { testEffect } from "../lib/effect"
import os from "os"
import path from "path"
import fs from "fs/promises"

const testBaseDir = path.join(os.tmpdir(), "opencode-memory-extract-" + process.pid + "-" + Date.now())

const storageLayer = MemoryStorage.layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.layerWith({ data: testBaseDir })),
)

let counter = 0
function freshLayer() {
  counter++
  const projectPath = `/test/extraction-${counter}-${Date.now()}`
  const memLayer = Memory.layer(projectPath).pipe(Layer.provide(storageLayer))
  const extractionLayer = MemoryExtraction.layer.pipe(Layer.provide(memLayer))
  return Layer.merge(extractionLayer, memLayer)
}

const it = testEffect(storageLayer)

afterAll(async () => {
  await fs.rm(testBaseDir, { recursive: true, force: true }).catch(() => {})
})

describe("MemoryExtraction", () => {
  it.live("extract analyzes conversation and creates memory entries", () =>
    Effect.gen(function* () {
      const extraction = yield* MemoryExtraction.Service
      const memory = yield* Memory.Service

      const conversation = [
        "I prefer TypeScript over JavaScript",
        "We use Effect for error handling",
        "Don't use any in the codebase",
      ].join("\n")

      const result = yield* extraction.extract({ conversation })

      expect(result.count).toBeGreaterThan(0)
      expect(result.entries.length).toBe(result.count)

      const allEntries = yield* memory.list()
      expect(allEntries.length).toBe(result.count)

      const types = result.entries.map((e) => e.type)
      expect(types).toContain("user")
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("extract skips conversations with no memorable content", () =>
    Effect.gen(function* () {
      const extraction = yield* MemoryExtraction.Service
      const memory = yield* Memory.Service

      const conversation = [
        "Hello, how are you?",
        "The weather is nice today.",
        "What time is it?",
      ].join("\n")

      const result = yield* extraction.extract({ conversation })

      expect(result.count).toBe(0)
      expect(result.entries.length).toBe(0)

      const allEntries = yield* memory.list()
      expect(allEntries.length).toBe(0)
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("extract categorizes memories correctly", () =>
    Effect.gen(function* () {
      const extraction = yield* MemoryExtraction.Service

      const conversation = [
        "I prefer TypeScript over JavaScript",
        "Don't use any in the codebase",
        "This project uses Effect for error handling",
        "Check the docs at https://effect.website",
      ].join("\n")

      const result = yield* extraction.extract({ conversation })

      expect(result.count).toBe(4)

      const types = result.entries.map((e) => e.type)
      expect(types).toContain("user")
      expect(types).toContain("feedback")
      expect(types).toContain("project")
      expect(types).toContain("reference")
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("extract deduplicates similar memories", () =>
    Effect.gen(function* () {
      const extraction = yield* MemoryExtraction.Service
      const memory = yield* Memory.Service

      const line = "I prefer TypeScript over JavaScript"
      const existingName = `User preference: ${line}`

      yield* memory.add({
        type: "user",
        name: existingName,
        description: "User stated preference",
        content: line,
      })

      const result = yield* extraction.extract({ conversation: line })

      expect(result.count).toBe(0)
      expect(result.entries.length).toBe(0)

      const allEntries = yield* memory.list()
      expect(allEntries.length).toBe(1)
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("extract respects maxEntries limit", () =>
    Effect.gen(function* () {
      const extraction = yield* MemoryExtraction.Service

      const conversation = [
        "I prefer TypeScript",
        "I like functional programming",
        "I want to use Effect",
        "We use Bun as our runtime",
        "This project uses Drizzle for database",
        "Our stack includes SolidJS",
        "Don't use var declarations",
        "Stop using console.log",
        "Please don't use any type",
        "Check https://effect.website for docs",
        "See https://bun.sh for runtime docs",
      ].join("\n")

      const result = yield* extraction.extract({ conversation, maxEntries: 5 })

      expect(result.count).toBeLessThanOrEqual(5)
      expect(result.entries.length).toBeLessThanOrEqual(5)
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("extract returns summary of extracted memories", () =>
    Effect.gen(function* () {
      const extraction = yield* MemoryExtraction.Service

      const conversation = [
        "I prefer TypeScript over JavaScript",
        "We use Effect for error handling",
      ].join("\n")

      const result = yield* extraction.extract({ conversation })

      expect(result).toHaveProperty("count")
      expect(result).toHaveProperty("entries")
      expect(typeof result.count).toBe("number")
      expect(Array.isArray(result.entries)).toBe(true)
      expect(result.count).toBe(result.entries.length)

      for (const entry of result.entries) {
        expect(entry.id).toBeDefined()
        expect(entry.type).toBeDefined()
        expect(entry.name).toBeDefined()
        expect(entry.content).toBeDefined()
      }
    }).pipe(Effect.provide(freshLayer())),
  )
})
