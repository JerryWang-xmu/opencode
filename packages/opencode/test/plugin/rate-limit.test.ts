import { describe, expect, it } from "bun:test"
import { MAX_PLUGIN_LLM_CALLS, createRateLimitedQuery } from "@/plugin"

describe("Plugin LLM Rate Limiting", () => {
  it("plugin LLM query rejects after exceeding rate limit", async () => {
    const query = createRateLimitedQuery(async (prompt: string) => `response: ${prompt}`)

    for (let i = 0; i < MAX_PLUGIN_LLM_CALLS; i++) {
      const result = await query(`prompt ${i}`)
      expect(result).toBe(`response: prompt ${i}`)
    }

    expect(query("overflow")).rejects.toThrow(
      `Plugin LLM rate limit exceeded (max ${MAX_PLUGIN_LLM_CALLS} calls per session)`,
    )
  })

  it("plugin LLM query tracks call count per plugin instance", async () => {
    const query = createRateLimitedQuery(async (prompt: string) => `ok: ${prompt}`)

    expect(query.callCount).toBe(0)
    await query("first")
    expect(query.callCount).toBe(1)
    await query("second")
    expect(query.callCount).toBe(2)
  })

  it("plugin LLM query allows calls within limit", async () => {
    const query = createRateLimitedQuery(async (prompt: string) => `ok: ${prompt}`)

    const results: string[] = []
    for (let i = 0; i < MAX_PLUGIN_LLM_CALLS; i++) {
      results.push(await query(`prompt ${i}`))
    }

    expect(results).toHaveLength(MAX_PLUGIN_LLM_CALLS)
    expect(results[0]).toBe("ok: prompt 0")
    expect(results[MAX_PLUGIN_LLM_CALLS - 1]).toBe(`ok: prompt ${MAX_PLUGIN_LLM_CALLS - 1}`)
    expect(query.callCount).toBe(MAX_PLUGIN_LLM_CALLS)
  })

  it("each plugin gets an independent rate limiter", async () => {
    const pluginA = createRateLimitedQuery(async (prompt: string) => `a: ${prompt}`)
    const pluginB = createRateLimitedQuery(async (prompt: string) => `b: ${prompt}`)

    // Exhaust pluginA's limit
    for (let i = 0; i < MAX_PLUGIN_LLM_CALLS; i++) {
      await pluginA(`prompt ${i}`)
    }

    // pluginA is rate limited
    expect(pluginA("overflow")).rejects.toThrow(
      `Plugin LLM rate limit exceeded (max ${MAX_PLUGIN_LLM_CALLS} calls per session)`,
    )
    expect(pluginA.callCount).toBe(MAX_PLUGIN_LLM_CALLS)

    // pluginB is unaffected and still has its full budget
    const result = await pluginB("still works")
    expect(result).toBe("b: still works")
    expect(pluginB.callCount).toBe(1)

    // pluginB can use all its calls independently
    for (let i = 1; i < MAX_PLUGIN_LLM_CALLS; i++) {
      await pluginB(`prompt ${i}`)
    }
    expect(pluginB.callCount).toBe(MAX_PLUGIN_LLM_CALLS)
    expect(pluginB("also overflow")).rejects.toThrow("Plugin LLM rate limit exceeded")
  })
})
