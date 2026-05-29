import { Clock, Context, Effect, Layer, Ref, Schema } from "effect"
import { generateObject } from "ai"
import { Memory } from "./memory"
import type { MemoryEntry } from "./types"
import type { Provider } from "../provider/provider"
import type { Config } from "../config/config"
import type { Info as RuntimeFlagsInfo } from "../effect/runtime-flags"
import { ProviderID, ModelID } from "../provider/schema"

const CACHE_TTL_MS = 300_000

// Local service references to avoid circular imports
// (retrieval → provider → plugin → session/llm → session/llm/request → system → retrieval)
class ProviderRef extends Context.Service<ProviderRef, Provider.Interface>()("@opencode/Provider") {}
class ConfigRef extends Context.Service<ConfigRef, Config.Interface>()("@opencode/Config") {}
class RuntimeFlagsRef extends Context.Service<RuntimeFlagsRef, RuntimeFlagsInfo>()("@opencode/RuntimeFlags") {}

const ScoreResult = Schema.Struct({
  scores: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      relevance: Schema.Number,
    }),
  ),
})

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
    const provider = yield* ProviderRef
    const flags = yield* RuntimeFlagsRef
    const config = yield* ConfigRef
    const cache = yield* Ref.make<Map<string, { entries: MemoryEntry[]; ts: number }>>(new Map())
    const inFlight = yield* Ref.make<Map<string, Effect.Effect<MemoryEntry[]>>>(new Map())

    const retrieveWithKeywords = Effect.fn("MemoryRetrieval.retrieveWithKeywords")(function* (input: {
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

    const retrieveWithLLM = Effect.fn("MemoryRetrieval.retrieveWithLLM")(function* (input: {
      query: string
      maxResults?: number
      tags?: string[]
    }) {
      const cfg = yield* config.get()
      const modelConfig = cfg.model ?? "openai/gpt-4o-mini"
      const parts = modelConfig.split("/")
      const providerID = parts[0]
      const modelID = parts[1]
      if (!providerID || !modelID) return yield* Effect.fail(new Error(`Invalid model format: ${modelConfig}`))

      const model = yield* provider.getModel(ProviderID.make(providerID), ModelID.make(modelID))
      const languageModel = yield* provider.getLanguage(model)

      const all = yield* memory.list()
      const candidates = input.tags?.length
        ? all.filter((entry) => entry.tags?.some((tag) => input.tags!.includes(tag)))
        : all

      if (candidates.length === 0) return []

      const prompt = [
        `Score the relevance of each memory entry to the query.`,
        `Return a relevance score from 0-10 for each entry.`,
        ``,
        `Query: ${input.query}`,
        ``,
        `Entries:`,
        ...candidates.map(
          (e) => `ID: ${e.id}\nName: ${e.name}\nDescription: ${e.description}\nContent: ${e.content}`,
        ),
        ``,
        `Return a JSON object with a "scores" array of {"id", "relevance"} objects.`,
      ].join("\n")

      const result = yield* Effect.promise(() =>
        generateObject({
          model: languageModel,
          schema: Object.assign(
            Schema.toStandardSchemaV1(ScoreResult),
            Schema.toStandardJSONSchemaV1(ScoreResult),
          ),
          prompt,
        }).then((r) => r.object),
      )

      const scoreMap = new Map(result.scores.map((s) => [s.id, s.relevance]))
      return candidates
        .map((entry) => ({ entry, score: scoreMap.get(entry.id) ?? 0 }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, input.maxResults ?? 5)
        .map((s) => s.entry)
    })

    const cacheKey = (input: { query: string; tags?: string[] }) =>
      `${input.query}:${input.tags?.join(",") ?? ""}`

    const retrieve = Effect.fn("MemoryRetrieval.retrieve")(function* (input: {
      query: string
      maxResults?: number
      tags?: string[]
    }) {
      if (!flags.experimentalMemoryRetrieval) return yield* retrieveWithKeywords(input)

      const key = cacheKey(input)
      const now = yield* Clock.currentTimeMillis
      const cached = yield* Ref.get(cache).pipe(Effect.map((m) => m.get(key)))
      if (cached && now - cached.ts < CACHE_TTL_MS) return cached.entries

      const inflight = yield* Ref.get(inFlight).pipe(Effect.map((m) => m.get(key)))
      if (inflight) return yield* inflight

      const computation = retrieveWithLLM(input).pipe(
        Effect.tap((entries) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((ts) =>
              Ref.update(cache, (m) => {
                const next = new Map(m)
                next.set(key, { entries, ts })
                return next
              }),
            ),
          ),
        ),
        Effect.catch(() => retrieveWithKeywords(input)),
        Effect.ensuring(
          Ref.update(inFlight, (m) => {
            const next = new Map(m)
            next.delete(key)
            return next
          }),
        ),
      )

      yield* Ref.update(inFlight, (m) => {
        const next = new Map(m)
        next.set(key, computation)
        return next
      })
      return yield* computation
    })

    return Service.of({ retrieve })
  }),
)

// Layer.suspend takes a synchronous thunk () => Layer, so we use require() here because:
// 1. Static import would create a circular dependency at module evaluation time:
//    retrieval → provider → plugin → session/llm → llm/request → system → retrieval
// 2. Layer.suspend defers this callback until layer build time, when all modules
//    have completed top-level evaluation, so require() resolves fully initialized exports.
// 3. await import() is not possible — the thunk signature must be synchronous.
// 4. This project targets Bun, which natively supports require() in ESM modules.
export const defaultLayer = Layer.suspend(() => {
  const { Provider } = require("../provider/provider") as typeof import("../provider/provider")
  const { Config } = require("../config/config") as typeof import("../config/config")
  const { RuntimeFlags } = require("../effect/runtime-flags") as typeof import("../effect/runtime-flags")

  return layer.pipe(
    Layer.provide(Memory.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(RuntimeFlags.defaultLayer),
  )
})

export * as MemoryRetrieval from "./retrieval"
