import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { MemoryStorage } from "../../src/memory/storage"
import { Memory } from "../../src/memory/memory"
import { testEffect } from "../lib/effect"
import os from "os"
import path from "path"
import fs from "fs/promises"

const testBaseDir = path.join(os.tmpdir(), "opencode-memory-svc-" + process.pid + "-" + Date.now())

const storageLayer = MemoryStorage.layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.layerWith({ data: testBaseDir })),
)

let counter = 0
function freshLayer() {
  counter++
  return Memory.layer(`/test/memory-${counter}-${Date.now()}`).pipe(Layer.provide(storageLayer))
}

const it = testEffect(storageLayer)

afterAll(async () => {
  await fs.rm(testBaseDir, { recursive: true, force: true }).catch(() => {})
})

describe("Memory", () => {
  it.live("add creates a new memory entry and returns it", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const entry = yield* memory.add({
        type: "user",
        name: "TypeScript Preference",
        description: "User prefers TypeScript",
        content: "User prefers TypeScript for all projects.",
        tags: ["preference"],
      })

      expect(entry.id).toBeDefined()
      expect(entry.type).toBe("user")
      expect(entry.name).toBe("TypeScript Preference")
      expect(entry.description).toBe("User prefers TypeScript")
      expect(entry.content).toBe("User prefers TypeScript for all projects.")
      expect(entry.tags).toEqual(["preference"])
      expect(entry.created).toBeGreaterThan(0)
      expect(entry.updated).toBeGreaterThan(0)
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("add generates unique IDs for each entry", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const entry1 = yield* memory.add({
        type: "user",
        name: "Entry One",
        description: "First",
        content: "Content 1",
      })
      const entry2 = yield* memory.add({
        type: "user",
        name: "Entry Two",
        description: "Second",
        content: "Content 2",
      })

      expect(entry1.id).not.toBe(entry2.id)
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("list returns all entries", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      yield* memory.add({ type: "user", name: "A", description: "a", content: "a" })
      yield* memory.add({ type: "feedback", name: "B", description: "b", content: "b" })
      yield* memory.add({ type: "project", name: "C", description: "c", content: "c" })

      const entries = yield* memory.list()
      expect(entries.length).toBe(3)
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("get returns entry by ID", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const added = yield* memory.add({
        type: "reference",
        name: "API Docs",
        description: "API documentation link",
        content: "https://api.example.com",
      })

      const found = yield* memory.get(added.id)
      expect(found).toBeDefined()
      expect(found!.id).toBe(added.id)
      expect(found!.name).toBe("API Docs")
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("get returns undefined for non-existent ID", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const found = yield* memory.get("non-existent")
      expect(found).toBeUndefined()
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("delete removes entry", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      const entry = yield* memory.add({
        type: "user",
        name: "To Delete",
        description: "Will be deleted",
        content: "Delete me",
      })

      yield* memory.delete(entry.id)

      const entries = yield* memory.list()
      expect(entries.length).toBe(0)
    }).pipe(Effect.provide(freshLayer())),
  )

  it.live("delete is idempotent", () =>
    Effect.gen(function* () {
      const memory = yield* Memory.Service
      yield* memory.delete("non-existent")
      yield* memory.delete("non-existent")
    }).pipe(Effect.provide(freshLayer())),
  )
})
