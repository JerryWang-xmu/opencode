import { describe, test, expect } from "bun:test"
import { ModelTools } from "@/util/model-tools"

describe("shouldUseApplyPatch", () => {
  // Should use apply_patch (modern GPT models)
  test("gpt-4o → true", () => {
    expect(ModelTools.shouldUseApplyPatch("gpt-4o")).toBe(true)
  })

  test("gpt-4o-mini → true", () => {
    expect(ModelTools.shouldUseApplyPatch("gpt-4o-mini")).toBe(true)
  })

  test("gpt-4.1 → true", () => {
    expect(ModelTools.shouldUseApplyPatch("gpt-4.1")).toBe(true)
  })

  test("gpt-4.1-mini → true", () => {
    expect(ModelTools.shouldUseApplyPatch("gpt-4.1-mini")).toBe(true)
  })

  test("gpt-4o-2024-08-06 → true", () => {
    expect(ModelTools.shouldUseApplyPatch("gpt-4o-2024-08-06")).toBe(true)
  })

  test("chatgpt-4o-latest → true", () => {
    expect(ModelTools.shouldUseApplyPatch("chatgpt-4o-latest")).toBe(true)
  })

  // Should NOT use apply_patch
  test("gpt-4 → false", () => {
    expect(ModelTools.shouldUseApplyPatch("gpt-4")).toBe(false)
  })

  test("gpt-4-turbo → false", () => {
    expect(ModelTools.shouldUseApplyPatch("gpt-4-turbo")).toBe(false)
  })

  test("gpt-4-0613 → false", () => {
    expect(ModelTools.shouldUseApplyPatch("gpt-4-0613")).toBe(false)
  })

  test("gpt-oss-20b → false", () => {
    expect(ModelTools.shouldUseApplyPatch("gpt-oss-20b")).toBe(false)
  })

  test("claude-3-opus → false", () => {
    expect(ModelTools.shouldUseApplyPatch("claude-3-opus")).toBe(false)
  })

  test("gemini-pro → false", () => {
    expect(ModelTools.shouldUseApplyPatch("gemini-pro")).toBe(false)
  })

  test("gpt-3.5-turbo → false", () => {
    expect(ModelTools.shouldUseApplyPatch("gpt-3.5-turbo")).toBe(false)
  })
})
