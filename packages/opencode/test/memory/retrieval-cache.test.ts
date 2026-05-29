import { beforeEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Memory } from "../../src/memory/memory"
import { MemoryRetrieval } from "../../src/memory/retrieval"
import { Provider } from "../../src/provider/provider"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Config } from "../../src/config/config"
import { testEffect } from "../lib/effect"
import type { MemoryEntry } from "../../src/memory/types"
import type { LanguageModelV3 } from "@ai-sdk/provider"

const testEntries: MemoryEntry[] = [
  {
    id: "entry-1",
    type: "user",
    name: "TypeScript Configuration",
    description: "TypeScript compiler options and tsconfig setup",
    content: "Configure strict mode and target ES2022 in tsconfig.json",
    tags: ["typescript"],
    created: 1000,
    updated: 1000,
  },
  {
    id: "entry-2",
    type: "user",
    name: "React Hooks Guide",
    description: "How to use React hooks effectively",
    content: "Use useState and useEffect for state management in React components",
    tags: ["react"],
    created: 2000,
    updated: 2000,
  },
  {
    id: "entry-3",
    type: "project",
    name: "TypeScript Best Practices",
    description: "TypeScript coding standards and TypeScript patterns",
    content: "Use TypeScript strict mode and avoid any types in TypeScript projects",
    tags: ["typescript"],
    created: 3000,
    updated: 3000,
  },
]

let llmCallCount = 0

function createMockLanguageModel(): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "mock",
    modelId: "mock-model",
    supportedUrls: {},
    doGenerate: async () => {
      llmCallCount++
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              scores: testEntries.map((e, i) => ({
                id: e.id,
                relevance: testEntries.length - i,
              })),
            }),
          },
        ],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      }
    },
    doStream: async () => {
      throw new Error("streaming not implemented for mock")
    },
  }
}

const mockMemory = Layer.mock(Memory.Service)({
  list: () => Effect.succeed(testEntries),
  add: (input: any) =>
    Effect.succeed({
      id: "new-id",
      ...input,
      created: Date.now(),
      updated: Date.now(),
    } as any),
  get: (_id: string) => Effect.succeed(undefined),
  delete: (_id: string) => Effect.void,
})

const mockProvider = Layer.mock(Provider.Service)({
  getModel: (_providerID: any, _modelID: any) =>
    Effect.succeed({
      providerID: _providerID,
      id: _modelID,
      api: { id: String(_modelID) },
      name: "Mock Model",
    } as any),
  getLanguage: (_model: any) => Effect.succeed(createMockLanguageModel()),
})

const mockConfig = Layer.mock(Config.Service)({
  get: () => Effect.succeed({ model: "mock/mock-model" } as any),
})

function makeTestLayer(experimentalMemoryRetrieval = true) {
  return MemoryRetrieval.layer.pipe(
    Layer.provide(mockMemory),
    Layer.provide(mockProvider),
    Layer.provide(mockConfig),
    Layer.provide(RuntimeFlags.layer({ experimentalMemoryRetrieval })),
  )
}

function makeFailingProviderLayer() {
  const failingProvider = Layer.mock(Provider.Service)({
    getModel: (_providerID: any, _modelID: any) =>
      Effect.succeed({
        providerID: _providerID,
        id: _modelID,
        api: { id: String(_modelID) },
        name: "Mock Model",
      } as any),
    getLanguage: (_model: any) => Effect.fail(new Error("LLM unavailable") as any),
  })
  return MemoryRetrieval.layer.pipe(
    Layer.provide(mockMemory),
    Layer.provide(failingProvider),
    Layer.provide(mockConfig),
    Layer.provide(RuntimeFlags.layer({ experimentalMemoryRetrieval: true })),
  )
}

const it = testEffect(makeTestLayer())
const itFailing = testEffect(makeFailingProviderLayer())

beforeEach(() => {
  llmCallCount = 0
})

describe("MemoryRetrieval cache", () => {
  it.effect("retrieve caches LLM results for identical queries", () =>
    Effect.gen(function* () {
      const retrieval = yield* MemoryRetrieval.Service

      const results1 = yield* retrieval.retrieve({ query: "TypeScript configuration", maxResults: 3 })
      const results2 = yield* retrieval.retrieve({ query: "TypeScript configuration", maxResults: 3 })

      expect(results1.length).toBeGreaterThan(0)
      expect(results2.length).toBeGreaterThan(0)
      expect(results1).toEqual(results2)
      expect(llmCallCount).toBe(1)
    }),
  )

  it.effect("cache expires after TTL", () =>
    Effect.gen(function* () {
      const retrieval = yield* MemoryRetrieval.Service

      yield* retrieval.retrieve({ query: "TypeScript configuration", maxResults: 3 })
      expect(llmCallCount).toBe(1)

      // Advance TestClock past the 5-minute TTL (300_000 ms)
      yield* TestClock.adjust("300001 millis")

      yield* retrieval.retrieve({ query: "TypeScript configuration", maxResults: 3 })
      expect(llmCallCount).toBe(2)
    }),
  )

  itFailing.effect("retrieveWithLLM errors propagate to outer catch", () =>
    Effect.gen(function* () {
      const retrieval = yield* MemoryRetrieval.Service

      // With failing provider, LLM call fails.
      // Keyword fallback should fire exactly once (not twice).
      const results = yield* retrieval.retrieve({ query: "TypeScript configuration", maxResults: 3 })

      // Should get keyword results (fallback)
      expect(results.length).toBeGreaterThan(0)
      // LLM was never successfully called
      expect(llmCallCount).toBe(0)
    }),
  )

  it.effect("different queries produce different cache entries", () =>
    Effect.gen(function* () {
      const retrieval = yield* MemoryRetrieval.Service

      yield* retrieval.retrieve({ query: "TypeScript configuration", maxResults: 3 })
      expect(llmCallCount).toBe(1)

      yield* retrieval.retrieve({ query: "React hooks", maxResults: 3 })
      expect(llmCallCount).toBe(2)

      // First query again should be cached
      yield* retrieval.retrieve({ query: "TypeScript configuration", maxResults: 3 })
      expect(llmCallCount).toBe(2)
    }),
  )
})
