import path from "path"
import { Context, Effect, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import type { MemoryEntry } from "./types"
import { MEMORY_INDEX_MAX_LINES } from "./types"

export function sanitizePath(projectPath: string): string {
  return projectPath
    .replace(/[/\\]/g, "-")
    .replace(/[^a-z0-9\-_.]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
}

function escapeQuotes(s: string): string {
  return s.replace(/"/g, '\\"')
}

function serializeEntry(entry: MemoryEntry): string {
  const lines = ["---"]
  lines.push(`name: "${escapeQuotes(entry.name)}"`)
  lines.push(`description: "${escapeQuotes(entry.description)}"`)
  lines.push(`type: ${entry.type}`)
  if (entry.tags?.length) {
    lines.push(`tags: [${entry.tags.map((t) => `"${escapeQuotes(t)}"`).join(", ")}]`)
  }
  lines.push(`created: ${entry.created}`)
  lines.push(`updated: ${entry.updated}`)
  if (entry.source) {
    lines.push(`source_session: "${entry.source.sessionID}"`)
    lines.push(`source_message: "${entry.source.messageID}"`)
  }
  lines.push("---")
  lines.push(entry.content)
  return lines.join("\n") + "\n"
}

function parseEntry(id: string, text: string): MemoryEntry | undefined {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return undefined

  const yamlBlock = match[1]!
  const content = match[2]!.trim()

  const fields: Record<string, string> = {}
  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":")
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    let value = line.slice(colonIdx + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"')
    }
    fields[key] = value
  }

  let tags: string[] | undefined
  if (fields.tags) {
    const tagMatch = fields.tags.match(/\[(.*)\]/)
    if (tagMatch) {
      tags = tagMatch[1]!
        .split(",")
        .map((t) => t.trim().replace(/^"|"$/g, ""))
        .filter(Boolean)
    }
  }

  let source: { sessionID: string; messageID: string } | undefined
  if (fields.source_session && fields.source_message) {
    source = {
      sessionID: fields.source_session,
      messageID: fields.source_message,
    }
  }

  const type = fields.type
  if (!type || !["user", "feedback", "project", "reference"].includes(type)) return undefined

  return {
    id,
    type: type as MemoryEntry["type"],
    name: fields.name ?? "",
    description: fields.description ?? "",
    content,
    tags,
    created: Number(fields.created) || 0,
    updated: Number(fields.updated) || 0,
    source,
  }
}

function generateIndex(entries: MemoryEntry[]): string {
  const lines: string[] = ["# Memory Index", ""]
  for (const entry of entries) {
    if (lines.length >= MEMORY_INDEX_MAX_LINES) break
    lines.push(`- **${entry.name}**: ${entry.description}`)
  }
  return lines.join("\n") + "\n"
}

export interface Interface {
  readonly init: (projectPath: string) => Effect.Effect<void>
  readonly readAll: (projectPath: string) => Effect.Effect<MemoryEntry[]>
  readonly write: (projectPath: string, entry: MemoryEntry) => Effect.Effect<void>
  readonly delete: (projectPath: string, id: string) => Effect.Effect<void>
  readonly readIndex: (projectPath: string) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MemoryStorage") {}

export const use = serviceUse(Service)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const fs = yield* AppFileSystem.Service

    const baseDir = path.join(global.data, "memory")

    function memoryDir(projectPath: string) {
      return path.join(baseDir, sanitizePath(projectPath))
    }

    function indexFile(projectPath: string) {
      return path.join(memoryDir(projectPath), "MEMORY.md")
    }

    function entryFile(projectPath: string, id: string) {
      return path.join(memoryDir(projectPath), `${id}.md`)
    }

    const init = Effect.fn("MemoryStorage.init")(function* (projectPath: string) {
      const dir = memoryDir(projectPath)
      yield* fs.ensureDir(dir)
      const idx = indexFile(projectPath)
      const exists = yield* fs.existsSafe(idx)
      if (!exists) {
        yield* fs.writeFileString(idx, "# Memory Index\n")
      }
    }, Effect.orDie)

    const readAll = Effect.fn("MemoryStorage.readAll")(function* (projectPath: string) {
      const dir = memoryDir(projectPath)
      const exists = yield* fs.existsSafe(dir)
      if (!exists) return []

      const dirEntries = yield* fs.readDirectoryEntries(dir)
      const mdFiles = dirEntries.filter((e) => e.name.endsWith(".md") && e.name !== "MEMORY.md" && e.type === "file")

      const results = yield* Effect.all(
        mdFiles.map((file) =>
          Effect.gen(function* () {
            const content = yield* fs.readFileStringSafe(path.join(dir, file.name))
            if (content === undefined) return undefined
            const id = file.name.replace(/\.md$/, "")
            return parseEntry(id, content)
          })
        ),
        { concurrency: "unbounded" },
      )

      return results.filter((e): e is MemoryEntry => e !== undefined)
    }, Effect.orDie)

    const updateIndex = Effect.fn("MemoryStorage.updateIndex")(function* (projectPath: string) {
      const allEntries = yield* readAll(projectPath)
      const indexContent = generateIndex(allEntries)
      yield* fs.writeFileString(indexFile(projectPath), indexContent)
    })

    const write = Effect.fn("MemoryStorage.write")(function* (projectPath: string, entry: MemoryEntry) {
      const dir = memoryDir(projectPath)
      yield* fs.ensureDir(dir)

      const filePath = entryFile(projectPath, entry.id)
      const content = serializeEntry(entry)
      yield* fs.writeFileString(filePath, content)

      yield* updateIndex(projectPath)
    }, Effect.orDie)

    const deleteEntry = Effect.fn("MemoryStorage.delete")(function* (projectPath: string, id: string) {
      const filePath = entryFile(projectPath, id)
      const exists = yield* fs.existsSafe(filePath)
      if (exists) {
        yield* fs.remove(filePath)
      }

      yield* updateIndex(projectPath)
    }, Effect.orDie)

    const readIndex = Effect.fn("MemoryStorage.readIndex")(function* (projectPath: string) {
      const idx = indexFile(projectPath)
      const content = yield* fs.readFileStringSafe(idx)
      return content ?? ""
    }, Effect.orDie)

    return Service.of({
      init,
      readAll,
      write,
      delete: deleteEntry,
      readIndex,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Global.defaultLayer),
)

export * as MemoryStorage from "./storage"
