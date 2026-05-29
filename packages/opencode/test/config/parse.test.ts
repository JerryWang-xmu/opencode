import { test, expect, describe } from "bun:test"
import { ConfigParse } from "../../src/config/parse"
import { JsonError, InvalidError } from "../../src/config/error"
import { Schema } from "effect"

describe("jsonc", () => {
  describe("valid JSON parsing", () => {
    test("parses standard JSON object", () => {
      const result = ConfigParse.jsonc('{"key": "value", "num": 42}', "test.json")
      expect(result).toEqual({ key: "value", num: 42 })
    })

    test("parses JSON array", () => {
      const result = ConfigParse.jsonc('[1, 2, 3]', "test.json")
      expect(result).toEqual([1, 2, 3])
    })

    test("parses nested structures", () => {
      const input = '{"outer": {"inner": {"deep": true}}, "list": [1, {"a": "b"}]}'
      const result = ConfigParse.jsonc(input, "test.json")
      expect(result).toEqual({
        outer: { inner: { deep: true } },
        list: [1, { a: "b" }],
      })
    })

    test("parses empty object", () => {
      expect(ConfigParse.jsonc("{}", "test.json")).toEqual({})
    })

    test("parses empty array", () => {
      expect(ConfigParse.jsonc("[]", "test.json")).toEqual([])
    })

    test("parses primitive values", () => {
      expect(ConfigParse.jsonc('"hello"', "test.json")).toBe("hello")
      expect(ConfigParse.jsonc("42", "test.json")).toBe(42)
      expect(ConfigParse.jsonc("true", "test.json")).toBe(true)
      expect(ConfigParse.jsonc("false", "test.json")).toBe(false)
      expect(ConfigParse.jsonc("null", "test.json")).toBe(null)
    })

    test("parses unicode characters", () => {
      const result = ConfigParse.jsonc('{"emoji": "🎉", "chinese": "你好", "math": "∑"}', "test.json")
      expect(result).toEqual({ emoji: "🎉", chinese: "你好", math: "∑" })
    })

    test("parses escaped characters in strings", () => {
      const result = ConfigParse.jsonc('{"text": "line1\\nline2\\ttab"}', "test.json")
      expect(result).toEqual({ text: "line1\nline2\ttab" })
    })
  })

  describe("JSONC comment handling", () => {
    test("handles single-line comments", () => {
      const input = `{
        // This is a comment
        "key": "value"
      }`
      expect(ConfigParse.jsonc(input, "test.json")).toEqual({ key: "value" })
    })

    test("handles multi-line comments", () => {
      const input = `{
        /* This is a
           multi-line comment */
        "key": "value"
      }`
      expect(ConfigParse.jsonc(input, "test.json")).toEqual({ key: "value" })
    })

    test("handles comments at start of file", () => {
      const input = `// Header comment
      {"key": "value"}`
      expect(ConfigParse.jsonc(input, "test.json")).toEqual({ key: "value" })
    })

    test("handles comments at end of file", () => {
      const input = `{"key": "value"}
      // Footer comment`
      expect(ConfigParse.jsonc(input, "test.json")).toEqual({ key: "value" })
    })

    test("handles inline comments after values", () => {
      const input = `{
        "key": "value", // inline comment
        "num": 42 /* another inline */
      }`
      expect(ConfigParse.jsonc(input, "test.json")).toEqual({ key: "value", num: 42 })
    })

    test("handles mixed comment styles", () => {
      const input = `{
        // Single line
        "a": 1,
        /* Multi-line
           block */
        "b": 2,
        "c": 3 // trailing
      }`
      expect(ConfigParse.jsonc(input, "test.json")).toEqual({ a: 1, b: 2, c: 3 })
    })
  })

  describe("trailing comma support", () => {
    test("allows trailing comma in objects", () => {
      const input = '{"a": 1, "b": 2,}'
      expect(ConfigParse.jsonc(input, "test.json")).toEqual({ a: 1, b: 2 })
    })

    test("allows trailing comma in arrays", () => {
      const input = '[1, 2, 3,]'
      expect(ConfigParse.jsonc(input, "test.json")).toEqual([1, 2, 3])
    })

    test("allows trailing commas in nested structures", () => {
      const input = `{
        "obj": {
          "x": 1,
        },
        "arr": [1, 2,],
      }`
      expect(ConfigParse.jsonc(input, "test.json")).toEqual({
        obj: { x: 1 },
        arr: [1, 2],
      })
    })
  })

  describe("error handling", () => {
    test("throws JsonError on invalid JSON syntax", () => {
      expect(() => ConfigParse.jsonc('{"key": invalid}', "test.json")).toThrow(JsonError)
    })

    test("error message includes line and column information", () => {
      try {
        ConfigParse.jsonc('{"key": invalid}', "test.json")
        throw new Error("Should have thrown")
      } catch (e: any) {
        expect(e).toBeInstanceOf(JsonError)
        expect(e.data.message).toContain("line")
        expect(e.data.message).toContain("column")
      }
    })

    test("error message includes the input text", () => {
      try {
        ConfigParse.jsonc('{"broken": }', "test.json")
        throw new Error("Should have thrown")
      } catch (e: any) {
        expect(e).toBeInstanceOf(JsonError)
        expect(e.data.message).toContain('{"broken": }')
      }
    })

    test("error includes file path", () => {
      try {
        ConfigParse.jsonc("{invalid}", "my-config.json")
        throw new Error("Should have thrown")
      } catch (e: any) {
        expect(e).toBeInstanceOf(JsonError)
        expect(e.data.path).toBe("my-config.json")
      }
    })

    test("throws on unclosed string", () => {
      expect(() => ConfigParse.jsonc('{"key": "unclosed}', "test.json")).toThrow(JsonError)
    })

    test("throws on unclosed object", () => {
      expect(() => ConfigParse.jsonc('{"key": "value"', "test.json")).toThrow(JsonError)
    })

    test("throws on unclosed array", () => {
      expect(() => ConfigParse.jsonc('[1, 2, 3', "test.json")).toThrow(JsonError)
    })

    test("error points to correct line for multi-line input", () => {
      const input = `{
        "valid": true,
        "also_valid": 42,
        "broken":
      }`
      try {
        ConfigParse.jsonc(input, "test.json")
        throw new Error("Should have thrown")
      } catch (e: any) {
        expect(e).toBeInstanceOf(JsonError)
        expect(e.data.message).toContain("line 5")
      }
    })
  })

  describe("edge cases", () => {
    test("throws on whitespace-only input", () => {
      expect(() => ConfigParse.jsonc("   \n\t  ", "test.json")).toThrow(JsonError)
    })

    test("throws on empty string input", () => {
      expect(() => ConfigParse.jsonc("", "test.json")).toThrow(JsonError)
    })

    test("handles deeply nested structures", () => {
      const input = '{"a":{"b":{"c":{"d":{"e":"deep"}}}}}'
      const result = ConfigParse.jsonc(input, "test.json") as any
      expect(result.a.b.c.d.e).toBe("deep")
    })

    test("handles large numeric values", () => {
      const result = ConfigParse.jsonc('{"big": 9999999999999}', "test.json")
      expect(result).toEqual({ big: 9999999999999 })
    })

    test("handles negative numbers", () => {
      const result = ConfigParse.jsonc('{"neg": -42, "float": -3.14}', "test.json")
      expect(result).toEqual({ neg: -42, float: -3.14 })
    })

    test("handles scientific notation", () => {
      const result = ConfigParse.jsonc('{"sci": 1.5e10}', "test.json")
      expect(result).toEqual({ sci: 1.5e10 })
    })
  })
})

describe("schema", () => {
  const TestSchema = Schema.Struct({
    name: Schema.String,
    age: Schema.Number,
    active: Schema.optional(Schema.Boolean),
  })

  test("decodes valid data matching schema", () => {
    const data = { name: "Alice", age: 30 }
    const result = ConfigParse.schema(TestSchema, data, "test.json")
    expect(result).toEqual({ name: "Alice", age: 30 })
  })

  test("decodes with optional fields", () => {
    const data = { name: "Bob", age: 25, active: true }
    const result = ConfigParse.schema(TestSchema, data, "test.json")
    expect(result).toEqual({ name: "Bob", age: 25, active: true })
  })

  test("throws InvalidError on unrecognized top-level keys", () => {
    const data = { name: "Alice", age: 30, unknown: "extra" }
    expect(() => ConfigParse.schema(TestSchema, data, "test.json")).toThrow(InvalidError)
  })

  test("InvalidError includes unrecognized key names", () => {
    const data = { name: "Alice", age: 30, foo: 1, bar: 2 }
    try {
      ConfigParse.schema(TestSchema, data, "test.json")
      throw new Error("Should have thrown")
    } catch (e: any) {
      expect(e).toBeInstanceOf(InvalidError)
      expect(e.data.issues).toBeDefined()
      expect(e.data.issues.length).toBeGreaterThan(0)
      expect(e.data.issues[0].code).toBe("unrecognized_keys")
      expect(e.data.issues[0].keys).toContain("foo")
      expect(e.data.issues[0].keys).toContain("bar")
    }
  })

  test("throws InvalidError on type mismatch", () => {
    const data = { name: 123, age: "not a number" }
    expect(() => ConfigParse.schema(TestSchema, data, "test.json")).toThrow(InvalidError)
  })

  test("InvalidError includes path for nested type errors", () => {
    const data = { name: 123, age: 30 }
    try {
      ConfigParse.schema(TestSchema, data, "test.json")
      throw new Error("Should have thrown")
    } catch (e: any) {
      expect(e).toBeInstanceOf(InvalidError)
      expect(e.data.issues).toBeDefined()
      expect(e.data.issues.length).toBeGreaterThan(0)
    }
  })

  test("includes source path in error", () => {
    const data = { name: 123, age: 30 }
    try {
      ConfigParse.schema(TestSchema, data, "my-config.json")
      throw new Error("Should have thrown")
    } catch (e: any) {
      expect(e).toBeInstanceOf(InvalidError)
      expect(e.data.path).toBe("my-config.json")
    }
  })

  test("does not reject extra keys when schema has index signatures", () => {
    const FlexibleSchema = Schema.Record(Schema.String, Schema.Unknown)
    const data = { anything: "goes", whatever: 123 }
    const result = ConfigParse.schema(FlexibleSchema, data, "test.json")
    expect(result).toEqual({ anything: "goes", whatever: 123 })
  })

  test("handles array data without extra key check", () => {
    const ArraySchema = Schema.Array(Schema.String)
    const data = ["a", "b", "c"]
    const result = ConfigParse.schema(ArraySchema, data, "test.json")
    expect(result).toEqual(["a", "b", "c"])
  })

  test("handles null data without extra key check", () => {
    const NullSchema = Schema.Null
    const result = ConfigParse.schema(NullSchema, null, "test.json")
    expect(result).toBeNull()
  })
})
