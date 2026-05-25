import { Context, Effect, Layer } from "effect"
import { Memory } from "./memory"
import type { MemoryEntry, MemoryType } from "./types"

export interface Interface {
  readonly extract: (input: {
    conversation: string
    maxEntries?: number
  }) => Effect.Effect<{
    count: number
    entries: MemoryEntry[]
  }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MemoryExtraction") {}

function classifyLine(line: string): { type: MemoryType; prefix: string; description: string } | undefined {
  const lower = line.toLowerCase()

  if (lower.includes("i prefer") || lower.includes("i like") || lower.includes("i want")) {
    return { type: "user", prefix: "User preference", description: "User stated preference" }
  }

  if (lower.includes("don't") || lower.includes("stop") || lower.includes("please don't")) {
    return { type: "feedback", prefix: "User feedback", description: "User provided feedback" }
  }

  if (lower.includes("this project") || lower.includes("we use") || lower.includes("our stack")) {
    return { type: "project", prefix: "Project info", description: "Project-specific information" }
  }

  if (lower.includes("http://") || lower.includes("https://")) {
    return { type: "reference", prefix: "Reference", description: "Referenced resource" }
  }

  return undefined
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    const extract = Effect.fn("MemoryExtraction.extract")(function* (input: {
      conversation: string
      maxEntries?: number
    }) {
      const lines = input.conversation.split("\n").map((l) => l.trim()).filter(Boolean)

      const candidates: Array<{ type: MemoryType; name: string; description: string; content: string }> = []

      for (const line of lines) {
        const classification = classifyLine(line)
        if (!classification) continue

        candidates.push({
          type: classification.type,
          name: `${classification.prefix}: ${line.slice(0, 50)}`,
          description: classification.description,
          content: line,
        })
      }

      const existing = yield* memory.list()
      const existingNames = new Set(existing.map((e) => e.name.toLowerCase()))

      const newEntries = candidates
        .filter((c) => !existingNames.has(c.name.toLowerCase()))
        .slice(0, input.maxEntries ?? 10)

      const added: MemoryEntry[] = []
      for (const entry of newEntries) {
        const addedEntry = yield* memory.add(entry)
        added.push(addedEntry)
      }

      return {
        count: added.length,
        entries: added,
      }
    })

    return Service.of({ extract })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Memory.defaultLayer))

export * as MemoryExtraction from "./extraction"
