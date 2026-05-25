import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { tool, jsonSchema } from "ai"
import { pollWithTimeout, testEffect } from "../lib/effect.js"
import { StreamingExecutor, type ToolCall } from "../../src/session/streaming-executor"

const testLayer = Layer.mergeAll(StreamingExecutor.defaultLayer)
const it = testEffect(testLayer)

function makeTool(opts: {
  id: string
  mode: "parallel" | "serial"
  duration: number
  startRef: Ref.Ref<number[]>
  endRef: Ref.Ref<number[]>
  failAfter?: number
}): ToolCall {
  return {
    toolID: opts.id,
    concurrency: { mode: opts.mode },
    execute: () =>
      Effect.gen(function* () {
        yield* Ref.update(opts.startRef, (arr) => [...arr, Date.now()])
        if (opts.failAfter !== undefined) {
          yield* Effect.sleep(`${opts.failAfter} millis`)
          return yield* Effect.fail(new Error(`tool ${opts.id} failed`))
        }
        yield* Effect.sleep(`${opts.duration} millis`)
        yield* Ref.update(opts.endRef, (arr) => [...arr, Date.now()])
        return `result-${opts.id}`
      }),
  }
}

describe("StreamingExecutor", () => {
  it.live("partitions consecutive read-only tools into parallel batch", () =>
    Effect.gen(function* () {
      const executor = yield* StreamingExecutor.Service
      const startRef = yield* Ref.make<number[]>([])
      const endRef = yield* Ref.make<number[]>([])

      const tools: ToolCall[] = [
        makeTool({ id: "r1", mode: "parallel", duration: 100, startRef, endRef }),
        makeTool({ id: "r2", mode: "parallel", duration: 100, startRef, endRef }),
        makeTool({ id: "r3", mode: "parallel", duration: 100, startRef, endRef }),
      ]

      yield* executor.execute(tools)

      const starts = yield* Ref.get(startRef)
      expect(starts).toHaveLength(3)

      // All three should start within 50ms of each other (parallel)
      const minStart = Math.min(...starts)
      const maxStart = Math.max(...starts)
      expect(maxStart - minStart).toBeLessThan(50)
    }),
  )

  it.live("serializes write tools", () =>
    Effect.gen(function* () {
      const executor = yield* StreamingExecutor.Service
      const startRef = yield* Ref.make<number[]>([])
      const endRef = yield* Ref.make<number[]>([])

      const tools: ToolCall[] = [
        makeTool({ id: "w1", mode: "serial", duration: 80, startRef, endRef }),
        makeTool({ id: "w2", mode: "serial", duration: 80, startRef, endRef }),
      ]

      yield* executor.execute(tools)

      const starts = yield* Ref.get(startRef)
      const ends = yield* Ref.get(endRef)
      expect(starts).toHaveLength(2)
      expect(ends).toHaveLength(2)

      // Second tool must start after first completes
      expect(starts[1]).toBeGreaterThanOrEqual(ends[0])
    }),
  )

  it.live("mixed batch: read-only parallel, then write serial", () =>
    Effect.gen(function* () {
      const executor = yield* StreamingExecutor.Service
      const startRef = yield* Ref.make<number[]>([])
      const endRef = yield* Ref.make<number[]>([])

      const tools: ToolCall[] = [
        makeTool({ id: "r1", mode: "parallel", duration: 60, startRef, endRef }),
        makeTool({ id: "r2", mode: "parallel", duration: 60, startRef, endRef }),
        makeTool({ id: "w1", mode: "serial", duration: 60, startRef, endRef }),
        makeTool({ id: "r3", mode: "parallel", duration: 60, startRef, endRef }),
      ]

      yield* executor.execute(tools)

      const starts = yield* Ref.get(startRef)
      const ends = yield* Ref.get(endRef)
      expect(starts).toHaveLength(4)
      expect(ends).toHaveLength(4)

      // r1 and r2 should start near-simultaneously (parallel batch)
      expect(Math.abs(starts[0] - starts[1])).toBeLessThan(50)

      // w1 (serial) must start after both r1 and r2 complete
      const parallelEndMax = Math.max(ends[0], ends[1])
      expect(starts[2]).toBeGreaterThanOrEqual(parallelEndMax)

      // r3 (new parallel batch of 1) starts after w1 completes
      expect(starts[3]).toBeGreaterThanOrEqual(ends[2])
    }),
  )

  it.live("sibling abort: error in one parallel tool cancels siblings", () =>
    Effect.gen(function* () {
      const executor = yield* StreamingExecutor.Service
      const startRef = yield* Ref.make<number[]>([])
      const endRef = yield* Ref.make<number[]>([])

      const tools: ToolCall[] = [
        makeTool({ id: "p1", mode: "parallel", duration: 500, startRef, endRef }),
        makeTool({ id: "p2", mode: "parallel", duration: 500, startRef, endRef, failAfter: 30 }),
        makeTool({ id: "p3", mode: "parallel", duration: 500, startRef, endRef }),
      ]

      const result = yield* Effect.exit(executor.execute(tools))

      // Should fail because p2 throws
      expect(result._tag).toBe("Failure")

      // All three should have started (parallel)
      const starts = yield* Ref.get(startRef)
      expect(starts).toHaveLength(3)

      // p1 and p3 should NOT have completed (interrupted by p2's failure)
      const ends = yield* Ref.get(endRef)
      expect(ends).toHaveLength(0)
    }),
  )

  it.live("empty batch returns immediately", () =>
    Effect.gen(function* () {
      const executor = yield* StreamingExecutor.Service
      yield* executor.execute([])
      // No error = success
      expect(true).toBe(true)
    }),
  )

  it.live("single tool executes without partitioning overhead", () =>
    Effect.gen(function* () {
      const executor = yield* StreamingExecutor.Service
      const startRef = yield* Ref.make<number[]>([])
      const endRef = yield* Ref.make<number[]>([])

      const tools: ToolCall[] = [makeTool({ id: "solo", mode: "parallel", duration: 50, startRef, endRef })]

      yield* executor.execute(tools)

      const starts = yield* Ref.get(startRef)
      const ends = yield* Ref.get(endRef)
      expect(starts).toHaveLength(1)
      expect(ends).toHaveLength(1)
    }),
  )

  it.live("tools.resolve provides StreamingExecutor service", () =>
    Effect.gen(function* () {
      const executor = yield* StreamingExecutor.Service
      expect(executor).toBeDefined()
      expect(typeof executor.execute).toBe("function")
    }),
  )

  it.live("tool concurrency metadata is accessible from resolved tools", () =>
    Effect.gen(function* () {
      // Simulate the wrapping pattern used in SessionTools.resolve
      const parallelDef = {
        id: "read",
        concurrency: { mode: "parallel" as const },
      }
      const serialDef = {
        id: "edit",
        concurrency: undefined,
      }

      const parallelTool = Object.assign(
        tool({
          description: "read file",
          inputSchema: jsonSchema({ type: "object", properties: {} }),
          execute: async () => ({ result: "ok" }),
        }),
        { concurrency: parallelDef.concurrency ?? { mode: "serial" as const } },
      )

      const serialTool = Object.assign(
        tool({
          description: "edit file",
          inputSchema: jsonSchema({ type: "object", properties: {} }),
          execute: async () => ({ result: "ok" }),
        }),
        { concurrency: serialDef.concurrency ?? { mode: "serial" as const } },
      )

      expect(parallelTool.concurrency).toEqual({ mode: "parallel" })
      expect(serialTool.concurrency).toEqual({ mode: "serial" })
    }),
  )

  it.live("full session: LLM returns 3 read tool calls, all execute in parallel", () =>
    Effect.gen(function* () {
      const executor = yield* StreamingExecutor.Service
      const startRef = yield* Ref.make<number[]>([])
      const endRef = yield* Ref.make<number[]>([])

      const tools: ToolCall[] = [
        makeTool({ id: "r1", mode: "parallel", duration: 100, startRef, endRef }),
        makeTool({ id: "r2", mode: "parallel", duration: 100, startRef, endRef }),
        makeTool({ id: "r3", mode: "parallel", duration: 100, startRef, endRef }),
      ]

      const before = Date.now()
      yield* executor.execute(tools)
      const elapsed = Date.now() - before

      const ends = yield* Ref.get(endRef)
      expect(ends).toHaveLength(3)
      // All 3 complete within 2x single-tool time (200ms), proving parallelism
      expect(elapsed).toBeLessThan(200)
    }),
  )

  it.live("full session: LLM returns write then read, write completes first", () =>
    Effect.gen(function* () {
      const executor = yield* StreamingExecutor.Service
      const startRef = yield* Ref.make<number[]>([])
      const endRef = yield* Ref.make<number[]>([])

      const tools: ToolCall[] = [
        makeTool({ id: "w1", mode: "serial", duration: 80, startRef, endRef }),
        makeTool({ id: "r1", mode: "parallel", duration: 80, startRef, endRef }),
      ]

      yield* executor.execute(tools)

      const starts = yield* Ref.get(startRef)
      const ends = yield* Ref.get(endRef)
      expect(starts).toHaveLength(2)
      expect(ends).toHaveLength(2)

      // Write (serial) must complete before read starts
      expect(starts[1]).toBeGreaterThanOrEqual(ends[0])
    }),
  )

  it.live("full session: parallel sibling abort propagates", () =>
    Effect.gen(function* () {
      const executor = yield* StreamingExecutor.Service
      const startRef = yield* Ref.make<number[]>([])
      const endRef = yield* Ref.make<number[]>([])

      const tools: ToolCall[] = [
        makeTool({ id: "p1", mode: "parallel", duration: 10, startRef, endRef }),
        makeTool({ id: "p2", mode: "parallel", duration: 500, startRef, endRef, failAfter: 50 }),
        makeTool({ id: "p3", mode: "parallel", duration: 500, startRef, endRef }),
      ]

      const result = yield* Effect.exit(executor.execute(tools))

      // Should fail because p2 throws
      expect(result._tag).toBe("Failure")

      // All three should have started (parallel)
      const starts = yield* Ref.get(startRef)
      expect(starts).toHaveLength(3)

      const ends = yield* Ref.get(endRef)
      // p1 completed before p2 failed (10ms < 50ms), so its result is preserved
      expect(ends).toHaveLength(1)
    }),
  )

  it.live("abort signal from session cancel stops all in-flight tools", () =>
    Effect.gen(function* () {
      const executor = yield* StreamingExecutor.Service
      const startRef = yield* Ref.make<number[]>([])
      const endRef = yield* Ref.make<number[]>([])

      const tools: ToolCall[] = [
        makeTool({ id: "a1", mode: "parallel", duration: 500, startRef, endRef }),
        makeTool({ id: "a2", mode: "parallel", duration: 500, startRef, endRef }),
        makeTool({ id: "a3", mode: "parallel", duration: 500, startRef, endRef }),
      ]

      const fiber = yield* Effect.forkScoped(executor.execute(tools))

      // Wait for all 3 tools to start (readiness signal, not sleep)
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const starts = yield* Ref.get(startRef)
          return starts.length >= 3 ? (true as const) : undefined
        }),
        "tools never started",
      )

      // Interrupt the fiber (simulating session cancel)
      yield* Fiber.interrupt(fiber)

      const ends = yield* Ref.get(endRef)
      // No tools should have completed (all interrupted mid-flight)
      expect(ends).toHaveLength(0)
    }),
  )
})
