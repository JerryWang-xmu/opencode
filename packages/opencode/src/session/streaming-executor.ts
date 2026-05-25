import { Context, Effect, Layer } from "effect"

export interface ToolConcurrency {
  mode: "parallel" | "serial"
}

export interface ToolCall {
  toolID: string
  concurrency: ToolConcurrency
  execute: () => Effect.Effect<unknown, unknown>
}

export interface Interface {
  readonly execute: (calls: ToolCall[]) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/StreamingExecutor") {}

type Batch = { type: "parallel"; tools: ToolCall[] } | { type: "serial"; tool: ToolCall }

function partition(calls: ToolCall[]): Batch[] {
  const batches: Batch[] = []
  let i = 0
  while (i < calls.length) {
    if (calls[i].concurrency.mode === "parallel") {
      const tools: ToolCall[] = []
      while (i < calls.length && calls[i].concurrency.mode === "parallel") {
        tools.push(calls[i])
        i++
      }
      batches.push({ type: "parallel", tools })
    } else {
      batches.push({ type: "serial", tool: calls[i] })
      i++
    }
  }
  return batches
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const execute = (calls: ToolCall[]) =>
      Effect.gen(function* () {
        if (calls.length === 0) return

        const batches = partition(calls)

        for (const batch of batches) {
          if (batch.type === "parallel") {
            yield* Effect.all(batch.tools.map((tool) => tool.execute()), { concurrency: "unbounded" })
          } else {
            yield* batch.tool.execute()
          }
        }
      }).pipe(Effect.asVoid)

    return Service.of({ execute })
  }),
)

export const defaultLayer = layer

export * as StreamingExecutor from "./streaming-executor"
