import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/provider/transform"
import { ModelID, ProviderID } from "../../src/provider/schema"

describe("ProviderTransform.options - setCacheKey", () => {
  const sessionID = "test-session-123"

  const mockModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("should set promptCacheKey when providerOptions.setCacheKey is true", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: { setCacheKey: true },
    })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should not set promptCacheKey when providerOptions.setCacheKey is false", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: { setCacheKey: false },
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey when providerOptions is undefined", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: undefined,
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey when providerOptions does not have setCacheKey", () => {
    const result = ProviderTransform.options({ model: mockModel, sessionID, providerOptions: {} })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should set promptCacheKey for openai provider regardless of setCacheKey", () => {
    const openaiModel = {
      ...mockModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }
    const result = ProviderTransform.options({ model: openaiModel, sessionID, providerOptions: {} })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should set store=false for openai provider", () => {
    const openaiModel = {
      ...mockModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }
    const result = ProviderTransform.options({
      model: openaiModel,
      sessionID,
      providerOptions: {},
    })
    expect(result.store).toBe(false)
  })

  test("should set store=false for azure provider by default", () => {
    const azureModel = {
      ...mockModel,
      providerID: "azure",
      api: {
        id: "gpt-4",
        url: "https://azure.com",
        npm: "@ai-sdk/azure",
      },
    }
    const result = ProviderTransform.options({
      model: azureModel,
      sessionID,
      providerOptions: {},
    })
    expect(result.store).toBe(false)
  })
})

describe("ProviderTransform.options - zai/zhipuai thinking", () => {
  const sessionID = "test-session-123"

  const createModel = (providerID: string) =>
    ({
      id: `${providerID}/glm-4.6`,
      providerID,
      api: {
        id: "glm-4.6",
        url: "https://open.bigmodel.cn/api/paas/v4",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "GLM 4.6",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
    }) as any

  for (const providerID of ["zai-coding-plan", "zai", "zhipuai-coding-plan", "zhipuai"]) {
    test(`${providerID} should set thinking cfg`, () => {
      const result = ProviderTransform.options({
        model: createModel(providerID),
        sessionID,
        providerOptions: {},
      })

      expect(result.thinking).toEqual({
        type: "enabled",
        clear_thinking: false,
      })
    })
  }
})

describe("ProviderTransform.options - google thinkingConfig gating", () => {
  const sessionID = "test-session-123"

  const createGoogleModel = (reasoning: boolean, npm: "@ai-sdk/google" | "@ai-sdk/google-vertex") =>
    ({
      id: `${npm === "@ai-sdk/google" ? "google" : "google-vertex"}/gemini-2.0-flash`,
      providerID: npm === "@ai-sdk/google" ? "google" : "google-vertex",
      api: {
        id: "gemini-2.0-flash",
        url: npm === "@ai-sdk/google" ? "https://generativelanguage.googleapis.com" : "https://vertexai.googleapis.com",
        npm,
      },
      name: "Gemini 2.0 Flash",
      capabilities: {
        temperature: true,
        reasoning,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 1_000_000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("does not set thinkingConfig for google models without reasoning capability", () => {
    const result = ProviderTransform.options({
      model: createGoogleModel(false, "@ai-sdk/google"),
      sessionID,
      providerOptions: {},
    })
    expect(result.thinkingConfig).toBeUndefined()
  })

  test("sets thinkingConfig for google models with reasoning capability", () => {
    const result = ProviderTransform.options({
      model: createGoogleModel(true, "@ai-sdk/google"),
      sessionID,
      providerOptions: {},
    })
    expect(result.thinkingConfig).toEqual({
      includeThoughts: true,
    })
  })

  test("does not set thinkingConfig for vertex models without reasoning capability", () => {
    const result = ProviderTransform.options({
      model: createGoogleModel(false, "@ai-sdk/google-vertex"),
      sessionID,
      providerOptions: {},
    })
    expect(result.thinkingConfig).toBeUndefined()
  })
})

describe("ProviderTransform.options - gpt-5 textVerbosity", () => {
  const sessionID = "test-session-123"

  const createGpt5Model = (apiId: string) =>
    ({
      id: `openai/${apiId}`,
      providerID: "openai",
      api: {
        id: apiId,
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
      name: apiId,
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.03, output: 0.06, cache: { read: 0.001, write: 0.002 } },
      limit: { context: 128000, output: 4096 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("gpt-5.2 should have textVerbosity set to low", () => {
    const model = createGpt5Model("gpt-5.2")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBe("low")
    expect(result.include).toEqual(["reasoning.encrypted_content"])
  })

  test("gpt-5.1 should have textVerbosity set to low", () => {
    const model = createGpt5Model("gpt-5.1")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBe("low")
  })

  test("gpt-5.2-chat-latest should NOT have textVerbosity set (only supports medium)", () => {
    const model = createGpt5Model("gpt-5.2-chat-latest")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.1-chat-latest should NOT have textVerbosity set (only supports medium)", () => {
    const model = createGpt5Model("gpt-5.1-chat-latest")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.2-chat should NOT have textVerbosity set", () => {
    const model = createGpt5Model("gpt-5.2-chat")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5-chat should NOT have textVerbosity set", () => {
    const model = createGpt5Model("gpt-5-chat")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.2-codex should NOT have textVerbosity set (codex models excluded)", () => {
    const model = createGpt5Model("gpt-5.2-codex")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })
})

describe("ProviderTransform.options - gpt-5 reasoningEffort", () => {
  const sessionID = "test-session-123"

  const createModel = (apiId: string) =>
    ({
      id: `azure/${apiId}`,
      providerID: "azure",
      api: {
        id: apiId,
        url: "https://azure.com",
        npm: "@ai-sdk/azure",
      },
      name: apiId,
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
      cost: {
        input: 0.03,
        output: 0.06,
        cache: { read: 0.001, write: 0.002 },
      },
      limit: {
        context: 128000,
        output: 4096,
      },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("gpt-5-chat should NOT set reasoningEffort", () => {
    const result = ProviderTransform.options({
      model: createModel("gpt-5-chat"),
      sessionID,
      providerOptions: {},
    })

    expect(result.reasoningEffort).toBeUndefined()
  })

  test("gpt-5.5 should NOT set reasoningEffort", () => {
    const result = ProviderTransform.options({
      model: createModel("gpt-5.5"),
      sessionID,
      providerOptions: {},
    })

    expect(result.reasoningEffort).toBeUndefined()
  })
})

describe("ProviderTransform.options - gateway", () => {
  const sessionID = "test-session-123"

  const createModel = (id: string) =>
    ({
      id,
      providerID: "vercel",
      api: {
        id,
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
      name: id,
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 200_000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
    }) as any

  test("puts gateway defaults under gateway key", () => {
    const model = createModel("anthropic/claude-sonnet-4")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result).toEqual({
      gateway: {
        caching: "auto",
      },
    })
  })
})

describe("ProviderTransform.providerOptions", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "test/test-model",
      providerID: "test",
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm: "@ai-sdk/openai",
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 200_000,
        output: 64_000,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
      ...overrides,
    }) as any

  test("uses sdk key for non-gateway models", () => {
    const model = createModel({
      providerID: "my-bedrock",
      api: {
        id: "anthropic.claude-sonnet-4",
        url: "https://bedrock.aws",
        npm: "@ai-sdk/amazon-bedrock",
      },
    })

    expect(ProviderTransform.providerOptions(model, { cachePoint: { type: "default" } })).toEqual({
      bedrock: { cachePoint: { type: "default" } },
    })
  })

  test("uses gateway model provider slug for gateway models", () => {
    const model = createModel({
      providerID: "vercel",
      api: {
        id: "anthropic/claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { thinking: { type: "enabled", budgetTokens: 12_000 } })).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 12_000 } },
    })
  })

  test("falls back to gateway key when gateway api id is unscoped", () => {
    const model = createModel({
      id: "anthropic/claude-sonnet-4",
      providerID: "vercel",
      api: {
        id: "claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { thinking: { type: "enabled", budgetTokens: 12_000 } })).toEqual({
      gateway: { thinking: { type: "enabled", budgetTokens: 12_000 } },
    })
  })

  test("splits gateway routing options from provider-specific options", () => {
    const model = createModel({
      providerID: "vercel",
      api: {
        id: "anthropic/claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(
      ProviderTransform.providerOptions(model, {
        gateway: { order: ["vertex", "anthropic"] },
        thinking: { type: "enabled", budgetTokens: 12_000 },
      }),
    ).toEqual({
      gateway: { order: ["vertex", "anthropic"] },
      anthropic: { thinking: { type: "enabled", budgetTokens: 12_000 } },
    } as any)
  })

  test("falls back to gateway key when model id has no provider slug", () => {
    const model = createModel({
      id: "claude-sonnet-4",
      providerID: "vercel",
      api: {
        id: "claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningEffort: "high" })).toEqual({
      gateway: { reasoningEffort: "high" },
    })
  })

  test("maps amazon slug to bedrock for provider options", () => {
    const model = createModel({
      providerID: "vercel",
      api: {
        id: "amazon/nova-2-lite",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningConfig: { type: "enabled" } })).toEqual({
      bedrock: { reasoningConfig: { type: "enabled" } },
    })
  })

  test("uses groq slug for groq models", () => {
    const model = createModel({
      providerID: "vercel",
      api: {
        id: "groq/llama-3.3-70b-versatile",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningFormat: "parsed" })).toEqual({
      groq: { reasoningFormat: "parsed" },
    })
  })
})

describe("ProviderTransform.schema - gemini array items", () => {
  test("adds missing items for array properties", () => {
    const geminiModel = {
      providerID: "google",
      api: {
        id: "gemini-3-pro",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        nodes: { type: "array" },
        edges: { type: "array", items: { type: "string" } },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.nodes.items).toBeDefined()
    expect(result.properties.edges.items.type).toBe("string")
  })
})

describe("ProviderTransform.schema - gemini nested array items", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("adds type to 2D array with empty inner items", () => {
    const schema = {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: {
            type: "array",
            items: {}, // Empty items object
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    // Inner items should have a default type
    expect(result.properties.values.items.items.type).toBe("string")
  })

  test("adds items and type to 2D array with missing inner items", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: { type: "array" }, // No items at all
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.items.items).toBeDefined()
    expect(result.properties.data.items.items.type).toBe("string")
  })

  test("handles deeply nested arrays (3D)", () => {
    const schema = {
      type: "object",
      properties: {
        matrix: {
          type: "array",
          items: {
            type: "array",
            items: {
              type: "array",
              // No items
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.matrix.items.items.items).toBeDefined()
    expect(result.properties.matrix.items.items.items.type).toBe("string")
  })

  test("preserves existing item types in nested arrays", () => {
    const schema = {
      type: "object",
      properties: {
        numbers: {
          type: "array",
          items: {
            type: "array",
            items: { type: "number" }, // Has explicit type
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    // Should preserve the explicit type
    expect(result.properties.numbers.items.items.type).toBe("number")
  })

  test("handles mixed nested structures with objects and arrays", () => {
    const schema = {
      type: "object",
      properties: {
        spreadsheetData: {
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: {
                type: "array",
                items: {}, // Empty items
              },
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.spreadsheetData.properties.rows.items.items.type).toBe("string")
  })
})

describe("ProviderTransform.schema - gemini combiner nodes", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  const walk = (node: any, cb: (node: any, path: (string | number)[]) => void, path: (string | number)[] = []) => {
    if (node === null || typeof node !== "object") {
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, cb, [...path, i]))
      return
    }
    cb(node, path)
    Object.entries(node).forEach(([key, value]) => walk(value, cb, [...path, key]))
  }

  test("keeps edits.items.anyOf without adding type", () => {
    const schema = {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "object",
                properties: {
                  old_string: { type: "string" },
                  new_string: { type: "string" },
                },
                required: ["old_string", "new_string"],
              },
              {
                type: "object",
                properties: {
                  old_string: { type: "string" },
                  new_string: { type: "string" },
                  replace_all: { type: "boolean" },
                },
                required: ["old_string", "new_string"],
              },
            ],
          },
        },
      },
      required: ["edits"],
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(Array.isArray(result.properties.edits.items.anyOf)).toBe(true)
    expect(result.properties.edits.items.type).toBeUndefined()
  })

  test("does not add sibling keys to combiner nodes during sanitize", () => {
    const schema = {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            anyOf: [{ type: "string" }, { type: "number" }],
          },
        },
        value: {
          oneOf: [{ type: "string" }, { type: "boolean" }],
        },
        meta: {
          allOf: [
            {
              type: "object",
              properties: { a: { type: "string" } },
            },
            {
              type: "object",
              properties: { b: { type: "string" } },
            },
          ],
        },
      },
    } as any
    const input = JSON.parse(JSON.stringify(schema))
    const result = ProviderTransform.schema(geminiModel, schema) as any

    walk(result, (node, path) => {
      const hasCombiner = Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf)
      if (!hasCombiner) {
        return
      }
      const before = path.reduce((acc: any, key) => acc?.[key], input)
      const added = Object.keys(node).filter((key) => !(key in before))
      expect(added).toEqual([])
    })
  })
})

describe("ProviderTransform.schema - gemini non-object properties removal", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("removes properties from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "string",
          properties: { invalid: { type: "string" } },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("string")
    expect(result.properties.data.properties).toBeUndefined()
  })

  test("removes required from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: { type: "string" },
          required: ["invalid"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("array")
    expect(result.properties.data.required).toBeUndefined()
  })

  test("removes properties and required from nested non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: {
            inner: {
              type: "number",
              properties: { bad: { type: "string" } },
              required: ["bad"],
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.outer.properties.inner.type).toBe("number")
    expect(result.properties.outer.properties.inner.properties).toBeUndefined()
    expect(result.properties.outer.properties.inner.required).toBeUndefined()
  })

  test("keeps properties and required on object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("object")
    expect(result.properties.data.properties).toBeDefined()
    expect(result.properties.data.required).toEqual(["name"])
  })

  test("does not affect non-gemini providers", () => {
    const openaiModel = {
      providerID: "openai",
      api: {
        id: "gpt-4",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        data: {
          type: "string",
          properties: { invalid: { type: "string" } },
        },
      },
    } as any

    const result = ProviderTransform.schema(openaiModel, schema) as any

    expect(result.properties.data.properties).toBeDefined()
  })
})

describe("ProviderTransform.schema - moonshot $ref siblings", () => {
  const moonshotModel = {
    providerID: "moonshotai",
    api: {
      id: "kimi-k2",
    },
  } as any

  test("removes sibling descriptions from referenced tool parameter schemas", () => {
    const schema = {
      type: "object",
      properties: {
        deviceType: {
          description: "Optional. The type of device that captured the screenshot, e.g. mobile or desktop.",
          enum: ["DEVICE_TYPE_UNSPECIFIED", "MOBILE", "DESKTOP", "TABLET", "AGNOSTIC"],
          type: "string",
        },
        modelId: {
          description: "Optional. The model to use for generation.",
          enum: ["MODEL_ID_UNSPECIFIED", "GEMINI_3_PRO", "GEMINI_3_FLASH", "GEMINI_3_1_PRO"],
          type: "string",
        },
        projectId: {
          description: "Required. The project ID of screens to generate variants for.",
          type: "string",
        },
        prompt: {
          description: "Required. The input text used to generate the variants.",
          type: "string",
        },
        selectedScreenIds: {
          description: "Required. The screen ids of screen to generate variants for.",
          items: {
            type: "string",
          },
          type: "array",
        },
        variantOptions: {
          $ref: "#/$defs/VariantOptions",
          description:
            "Required. The variant options for generation, including the number of variants, creative range, and aspects to focus on.",
        },
      },
      required: ["projectId", "selectedScreenIds", "prompt", "variantOptions"],
      $defs: {
        VariantOptions: {
          description:
            "Configuration options for design variant generation. This message captures all parameters used to generate variants, allowing the configuration to be stored, replayed, or analyzed.",
          properties: {
            aspects: {
              description: "Optional. Specific aspects to focus on. If empty, all aspects may be varied.",
              items: {
                enum: ["VARIANT_ASPECT_UNSPECIFIED", "LAYOUT", "COLOR_SCHEME", "IMAGES", "TEXT_FONT", "TEXT_CONTENT"],
                type: "string",
              },
              type: "array",
            },
            creativeRange: {
              description: "Optional. Creative range for variations. Default: EXPLORE",
              enum: ["CREATIVE_RANGE_UNSPECIFIED", "REFINE", "EXPLORE", "REIMAGINE"],
              type: "string",
            },
            variantCount: {
              description: "Optional. Number of variants to generate (1-5). Default: 3",
              format: "int32",
              type: "integer",
            },
          },
          type: "object",
        },
      },
      description: "Request message for GenerateVariants.",
      additionalProperties: false,
    } as any

    const result = ProviderTransform.schema(moonshotModel, schema) as any

    expect(result.properties.variantOptions).toEqual({
      $ref: "#/$defs/VariantOptions",
    })
    expect(result.$defs.VariantOptions.description).toBe(schema.$defs.VariantOptions.description)
  })

  test("also runs for kimi models outside the moonshot provider", () => {
    const result = ProviderTransform.schema(
      {
        providerID: "openrouter",
        name: "Kimi K2",
        api: {
          id: "moonshotai/kimi-k2",
        },
      } as any,
      {
        type: "object",
        properties: {
          value: {
            $ref: "#/$defs/Value",
            description: "Moonshot rejects this sibling after ref expansion.",
          },
        },
        $defs: {
          Value: {
            description: "Referenced schema description stays here.",
            type: "object",
          },
        },
      } as any,
    ) as any

    expect(result.properties.value).toEqual({
      $ref: "#/$defs/Value",
    })
  })

  test("converts tuple-style array items to a single item schema", () => {
    const result = ProviderTransform.schema(moonshotModel, {
      type: "object",
      properties: {
        codeSpec: {
          type: "object",
          properties: {
            accessibility: {
              type: "object",
              properties: {
                renderedSize: {
                  description: "Rendered size [width, height] in px",
                  type: "array",
                  items: [{ type: "number" }, { type: "number" }],
                  minItems: 2,
                  maxItems: 2,
                },
              },
            },
          },
        },
      },
    } as any) as any

    expect(result.properties.codeSpec.properties.accessibility.properties.renderedSize.items).toEqual({
      type: "number",
    })
  })
})

describe("ProviderTransform.message - DeepSeek reasoning content", () => {
  test("DeepSeek with tool calls includes reasoning_content in providerOptions", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me think about this..." },
          {
            type: "tool-call",
            toolCallId: "test",
            toolName: "bash",
            input: { command: "echo hello" },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(
      msgs,
      {
        id: ModelID.make("deepseek/deepseek-chat"),
        providerID: ProviderID.make("deepseek"),
        api: {
          id: "deepseek-chat",
          url: "https://api.deepseek.com",
          npm: "@ai-sdk/openai-compatible",
        },
        name: "DeepSeek Chat",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: {
            field: "reasoning_content",
          },
        },
        cost: {
          input: 0.001,
          output: 0.002,
          cache: { read: 0.0001, write: 0.0002 },
        },
        limit: {
          context: 128000,
          output: 8192,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2023-04-01",
      },
      {},
    )

    expect(result).toHaveLength(1)
    expect(result[0].content).toEqual([
      {
        type: "tool-call",
        toolCallId: "test",
        toolName: "bash",
        input: { command: "echo hello" },
      },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("Let me think about this...")
  })

  test("Non-DeepSeek providers leave reasoning content unchanged", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Should not be processed" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(
      msgs,
      {
        id: ModelID.make("openai/gpt-4"),
        providerID: ProviderID.make("openai"),
        api: {
          id: "gpt-4",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        name: "GPT-4",
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: {
          input: 0.03,
          output: 0.06,
          cache: { read: 0.001, write: 0.002 },
        },
        limit: {
          context: 128000,
          output: 4096,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2023-04-01",
      },
      {},
    )

    expect(result[0].content).toEqual([
      { type: "reasoning", text: "Should not be processed" },
      { type: "text", text: "Answer" },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
  })
})

describe("ProviderTransform.message - surrogate sanitization", () => {
  const model = {
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("replaces lone surrogates in model-visible text", () => {
    const lone = "\uD83D"
    const valid = "🚀"
    const sanitized = "�"
    const text = (label: string) => `${label} ${lone} and ${valid}`
    const expected = (label: string) => `${label} ${sanitized} and ${valid}`
    const msgs = [
      { role: "system", content: text("system") },
      { role: "user", content: text("user string") },
      {
        role: "user",
        content: [
          { type: "text", text: text("user text") },
          { type: "image", image: "data:image/png;base64,abcd" },
        ],
      },
      { role: "assistant", content: text("assistant string") },
      {
        role: "assistant",
        content: [
          { type: "text", text: text("assistant text") },
          { type: "reasoning", text: text("assistant reasoning") },
          { type: "tool-call", toolCallId: "call-1", toolName: "Read", input: { filePath: ".opencode/tool/emoji.ts" } },
          {
            type: "tool-result",
            toolCallId: "call-2",
            toolName: "Read",
            output: { type: "text", value: text("assistant tool text") },
          },
          {
            type: "tool-result",
            toolCallId: "call-3",
            toolName: "Read",
            output: { type: "error-text", value: text("assistant tool error") },
          },
          {
            type: "tool-result",
            toolCallId: "call-4",
            toolName: "Read",
            output: { type: "content", value: [{ type: "text", text: text("assistant tool content") }] },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-5",
            toolName: "Read",
            output: { type: "text", value: text("tool text") },
          },
          {
            type: "tool-result",
            toolCallId: "call-6",
            toolName: "Read",
            output: { type: "error-text", value: text("tool error") },
          },
          {
            type: "tool-result",
            toolCallId: "call-7",
            toolName: "Read",
            output: { type: "content", value: [{ type: "text", text: text("tool content") }] },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].content).toBe(expected("system"))
    expect(result[1].content).toBe(expected("user string"))
    expect(result[2].content[0].text).toBe(expected("user text"))
    expect(result[3].content).toBe(expected("assistant string"))
    expect(result[4].content[0].text).toBe(expected("assistant text"))
    expect(result[4].content[1].text).toBe(expected("assistant reasoning"))
    expect(result[4].content[3].output.value).toBe(expected("assistant tool text"))
    expect(result[4].content[4].output.value).toBe(expected("assistant tool error"))
    expect(result[4].content[5].output.value[0].text).toBe(expected("assistant tool content"))
    expect(result[5].content[0].output.value).toBe(expected("tool text"))
    expect(result[5].content[1].output.value).toBe(expected("tool error"))
    expect(result[5].content[2].output.value[0].text).toBe(expected("tool content"))
    expect(result[2].content[1]).toEqual({ type: "image", image: "data:image/png;base64,abcd" })
  })
})

describe("ProviderTransform.message - empty image handling", () => {
  const mockModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("should replace empty base64 image with error text", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: "data:image/png;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this image?" })
    expect(result[0].content[1]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })

  test("should keep valid base64 images unchanged", () => {
    const validBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: `data:image/png;base64,${validBase64}` },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this image?" })
    expect(result[0].content[1]).toEqual({ type: "image", image: `data:image/png;base64,${validBase64}` })
  })

  test("should handle mixed valid and empty images", () => {
    const validBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "Compare these images" },
          { type: "image", image: `data:image/png;base64,${validBase64}` },
          { type: "image", image: "data:image/jpeg;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(3)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Compare these images" })
    expect(result[0].content[1]).toEqual({ type: "image", image: `data:image/png;base64,${validBase64}` })
    expect(result[0].content[2]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })
})

describe("ProviderTransform.message - anthropic empty content filtering", () => {
  const anthropicModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("filters out messages with empty string content", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
      { role: "user", content: "World" },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("World")
  })

  test("filters out empty text parts from array content", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "Hello" },
          { type: "text", text: "" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Hello" })
  })

  test("filters out empty reasoning parts from array content", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "" },
          { type: "text", text: "Answer" },
          { type: "reasoning", text: "" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Answer" })
  })

  test("removes entire message when all parts are empty", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "reasoning", text: "" },
        ],
      },
      { role: "user", content: "World" },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("World")
  })

  test("keeps non-text/reasoning parts even if text parts are empty", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "tool-call", toolCallId: "123", toolName: "bash", input: { command: "ls" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({
      type: "tool-call",
      toolCallId: "123",
      toolName: "bash",
      input: { command: "ls" },
    })
  })

  test("keeps messages with valid text alongside empty parts", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Thinking..." },
          { type: "text", text: "" },
          { type: "text", text: "Result" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "reasoning", text: "Thinking..." })
    expect(result[0].content[1]).toEqual({ type: "text", text: "Result" })
  })

  test("filters empty content for bedrock provider", () => {
    const bedrockModel = {
      ...anthropicModel,
      id: "amazon-bedrock/anthropic.claude-opus-4-6",
      providerID: "amazon-bedrock",
      api: {
        id: "anthropic.claude-opus-4-6",
        url: "https://bedrock-runtime.us-east-1.amazonaws.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
    }

    const msgs = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, bedrockModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toHaveLength(1)
    expect(result[1].content[0]).toEqual({ type: "text", text: "Answer" })
  })

  test("does not filter for non-anthropic providers", () => {
    const openaiModel = {
      ...anthropicModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }

    const msgs = [
      { role: "assistant", content: "" },
      {
        role: "assistant",
        content: [{ type: "text", text: "" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("")
    expect(result[1].content).toHaveLength(1)
  })

  test("splits anthropic assistant messages when text trails tool calls", () => {
    const msgs = [
      {
        role: "user",
        content: [{ type: "text", text: "Check my home directory for PDFs" }],
      },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "toolu_1", toolName: "read", input: { filePath: "/root" } },
          { type: "tool-call", toolCallId: "toolu_2", toolName: "glob", input: { pattern: "**/*.pdf" } },
          { type: "text", text: "I checked your home directory and looked for PDF files." },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "toolu_1", toolName: "read", output: { type: "text", value: "ok" } },
          {
            type: "tool-result",
            toolCallId: "toolu_2",
            toolName: "glob",
            output: { type: "text", value: "No files found" },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {}) as any[]

    expect(result).toHaveLength(4)
    expect(result[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "I checked your home directory and looked for PDF files." }],
    })
    expect(result[2]).toMatchObject({
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "toolu_1", toolName: "read", input: { filePath: "/root" } },
        { type: "tool-call", toolCallId: "toolu_2", toolName: "glob", input: { pattern: "**/*.pdf" } },
      ],
    })
  })

  test("leaves valid anthropic assistant tool ordering unchanged", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I checked your home directory and looked for PDF files." },
          { type: "tool-call", toolCallId: "toolu_1", toolName: "read", input: { filePath: "/root" } },
          { type: "tool-call", toolCallId: "toolu_2", toolName: "glob", input: { pattern: "**/*.pdf" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {}) as any[]

    expect(result).toHaveLength(1)
    expect(result[0].content).toMatchObject([
      { type: "text", text: "I checked your home directory and looked for PDF files." },
      { type: "tool-call", toolCallId: "toolu_1", toolName: "read", input: { filePath: "/root" } },
      { type: "tool-call", toolCallId: "toolu_2", toolName: "glob", input: { pattern: "**/*.pdf" } },
    ])
  })

  test("splits vertex anthropic assistant messages when text trails tool calls", () => {
    const model = {
      ...anthropicModel,
      providerID: "google-vertex-anthropic",
      api: {
        id: "claude-sonnet-4@20250514",
        url: "https://us-central1-aiplatform.googleapis.com",
        npm: "@ai-sdk/google-vertex/anthropic",
      },
    }

    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "toolu_1", toolName: "read", input: { filePath: "/root" } },
          { type: "tool-call", toolCallId: "toolu_2", toolName: "glob", input: { pattern: "**/*.pdf" } },
          { type: "text", text: "I checked your home directory and looked for PDF files." },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "I checked your home directory and looked for PDF files." }],
    })
    expect(result[1]).toMatchObject({
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "toolu_1", toolName: "read", input: { filePath: "/root" } },
        { type: "tool-call", toolCallId: "toolu_2", toolName: "glob", input: { pattern: "**/*.pdf" } },
      ],
    })
  })
})

describe("ProviderTransform.message - strip openai metadata when store=false", () => {
  const openaiModel = {
    id: "openai/gpt-5",
    providerID: "openai",
    api: {
      id: "gpt-5",
      url: "https://api.openai.com",
      npm: "@ai-sdk/openai",
    },
    name: "GPT-5",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.03, output: 0.06, cache: { read: 0.001, write: 0.002 } },
    limit: { context: 128000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("preserves itemId and reasoningEncryptedContent when store=false", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: {
              openai: {
                itemId: "rs_123",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_456",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, { store: false }) as any[]

    expect(result).toHaveLength(1)
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("rs_123")
    expect(result[0].content[1].providerOptions?.openai?.itemId).toBe("msg_456")
  })

  test("preserves itemId and reasoningEncryptedContent when store=false even when not openai", () => {
    const zenModel = {
      ...openaiModel,
      providerID: "zen",
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: {
              openai: {
                itemId: "rs_123",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_456",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, zenModel, { store: false }) as any[]

    expect(result).toHaveLength(1)
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("rs_123")
    expect(result[0].content[1].providerOptions?.openai?.itemId).toBe("msg_456")
  })

  test("preserves other openai options including itemId", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
                otherOption: "value",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
    expect(result[0].content[0].providerOptions?.openai?.otherOption).toBe("value")
  })

  test("preserves metadata for openai package when store is true", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    // openai package preserves itemId regardless of store value
    const result = ProviderTransform.message(msgs, openaiModel, { store: true }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })

  test("preserves metadata for non-openai packages when store is false", () => {
    const anthropicModel = {
      ...openaiModel,
      providerID: "anthropic",
      api: {
        id: "claude-3",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    // store=false preserves metadata for non-openai packages
    const result = ProviderTransform.message(msgs, anthropicModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })

  test("preserves metadata using providerID key when store is false", () => {
    const opencodeModel = {
      ...openaiModel,
      providerID: "opencode",
      api: {
        id: "opencode-test",
        url: "https://api.opencode.ai",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              opencode: {
                itemId: "msg_123",
                otherOption: "value",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, opencodeModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.opencode?.itemId).toBe("msg_123")
    expect(result[0].content[0].providerOptions?.opencode?.otherOption).toBe("value")
  })

  test("preserves itemId across all providerOptions keys", () => {
    const opencodeModel = {
      ...openaiModel,
      providerID: "opencode",
      api: {
        id: "opencode-test",
        url: "https://api.opencode.ai",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const msgs = [
      {
        role: "assistant",
        providerOptions: {
          openai: { itemId: "msg_root" },
          opencode: { itemId: "msg_opencode" },
          extra: { itemId: "msg_extra" },
        },
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: { itemId: "msg_openai_part" },
              opencode: { itemId: "msg_opencode_part" },
              extra: { itemId: "msg_extra_part" },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, opencodeModel, { store: false }) as any[]

    expect(result[0].providerOptions?.openai?.itemId).toBe("msg_root")
    expect(result[0].providerOptions?.opencode?.itemId).toBe("msg_opencode")
    expect(result[0].providerOptions?.extra?.itemId).toBe("msg_extra")
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_openai_part")
    expect(result[0].content[0].providerOptions?.opencode?.itemId).toBe("msg_opencode_part")
    expect(result[0].content[0].providerOptions?.extra?.itemId).toBe("msg_extra_part")
  })

  test("does not strip metadata for non-openai packages when store is not false", () => {
    const anthropicModel = {
      ...openaiModel,
      providerID: "anthropic",
      api: {
        id: "claude-3",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {}) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })
})

describe("ProviderTransform.message - providerOptions key remapping", () => {
  const createModel = (providerID: string, npm: string) =>
    ({
      id: `${providerID}/test-model`,
      providerID,
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm,
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
      limit: { context: 128000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("azure keeps 'azure' key and does not remap to 'openai'", () => {
    const model = createModel("azure", "@ai-sdk/azure")
    const msgs = [
      {
        role: "user",
        content: "Hello",
        providerOptions: {
          azure: { someOption: "value" },
        },
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result[0].providerOptions?.azure).toEqual({ someOption: "value" })
    expect(result[0].providerOptions?.openai).toBeUndefined()
  })

  test("azure cognitive services remaps providerID to 'azure' key", () => {
    const model = createModel("azure-cognitive-services", "@ai-sdk/azure")
    const msgs = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              "azure-cognitive-services": { part: true },
            },
          },
        ],
        providerOptions: {
          "azure-cognitive-services": { someOption: "value" },
        },
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]
    const part = result[0].content[0] as any

    expect(result[0].providerOptions?.azure).toEqual({ someOption: "value" })
    expect(result[0].providerOptions?.["azure-cognitive-services"]).toBeUndefined()
    expect(part.providerOptions?.azure).toEqual({ part: true })
    expect(part.providerOptions?.["azure-cognitive-services"]).toBeUndefined()
  })

  test("copilot remaps providerID to 'copilot' key", () => {
    const model = createModel("github-copilot", "@ai-sdk/github-copilot")
    const msgs = [
      {
        role: "user",
        content: "Hello",
        providerOptions: {
          copilot: { someOption: "value" },
        },
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result[0].providerOptions?.copilot).toEqual({ someOption: "value" })
    expect(result[0].providerOptions?.["github-copilot"]).toBeUndefined()
  })

  test("bedrock remaps providerID to 'bedrock' key", () => {
    const model = createModel("my-bedrock", "@ai-sdk/amazon-bedrock")
    const msgs = [
      {
        role: "user",
        content: "Hello",
        providerOptions: {
          "my-bedrock": { someOption: "value" },
        },
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result[0].providerOptions?.bedrock).toEqual({ someOption: "value" })
    expect(result[0].providerOptions?.["my-bedrock"]).toBeUndefined()
  })
})

describe("ProviderTransform.message - claude w/bedrock custom inference profile", () => {
  test("adds cachePoint", () => {
    const model = {
      id: "amazon-bedrock/custom-claude-sonnet-4.5",
      providerID: "amazon-bedrock",
      api: {
        id: "arn:aws:bedrock:xxx:yyy:application-inference-profile/zzz",
        url: "https://api.test.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
      name: "Custom inference profile",
      capabilities: {},
      options: {},
      headers: {},
    } as any

    const msgs = [
      {
        role: "user",
        content: "Hello",
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result[0].providerOptions?.bedrock).toEqual(
      expect.objectContaining({
        cachePoint: {
          type: "default",
        },
      }),
    )
  })
})

describe("ProviderTransform.message - bedrock caching with non-bedrock providerID", () => {
  test("applies cache options at message level when npm package is amazon-bedrock", () => {
    const model = {
      id: "aws/us.anthropic.claude-opus-4-6-v1",
      providerID: "aws",
      api: {
        id: "us.anthropic.claude-opus-4-6-v1",
        url: "https://bedrock-runtime.us-east-1.amazonaws.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
      name: "Claude Opus 4.6",
      capabilities: {},
      options: {},
      headers: {},
    } as any

    const msgs = [
      {
        role: "system",
        content: "You are a helpful assistant",
      },
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    // Cache should be at the message level and not the content-part level
    expect(result[0].providerOptions?.bedrock).toEqual({
      cachePoint: { type: "default" },
    })
    expect(result[0].content).toBe("You are a helpful assistant")
  })
})

describe("ProviderTransform.message - cache control on gateway", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "anthropic/claude-sonnet-4",
      providerID: "vercel",
      api: {
        id: "anthropic/claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
      name: "Claude Sonnet 4",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
      limit: { context: 200_000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
      ...overrides,
    }) as any

  test("gateway does not set cache control for anthropic models", () => {
    const model = createModel()
    const msgs = [
      {
        role: "system",
        content: "You are a helpful assistant",
      },
      {
        role: "user",
        content: "Hello",
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].content).toBe("You are a helpful assistant")
    expect(result[0].providerOptions).toBeUndefined()
  })

  test("non-gateway anthropic keeps existing cache control behavior", () => {
    const model = createModel({
      providerID: "anthropic",
      api: {
        id: "claude-sonnet-4",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    })
    const msgs = [
      {
        role: "system",
        content: "You are a helpful assistant",
      },
      {
        role: "user",
        content: "Hello",
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].providerOptions).toEqual({
      anthropic: {
        cacheControl: {
          type: "ephemeral",
        },
      },
      openrouter: {
        cacheControl: {
          type: "ephemeral",
        },
      },
      bedrock: {
        cachePoint: {
          type: "default",
        },
      },
      openaiCompatible: {
        cache_control: {
          type: "ephemeral",
        },
      },
      copilot: {
        copilot_cache_control: {
          type: "ephemeral",
        },
      },
      alibaba: {
        cacheControl: {
          type: "ephemeral",
        },
      },
    })
  })

  test("google-vertex-anthropic applies cache control", () => {
    const model = createModel({
      providerID: "google-vertex-anthropic",
      api: {
        id: "google-vertex-anthropic",
        url: "https://us-central1-aiplatform.googleapis.com",
        npm: "@ai-sdk/google-vertex/anthropic",
      },
      id: "claude-sonnet-4@20250514",
    })
    const msgs = [
      {
        role: "system",
        content: "You are a helpful assistant",
      },
      {
        role: "user",
        content: "Hello",
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].providerOptions).toEqual({
      anthropic: {
        cacheControl: {
          type: "ephemeral",
        },
      },
      openrouter: {
        cacheControl: {
          type: "ephemeral",
        },
      },
      bedrock: {
        cachePoint: {
          type: "default",
        },
      },
      openaiCompatible: {
        cache_control: {
          type: "ephemeral",
        },
      },
      copilot: {
        copilot_cache_control: {
          type: "ephemeral",
        },
      },
      alibaba: {
        cacheControl: {
          type: "ephemeral",
        },
      },
    })
  })
})

describe("ProviderTransform.variants", () => {
  const createMockModel = (overrides: Partial<any> = {}): any => ({
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.001,
      output: 0.002,
      cache: { read: 0.0001, write: 0.0002 },
    },
    limit: {
      context: 200_000,
      output: 64_000,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
    ...overrides,
  })

  test("returns empty object when model has no reasoning capabilities", () => {
    const model = createMockModel({
      capabilities: { reasoning: false },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("deepseek returns empty object", () => {
    const model = createMockModel({
      id: "deepseek/deepseek-chat",
      providerID: "deepseek",
      api: {
        id: "deepseek-chat",
        url: "https://api.deepseek.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("minimax returns empty object", () => {
    const model = createMockModel({
      id: "minimax/minimax-model",
      providerID: "minimax",
      api: {
        id: "minimax-model",
        url: "https://api.minimax.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("glm returns empty object", () => {
    const model = createMockModel({
      id: "glm/glm-4",
      providerID: "glm",
      api: {
        id: "glm-4",
        url: "https://api.glm.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("mistral models with reasoning support return variants", () => {
    const model = createMockModel({
      id: "mistral/mistral-small-latest",
      providerID: "mistral",
      api: {
        id: "mistral-small-latest",
        url: "https://api.mistral.com",
        npm: "@ai-sdk/mistral",
      },
      capabilities: { reasoning: true },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({
      high: { reasoningEffort: "high" },
    })
  })

  test("mistral-medium-3.5 with reasoning returns variants", () => {
    const model = createMockModel({
      id: "mistral/mistral-medium-3.5",
      providerID: "mistral",
      api: {
        id: "mistral-medium-3.5",
        url: "https://api.mistral.com",
        npm: "@ai-sdk/mistral",
      },
      capabilities: { reasoning: true },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({
      high: { reasoningEffort: "high" },
    })
  })

  test("mistral without reasoning returns empty object", () => {
    const model = createMockModel({
      id: "mistral/mistral-large",
      providerID: "mistral",
      api: {
        id: "mistral-large-latest",
        url: "https://api.mistral.com",
        npm: "@ai-sdk/mistral",
      },
      capabilities: { reasoning: false },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("mistral large with reasoning returns empty object (only small supports reasoning)", () => {
    const model = createMockModel({
      id: "mistral/mistral-large",
      providerID: "mistral",
      api: {
        id: "mistral-large-latest",
        url: "https://api.mistral.com",
        npm: "@ai-sdk/mistral",
      },
      capabilities: { reasoning: true },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  describe("@openrouter/ai-sdk-provider", () => {
    test("returns empty object for non-qualifying models", () => {
      const model = createMockModel({
        id: "openrouter/test-model",
        providerID: "openrouter",
        api: {
          id: "test-model",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("gpt models return OPENAI_EFFORTS with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/gpt-4",
        providerID: "openrouter",
        api: {
          id: "gpt-4",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
      expect(result.low).toEqual({ reasoning: { effort: "low" } })
      expect(result.high).toEqual({ reasoning: { effort: "high" } })
    })

    for (const testCase of [
      { id: "openai/gpt-5.4", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5-pro", efforts: ["high"] },
      { id: "openai/gpt-5.5-pro", efforts: ["medium", "high", "xhigh"] },
      { id: "openai/gpt-5.2-codex", efforts: ["low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5.3-codex", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5.3-codex-max", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5-chat-latest", efforts: [] },
      { id: "openai/gpt-5.2-chat-latest", efforts: ["medium"] },
    ]) {
      test(`${testCase.id} returns supported OpenAI reasoning efforts`, () => {
        const result = ProviderTransform.variants(
          createMockModel({
            id: testCase.id,
            providerID: "openrouter",
            api: {
              id: testCase.id,
              url: "https://openrouter.ai",
              npm: "@openrouter/ai-sdk-provider",
            },
          }),
        )
        expect(Object.keys(result)).toEqual(testCase.efforts)
      })
    }

    test("gemini-3 returns OPENAI_EFFORTS with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/gemini-3-5-pro",
        providerID: "openrouter",
        api: {
          id: "gemini-3-5-pro",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
    })

    test("grok-4 returns empty object", () => {
      const model = createMockModel({
        id: "openrouter/grok-4",
        providerID: "openrouter",
        api: {
          id: "grok-4",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("grok-3-mini returns low and high with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/grok-3-mini",
        providerID: "openrouter",
        api: {
          id: "grok-3-mini",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({ reasoning: { effort: "low" } })
      expect(result.high).toEqual({ reasoning: { effort: "high" } })
    })
  })

  describe("@ai-sdk/gateway", () => {
    test("anthropic sonnet 4.6 models return adaptive thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-sonnet-4-6",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-sonnet-4-6",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.medium).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "medium",
      })
    })

    test("anthropic sonnet 4.6 dot-format models return adaptive thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-sonnet-4-6",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-sonnet-4.6",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.medium).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "medium",
      })
    })

    test("anthropic opus 4.6 dot-format models return adaptive thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-opus-4-6",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-opus-4.6",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "high",
      })
    })

    test("anthropic opus 4.7 models return adaptive thinking options with xhigh", () => {
      const model = createMockModel({
        id: "anthropic/claude-opus-4-7",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-opus-4-7",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh", "max"])
      expect(result.xhigh).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "xhigh",
      })
      expect(result.max).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "max",
      })
    })

    test("anthropic opus 4.7 dot-format models return adaptive thinking options with xhigh", () => {
      const model = createMockModel({
        id: "anthropic/claude-opus-4-7",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-opus-4.7",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh", "max"])
    })

    test("anthropic models return anthropic thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-sonnet-4",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-sonnet-4",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 16000,
        },
      })
      expect(result.max).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 31999,
        },
      })
    })

    test("returns OPENAI_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "gateway/gateway-model",
        providerID: "gateway",
        api: {
          id: "gateway-model",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })

    for (const testCase of [
      { id: "openai/gpt-5-5", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5-pro", efforts: ["high"] },
      { id: "openai/gpt-5-5-pro", efforts: ["medium", "high", "xhigh"] },
      { id: "openai/gpt-5-2-codex", efforts: ["low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5-3-codex", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5-3-codex-max", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5-chat-latest", efforts: [] },
      { id: "openai/gpt-5-2-chat-latest", efforts: ["medium"] },
    ]) {
      test(`${testCase.id} returns supported OpenAI reasoning efforts`, () => {
        const result = ProviderTransform.variants(
          createMockModel({
            id: testCase.id,
            providerID: "gateway",
            api: {
              id: testCase.id,
              url: "https://gateway.ai",
              npm: "@ai-sdk/gateway",
            },
          }),
        )
        expect(Object.keys(result)).toEqual(testCase.efforts)
      })
    }
  })

  describe("@ai-sdk/github-copilot", () => {
    test("standard models return low, medium, high", () => {
      const model = createMockModel({
        id: "gpt-4.5",
        providerID: "github-copilot",
        api: {
          id: "gpt-4.5",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("gpt-5.1-codex-max includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.1-codex-max",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.1-codex-max",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
    })

    test("gpt-5.1-codex-mini does not include xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.1-codex-mini",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.1-codex-mini",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    })

    test("gpt-5.1-codex does not include xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.1-codex",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.1-codex",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    })

    test("gpt-5.2 includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.2",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.2",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
      expect(result.xhigh).toEqual({
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("gpt-5.2-codex includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.2-codex",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.2-codex",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
    })

    test("gpt-5.3-codex includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.3-codex",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.3-codex",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
    })

    test("gpt-5.4 includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.4",
        release_date: "2026-03-05",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.4",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
    })
  })

  describe("@ai-sdk/cerebras", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "cerebras/llama-4",
        providerID: "cerebras",
        api: {
          id: "llama-4-sc",
          url: "https://api.cerebras.ai",
          npm: "@ai-sdk/cerebras",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/togetherai", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "togetherai/llama-4",
        providerID: "togetherai",
        api: {
          id: "llama-4-sc",
          url: "https://api.togetherai.com",
          npm: "@ai-sdk/togetherai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/xai", () => {
    test("grok-3 returns empty object", () => {
      const model = createMockModel({
        id: "xai/grok-3",
        providerID: "xai",
        api: {
          id: "grok-3",
          url: "https://api.x.ai",
          npm: "@ai-sdk/xai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("grok-3-mini returns low and high with reasoningEffort", () => {
      const model = createMockModel({
        id: "xai/grok-3-mini",
        providerID: "xai",
        api: {
          id: "grok-3-mini",
          url: "https://api.x.ai",
          npm: "@ai-sdk/xai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/deepinfra", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "deepinfra/llama-4",
        providerID: "deepinfra",
        api: {
          id: "llama-4-sc",
          url: "https://api.deepinfra.com",
          npm: "@ai-sdk/deepinfra",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/openai-compatible", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "custom-provider/custom-model",
        providerID: "custom-provider",
        api: {
          id: "custom-model",
          url: "https://api.custom.com",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/azure", () => {
    test("o1-mini returns empty object", () => {
      const model = createMockModel({
        id: "o1-mini",
        providerID: "azure",
        api: {
          id: "o1-mini",
          url: "https://azure.com",
          npm: "@ai-sdk/azure",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("standard azure models return custom efforts with reasoningSummary", () => {
      const model = createMockModel({
        id: "o1",
        providerID: "azure",
        api: {
          id: "o1",
          url: "https://azure.com",
          npm: "@ai-sdk/azure",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("gpt-5 adds minimal effort", () => {
      const model = createMockModel({
        id: "gpt-5",
        providerID: "azure",
        api: {
          id: "gpt-5",
          url: "https://azure.com",
          npm: "@ai-sdk/azure",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["minimal", "low", "medium", "high"])
    })

    for (const id of ["gpt-5-4", "gpt-5-5"]) {
      test(`${id} does not add minimal effort`, () => {
        const result = ProviderTransform.variants(
          createMockModel({
            id,
            providerID: "azure",
            api: {
              id,
              url: "https://azure.com",
              npm: "@ai-sdk/azure",
            },
          }),
        )
        expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      })
    }
  })

  describe("@ai-sdk/openai", () => {
    test("gpt-5-pro returns only high effort", () => {
      const model = createMockModel({
        id: "gpt-5-pro",
        providerID: "openai",
        api: {
          id: "gpt-5-pro",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high"])
    })

    test("standard openai models return custom efforts with reasoningSummary", () => {
      const model = createMockModel({
        id: "gpt-5",
        providerID: "openai",
        api: {
          id: "gpt-5",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2024-06-01",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["minimal", "low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("models after 2025-11-13 include 'none' effort", () => {
      const model = createMockModel({
        id: "gpt-5-nano",
        providerID: "openai",
        api: {
          id: "gpt-5-nano",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2025-11-14",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high"])
    })

    test("models after 2025-12-04 include 'xhigh' effort", () => {
      const model = createMockModel({
        id: "openai/gpt-5-reasoning",
        providerID: "openai",
        api: {
          id: "gpt-5-reasoning",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2025-12-05",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
    })

    for (const testCase of [
      { id: "o1", releaseDate: "2024-12-17", efforts: ["low", "medium", "high"] },
      { id: "o1-pro", releaseDate: "2025-03-19", efforts: ["low", "medium", "high"] },
      { id: "o3", releaseDate: "2025-04-16", efforts: ["low", "medium", "high"] },
      { id: "o3-mini", releaseDate: "2025-01-31", efforts: ["low", "medium", "high"] },
      { id: "o3-pro", releaseDate: "2025-06-10", efforts: ["low", "medium", "high"] },
      { id: "o4-mini", releaseDate: "2025-04-16", efforts: ["low", "medium", "high"] },
      { id: "o3-deep-research", releaseDate: "2025-06-26", efforts: ["medium"] },
      { id: "o4-mini-deep-research", releaseDate: "2025-06-26", efforts: ["medium"] },
      { id: "gpt-5.1", releaseDate: "2025-11-13", efforts: ["none", "low", "medium", "high"] },
      { id: "gpt-5.4", releaseDate: "2026-03-05", efforts: ["none", "low", "medium", "high", "xhigh"] },
      {
        id: "gpt-5.5",
        modelID: "gpt-5-5",
        releaseDate: "2026-04-23",
        efforts: ["none", "low", "medium", "high", "xhigh"],
      },
      { id: "gpt-5.4-pro", releaseDate: "2026-03-05", efforts: ["medium", "high", "xhigh"] },
      { id: "gpt-5.5-pro", releaseDate: "2026-04-23", efforts: ["medium", "high", "xhigh"] },
      { id: "gpt-5-codex", releaseDate: "2025-09-23", efforts: ["low", "medium", "high"] },
      { id: "gpt-5.1-codex", releaseDate: "2025-11-13", efforts: ["low", "medium", "high"] },
      { id: "gpt-5.1-codex-max", releaseDate: "2025-11-13", efforts: ["low", "medium", "high", "xhigh"] },
      { id: "gpt-5.2-codex", releaseDate: "2025-12-11", efforts: ["low", "medium", "high", "xhigh"] },
      { id: "gpt-5.3-codex", releaseDate: "2026-01-22", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "gpt-5.3-codex-max", releaseDate: "2026-01-22", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "gpt-5-chat-latest", releaseDate: "2025-08-07", efforts: [] },
      { id: "gpt-5.1-chat-latest", releaseDate: "2025-11-13", efforts: ["medium"] },
      { id: "gpt-5.2-chat-latest", releaseDate: "2025-12-11", efforts: ["medium"] },
    ]) {
      test(`${testCase.id} returns supported reasoning efforts`, () => {
        const result = ProviderTransform.variants(
          createMockModel({
            id: testCase.modelID ?? testCase.id,
            providerID: "openai",
            api: {
              id: testCase.id,
              url: "https://api.openai.com",
              npm: "@ai-sdk/openai",
            },
            release_date: testCase.releaseDate,
          }),
        )
        expect(Object.keys(result)).toEqual(testCase.efforts)
      })
    }

    test("gpt-50 (lookalike) does not get gpt-5 family treatment", () => {
      const model = createMockModel({
        id: "gpt-50",
        providerID: "openai",
        api: {
          id: "gpt-50",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2024-01-01",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    })
  })

  describe("@ai-sdk/anthropic", () => {
    for (const testCase of [
      {
        name: "opus 4.5",
        apiIds: ["claude-opus-4-5-20251101", "claude-opus-4.5-20251101"],
        efforts: ["low", "medium", "high"],
        expectedHigh: { effort: "high" },
      },
      {
        name: "sonnet 4.6",
        apiIds: ["claude-sonnet-4-6", "claude-sonnet-4.6"],
        efforts: ["low", "medium", "high", "max"],
        expectedHigh: { thinking: { type: "adaptive" }, effort: "high" },
      },
      {
        name: "opus 4.6",
        apiIds: ["claude-opus-4-6", "claude-opus-4.6"],
        efforts: ["low", "medium", "high", "max"],
        expectedHigh: { thinking: { type: "adaptive" }, effort: "high" },
      },
      {
        name: "opus 4.7",
        apiIds: ["claude-opus-4-7", "claude-opus-4.7"],
        efforts: ["low", "medium", "high", "xhigh", "max"],
        expectedHigh: { thinking: { type: "adaptive", display: "summarized" }, effort: "high" },
      },
    ]) {
      for (const apiId of testCase.apiIds) {
        test(`${testCase.name} ${apiId} returns supported reasoning efforts`, () => {
          const result = ProviderTransform.variants(
            createMockModel({
              id: `anthropic/${apiId}`,
              providerID: "anthropic",
              api: {
                id: apiId,
                url: "https://api.anthropic.com",
                npm: "@ai-sdk/anthropic",
              },
            }),
          )
          expect(Object.keys(result)).toEqual(testCase.efforts)
          expect(result.high).toEqual(testCase.expectedHigh)
        })
      }
    }

    test("github copilot opus 4.7 returns only medium reasoning effort", () => {
      const model = createMockModel({
        id: "claude-opus-4.7",
        providerID: "github-copilot",
        api: {
          id: "claude-opus-4.7",
          url: "https://api.githubcopilot.com/v1",
          npm: "@ai-sdk/anthropic",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({
        medium: {
          thinking: {
            type: "adaptive",
            display: "summarized",
          },
          effort: "medium",
        },
      })
    })

    test("returns high and max with thinking config", () => {
      const model = createMockModel({
        id: "anthropic/claude-4",
        providerID: "anthropic",
        api: {
          id: "claude-4",
          url: "https://api.anthropic.com",
          npm: "@ai-sdk/anthropic",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 16000,
        },
      })
      expect(result.max).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 31999,
        },
      })
    })
  })

  describe("@ai-sdk/amazon-bedrock", () => {
    test("anthropic sonnet 4.6 returns adaptive reasoning options", () => {
      const model = createMockModel({
        id: "bedrock/anthropic-claude-sonnet-4-6",
        providerID: "bedrock",
        api: {
          id: "anthropic.claude-sonnet-4-6",
          url: "https://bedrock.amazonaws.com",
          npm: "@ai-sdk/amazon-bedrock",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.max).toEqual({
        reasoningConfig: {
          type: "adaptive",
          maxReasoningEffort: "max",
        },
      })
    })

    test("anthropic opus 4.7 returns adaptive reasoning options with xhigh", () => {
      const model = createMockModel({
        id: "bedrock/anthropic-claude-opus-4-7",
        providerID: "bedrock",
        api: {
          id: "anthropic.claude-opus-4-7",
          url: "https://bedrock.amazonaws.com",
          npm: "@ai-sdk/amazon-bedrock",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh", "max"])
      expect(result.xhigh).toEqual({
        reasoningConfig: {
          type: "adaptive",
          maxReasoningEffort: "xhigh",
          display: "summarized",
        },
      })
      expect(result.max).toEqual({
        reasoningConfig: {
          type: "adaptive",
          maxReasoningEffort: "max",
          display: "summarized",
        },
      })
    })

    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningConfig", () => {
      const model = createMockModel({
        id: "bedrock/llama-4",
        providerID: "bedrock",
        api: {
          id: "llama-4-sc",
          url: "https://bedrock.amazonaws.com",
          npm: "@ai-sdk/amazon-bedrock",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningConfig: {
          type: "enabled",
          maxReasoningEffort: "low",
        },
      })
    })
  })

  for (const provider of [
    { name: "@ai-sdk/google", providerID: "google", url: "https://generativelanguage.googleapis.com" },
    { name: "@ai-sdk/google-vertex", providerID: "google-vertex", url: "https://vertexai.googleapis.com" },
  ]) {
    describe(provider.name, () => {
      for (const testCase of [
        {
          apiId: "gemini-2.5-pro",
          efforts: ["high", "max"],
          expectedHigh: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16_000 } },
          expectedMax: { thinkingConfig: { includeThoughts: true, thinkingBudget: 32_768 } },
        },
        {
          apiId: "gemini-2.5-flash",
          efforts: ["high", "max"],
          expectedHigh: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16_000 } },
          expectedMax: { thinkingConfig: { includeThoughts: true, thinkingBudget: 24_576 } },
        },
        {
          apiId: "gemini-3-pro-preview",
          efforts: ["low", "medium", "high"],
          expectedHigh: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
        },
        {
          apiId: "gemini-3.1-pro-preview",
          efforts: ["low", "medium", "high"],
          expectedHigh: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
        },
        {
          apiId: "gemini-3-flash-preview",
          efforts: ["minimal", "low", "medium", "high"],
          expectedHigh: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
        },
        {
          apiId: "gemini-3.1-flash-lite",
          efforts: ["minimal", "low", "medium", "high"],
          expectedHigh: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
        },
        {
          apiId: "gemini-3.1-flash-image-preview",
          efforts: ["minimal", "high"],
          expectedHigh: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
        },
        {
          apiId: "gemini-3-pro-image-preview",
          efforts: ["high"],
          expectedHigh: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
        },
      ]) {
        test(`${testCase.apiId} returns supported thinking controls`, () => {
          const result = ProviderTransform.variants(
            createMockModel({
              id: `${provider.providerID}/${testCase.apiId}`,
              providerID: provider.providerID,
              api: {
                id: testCase.apiId,
                url: provider.url,
                npm: provider.name,
              },
            }),
          )
          expect(Object.keys(result)).toEqual(testCase.efforts)
          expect(result.high).toEqual(testCase.expectedHigh)
          if (testCase.expectedMax) expect(result.max).toEqual(testCase.expectedMax)
        })
      }
    })
  }

  describe("@ai-sdk/cohere", () => {
    test("returns empty object", () => {
      const model = createMockModel({
        id: "cohere/command-r",
        providerID: "cohere",
        api: {
          id: "command-r",
          url: "https://api.cohere.com",
          npm: "@ai-sdk/cohere",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })
  })

  describe("@ai-sdk/groq", () => {
    test("returns none and WIDELY_SUPPORTED_EFFORTS with thinkingLevel", () => {
      const model = createMockModel({
        id: "groq/llama-4",
        providerID: "groq",
        api: {
          id: "llama-4-sc",
          url: "https://api.groq.com",
          npm: "@ai-sdk/groq",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "low", "medium", "high"])
      expect(result.none).toEqual({
        reasoningEffort: "none",
      })
      expect(result.low).toEqual({
        reasoningEffort: "low",
      })
    })
  })

  describe("@ai-sdk/perplexity", () => {
    test("returns empty object", () => {
      const model = createMockModel({
        id: "perplexity/sonar-plus",
        providerID: "perplexity",
        api: {
          id: "sonar-plus",
          url: "https://api.perplexity.ai",
          npm: "@ai-sdk/perplexity",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })
  })

  describe("@jerome-benoit/sap-ai-provider-v2", () => {
    test("anthropic models return thinking variants", () => {
      const model = createMockModel({
        id: "sap-ai-core/anthropic--claude-sonnet-4",
        providerID: "sap-ai-core",
        api: {
          id: "anthropic--claude-sonnet-4",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 16000,
        },
      })
      expect(result.max).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 31999,
        },
      })
    })

    test("anthropic 4.6 models return adaptive thinking variants", () => {
      const model = createMockModel({
        id: "sap-ai-core/anthropic--claude-sonnet-4-6",
        providerID: "sap-ai-core",
        api: {
          id: "anthropic--claude-sonnet-4-6",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.low).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "low",
      })
      expect(result.max).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "max",
      })
    })

    test("gemini 2.5 models return thinkingConfig variants", () => {
      const model = createMockModel({
        id: "sap-ai-core/gcp--gemini-2.5-pro",
        providerID: "sap-ai-core",
        api: {
          id: "gcp--gemini-2.5-pro",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 16000,
        },
      })
      expect(result.max).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 24576,
        },
      })
    })

    test("gpt models return reasoningEffort variants", () => {
      const model = createMockModel({
        id: "sap-ai-core/azure-openai--gpt-4o",
        providerID: "sap-ai-core",
        api: {
          id: "azure-openai--gpt-4o",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })

    test("o-series models return reasoningEffort variants", () => {
      const model = createMockModel({
        id: "sap-ai-core/azure-openai--o3-mini",
        providerID: "sap-ai-core",
        api: {
          id: "azure-openai--o3-mini",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })

    test("sonar models return empty object", () => {
      const model = createMockModel({
        id: "sap-ai-core/perplexity--sonar-pro",
        providerID: "sap-ai-core",
        api: {
          id: "perplexity--sonar-pro",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("mistral models return empty object", () => {
      const model = createMockModel({
        id: "sap-ai-core/mistral--mistral-large",
        providerID: "sap-ai-core",
        api: {
          id: "mistral--mistral-large",
          url: "https://api.ai.sap",
          npm: "@jerome-benoit/sap-ai-provider-v2",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })
  })

  describe("ai-gateway-provider (cloudflare-ai-gateway)", () => {
    const cfModel = (apiId: string, releaseDate = "2024-01-01") =>
      createMockModel({
        id: `cloudflare-ai-gateway/${apiId}`,
        providerID: "cloudflare-ai-gateway",
        api: {
          id: apiId,
          url: "https://gateway.ai.cloudflare.com/v1/compat",
          npm: "ai-gateway-provider",
        },
        release_date: releaseDate,
      })

    for (const testCase of [
      { id: "openai/gpt-5.4", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5.2-codex", efforts: ["low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5.3-codex", efforts: ["none", "low", "medium", "high", "xhigh"] },
      { id: "openai/gpt-5-pro", efforts: ["high"] },
      { id: "openai/gpt-5.2-pro", efforts: ["medium", "high", "xhigh"] },
      { id: "openai/gpt-5-chat-latest", efforts: [] },
      { id: "openai/gpt-5.2-chat-latest", efforts: ["medium"] },
    ]) {
      test(`${testCase.id} returns supported reasoning efforts`, () => {
        const result = ProviderTransform.variants(cfModel(testCase.id, "2026-03-05"))
        expect(Object.keys(result)).toEqual(testCase.efforts)
      })
    }

    test("openai gpt-4o (no reasoning) returns empty", () => {
      const model = cfModel("openai/gpt-4o")
      model.capabilities.reasoning = false
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("non-openai upstream falls back to widely-supported OAI efforts", () => {
      const result = ProviderTransform.variants(cfModel("anthropic/claude-sonnet-4-6"))
      expect(result).toEqual({
        low: { reasoningEffort: "low" },
        medium: { reasoningEffort: "medium" },
        high: { reasoningEffort: "high" },
      })
    })
  })
})

describe("ProviderTransform.smallOptions - gpt-5 chat/search", () => {
  const createModel = (apiId: string) => {
    const model = {
      id: `openai/${apiId}`,
      providerID: "openai",
      api: {
        id: apiId,
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
      capabilities: { reasoning: true },
      limit: { output: 64_000 },
      release_date: "2026-01-01",
    } as any
    model.variants = ProviderTransform.variants(model)
    return model
  }

  for (const testCase of [
    { id: "gpt-5-chat-latest", options: { store: false } },
    {
      id: "gpt-5.1-chat-latest",
      options: {
        store: false,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
    {
      id: "gpt-5.2-chat-latest",
      options: {
        store: false,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
    {
      id: "gpt-5-search-api",
      options: {
        store: false,
        reasoningEffort: "none",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
  ]) {
    test(`${testCase.id} returns only supported small options`, () => {
      expect(ProviderTransform.smallOptions(createModel(testCase.id))).toEqual(testCase.options)
    })
  }
})

describe("ProviderTransform.smallOptions - google thinking controls", () => {
  const createGoogleModel = (apiId: string) => {
    const model = {
      id: `google/${apiId}`,
      providerID: "google",
      api: {
        id: apiId,
        url: "https://generativelanguage.googleapis.com",
        npm: "@ai-sdk/google",
      },
      capabilities: { reasoning: true },
      limit: { output: 64_000 },
    } as any
    model.variants = ProviderTransform.variants(model)
    return model
  }

  for (const testCase of [
    { id: "gemini-3-pro-preview", options: { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } } },
    { id: "gemini-3-flash-preview", options: { thinkingConfig: { includeThoughts: true, thinkingLevel: "minimal" } } },
    {
      id: "gemini-3.1-flash-image-preview",
      options: { thinkingConfig: { includeThoughts: true, thinkingLevel: "minimal" } },
    },
    { id: "gemini-3-pro-image-preview", options: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } } },
    { id: "gemini-2.5-pro", options: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } } },
    { id: "gemini-2.5-flash", options: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } } },
  ]) {
    test(`${testCase.id} returns supported small thinking options`, () => {
      expect(ProviderTransform.smallOptions(createGoogleModel(testCase.id))).toEqual(testCase.options)
    })
  }

  test("uses the first configured variant when available", () => {
    expect(
      ProviderTransform.smallOptions({
        ...createGoogleModel("gemini-2.5-pro"),
        variants: {
          high: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } },
          max: { thinkingConfig: { includeThoughts: true, thinkingBudget: 32768 } },
        },
      }),
    ).toEqual({ thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } })
  })

  test("does not synthesize thinking options when variants are empty", () => {
    expect(ProviderTransform.smallOptions({ ...createGoogleModel("gemini-2.5-pro"), variants: {} })).toEqual({})
  })
})

describe("ProviderTransform.providerOptions - ai-gateway-provider", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "cloudflare-ai-gateway/openai/gpt-5.4",
      providerID: "cloudflare-ai-gateway",
      api: {
        id: "openai/gpt-5.4",
        url: "https://gateway.ai.cloudflare.com/v1/compat",
        npm: "ai-gateway-provider",
      },
      capabilities: {
        temperature: false,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
      limit: { context: 1_000_000, output: 128_000 },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-03-05",
      ...overrides,
    }) as any

  test("routes options under openaiCompatible (the key @ai-sdk/openai-compatible reads)", () => {
    // Regression: previously fell back to providerID="cloudflare-ai-gateway",
    // which @ai-sdk/openai-compatible never reads, silently dropping reasoningEffort.
    const result = ProviderTransform.providerOptions(createModel(), { reasoningEffort: "high" })
    expect(result).toEqual({ openaiCompatible: { reasoningEffort: "high" } })
  })
})

// ─── sanitizeSurrogates ───────────────────────────────────────────────────────

describe("ProviderTransform.sanitizeSurrogates", () => {
  test("replaces lone high surrogate with replacement character", () => {
    expect(ProviderTransform.sanitizeSurrogates("\uD83D")).toBe("\uFFFD")
  })

  test("replaces lone low surrogate with replacement character", () => {
    expect(ProviderTransform.sanitizeSurrogates("\uDC00")).toBe("\uFFFD")
  })

  test("preserves valid surrogate pairs (emoji)", () => {
    expect(ProviderTransform.sanitizeSurrogates("🚀")).toBe("🚀")
  })

  test("replaces lone high surrogate in mixed string", () => {
    expect(ProviderTransform.sanitizeSurrogates("hello\uD83Dworld")).toBe("hello\uFFFDworld")
  })

  test("replaces lone low surrogate in mixed string", () => {
    expect(ProviderTransform.sanitizeSurrogates("abc\uDC00def")).toBe("abc\uFFFDdef")
  })

  test("preserves empty string", () => {
    expect(ProviderTransform.sanitizeSurrogates("")).toBe("")
  })

  test("preserves ASCII-only string", () => {
    expect(ProviderTransform.sanitizeSurrogates("hello world")).toBe("hello world")
  })

  test("handles two lone high surrogates", () => {
    // \uD800 and \uD801 are both lone high surrogates (no matching low surrogate follows)
    expect(ProviderTransform.sanitizeSurrogates("\uD800\uD801")).toBe("\uFFFD\uFFFD")
  })

  test("preserves valid pair adjacent to lone surrogate", () => {
    // \uD800 is lone high, \uD83D\uDE00 is valid pair (😀)
    expect(ProviderTransform.sanitizeSurrogates("\uD800\uD83D\uDE00")).toBe("\uFFFD😀")
  })
})

// ─── temperature ───────────────────────────────────────────────────────────────

describe("ProviderTransform.temperature", () => {
  const createModel = (id: string) => ({ id } as any)

  test("returns 0.55 for qwen models", () => {
    expect(ProviderTransform.temperature(createModel("qwen-plus"))).toBe(0.55)
  })

  test("returns undefined for claude models", () => {
    expect(ProviderTransform.temperature(createModel("claude-3-5-sonnet"))).toBeUndefined()
  })

  test("returns 1.0 for gemini models", () => {
    expect(ProviderTransform.temperature(createModel("gemini-2.5-pro"))).toBe(1.0)
  })

  test("returns 1.0 for glm-4.6 models", () => {
    expect(ProviderTransform.temperature(createModel("glm-4.6"))).toBe(1.0)
  })

  test("returns 1.0 for glm-4.7 models", () => {
    expect(ProviderTransform.temperature(createModel("glm-4.7"))).toBe(1.0)
  })

  test("returns 1.0 for minimax-m2 models", () => {
    expect(ProviderTransform.temperature(createModel("minimax-m2"))).toBe(1.0)
  })

  test("returns 1.0 for kimi-k2 thinking models", () => {
    expect(ProviderTransform.temperature(createModel("kimi-k2-thinking"))).toBe(1.0)
  })

  test("returns 1.0 for kimi-k2.5 models", () => {
    expect(ProviderTransform.temperature(createModel("kimi-k2.5"))).toBe(1.0)
  })

  test("returns 1.0 for kimi-k2p5 models", () => {
    expect(ProviderTransform.temperature(createModel("kimi-k2p5"))).toBe(1.0)
  })

  test("returns 1.0 for kimi-k2-5 models", () => {
    expect(ProviderTransform.temperature(createModel("kimi-k2-5"))).toBe(1.0)
  })

  test("returns 0.6 for kimi-k2 base models", () => {
    expect(ProviderTransform.temperature(createModel("kimi-k2"))).toBe(0.6)
  })

  test("returns undefined for unknown models", () => {
    expect(ProviderTransform.temperature(createModel("gpt-4"))).toBeUndefined()
  })
})

// ─── topP ──────────────────────────────────────────────────────────────────────

describe("ProviderTransform.topP", () => {
  const createModel = (id: string) => ({ id } as any)

  test("returns 1 for qwen models", () => {
    expect(ProviderTransform.topP(createModel("qwen-plus"))).toBe(1)
  })

  test("returns 0.95 for minimax-m2 models", () => {
    expect(ProviderTransform.topP(createModel("minimax-m2"))).toBe(0.95)
  })

  test("returns 0.95 for gemini models", () => {
    expect(ProviderTransform.topP(createModel("gemini-2.5-pro"))).toBe(0.95)
  })

  test("returns 0.95 for kimi-k2.5 models", () => {
    expect(ProviderTransform.topP(createModel("kimi-k2.5"))).toBe(0.95)
  })

  test("returns 0.95 for kimi-k2p5 models", () => {
    expect(ProviderTransform.topP(createModel("kimi-k2p5"))).toBe(0.95)
  })

  test("returns 0.95 for kimi-k2-5 models", () => {
    expect(ProviderTransform.topP(createModel("kimi-k2-5"))).toBe(0.95)
  })

  test("returns undefined for unknown models", () => {
    expect(ProviderTransform.topP(createModel("gpt-4"))).toBeUndefined()
  })
})

// ─── topK ──────────────────────────────────────────────────────────────────────

describe("ProviderTransform.topK", () => {
  const createModel = (id: string) => ({ id } as any)

  test("returns 40 for minimax-m2.5 models", () => {
    expect(ProviderTransform.topK(createModel("minimax-m2.5"))).toBe(40)
  })

  test("returns 40 for minimax-m25 models", () => {
    expect(ProviderTransform.topK(createModel("minimax-m25"))).toBe(40)
  })

  test("returns 40 for minimax-m21 models", () => {
    expect(ProviderTransform.topK(createModel("minimax-m21"))).toBe(40)
  })

  test("returns 20 for minimax-m2 base models", () => {
    expect(ProviderTransform.topK(createModel("minimax-m2"))).toBe(20)
  })

  test("returns 64 for gemini models", () => {
    expect(ProviderTransform.topK(createModel("gemini-2.5-pro"))).toBe(64)
  })

  test("returns undefined for unknown models", () => {
    expect(ProviderTransform.topK(createModel("gpt-4"))).toBeUndefined()
  })
})

// ─── maxOutputTokens ───────────────────────────────────────────────────────────

describe("ProviderTransform.maxOutputTokens", () => {
  test("returns model limit output when less than OUTPUT_TOKEN_MAX", () => {
    const model = { limit: { output: 4096 } } as any
    expect(ProviderTransform.maxOutputTokens(model)).toBe(4096)
  })

  test("returns OUTPUT_TOKEN_MAX when model limit output exceeds it", () => {
    const model = { limit: { output: 100_000 } } as any
    expect(ProviderTransform.maxOutputTokens(model)).toBe(32_000)
  })

  test("returns OUTPUT_TOKEN_MAX when model limit output is 0", () => {
    const model = { limit: { output: 0 } } as any
    expect(ProviderTransform.maxOutputTokens(model)).toBe(32_000)
  })

  test("allows custom outputTokenMax override", () => {
    const model = { limit: { output: 4096 } } as any
    expect(ProviderTransform.maxOutputTokens(model, 2048)).toBe(2048)
  })

  test("returns model limit when custom max is larger than model output", () => {
    const model = { limit: { output: 4096 } } as any
    expect(ProviderTransform.maxOutputTokens(model, 100_000)).toBe(4096)
  })
})

// ─── unsupported modality parts ────────────────────────────────────────────────

describe("ProviderTransform.message - unsupported modality replacement", () => {
  const createModel = (inputCapabilities: Record<string, boolean>) =>
    ({
      id: "test/test-model",
      providerID: "test",
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false, ...inputCapabilities },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
      limit: { context: 128000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("replaces unsupported image with error text", () => {
    const model = createModel({ image: false })
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this" },
          { type: "image", image: "data:image/png;base64,abc" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})
    expect(result[0].content[1]).toEqual({
      type: "text",
      text: "ERROR: Cannot read image (this model does not support image input). Inform the user.",
    })
  })

  test("replaces unsupported PDF file with error text including filename", () => {
    const model = createModel({ pdf: false })
    const msgs = [
      {
        role: "user",
        content: [
          { type: "file", mediaType: "application/pdf", filename: "report.pdf", data: "base64data" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})
    expect(result[0].content[0]).toEqual({
      type: "text",
      text: 'ERROR: Cannot read "report.pdf" (this model does not support pdf input). Inform the user.',
    })
  })

  test("replaces unsupported audio with error text", () => {
    const model = createModel({ audio: false })
    const msgs = [
      {
        role: "user",
        content: [
          { type: "file", mediaType: "audio/mp3", filename: "song.mp3", data: "base64data" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})
    expect(result[0].content[0]).toEqual({
      type: "text",
      text: 'ERROR: Cannot read "song.mp3" (this model does not support audio input). Inform the user.',
    })
  })

  test("replaces unsupported video with error text", () => {
    const model = createModel({ video: false })
    const msgs = [
      {
        role: "user",
        content: [
          { type: "file", mediaType: "video/mp4", filename: "clip.mp4", data: "base64data" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})
    expect(result[0].content[0]).toEqual({
      type: "text",
      text: 'ERROR: Cannot read "clip.mp4" (this model does not support video input). Inform the user.',
    })
  })

  test("keeps supported image unchanged", () => {
    const model = createModel({ image: true })
    const msgs = [
      {
        role: "user",
        content: [
          { type: "image", image: "data:image/png;base64,abc" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})
    expect(result[0].content[0]).toEqual({ type: "image", image: "data:image/png;base64,abc" })
  })

  test("keeps supported PDF file unchanged", () => {
    const model = createModel({ pdf: true })
    const msgs = [
      {
        role: "user",
        content: [
          { type: "file", mediaType: "application/pdf", filename: "report.pdf", data: "base64data" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})
    expect(result[0].content[0]).toEqual({
      type: "file",
      mediaType: "application/pdf",
      filename: "report.pdf",
      data: "base64data",
    })
  })

  test("does not modify non-user messages", () => {
    const model = createModel({ image: false })
    const msgs = [
      { role: "assistant", content: "Response" },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})
    expect(result[0].content).toBe("Response")
  })

  test("replaces unsupported image without filename using modality name", () => {
    const model = createModel({ image: false })
    const msgs = [
      {
        role: "user",
        content: [
          { type: "image", image: "data:image/png;base64,abc" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})
    expect(result[0].content[0]).toEqual({
      type: "text",
      text: "ERROR: Cannot read image (this model does not support image input). Inform the user.",
    })
  })
})

// ─── mistral tool call ID scrubbing ────────────────────────────────────────────

describe("ProviderTransform.message - mistral tool call ID scrubbing", () => {
  const mistralModel = {
    id: "mistral/mistral-small-latest",
    providerID: "mistral",
    api: {
      id: "mistral-small-latest",
      url: "https://api.mistral.com",
      npm: "@ai-sdk/mistral",
    },
    name: "Mistral Small",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("scrubs tool call IDs to alphanumeric max 9 chars padded with zeros", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call_abc-123!def", toolName: "bash", input: { command: "ls" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mistralModel, {})
    // "call_abc-123!def" → remove non-alphanumeric → "callabc123def" → first 9 chars → "callabc12" → pad to 9 → "callabc120"
    // Wait, let me re-check: remove non-alphanumeric = "callabc123def", first 9 = "callabc12", padEnd(9, "0") = "callabc120"
    // Actually: "callabc123def" has 13 chars, first 9 = "callabc12" (8 chars), padEnd(9, "0") = "callabc120"
    // Hmm, "callabc123def" → remove non-alphanumeric → "callabc123def" → substring(0,9) → "callabc12" (9 chars) → padEnd(9, "0") → "callabc12"
    // Wait: "call_abc-123!def" → replace non-alphanumeric → "callabc123def" → substring(0,9) → "callabc123" (9 chars) → padEnd(9, "0") → "callabc123"
    // Let me just check what the actual result is
    expect(result[0].content[0]).toMatchObject({ toolCallId: "callabc12" })
  })

  test("pads short tool call IDs with zeros", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "ab", toolName: "bash", input: { command: "ls" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mistralModel, {})
    expect(result[0].content[0]).toMatchObject({ toolCallId: "ab0000000" })
  })

  test("scrubs tool result IDs in tool messages", () => {
    const msgs = [
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call_abc-123!def", toolName: "bash", output: { type: "text", value: "ok" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mistralModel, {})
    expect(result[0].content[0]).toMatchObject({ toolCallId: "callabc12" })
  })

  test("inserts assistant message between tool and user messages", () => {
    const msgs = [
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "abc", toolName: "bash", output: { type: "text", value: "ok" } },
        ],
      },
      { role: "user", content: "Next question" },
    ] as any[]

    const result = ProviderTransform.message(msgs, mistralModel, {})
    // tool + inserted assistant + user = 3 messages
    expect(result).toHaveLength(3)
    expect(result[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "Done." }],
    })
  })

  test("does not insert assistant when tool is not followed by user", () => {
    const msgs = [
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "abc", toolName: "bash", output: { type: "text", value: "ok" } },
        ],
      },
      { role: "assistant", content: "Response" },
    ] as any[]

    const result = ProviderTransform.message(msgs, mistralModel, {})
    expect(result).toHaveLength(2)
  })

  test("scrubs IDs for devstral models too", () => {
    const devstralModel = {
      ...mistralModel,
      api: { id: "devstral-small-latest", npm: "@ai-sdk/openai-compatible" },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call_abc-123!def", toolName: "bash", input: { command: "ls" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, devstralModel, {})
    expect(result[0].content[0]).toMatchObject({ toolCallId: "callabc12" })
  })
})

// ─── claude tool call ID scrubbing ─────────────────────────────────────────────

describe("ProviderTransform.message - claude tool call ID scrubbing", () => {
  const claudeModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.003, output: 0.015, cache: { read: 0.0003, write: 0.00375 } },
    limit: { context: 200000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("scrubs tool call IDs to alphanumeric + underscore + hyphen only", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call.abc@123#def", toolName: "bash", input: { command: "ls" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, claudeModel, {})
    expect(result[0].content[0]).toMatchObject({ toolCallId: "call_abc_123_def" })
  })

  test("scrubs tool result IDs in tool messages for claude", () => {
    const msgs = [
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call.abc@123", toolName: "bash", output: { type: "text", value: "ok" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, claudeModel, {})
    expect(result[0].content[0]).toMatchObject({ toolCallId: "call_abc_123" })
  })

  test("does not scrub IDs for non-claude models", () => {
    const openaiModel = {
      ...claudeModel,
      providerID: "openai",
      api: { id: "gpt-4", npm: "@ai-sdk/openai" },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call.abc@123", toolName: "bash", input: { command: "ls" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, {})
    expect(result[0].content[0]).toMatchObject({ toolCallId: "call.abc@123" })
  })
})

// ─── deepseek reasoning requirement ────────────────────────────────────────────

describe("ProviderTransform.message - deepseek reasoning requirement", () => {
  const deepseekModel = {
    id: "deepseek/deepseek-chat",
    providerID: "deepseek",
    api: {
      id: "deepseek-chat",
      url: "https://api.deepseek.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "DeepSeek Chat",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("adds empty reasoning part to assistant messages without reasoning", () => {
    const msgs = [
      { role: "assistant", content: "Hello" },
    ] as any[]

    const result = ProviderTransform.message(msgs, deepseekModel, {})
    expect(result[0].content).toEqual([
      { type: "text", text: "Hello" },
      { type: "reasoning", text: "" },
    ])
  })

  test("adds empty reasoning part to assistant array content without reasoning", () => {
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, deepseekModel, {})
    expect(result[0].content).toEqual([
      { type: "text", text: "Hello" },
      { type: "reasoning", text: "" },
    ])
  })

  test("does not add reasoning when already present", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Thinking..." },
          { type: "text", text: "Hello" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, deepseekModel, {})
    expect(result[0].content).toEqual([
      { type: "reasoning", text: "Thinking..." },
      { type: "text", text: "Hello" },
    ])
  })

  test("does not modify non-assistant messages", () => {
    const msgs = [
      { role: "user", content: "Question" },
    ] as any[]

    const result = ProviderTransform.message(msgs, deepseekModel, {})
    expect(result[0].content).toBe("Question")
  })
})

// ─── anthropic reasoning with signature/redactedData ───────────────────────────

describe("ProviderTransform.message - anthropic reasoning signature preservation", () => {
  const anthropicModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.003, output: 0.015, cache: { read: 0.0003, write: 0.00375 } },
    limit: { context: 200000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("keeps reasoning part with empty text but signature in providerOptions", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "",
            providerOptions: {
              anthropic: { signature: "sig_value" },
            },
          },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})
    // Empty text reasoning would normally be filtered, but signature preserves it
    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({
      type: "reasoning",
      text: "",
      providerOptions: { anthropic: { signature: "sig_value" } },
    })
  })

  test("keeps reasoning part with empty text but redactedData in providerOptions", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "",
            providerOptions: {
              anthropic: { redactedData: "redacted_value" },
            },
          },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})
    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({
      type: "reasoning",
      text: "",
      providerOptions: { anthropic: { redactedData: "redacted_value" } },
    })
  })

  test("filters reasoning with empty text and no signature/redactedData", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Answer" })
  })
})

// ─── options - additional provider-specific ────────────────────────────────────

describe("ProviderTransform.options - anthropic toolStreaming", () => {
  test("sets toolStreaming=false for anthropic non-claude models", () => {
    const model = {
      id: "anthropic/other-model",
      providerID: "anthropic",
      api: { id: "other-model", npm: "@ai-sdk/anthropic" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.toolStreaming).toBe(false)
  })

  test("sets toolStreaming=false for google-vertex/anthropic", () => {
    const model = {
      id: "google-vertex-anthropic/claude-sonnet-4",
      providerID: "google-vertex-anthropic",
      api: { id: "claude-sonnet-4", npm: "@ai-sdk/google-vertex/anthropic" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.toolStreaming).toBe(false)
  })

  test("does not set toolStreaming for claude models on anthropic npm", () => {
    const model = {
      id: "anthropic/claude-3-5-sonnet",
      providerID: "anthropic",
      api: { id: "claude-3-5-sonnet", npm: "@ai-sdk/anthropic" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.toolStreaming).toBeUndefined()
  })
})

describe("ProviderTransform.options - baseten/opencode chat_template_args", () => {
  test("sets chat_template_args for baseten provider", () => {
    const model = {
      id: "baseten/test-model",
      providerID: "baseten",
      api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.chat_template_args).toEqual({ enable_thinking: true })
  })

  test("sets chat_template_args for opencode kimi-k2-thinking", () => {
    const model = {
      id: "opencode/kimi-k2-thinking",
      providerID: "opencode",
      api: { id: "kimi-k2-thinking", npm: "@ai-sdk/openai-compatible" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.chat_template_args).toEqual({ enable_thinking: true })
  })

  test("sets chat_template_args for opencode glm-4.6", () => {
    const model = {
      id: "opencode/glm-4.6",
      providerID: "opencode",
      api: { id: "glm-4.6", npm: "@ai-sdk/openai-compatible" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.chat_template_args).toEqual({ enable_thinking: true })
  })

  test("does not set chat_template_args for other opencode models", () => {
    const model = {
      id: "opencode/other-model",
      providerID: "opencode",
      api: { id: "other-model", npm: "@ai-sdk/openai-compatible" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.chat_template_args).toBeUndefined()
  })
})

describe("ProviderTransform.options - alibaba-cn enable_thinking", () => {
  test("sets enable_thinking for alibaba-cn reasoning models on openai-compatible", () => {
    const model = {
      id: "alibaba-cn/qwen3",
      providerID: "alibaba-cn",
      api: { id: "qwen3", npm: "@ai-sdk/openai-compatible" },
      capabilities: { reasoning: true },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.enable_thinking).toBe(true)
  })

  test("does not set enable_thinking for kimi-k2-thinking on alibaba-cn", () => {
    const model = {
      id: "alibaba-cn/kimi-k2-thinking",
      providerID: "alibaba-cn",
      api: { id: "kimi-k2-thinking", npm: "@ai-sdk/openai-compatible" },
      capabilities: { reasoning: true },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.enable_thinking).toBeUndefined()
  })

  test("does not set enable_thinking for non-reasoning models", () => {
    const model = {
      id: "alibaba-cn/qwen-turbo",
      providerID: "alibaba-cn",
      api: { id: "qwen-turbo", npm: "@ai-sdk/openai-compatible" },
      capabilities: { reasoning: false },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.enable_thinking).toBeUndefined()
  })
})

describe("ProviderTransform.options - venice/openrouter/llmgateway", () => {
  test("sets promptCacheKey for venice provider", () => {
    const model = {
      id: "venice/test-model",
      providerID: "venice",
      api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "session-1", providerOptions: {} })
    expect(result.promptCacheKey).toBe("session-1")
  })

  test("sets prompt_cache_key for openrouter provider", () => {
    const model = {
      id: "openrouter/test-model",
      providerID: "openrouter",
      api: { id: "test-model", npm: "@openrouter/ai-sdk-provider" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "session-1", providerOptions: {} })
    expect(result.prompt_cache_key).toBe("session-1")
  })

  test("sets usage and gemini-3 reasoning for openrouter", () => {
    const model = {
      id: "openrouter/gemini-3-pro",
      providerID: "openrouter",
      api: { id: "gemini-3-pro", npm: "@openrouter/ai-sdk-provider" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "session-1", providerOptions: {} })
    expect(result.usage).toEqual({ include: true })
    expect(result.reasoning).toEqual({ effort: "high" })
  })

  test("sets usage for llmgateway provider", () => {
    const model = {
      id: "llmgateway/test-model",
      providerID: "llmgateway",
      api: { id: "test-model", npm: "@llmgateway/ai-sdk-provider" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "session-1", providerOptions: {} })
    expect(result.usage).toEqual({ include: true })
  })

  test("sets gateway caching for @ai-sdk/gateway", () => {
    const model = {
      id: "vercel/test-model",
      providerID: "vercel",
      api: { id: "test-model", npm: "@ai-sdk/gateway" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "session-1", providerOptions: {} })
    expect(result.gateway).toEqual({ caching: "auto" })
  })
})

describe("ProviderTransform.options - azure gpt-5.5 reasoningSummary", () => {
  test("sets reasoningSummary for azure gpt-5.5 models", () => {
    const model = {
      id: "azure/gpt-5.5",
      providerID: "azure",
      api: { id: "gpt-5.5", npm: "@ai-sdk/azure" },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.reasoningSummary).toBe("auto")
  })
})

describe("ProviderTransform.options - kimi anthropic thinking", () => {
  test("sets thinking for kimi-k2.5 on anthropic npm", () => {
    const model = {
      id: "anthropic/kimi-k2.5",
      providerID: "opencode",
      api: { id: "kimi-k2.5", npm: "@ai-sdk/anthropic" },
      capabilities: { reasoning: true },
      limit: { output: 32000 },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.thinking).toEqual({
      type: "enabled",
      budgetTokens: Math.min(16_000, Math.floor(32000 / 2 - 1)),
    })
  })

  test("sets thinking for kimi-k2p on google-vertex/anthropic npm", () => {
    const model = {
      id: "google-vertex-anthropic/kimi-k2p",
      providerID: "google-vertex-anthropic",
      api: { id: "kimi-k2p", npm: "@ai-sdk/google-vertex/anthropic" },
      capabilities: { reasoning: true },
      limit: { output: 32000 },
    } as any
    const result = ProviderTransform.options({ model, sessionID: "test", providerOptions: {} })
    expect(result.thinking).toBeDefined()
    expect(result.thinking.type).toBe("enabled")
  })
})

// ─── smallOptions - additional coverage ────────────────────────────────────────

describe("ProviderTransform.smallOptions - openrouter/google reasoning disabled", () => {
  test("returns reasoning disabled for openrouter google models without variants", () => {
    const model = {
      id: "openrouter/google/gemini-2.0-flash",
      providerID: "openrouter",
      api: { id: "google/gemini-2.0-flash", npm: "@openrouter/ai-sdk-provider" },
      variants: {},
    } as any
    const result = ProviderTransform.smallOptions(model)
    expect(result).toEqual({ reasoning: { enabled: false } })
  })

  test("returns first variant for openrouter google models with variants", () => {
    const model = {
      id: "openrouter/google/gemini-2.5-pro",
      providerID: "openrouter",
      api: { id: "google/gemini-2.5-pro", npm: "@openrouter/ai-sdk-provider" },
      variants: {
        high: { thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } },
      },
    } as any
    const result = ProviderTransform.smallOptions(model)
    expect(result).toEqual({ thinkingConfig: { includeThoughts: true, thinkingBudget: 16000 } })
  })
})

describe("ProviderTransform.smallOptions - venice disableThinking", () => {
  test("returns disableThinking when no variants", () => {
    const model = {
      id: "venice/test-model",
      providerID: "venice",
      api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
      variants: {},
    } as any
    const result = ProviderTransform.smallOptions(model)
    expect(result).toEqual({ veniceParameters: { disableThinking: true } })
  })

  test("returns first variant when variants exist", () => {
    const model = {
      id: "venice/test-model",
      providerID: "venice",
      api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
      variants: {
        low: { reasoningEffort: "low" },
      },
    } as any
    const result = ProviderTransform.smallOptions(model)
    expect(result).toEqual({ reasoningEffort: "low" })
  })
})

// ─── schema - gemini integer enum conversion ───────────────────────────────────

describe("ProviderTransform.schema - gemini integer enum to string", () => {
  const geminiModel = {
    providerID: "google",
    api: { id: "gemini-3-pro" },
  } as any

  test("converts integer enum values to strings", () => {
    const schema = {
      type: "object",
      properties: {
        priority: {
          type: "integer",
          enum: [1, 2, 3],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any
    expect(result.properties.priority.type).toBe("string")
    expect(result.properties.priority.enum).toEqual(["1", "2", "3"])
  })

  test("converts number enum values to strings", () => {
    const schema = {
      type: "object",
      properties: {
        level: {
          type: "number",
          enum: [0.5, 1.0, 2.5],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any
    expect(result.properties.level.type).toBe("string")
    expect(result.properties.level.enum).toEqual(["0.5", "1", "2.5"])
  })

  test("preserves string enums unchanged", () => {
    const schema = {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "inactive"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any
    expect(result.properties.status.type).toBe("string")
    expect(result.properties.status.enum).toEqual(["active", "inactive"])
  })
})

describe("ProviderTransform.schema - gemini required filtering", () => {
  const geminiModel = {
    providerID: "google",
    api: { id: "gemini-3-pro" },
  } as any

  test("filters required array to only include fields in properties", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name", "missing_field"],
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any
    expect(result.required).toEqual(["name"])
  })
})

// ─── message - empty messages array ────────────────────────────────────────────

describe("ProviderTransform.message - empty messages array", () => {
  const model = {
    id: "test/test-model",
    providerID: "test",
    api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("handles empty messages array", () => {
    const result = ProviderTransform.message([], model, {})
    expect(result).toEqual([])
  })
})

// ─── message - system message preservation ─────────────────────────────────────

describe("ProviderTransform.message - system message preservation", () => {
  const model = {
    id: "test/test-model",
    providerID: "test",
    api: { id: "test-model", npm: "@ai-sdk/openai-compatible" },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("preserves system messages", () => {
    const msgs = [
      { role: "system", content: "You are a helpful assistant" },
      { role: "user", content: "Hello" },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})
    expect(result[0].role).toBe("system")
    expect(result[0].content).toBe("You are a helpful assistant")
  })

  test("sanitizes surrogates in system messages", () => {
    const msgs = [
      { role: "system", content: "Rule: \uD83D" },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})
    expect(result[0].content).toBe("Rule: \uFFFD")
  })
})

describe("ProviderTransform.sanitizeSurrogates", () => {
  test("replaces lone high surrogate with replacement character", () => {
    expect(ProviderTransform.sanitizeSurrogates("\uD83D")).toBe("\uFFFD")
  })

  test("replaces lone low surrogate with replacement character", () => {
    expect(ProviderTransform.sanitizeSurrogates("\uDE00")).toBe("\uFFFD")
  })

  test("preserves valid surrogate pairs (emoji)", () => {
    expect(ProviderTransform.sanitizeSurrogates("🚀")).toBe("🚀")
    expect(ProviderTransform.sanitizeSurrogates("😀")).toBe("😀")
    expect(ProviderTransform.sanitizeSurrogates("🎉")).toBe("🎉")
  })

  test("preserves regular ASCII text", () => {
    expect(ProviderTransform.sanitizeSurrogates("Hello, world!")).toBe("Hello, world!")
  })

  test("handles empty string", () => {
    expect(ProviderTransform.sanitizeSurrogates("")).toBe("")
  })

  test("replaces multiple lone surrogates in a string", () => {
    const input = "a\uD83Db\uDE00c\uD800d"
    const result = ProviderTransform.sanitizeSurrogates(input)
    expect(result).toBe("a\uFFFDb\uFFFDc\uFFFDd")
  })

  test("preserves valid emoji mixed with lone surrogates", () => {
    const input = "🚀\uD83Dhello😀\uDE00"
    const result = ProviderTransform.sanitizeSurrogates(input)
    expect(result).toBe("🚀\uFFFDhello😀\uFFFD")
  })

  test("preserves CJK characters", () => {
    expect(ProviderTransform.sanitizeSurrogates("你好世界")).toBe("你好世界")
  })

  test("preserves multi-byte characters mixed with emoji", () => {
    expect(ProviderTransform.sanitizeSurrogates("café 🚀 naïve")).toBe("café 🚀 naïve")
  })
})

describe("ProviderTransform.OUTPUT_TOKEN_MAX", () => {
  test("is 32000", () => {
    expect(ProviderTransform.OUTPUT_TOKEN_MAX).toBe(32_000)
  })
})

describe("ProviderTransform.temperature", () => {
  const createModel = (id: string) =>
    ({
      id,
      providerID: "test",
      api: { id, url: "", npm: "" },
      name: id,
      capabilities: {},
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 0, output: 0 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("returns 0.55 for qwen models", () => {
    expect(ProviderTransform.temperature(createModel("qwen-plus"))).toBe(0.55)
    expect(ProviderTransform.temperature(createModel("qwen-max"))).toBe(0.55)
    expect(ProviderTransform.temperature(createModel("QWEN-turbo"))).toBe(0.55)
  })

  test("returns undefined for claude models", () => {
    expect(ProviderTransform.temperature(createModel("claude-3-5-sonnet"))).toBeUndefined()
    expect(ProviderTransform.temperature(createModel("anthropic/claude-opus"))).toBeUndefined()
  })

  test("returns 1.0 for gemini models", () => {
    expect(ProviderTransform.temperature(createModel("gemini-2.5-pro"))).toBe(1.0)
    expect(ProviderTransform.temperature(createModel("gemini-3-flash"))).toBe(1.0)
  })

  test("returns 1.0 for glm-4.6 and glm-4.7", () => {
    expect(ProviderTransform.temperature(createModel("glm-4.6"))).toBe(1.0)
    expect(ProviderTransform.temperature(createModel("glm-4.7"))).toBe(1.0)
  })

  test("returns 1.0 for minimax-m2", () => {
    expect(ProviderTransform.temperature(createModel("minimax-m2"))).toBe(1.0)
  })

  test("returns 1.0 for kimi-k2 thinking variants", () => {
    expect(ProviderTransform.temperature(createModel("kimi-k2-thinking"))).toBe(1.0)
    expect(ProviderTransform.temperature(createModel("kimi-k2.5"))).toBe(1.0)
    expect(ProviderTransform.temperature(createModel("kimi-k2p5"))).toBe(1.0)
    expect(ProviderTransform.temperature(createModel("kimi-k2-5"))).toBe(1.0)
  })

  test("returns 0.6 for kimi-k2 base", () => {
    expect(ProviderTransform.temperature(createModel("kimi-k2"))).toBe(0.6)
    expect(ProviderTransform.temperature(createModel("kimi-k2-base"))).toBe(0.6)
  })

  test("returns undefined for unknown models", () => {
    expect(ProviderTransform.temperature(createModel("gpt-4"))).toBeUndefined()
    expect(ProviderTransform.temperature(createModel("llama-3"))).toBeUndefined()
  })
})

describe("ProviderTransform.topP", () => {
  const createModel = (id: string) =>
    ({
      id,
      providerID: "test",
      api: { id, url: "", npm: "" },
      name: id,
      capabilities: {},
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 0, output: 0 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("returns 1 for qwen models", () => {
    expect(ProviderTransform.topP(createModel("qwen-plus"))).toBe(1)
  })

  test("returns 0.95 for minimax-m2", () => {
    expect(ProviderTransform.topP(createModel("minimax-m2"))).toBe(0.95)
  })

  test("returns 0.95 for gemini models", () => {
    expect(ProviderTransform.topP(createModel("gemini-2.5-pro"))).toBe(0.95)
  })

  test("returns 0.95 for kimi-k2.5/k2p5/k2-5", () => {
    expect(ProviderTransform.topP(createModel("kimi-k2.5"))).toBe(0.95)
    expect(ProviderTransform.topP(createModel("kimi-k2p5"))).toBe(0.95)
    expect(ProviderTransform.topP(createModel("kimi-k2-5"))).toBe(0.95)
  })

  test("returns undefined for unknown models", () => {
    expect(ProviderTransform.topP(createModel("gpt-4"))).toBeUndefined()
    expect(ProviderTransform.topP(createModel("claude-3"))).toBeUndefined()
  })
})

describe("ProviderTransform.topK", () => {
  const createModel = (id: string) =>
    ({
      id,
      providerID: "test",
      api: { id, url: "", npm: "" },
      name: id,
      capabilities: {},
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 0, output: 0 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("returns 20 for minimax-m2 base", () => {
    expect(ProviderTransform.topK(createModel("minimax-m2"))).toBe(20)
  })

  test("returns 40 for minimax-m2 versioned variants", () => {
    expect(ProviderTransform.topK(createModel("minimax-m2.5"))).toBe(40)
    expect(ProviderTransform.topK(createModel("minimax-m25"))).toBe(40)
    expect(ProviderTransform.topK(createModel("minimax-m21"))).toBe(40)
  })

  test("returns 64 for gemini models", () => {
    expect(ProviderTransform.topK(createModel("gemini-2.5-pro"))).toBe(64)
    expect(ProviderTransform.topK(createModel("gemini-3-flash"))).toBe(64)
  })

  test("returns undefined for unknown models", () => {
    expect(ProviderTransform.topK(createModel("gpt-4"))).toBeUndefined()
    expect(ProviderTransform.topK(createModel("claude-3"))).toBeUndefined()
  })
})

describe("ProviderTransform.maxOutputTokens", () => {
  const createModel = (outputLimit: number) =>
    ({
      id: "test/model",
      providerID: "test",
      api: { id: "model", url: "", npm: "" },
      name: "Test",
      capabilities: {},
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 128000, output: outputLimit },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("returns model limit when below OUTPUT_TOKEN_MAX", () => {
    expect(ProviderTransform.maxOutputTokens(createModel(8192))).toBe(8192)
    expect(ProviderTransform.maxOutputTokens(createModel(16000))).toBe(16000)
  })

  test("returns OUTPUT_TOKEN_MAX when model limit exceeds it", () => {
    expect(ProviderTransform.maxOutputTokens(createModel(64000))).toBe(32_000)
    expect(ProviderTransform.maxOutputTokens(createModel(128000))).toBe(32_000)
  })

  test("returns OUTPUT_TOKEN_MAX when model limit equals it", () => {
    expect(ProviderTransform.maxOutputTokens(createModel(32_000))).toBe(32_000)
  })

  test("respects custom outputTokenMax parameter", () => {
    expect(ProviderTransform.maxOutputTokens(createModel(64000), 16000)).toBe(16000)
    expect(ProviderTransform.maxOutputTokens(createModel(8192), 16000)).toBe(8192)
  })

  test("falls back to outputTokenMax when model limit is 0", () => {
    expect(ProviderTransform.maxOutputTokens(createModel(0))).toBe(32_000)
    expect(ProviderTransform.maxOutputTokens(createModel(0), 16000)).toBe(16000)
  })
})

describe("ProviderTransform.message - claude tool ID scrubbing", () => {
  const claudeModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.003, output: 0.015, cache: { read: 0.0003, write: 0.00375 } },
    limit: { context: 200000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("scrubs non-alphanumeric characters from tool call IDs", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call_abc.123!@#", toolName: "bash", input: {} },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, claudeModel, {}) as any[]

    expect(result[0].content[0].toolCallId).toBe("call_abc_123___")
  })

  test("scrubs tool result IDs in tool messages", () => {
    const msgs = [
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call$%^test", toolName: "bash", output: { type: "text", value: "ok" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, claudeModel, {}) as any[]

    expect(result[0].content[0].toolCallId).toBe("call___test")
  })

  test("preserves valid alphanumeric and _/- characters", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "toolu_01ABC-xyz", toolName: "bash", input: {} },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, claudeModel, {}) as any[]

    expect(result[0].content[0].toolCallId).toBe("toolu_01ABC-xyz")
  })

  test("does not scrub for non-claude models", () => {
    const openaiModel = {
      ...claudeModel,
      id: "openai/gpt-4",
      providerID: "openai",
      api: { id: "gpt-4", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call_abc.123!@#", toolName: "bash", input: {} },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, {}) as any[]

    expect(result[0].content[0].toolCallId).toBe("call_abc.123!@#")
  })
})

describe("ProviderTransform.message - mistral transforms", () => {
  const mistralModel = {
    id: "mistral/mistral-large",
    providerID: "mistral",
    api: {
      id: "mistral-large-latest",
      url: "https://api.mistral.com",
      npm: "@ai-sdk/mistral",
    },
    name: "Mistral Large",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("scrubs tool call IDs to 9 alphanumeric chars padded with zeros", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call_abc!@#", toolName: "bash", input: {} },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mistralModel, {}) as any[]

    // "callabc" (7 alphanumeric chars) padded to 9 → "callabc00"
    expect(result[0].content[0].toolCallId).toBe("callabc00")
  })

  test("truncates long tool call IDs to 9 chars", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "abcdefghijklmnop", toolName: "bash", input: {} },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mistralModel, {}) as any[]

    expect(result[0].content[0].toolCallId).toBe("abcdefghi")
  })

  test("inserts assistant message between tool and user messages", () => {
    const msgs = [
      { role: "user", content: "Do something" },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call1", toolName: "bash", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call1", toolName: "bash", output: { type: "text", value: "done" } },
        ],
      },
      { role: "user", content: "Next task" },
    ] as any[]

    const result = ProviderTransform.message(msgs, mistralModel, {}) as any[]

    expect(result).toHaveLength(5)
    expect(result[3].role).toBe("assistant")
    expect(result[3].content).toEqual([{ type: "text", text: "Done." }])
    expect(result[4].role).toBe("user")
    expect(result[4].content).toBe("Next task")
  })

  test("does not insert assistant message when tool is not followed by user", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call1", toolName: "bash", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call1", toolName: "bash", output: { type: "text", value: "done" } },
        ],
      },
      {
        role: "assistant",
        content: "Result",
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mistralModel, {}) as any[]

    expect(result).toHaveLength(3)
  })

  test("also triggers for devstral model IDs", () => {
    const devstralModel = {
      ...mistralModel,
      id: "mistral/devstral-small",
      providerID: "mistral",
      api: { ...mistralModel.api, id: "devstral-small-latest" },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "call1", toolName: "bash", input: {} },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, devstralModel, {}) as any[]

    // Should have been scrubbed (mistral transform applied)
    expect(result[0].content[0].toolCallId).toHaveLength(9)
  })
})

describe("ProviderTransform.message - deepseek reasoning injection", () => {
  const deepseekModel = {
    id: "deepseek/deepseek-chat",
    providerID: "deepseek",
    api: {
      id: "deepseek-chat",
      url: "https://api.deepseek.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "DeepSeek Chat",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("adds empty reasoning part to assistant messages without reasoning", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Hello" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, deepseekModel, {}) as any[]

    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[1]).toEqual({ type: "reasoning", text: "" })
  })

  test("does not add reasoning when already present", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Thinking..." },
          { type: "text", text: "Hello" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, deepseekModel, {}) as any[]

    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "reasoning", text: "Thinking..." })
  })

  test("converts string content to array with reasoning for deepseek", () => {
    const msgs = [
      { role: "assistant", content: "Hello" },
    ] as any[]

    const result = ProviderTransform.message(msgs, deepseekModel, {}) as any[]

    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Hello" })
    expect(result[0].content[1]).toEqual({ type: "reasoning", text: "" })
  })

  test("does not inject reasoning for non-assistant messages", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      { role: "system", content: "You are helpful" },
    ] as any[]

    const result = ProviderTransform.message(msgs, deepseekModel, {}) as any[]

    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("You are helpful")
  })

  test("does not inject reasoning for non-deepseek models", () => {
    const openaiModel = {
      ...deepseekModel,
      id: "openai/gpt-4",
      providerID: "openai",
      api: { id: "gpt-4", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
    }
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, {}) as any[]

    expect(result[0].content).toHaveLength(1)
  })
})

describe("ProviderTransform.message - unsupported modality replacement", () => {
  const textOnlyModel = {
    id: "test/text-only",
    providerID: "test",
    api: {
      id: "text-only",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Text Only Model",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: false,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("replaces unsupported image with error text", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this" },
          { type: "image", image: "data:image/png;base64,abc123" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, textOnlyModel, {}) as any[]

    expect(result[0].content[1]).toEqual({
      type: "text",
      text: expect.stringContaining("this model does not support image"),
    })
  })

  test("replaces unsupported PDF file with error text", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "file", data: "base64data", mediaType: "application/pdf", filename: "doc.pdf" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, textOnlyModel, {}) as any[]

    expect(result[0].content[0]).toEqual({
      type: "text",
      text: expect.stringContaining('"doc.pdf"'),
    })
    expect(result[0].content[0].text).toContain("pdf")
  })

  test("preserves supported modalities", () => {
    const imageModel = {
      ...textOnlyModel,
      capabilities: {
        ...textOnlyModel.capabilities,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
      },
    }
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "Look at this" },
          { type: "image", image: "data:image/png;base64,abc123" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, imageModel, {}) as any[]

    expect(result[0].content[1]).toEqual({ type: "image", image: "data:image/png;base64,abc123" })
  })

  test("does not modify non-user messages", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Here is an image" },
          { type: "image", image: "data:image/png;base64,abc123" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, textOnlyModel, {}) as any[]

    // unsupportedParts only applies to user messages
    expect(result[0].content[1]).toEqual({ type: "image", image: "data:image/png;base64,abc123" })
  })
})

describe("ProviderTransform.message - empty messages array", () => {
  const model = {
    id: "test/model",
    providerID: "test",
    api: { id: "model", url: "", npm: "@ai-sdk/openai-compatible" },
    name: "Test",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("handles empty messages array", () => {
    const result = ProviderTransform.message([], model, {})
    expect(result).toEqual([])
  })

  test("handles single system message", () => {
    const msgs = [{ role: "system", content: "You are helpful" }] as any[]
    const result = ProviderTransform.message(msgs, model, {})
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe("You are helpful")
  })
})

describe("ProviderTransform.message - interleaved reasoning field", () => {
  const createInterleavedModel = (field: "reasoning_content" | "reasoning_details") =>
    ({
      id: "deepseek/deepseek-chat",
      providerID: "deepseek",
      api: {
        id: "deepseek-chat",
        url: "https://api.deepseek.com",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "DeepSeek Chat",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: { field },
      },
      cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
      limit: { context: 128000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("moves reasoning parts to providerOptions with reasoning_content field", () => {
    const model = createInterleavedModel("reasoning_content")
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me think..." },
          { type: "text", text: "The answer is 42" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].content).toEqual([{ type: "text", text: "The answer is 42" }])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("Let me think...")
  })

  test("concatenates multiple reasoning parts", () => {
    const model = createInterleavedModel("reasoning_content")
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Step 1. " },
          { type: "reasoning", text: "Step 2." },
          { type: "text", text: "Done" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("Step 1. Step 2.")
  })

  test("uses reasoning_details field when configured", () => {
    const model = createInterleavedModel("reasoning_details")
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Thinking..." },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].providerOptions?.openaiCompatible?.reasoning_details).toBe("Thinking...")
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
  })

  test("sets empty reasoning field for assistant messages without reasoning", () => {
    const model = createInterleavedModel("reasoning_content")
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Just text" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    // Always set the field even when empty for DeepSeek compatibility
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("")
  })

  test("does not apply to non-assistant messages", () => {
    const model = createInterleavedModel("reasoning_content")
    const msgs = [
      { role: "user", content: "Hello" },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].providerOptions).toBeUndefined()
  })

  test("skips openrouter provider even with interleaved capability", () => {
    const model = {
      ...createInterleavedModel("reasoning_content"),
      api: {
        id: "deepseek/deepseek-chat",
        url: "https://openrouter.ai",
        npm: "@openrouter/ai-sdk-provider",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Thinking..." },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    // OpenRouter is excluded from interleaved transform
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "reasoning", text: "Thinking..." })
  })
})

describe("ProviderTransform.message - anthropic reasoning with signature/redactedData", () => {
  const anthropicModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.003, output: 0.015, cache: { read: 0.0003, write: 0.00375 } },
    limit: { context: 200000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("keeps empty reasoning part with anthropic signature", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: { anthropic: { signature: "sig_123" } } },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {}) as any[]

    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0].type).toBe("reasoning")
  })

  test("keeps empty reasoning part with anthropic redactedData", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: { anthropic: { redactedData: "base64data" } } },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {}) as any[]

    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0].type).toBe("reasoning")
  })

  test("removes empty reasoning without signature or redactedData", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "  " },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {}) as any[]

    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Answer" })
  })
})

describe("ProviderTransform.message - bedrock reasoning with signature/redactedData", () => {
  const bedrockModel = {
    id: "amazon-bedrock/anthropic.claude-opus-4-6",
    providerID: "amazon-bedrock",
    api: {
      id: "anthropic.claude-opus-4-6",
      url: "https://bedrock-runtime.us-east-1.amazonaws.com",
      npm: "@ai-sdk/amazon-bedrock",
    },
    name: "Claude Opus 4.6",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.003, output: 0.015, cache: { read: 0.0003, write: 0.00375 } },
    limit: { context: 200000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("keeps empty reasoning part with bedrock signature", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: { bedrock: { signature: "sig_456" } } },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, bedrockModel, {}) as any[]

    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0].type).toBe("reasoning")
  })

  test("keeps empty reasoning part with bedrock redactedData", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "", providerOptions: { bedrock: { redactedData: "data" } } },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, bedrockModel, {}) as any[]

    expect(result[0].content).toHaveLength(2)
  })
})

describe("ProviderTransform.schema - gemini integer enum conversion", () => {
  const geminiModel = {
    providerID: "google",
    api: { id: "gemini-2.5-pro" },
  } as any

  test("converts integer enums to string enums", () => {
    const schema = {
      type: "object",
      properties: {
        priority: {
          type: "integer",
          enum: [1, 2, 3],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.priority.enum).toEqual(["1", "2", "3"])
    expect(result.properties.priority.type).toBe("string")
  })

  test("converts number enums to string enums", () => {
    const schema = {
      type: "object",
      properties: {
        score: {
          type: "number",
          enum: [0.5, 1.0, 1.5],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.score.enum).toEqual(["0.5", "1", "1.5"])
    expect(result.properties.score.type).toBe("string")
  })

  test("preserves string enums", () => {
    const schema = {
      type: "object",
      properties: {
        color: {
          type: "string",
          enum: ["red", "green", "blue"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.color.enum).toEqual(["red", "green", "blue"])
    expect(result.properties.color.type).toBe("string")
  })

  test("filters required to only include fields in properties", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name", "missing_field"],
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.required).toEqual(["name"])
  })
})
