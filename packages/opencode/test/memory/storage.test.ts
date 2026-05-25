import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { MemoryStorage, sanitizePath } from "../../src/memory/storage"
import type { MemoryEntry } from "../../src/memory/types"
import { testEffect } from "../lib/effect"
import os from "os"
import path from "path"
import fs from "fs/promises"

const testBaseDir = path.join(os.tmpdir(), "opencode-mem-test-" + process.pid + "-" + Date.now())

const it = testEffect(
  MemoryStorage.layer.pipe(
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Global.layerWith({ data: testBaseDir })),
  ),
)

let counter = 0
function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  counter++
  return {
    id: overrides.id ?? `mem-${counter}-${Math.random().toString(36).slice(2, 6)}`,
    type: "user",
    name: "Test Entry",
    description: "A test memory entry",
    content: "Test content for this memory entry.",
    created: 1700000000000,
    updated: 1700000000000,
    ...overrides,
  }
}

afterAll(async () => {
  await fs.rm(testBaseDir, { recursive: true, force: true }).catch(() => {})
})

describe("MemoryStorage", () => {
  it.live("creates memory directory structure", () =>
    Effect.gen(function* () {
      const storage = yield* MemoryStorage.Service
      const projectPath = "/test/project-init"
      yield* storage.init(projectPath)

      const dir = path.join(testBaseDir, "memory", sanitizePath(projectPath))
      const stat = yield* Effect.promise(() => fs.stat(dir))
      expect(stat.isDirectory()).toBe(true)

      const indexStat = yield* Effect.promise(() => fs.stat(path.join(dir, "MEMORY.md")))
      expect(indexStat.isFile()).toBe(true)
    }),
  )

  it.live("writes memory entry as .md file with YAML frontmatter", () =>
    Effect.gen(function* () {
      const storage = yield* MemoryStorage.Service
      const projectPath = "/test/project-write"
      yield* storage.init(projectPath)

      const entry = makeEntry({
        id: "write-test-001",
        name: "TypeScript Preference",
        description: "User prefers TypeScript",
        type: "user",
        tags: ["preference", "language"],
        content: "User prefers TypeScript for all projects.",
        created: 1700000000000,
        updated: 1700000000000,
      })
      yield* storage.write(projectPath, entry)

      const entries = yield* storage.readAll(projectPath)
      expect(entries.length).toBe(1)
      const result = entries[0]!
      expect(result.name).toBe("TypeScript Preference")
      expect(result.description).toBe("User prefers TypeScript")
      expect(result.type).toBe("user")
      expect(result.tags).toEqual(["preference", "language"])
      expect(result.content).toBe("User prefers TypeScript for all projects.")
    }),
  )

  it.live("reads all entries from directory", () =>
    Effect.gen(function* () {
      const storage = yield* MemoryStorage.Service
      const projectPath = "/test/project-readall"
      yield* storage.init(projectPath)

      yield* storage.write(projectPath, makeEntry({ id: "re-1", name: "Entry One" }))
      yield* storage.write(projectPath, makeEntry({ id: "re-2", name: "Entry Two" }))
      yield* storage.write(projectPath, makeEntry({ id: "re-3", name: "Entry Three" }))

      const entries = yield* storage.readAll(projectPath)
      expect(entries.length).toBe(3)
      const names = entries.map((e) => e.name).sort()
      expect(names).toEqual(["Entry One", "Entry Three", "Entry Two"])
    }),
  )

  it.live("updates existing entry", () =>
    Effect.gen(function* () {
      const storage = yield* MemoryStorage.Service
      const projectPath = "/test/project-update"
      yield* storage.init(projectPath)

      const entry = makeEntry({
        id: "update-001",
        name: "Original",
        content: "Original content",
        created: 1700000000000,
        updated: 1700000000000,
      })
      yield* storage.write(projectPath, entry)

      const updated = makeEntry({
        id: "update-001",
        name: "Original",
        content: "Updated content",
        created: 1700000000000,
        updated: 1700000001000,
      })
      yield* storage.write(projectPath, updated)

      const entries = yield* storage.readAll(projectPath)
      expect(entries.length).toBe(1)
      expect(entries[0]!.content).toBe("Updated content")
      expect(entries[0]!.updated).toBe(1700000001000)
    }),
  )

  it.live("deletes entry", () =>
    Effect.gen(function* () {
      const storage = yield* MemoryStorage.Service
      const projectPath = "/test/project-delete"
      yield* storage.init(projectPath)

      const entry = makeEntry({ id: "delete-001", name: "To Delete" })
      yield* storage.write(projectPath, entry)

      let entries = yield* storage.readAll(projectPath)
      expect(entries.length).toBe(1)

      yield* storage.delete(projectPath, "delete-001")

      entries = yield* storage.readAll(projectPath)
      expect(entries.length).toBe(0)
    }),
  )

  it.live("MEMORY.md index reflects current entries", () =>
    Effect.gen(function* () {
      const storage = yield* MemoryStorage.Service
      const projectPath = "/test/project-index"
      yield* storage.init(projectPath)

      yield* storage.write(
        projectPath,
        makeEntry({ id: "idx-1", name: "First Entry", description: "Description of first" }),
      )
      yield* storage.write(
        projectPath,
        makeEntry({ id: "idx-2", name: "Second Entry", description: "Description of second" }),
      )

      const index = yield* storage.readIndex(projectPath)
      expect(index).toContain("First Entry")
      expect(index).toContain("Description of first")
      expect(index).toContain("Second Entry")
      expect(index).toContain("Description of second")
    }),
  )

  it.live("MEMORY.md respects 200 line cap", () =>
    Effect.gen(function* () {
      const storage = yield* MemoryStorage.Service
      const projectPath = "/test/project-cap"
      yield* storage.init(projectPath)

      for (let i = 0; i < 250; i++) {
        yield* storage.write(
          projectPath,
          makeEntry({ id: `cap-${String(i).padStart(3, "0")}`, name: `Entry ${i}`, description: `Desc ${i}` }),
        )
      }

      const index = yield* storage.readIndex(projectPath)
      const lines = index.split("\n")
      // trailing newline produces an empty last element — count non-empty lines
      const nonEmpty = lines.filter((l) => l.length > 0)
      expect(nonEmpty.length).toBeLessThanOrEqual(200)
    }),
  )

  it.live("sanitizes project path for directory name", () =>
    Effect.gen(function* () {
      const result = sanitizePath("/home/user/my project")
      expect(result).not.toContain(" ")
      expect(result).not.toContain("/")
      expect(result).toBe(result.toLowerCase())
      expect(result.length).toBeGreaterThan(0)

      const result2 = sanitizePath("/home/user/my project")
      const storage = yield* MemoryStorage.Service
      yield* storage.init("/home/user/my project")
      const dir = path.join(testBaseDir, "memory", result2)
      const stat = yield* Effect.promise(() => fs.stat(dir))
      expect(stat.isDirectory()).toBe(true)
    }),
  )
})
