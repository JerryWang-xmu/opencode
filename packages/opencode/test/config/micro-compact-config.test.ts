import { describe, expect, test } from "bun:test"
import { Config } from "@/config/config"
import { ConfigParse } from "@/config/parse"

const parse = (data: object) => ConfigParse.schema(Config.Info, data, "test")

describe("micro_compact config", () => {
  test("micro_compact config defaults to enabled", () => {
    const config = parse({})
    expect(config.micro_compact?.enabled !== false).toBe(true)
  })

  test("micro_compact.age_minutes defaults to 10", () => {
    const config = parse({ micro_compact: {} })
    expect(config.micro_compact?.age_minutes ?? 10).toBe(10)
  })

  test("micro_compact.tools defaults to ['read', 'grep', 'glob', 'lsp']", () => {
    const config = parse({ micro_compact: {} })
    expect(config.micro_compact?.tools ?? ["read", "grep", "glob", "lsp"]).toEqual([
      "read",
      "grep",
      "glob",
      "lsp",
    ])
  })

  test("micro_compact can be disabled via config", () => {
    const config = parse({ micro_compact: { enabled: false } })
    expect(config.micro_compact?.enabled).toBe(false)
  })

  test("micro_compact.age_minutes can be customized", () => {
    const config = parse({ micro_compact: { age_minutes: 30 } })
    expect(config.micro_compact?.age_minutes).toBe(30)
  })

  test("micro_compact.tools can be customized", () => {
    const config = parse({ micro_compact: { tools: ["read", "edit"] } })
    expect(config.micro_compact?.tools).toEqual(["read", "edit"])
  })
})
