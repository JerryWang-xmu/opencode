import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { MemoryEntry, MemoryType } from "../../src/memory/types"

const decode = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown): S["Type"] =>
  Schema.decodeUnknownSync(schema)(input)

const baseEntry = {
  id: "mem_001",
  name: "test entry",
  description: "a test memory entry",
  content: "some content here",
  created: 1700000000000,
  updated: 1700000000000,
}

describe("MemoryEntry", () => {
  test("validates user type", () => {
    const result = decode(MemoryEntry, { ...baseEntry, type: "user" })
    expect(result.type).toBe("user")
    expect(result.id).toBe("mem_001")
  })

  test("validates feedback type", () => {
    const result = decode(MemoryEntry, { ...baseEntry, type: "feedback" })
    expect(result.type).toBe("feedback")
  })

  test("validates project type", () => {
    const result = decode(MemoryEntry, { ...baseEntry, type: "project" })
    expect(result.type).toBe("project")
  })

  test("validates reference type", () => {
    const result = decode(MemoryEntry, {
      ...baseEntry,
      type: "reference",
      tags: ["docs", "api"],
      source: { sessionID: "ses_123", messageID: "msg_456" },
    })
    expect(result.type).toBe("reference")
    expect(result.tags).toEqual(["docs", "api"])
    expect(result.source).toEqual({ sessionID: "ses_123", messageID: "msg_456" })
  })

  test("requires name and description", () => {
    expect(() => decode(MemoryEntry, { ...baseEntry, name: undefined })).toThrow()
    expect(() => decode(MemoryEntry, { ...baseEntry, description: undefined })).toThrow()
  })
})

describe("MemoryType", () => {
  test("rejects invalid types", () => {
    expect(() => decode(MemoryType, "invalid")).toThrow()
  })
})
