import { Context, Effect, Layer } from "effect"
import { MemoryStorage } from "./storage"
import type { MemoryEntry, MemoryType } from "./types"

export interface Interface {
  readonly add: (input: {
    type: MemoryType
    name: string
    description: string
    content: string
    tags?: string[]
  }) => Effect.Effect<MemoryEntry>
  readonly list: () => Effect.Effect<MemoryEntry[]>
  readonly get: (id: string) => Effect.Effect<MemoryEntry | undefined>
  readonly delete: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

export const layer = (projectPath: string) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const storage = yield* MemoryStorage.Service

      yield* storage.init(projectPath)

      const add = Effect.fn("Memory.add")(function* (input: {
        type: MemoryType
        name: string
        description: string
        content: string
        tags?: string[]
      }) {
        const id = crypto.randomUUID()
        const now = Date.now()
        const entry: MemoryEntry = {
          id,
          type: input.type,
          name: input.name,
          description: input.description,
          content: input.content,
          tags: input.tags,
          created: now,
          updated: now,
        }
        yield* storage.write(projectPath, entry)
        return entry
      })

      const list = Effect.fn("Memory.list")(function* () {
        return yield* storage.readAll(projectPath)
      })

      const get = Effect.fn("Memory.get")(function* (id: string) {
        const entries = yield* storage.readAll(projectPath)
        return entries.find((e) => e.id === id)
      })

      const deleteEntry = Effect.fn("Memory.delete")(function* (id: string) {
        yield* storage.delete(projectPath, id)
      })

      return Service.of({ add, list, get, delete: deleteEntry })
    }),
  )

export const defaultLayer = layer(process.cwd()).pipe(Layer.provide(MemoryStorage.defaultLayer))

export * as Memory from "./memory"
