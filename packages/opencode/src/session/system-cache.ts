import { Context, Effect, Layer, Ref } from "effect"
import { createHash } from "node:crypto"

export interface CacheKey {
  modelID: string
  agentName: string
  instructionsHash: string
  skillsHash: string
}

export interface Interface {
  readonly get: (key: CacheKey) => Effect.Effect<string[] | undefined>
  readonly set: (key: CacheKey, value: string[]) => Effect.Effect<void>
  readonly invalidate: () => Effect.Effect<void>
  readonly computeKey: (input: {
    modelID: string
    agentName: string
    instructions: string[]
    skills: string | undefined
  }) => Effect.Effect<CacheKey>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemCache") {}

function hashString(input: string) {
  return createHash("sha256").update(input).digest("hex")
}

function compositeKey(key: CacheKey) {
  return hashString(`${key.modelID}|${key.agentName}|${key.instructionsHash}|${key.skillsHash}`)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cache = yield* Ref.make<Map<string, string[]>>(new Map())

    return Service.of({
      get: Effect.fn("SystemCache.get")(function* (key: CacheKey) {
        const map = yield* Ref.get(cache)
        return map.get(compositeKey(key))
      }),

      set: Effect.fn("SystemCache.set")(function* (key: CacheKey, value: string[]) {
        yield* Ref.update(cache, (map) => new Map(map).set(compositeKey(key), value))
      }),

      invalidate: Effect.fn("SystemCache.invalidate")(function* () {
        yield* Ref.set(cache, new Map())
      }),

      computeKey: Effect.fn("SystemCache.computeKey")(function* (input: {
        modelID: string
        agentName: string
        instructions: string[]
        skills: string | undefined
      }) {
        return {
          modelID: input.modelID,
          agentName: input.agentName,
          instructionsHash: hashString(input.instructions.join("\n")),
          skillsHash: hashString(input.skills ?? ""),
        }
      }),
    })
  }),
)

export * as SystemCache from "./system-cache"
