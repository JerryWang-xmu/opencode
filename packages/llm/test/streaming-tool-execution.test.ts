import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM, LLMEvent } from "../src"
import { Auth } from "../src/route"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { tool, ToolFailure } from "../src/tool"
import { ToolRuntime } from "../src/tool-runtime"
import { it } from "./lib/effect"

const model = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4o-mini" })

const mockRequest = LLM.request({
  id: "test-req",
  model,
  prompt: "Test prompt",
})

const usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 }

describe("Streaming Tool Execution", () => {
  it.effect("tools execute after model stream completes", () =>
    Effect.gen(function* () {
      const slowTool = tool({
        description: "A tool for testing",
        parameters: Schema.Struct({}),
        success: Schema.Struct({ result: Schema.String }),
        execute: () => Effect.succeed({ result: "done" }),
      })

      const modelStream = Stream.fromIterable([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textDelta({ id: "text_1", text: "Thinking..." }),
        LLMEvent.toolCall({ id: "call_1", name: "slow_tool", input: {} }),
        LLMEvent.textDelta({ id: "text_1", text: "Still thinking..." }),
        LLMEvent.stepFinish({ index: 0, reason: "tool-calls", usage }),
        LLMEvent.finish({ reason: "tool-calls", usage }),
      ])

      const events = Array.from(
        yield* ToolRuntime.stream({
          request: mockRequest,
          stream: () => modelStream,
          tools: { slow_tool: slowTool },
        }).pipe(Stream.runCollect),
      )

      const toolResults = events.filter((e) => e.type === "tool-result")
      expect(toolResults.length).toBe(1)
      expect(toolResults[0]).toMatchObject({
        type: "tool-result",
        id: "call_1",
        name: "slow_tool",
      })

      const finishEvents = events.filter((e) => e.type === "finish")
      expect(finishEvents.length).toBe(1)
    }),
  )

  it.effect("multiple tools execute in parallel", () =>
    Effect.gen(function* () {
      const makeTool = (name: string) =>
        tool({
          description: `Tool ${name}`,
          parameters: Schema.Struct({}),
          success: Schema.Struct({ result: Schema.String }),
          execute: () => Effect.succeed({ result: `${name} done` }),
        })

      const tool1 = makeTool("tool1")
      const tool2 = makeTool("tool2")
      const tool3 = makeTool("tool3")

      const modelStream = Stream.fromIterable([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call_1", name: "tool1", input: {} }),
        LLMEvent.toolCall({ id: "call_2", name: "tool2", input: {} }),
        LLMEvent.toolCall({ id: "call_3", name: "tool3", input: {} }),
        LLMEvent.textDelta({ id: "text_1", text: "Processing..." }),
        LLMEvent.stepFinish({ index: 0, reason: "tool-calls", usage }),
        LLMEvent.finish({ reason: "tool-calls", usage }),
      ])

      const events = Array.from(
        yield* ToolRuntime.stream({
          request: mockRequest,
          stream: () => modelStream,
          tools: { tool1, tool2, tool3 },
        }).pipe(Stream.runCollect),
      )

      const toolResults = events.filter((e) => e.type === "tool-result")
      expect(toolResults.length).toBe(3)

      const resultIds = toolResults.map((e) => e.id).sort()
      expect(resultIds).toEqual(["call_1", "call_2", "call_3"])
    }),
  )

  it.effect("tool errors produce tool-error events", () =>
    Effect.gen(function* () {
      const failingTool = tool({
        description: "A tool that fails",
        parameters: Schema.Struct({}),
        success: Schema.Struct({ result: Schema.String }),
        execute: () => Effect.fail(new ToolFailure({ message: "Tool failed" })),
      })

      const modelStream = Stream.fromIterable([
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.toolCall({ id: "call_1", name: "failing_tool", input: {} }),
        LLMEvent.textDelta({ id: "text_1", text: "Continuing..." }),
        LLMEvent.stepFinish({ index: 0, reason: "tool-calls", usage }),
        LLMEvent.finish({ reason: "tool-calls", usage }),
      ])

      const events = Array.from(
        yield* ToolRuntime.stream({
          request: mockRequest,
          stream: () => modelStream,
          tools: { failing_tool: failingTool },
        }).pipe(Stream.runCollect),
      )

      const toolErrors = events.filter((e) => e.type === "tool-error")
      expect(toolErrors.length).toBe(1)
      expect(toolErrors[0]).toMatchObject({
        type: "tool-error",
        id: "call_1",
        name: "failing_tool",
      })

      const finishEvents = events.filter((e) => e.type === "finish")
      expect(finishEvents.length).toBe(1)
    }),
  )
})
