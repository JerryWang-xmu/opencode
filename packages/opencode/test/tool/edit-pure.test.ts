import { describe, expect, test } from "bun:test"
import {
  replace,
  trimDiff,
  SimpleReplacer,
  LineTrimmedReplacer,
  BlockAnchorReplacer,
  WhitespaceNormalizedReplacer,
  IndentationFlexibleReplacer,
  MultiOccurrenceReplacer,
  TrimmedBoundaryReplacer,
} from "../../src/tool/edit"

describe("replace function", () => {
  test("performs simple exact replacement", () => {
    expect(replace("hello world", "hello", "goodbye")).toBe("goodbye world")
  })

  test("throws on identical old and new strings", () => {
    expect(() => replace("content", "same", "same")).toThrow("identical")
  })

  test("throws when oldString not found", () => {
    expect(() => replace("content", "missing", "new")).toThrow("Could not find oldString")
  })

  test("throws on ambiguous match without replaceAll", () => {
    expect(() => replace("foo\nfoo\nbar", "foo", "baz")).toThrow("multiple matches")
  })

  test("replaces all occurrences with replaceAll", () => {
    expect(replace("foo bar foo baz foo", "foo", "qux", true)).toBe("qux bar qux baz qux")
  })

  test("handles multi-line replacement", () => {
    expect(replace("line1\nline2\nline3", "line1\nline2", "replaced")).toBe("replaced\nline3")
  })

  test("handles line-trimmed matching", () => {
    expect(replace("  hello\n  world", "hello\nworld", "replaced")).toBe("replaced")
  })

  test("handles whitespace-normalized matching", () => {
    expect(replace("foo   bar   baz", "foo bar baz", "replaced")).toBe("replaced")
  })

  test("handles indentation-flexible matching", () => {
    expect(replace("    if (true) {\n      doThing()\n    }", "if (true) {\n  doThing()\n}", "replaced")).toBe("replaced")
  })

  test("replaces with empty string (deletion)", () => {
    expect(replace("hello world", "world", "")).toBe("hello ")
  })
})

describe("trimDiff", () => {
  test("returns diff unchanged when no common indent", () => {
    const diff = "+new line\n-old line"
    expect(trimDiff(diff)).toBe(diff)
  })

  test("strips common leading whitespace from diff lines", () => {
    const diff = "+    indented\n-    indented\n     context"
    const result = trimDiff(diff)
    expect(result).toContain("+indented")
    expect(result).toContain("-indented")
  })

  test("preserves --- and +++ header lines", () => {
    const diff = "--- a/file.txt\n+++ b/file.txt\n+    content\n-    old"
    const result = trimDiff(diff)
    expect(result).toContain("--- a/file.txt")
    expect(result).toContain("+++ b/file.txt")
    expect(result).toContain("+content")
  })
})

describe("replacer strategies", () => {
  function collect(
    replacer: (content: string, find: string) => Generator<string, void, unknown>,
    content: string,
    find: string,
  ): string[] {
    return [...replacer(content, find)]
  }

  test("SimpleReplacer yields exact find string", () => {
    expect(collect(SimpleReplacer, "hello world", "hello")).toEqual(["hello"])
  })

  test("LineTrimmedReplacer matches trimmed lines", () => {
    const results = collect(LineTrimmedReplacer, "  hello\n  world", "hello\nworld")
    expect(results.length).toBe(1)
    expect(results[0]).toBe("  hello\n  world")
  })

  test("LineTrimmedReplacer returns no match when lines differ", () => {
    expect(collect(LineTrimmedReplacer, "hello\nworld", "foo\nbar").length).toBe(0)
  })

  test("BlockAnchorReplacer requires at least 3 lines", () => {
    expect(collect(BlockAnchorReplacer, "a\nb", "a\nb").length).toBe(0)
  })

  test("BlockAnchorReplacer matches by first and last line anchors", () => {
    const content = "function foo() {\n  return 1\n}"
    const find = "function foo() {\n  return 2\n}"
    const results = collect(BlockAnchorReplacer, content, find)
    expect(results.length).toBe(1)
    expect(results[0]).toBe(content)
  })

  test("WhitespaceNormalizedReplacer matches across extra spaces", () => {
    expect(collect(WhitespaceNormalizedReplacer, "foo   bar   baz", "foo bar baz").length).toBe(1)
  })

  test("IndentationFlexibleReplacer ignores indent differences", () => {
    const content = "    line1\n    line2"
    const find = "  line1\n  line2"
    expect(collect(IndentationFlexibleReplacer, content, find).length).toBe(1)
  })

  test("MultiOccurrenceReplacer yields all exact matches", () => {
    expect(collect(MultiOccurrenceReplacer, "foo bar foo baz foo", "foo")).toEqual(["foo", "foo", "foo"])
  })

  test("MultiOccurrenceReplacer returns empty for no match", () => {
    expect(collect(MultiOccurrenceReplacer, "hello world", "missing").length).toBe(0)
  })

  test("TrimmedBoundaryReplacer skips when find is already trimmed", () => {
    expect(collect(TrimmedBoundaryReplacer, "hello world", "hello").length).toBe(0)
  })

  test("TrimmedBoundaryReplacer matches trimmed version in content", () => {
    const results = collect(TrimmedBoundaryReplacer, "hello world", "  hello  ")
    expect(results.length).toBe(1)
    expect(results[0]).toBe("hello")
  })
})
