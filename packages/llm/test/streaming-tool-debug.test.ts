import { describe, expect } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { LLM, LLMEvent } from "../src"
import { Auth } from "../src/route"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { tool } from "../src/tool"
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

describe("Streaming Tool Debug", () => {
  it.effect("basic streaming without tools", () =>
    Effect.gen(function* () {
      const simpleTool = tool({
        description: "A simple tool",
        parameters: Schema.Struct({}),
        success: Schema.Struct({ result: Schema.String }),
        execute: () => Effect.succeed({ result: "done" }),
      })

      const modelStream = Stream.fromIterable([
        LLMEvent.textDelta({ id: "text_1", text: "Hello" }),
        LLMEvent.finish({ reason: "stop", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } }),
      ])

      const events = Array.from(
        yield* ToolRuntime.stream({
          request: mockRequest,
          stream: () => modelStream,
          tools: { simple: simpleTool },
        }).pipe(Stream.runCollect),
      )

      expect(events.length).toBeGreaterThan(0)
    }),
  )

  it.effect("streaming with tool call produces tool-result", () =>
    Effect.gen(function* () {
      const simpleTool = tool({
        description: "A simple tool",
        parameters: Schema.Struct({}),
        success: Schema.Struct({ result: Schema.String }),
        execute: () => Effect.succeed({ result: "done" }),
      })

      const modelStream = Stream.fromIterable([
        LLMEvent.toolCall({ id: "call_1", name: "simple", input: {} }),
        LLMEvent.finish({ reason: "tool-calls", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } }),
      ])

      const events = Array.from(
        yield* ToolRuntime.stream({
          request: mockRequest,
          stream: () => modelStream,
          tools: { simple: simpleTool },
        }).pipe(Stream.runCollect),
      )

      const toolResults = events.filter((e) => e.type === "tool-result")
      expect(toolResults.length).toBe(1)
    }),
  )

  it.effect("streaming with text and tool-call produces tool-result", () =>
    Effect.gen(function* () {
      const simpleTool = tool({
        description: "A simple tool",
        parameters: Schema.Struct({}),
        success: Schema.Struct({ result: Schema.String }),
        execute: () => Effect.succeed({ result: "done" }),
      })

      const modelStream = Stream.fromIterable([
        LLMEvent.toolCall({ id: "call_1", name: "simple", input: {} }),
        LLMEvent.textDelta({ id: "text_1", text: "Processing..." }),
        LLMEvent.finish({ reason: "tool-calls", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } }),
      ])

      const events = Array.from(
        yield* ToolRuntime.stream({
          request: mockRequest,
          stream: () => modelStream,
          tools: { simple: simpleTool },
        }).pipe(Stream.runCollect),
      )

      const toolResults = events.filter((e) => e.type === "tool-result")
      expect(toolResults.length).toBe(1)
    }),
  )
})
