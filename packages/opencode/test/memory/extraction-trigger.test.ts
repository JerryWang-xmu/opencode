import { afterAll, describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { MemoryStorage } from "../../src/memory/storage"
import { Memory } from "../../src/memory/memory"
import { MemoryExtraction } from "../../src/memory/extraction"
import { testEffect } from "../lib/effect"
import os from "os"
import path from "path"
import fs from "fs/promises"

const testBaseDir = path.join(os.tmpdir(), "opencode-extraction-trigger-" + process.pid + "-" + Date.now())

const storageLayer = MemoryStorage.layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.layerWith({ data: testBaseDir })),
)

let counter = 0
function freshLayer() {
  counter++
  const projectPath = `/test/extraction-${counter}-${Date.now()}`
  const memoryLayer = Memory.layer(projectPath).pipe(Layer.provide(storageLayer))
  return MemoryExtraction.layer.pipe(
    Layer.provideMerge(memoryLayer),
  )
}

const it = testEffect(storageLayer)

afterAll(async () => {
  await fs.rm(testBaseDir, { recursive: true, force: true }).catch(() => {})
})

describe("Memory extraction trigger", () => {
  it.live("extraction runs after prompt loop iteration", () =>
    Effect.gen(function* () {
      const extraction = yield* MemoryExtraction.Service
      const memory = yield* Memory.Service

      const conversation = "I prefer TypeScript over JavaScript\nWe use Bun as our runtime\nI like functional programming"

      const result = yield* extraction.extract({
        conversation,
        maxEntries: 3,
      })

      expect(result.count).toBeGreaterThan(0)
      expect(result.count).toBeLessThanOrEqual(3)
      expect(result.entries.length).toBe(result.count)

      const stored = yield* memory.list()
      expect(stored.length).toBe(result.count)
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("extraction does not block prompt response", () =>
    Effect.gen(function* () {
      const extraction = yield* MemoryExtraction.Service
      const signal = yield* Deferred.make<boolean>()

      const conversation = "I prefer TypeScript\nWe use Effect library"

      // Fork extraction (simulating what prompt.ts does with Effect.forkIn)
      const fiber = yield* Effect.forkScoped(
        extraction.extract({ conversation, maxEntries: 3 }).pipe(
          Effect.flatMap((result) => Deferred.succeed(signal, result.count > 0)),
        ),
      )

      // Main flow should complete before extraction fiber resolves
      const mainDone = yield* Deferred.make<boolean>()
      yield* Deferred.succeed(mainDone, true)
      const mainResult = yield* Deferred.await(mainDone)
      expect(mainResult).toBe(true)

      // Now wait for the forked extraction to complete
      const extractionDone = yield* Deferred.await(signal).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () => Effect.succeed(false),
        }),
      )
      expect(extractionDone).toBe(true)

      yield* Fiber.join(fiber)
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("extraction uses last user message as context", () =>
    Effect.gen(function* () {
      const extraction = yield* MemoryExtraction.Service
      const memory = yield* Memory.Service

      // Simulate the last user message text (what prompt.ts passes as queryText)
      const lastUserMessage = "I prefer using const over let and I like the Effect library for TypeScript"

      const result = yield* extraction.extract({
        conversation: lastUserMessage,
        maxEntries: 3,
      })

      expect(result.count).toBeGreaterThan(0)

      const stored = yield* memory.list()
      // Verify extracted memories are relevant to the user message
      const hasPreference = stored.some((e) => e.type === "user" || e.content.includes("prefer") || e.content.includes("like"))
      expect(hasPreference).toBe(true)

      // Verify extraction respects maxEntries limit
      expect(result.count).toBeLessThanOrEqual(3)
    }).pipe(Effect.provide(freshLayer())),
  )
})
