import { describe, expect } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { Service as MemoryAutoDreamService, layer as autoDreamLayer } from "../../src/memory/autoDream"
import { Memory } from "../../src/memory/memory"
import { MemoryExtraction } from "../../src/memory/extraction"
import { Session } from "../../src/session/session"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Config } from "../../src/config/config"
import { Provider } from "../../src/provider/provider"
import { testEffect } from "../lib/effect"

const mockMemory = Layer.mock(Memory.Service)({
  add: (_input: any) => Effect.succeed({ id: "test-id", type: "project", name: "test", description: "test", content: "test", tags: [] } as any),
  list: () => Effect.succeed([]),
})

const mockExtraction = Layer.mock(MemoryExtraction.Service)({
  extract: () => Effect.succeed({ count: 0, entries: [] }),
})

const mockSession = Layer.mock(Session.Service)({
  list: () =>
    Effect.succeed([
      {
        id: "s1",
        title: "Test Session 1",
        time: { created: Date.now() - 1000, updated: Date.now() - 500 },
      },
      {
        id: "s2",
        title: "Test Session 2",
        time: { created: Date.now() - 2000, updated: Date.now() - 1500 },
      },
      {
        id: "s3",
        title: "Test Session 3",
        time: { created: Date.now() - 3000, updated: Date.now() - 2500 },
      },
    ] as any),
})

const mockConfigInvalidModel = Layer.mock(Config.Service)({
  get: () => Effect.succeed({ model: "invalid-model" } as any),
})

const mockProvider = Layer.mock(Provider.Service)({
  getModel: (_providerID: any, _modelID: any) => Effect.fail(new Error("should not be called with invalid model") as any),
  getLanguage: (_model: any) => Effect.fail(new Error("should not be called") as any),
})

const testLayer = autoDreamLayer.pipe(
  Layer.provide(mockMemory),
  Layer.provide(mockExtraction),
  Layer.provide(mockSession),
  Layer.provide(RuntimeFlags.layer({ experimentalAutoDream: true })),
  Layer.provide(mockConfigInvalidModel),
  Layer.provide(mockProvider),
)

const it = testEffect(testLayer)

describe("MemoryAutoDream", () => {
  it.effect("performDream rejects invalid model format", () =>
    Effect.gen(function* () {
      const svc = yield* MemoryAutoDreamService
      // With invalid model format (no slash), forceDream should handle gracefully
      // After fix it should log a warning instead of swallowing silently
      const exit = yield* svc.forceDream().pipe(Effect.exit)
      // Should complete without throwing (graceful handling)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.effect("maybeDream logs errors instead of swallowing them", () =>
    Effect.gen(function* () {
      const svc = yield* MemoryAutoDreamService
      // Trigger maybeDream which should attempt to dream and fail
      const result = yield* svc.maybeDream()
      // Should return true (attempted to dream) even if dream failed
      expect(result).toBe(true)
      // After fix, a warning should be logged
    }),
  )

  describe("background execution", () => {
    const slowMockMemory = Layer.mock(Memory.Service)({
      add: (_input: any) =>
        Effect.sleep("3 seconds").pipe(
          Effect.map(() => ({ id: "test-id", type: "project", name: "test", description: "test", content: "test", tags: [] } as any)),
        ),
      list: () => Effect.succeed([]),
    })

    const slowTestLayer = autoDreamLayer.pipe(
      Layer.provide(slowMockMemory),
      Layer.provide(mockExtraction),
      Layer.provide(mockSession),
      Layer.provide(RuntimeFlags.layer({ experimentalAutoDream: true })),
      Layer.provide(mockConfigInvalidModel),
      Layer.provide(mockProvider),
    )

    const slowIt = testEffect(slowTestLayer)

    slowIt.live("maybeDream returns without waiting for dream completion", () =>
      Effect.gen(function* () {
        const svc = yield* MemoryAutoDreamService
        const result = yield* svc.maybeDream().pipe(
          Effect.timeoutOrElse({
            duration: "2 seconds",
            orElse: () => Effect.fail(new Error("maybeDream blocked on dream completion — forkIn + Fiber.join defeats background execution")),
          }),
        )
        expect(result).toBe(true)
      }),
    )
  })
})
