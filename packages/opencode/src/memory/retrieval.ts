import { Context, Effect, Layer } from "effect"
import { Memory } from "./memory"
import type { MemoryEntry } from "./types"

export interface Interface {
  readonly retrieve: (input: {
    query: string
    maxResults?: number
    tags?: string[]
  }) => Effect.Effect<MemoryEntry[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MemoryRetrieval") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    const retrieve = Effect.fn("MemoryRetrieval.retrieve")(function* (input: {
      query: string
      maxResults?: number
      tags?: string[]
    }) {
      const all = yield* memory.list()

      const candidates = input.tags?.length
        ? all.filter((entry) => entry.tags?.some((tag) => input.tags!.includes(tag)))
        : all

      const queryWords = input.query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2)

      const scored = candidates.map((entry) => {
        const text = `${entry.name} ${entry.description} ${entry.content}`.toLowerCase()
        const score = queryWords.reduce((acc, word) => acc + (text.includes(word) ? 1 : 0), 0)
        return { entry, score }
      })

      return scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, input.maxResults ?? 5)
        .map((s) => s.entry)
    })

    return Service.of({ retrieve })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Memory.defaultLayer))

export * as MemoryRetrieval from "./retrieval"
