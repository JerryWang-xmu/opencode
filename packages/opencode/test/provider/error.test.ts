import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { parseAPICallError, parseStreamError } from "../../src/provider/error"
import { ProviderID } from "../../src/provider/schema"

function makeApiError(opts: {
  message?: string
  statusCode?: number
  responseBody?: string
  responseHeaders?: Record<string, string>
  url?: string
  isRetryable?: boolean
}) {
  return new APICallError({
    message: opts.message ?? "",
    statusCode: opts.statusCode,
    responseBody: opts.responseBody,
    responseHeaders: opts.responseHeaders,
    url: opts.url ?? "",
    requestBodyValues: {},
    isRetryable: opts.isRetryable ?? false,
  })
}

describe("parseStreamError", () => {
  test("returns undefined for non-object input", () => {
    expect(parseStreamError(null)).toBeUndefined()
    expect(parseStreamError(undefined)).toBeUndefined()
    expect(parseStreamError(42)).toBeUndefined()
    expect(parseStreamError(true)).toBeUndefined()
  })

  test("returns undefined for string that is not valid JSON", () => {
    expect(parseStreamError("not json")).toBeUndefined()
  })

  test("returns undefined when body.type is not 'error'", () => {
    expect(parseStreamError({ type: "message", error: { code: "context_length_exceeded" } })).toBeUndefined()
  })

  test("detects context_length_exceeded", () => {
    const input = { type: "error", error: { code: "context_length_exceeded", message: "too long" } }
    const result = parseStreamError(input)
    expect(result).toBeDefined()
    expect(result!.type).toBe("context_overflow")
    if (result!.type === "context_overflow") {
      expect(result!.message).toBe("Input exceeds context window of this model")
      expect(result!.responseBody).toBe(JSON.stringify(input))
    }
  })

  test("detects insufficient_quota", () => {
    const input = { type: "error", error: { code: "insufficient_quota" } }
    const result = parseStreamError(input)
    expect(result).toBeDefined()
    expect(result!.type).toBe("api_error")
    if (result!.type === "api_error") {
      expect(result!.message).toBe("Quota exceeded. Check your plan and billing details.")
      expect(result!.isRetryable).toBe(false)
    }
  })

  test("detects usage_not_included", () => {
    const input = { type: "error", error: { code: "usage_not_included" } }
    const result = parseStreamError(input)
    expect(result).toBeDefined()
    expect(result!.type).toBe("api_error")
    if (result!.type === "api_error") {
      expect(result!.message).toContain("upgrade to Plus")
      expect(result!.isRetryable).toBe(false)
    }
  })

  test("detects invalid_prompt with message", () => {
    const input = { type: "error", error: { code: "invalid_prompt", message: "Bad prompt: xyz" } }
    const result = parseStreamError(input)
    expect(result).toBeDefined()
    expect(result!.type).toBe("api_error")
    if (result!.type === "api_error") {
      expect(result!.message).toBe("Bad prompt: xyz")
      expect(result!.isRetryable).toBe(false)
    }
  })

  test("detects invalid_prompt without message falls back to default", () => {
    const input = { type: "error", error: { code: "invalid_prompt" } }
    const result = parseStreamError(input)
    expect(result).toBeDefined()
    expect(result!.type).toBe("api_error")
    if (result!.type === "api_error") {
      expect(result!.message).toBe("Invalid prompt.")
      expect(result!.isRetryable).toBe(false)
    }
  })

  test("detects server_is_overloaded as retryable", () => {
    const input = { type: "error", error: { code: "server_is_overloaded", message: "Server busy" } }
    const result = parseStreamError(input)
    expect(result).toBeDefined()
    expect(result!.type).toBe("api_error")
    if (result!.type === "api_error") {
      expect(result!.message).toBe("Server busy")
      expect(result!.isRetryable).toBe(true)
    }
  })

  test("detects server_error as retryable", () => {
    const input = { type: "error", error: { code: "server_error" } }
    const result = parseStreamError(input)
    expect(result).toBeDefined()
    expect(result!.type).toBe("api_error")
    if (result!.type === "api_error") {
      expect(result!.message).toBe("Server error.")
      expect(result!.isRetryable).toBe(true)
    }
  })

  test("returns undefined for unknown error code", () => {
    const input = { type: "error", error: { code: "something_else" } }
    expect(parseStreamError(input)).toBeUndefined()
  })

  test("handles JSON string input", () => {
    const input = JSON.stringify({ type: "error", error: { code: "context_length_exceeded" } })
    const result = parseStreamError(input)
    expect(result).toBeDefined()
    expect(result!.type).toBe("context_overflow")
  })

  test("handles nested message JSON string", () => {
    const inner = JSON.stringify({ type: "error", error: { code: "insufficient_quota" } })
    const input = { message: inner }
    const result = parseStreamError(input)
    expect(result).toBeDefined()
    expect(result!.type).toBe("api_error")
    if (result!.type === "api_error") {
      expect(result!.message).toContain("Quota exceeded")
    }
  })
})

describe("parseAPICallError - context overflow detection", () => {
  const overflowPatterns: Array<{ name: string; message: string }> = [
    { name: "Anthropic: prompt is too long", message: "prompt is too long for this model" },
    { name: "Amazon Bedrock: input is too long", message: "Input is too long for requested model" },
    { name: "OpenAI: exceeds the context window", message: "This exceeds the context window of the model" },
    { name: "Google: input token count exceeds maximum", message: "Input token count of 50000 exceeds the maximum allowed" },
    { name: "xAI: maximum prompt length", message: "Maximum prompt length is 131072 tokens" },
    { name: "Groq: reduce the length", message: "Please reduce the length of the messages" },
    { name: "OpenRouter/DeepSeek: maximum context length", message: "Maximum context length is 8192 tokens" },
    { name: "GitHub Copilot: exceeds the limit", message: "Request exceeds the limit of 100000 tokens" },
    { name: "llama.cpp: exceeds available context size", message: "Input exceeds the available context size" },
    { name: "LM Studio: greater than context length", message: "Input is greater than the context length" },
    { name: "MiniMax: context window exceeds limit", message: "Context window exceeds limit for this model" },
    { name: "Kimi/Moonshot: exceeded model token limit", message: "Request exceeded model token limit" },
    { name: "Generic: context_length_exceeded", message: "context_length_exceeded error occurred" },
    { name: "Generic: context length exceeded (spaces)", message: "context length exceeded" },
    { name: "HTTP 413: request entity too large", message: "Request Entity Too Large" },
    { name: "vLLM: context length is only N tokens", message: "Context length is only 4096 tokens" },
    { name: "vLLM: input length exceeds context length", message: "Input length of 5000 exceeds the context length of 4096" },
    { name: "Ollama: prompt too long", message: "Prompt too long; exceeded max context length" },
    { name: "Ollama: prompt too long (without max)", message: "Prompt too long; exceeded context length" },
    { name: "Mistral: too large for model", message: "Input is too large for model with 32768 maximum context length" },
    { name: "z.ai: model_context_window_exceeded", message: "model_context_window_exceeded" },
  ]

  overflowPatterns.forEach(({ name, message }) => {
    test(`detects overflow: ${name}`, () => {
      const error = makeApiError({ message })
      const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
      expect(result.type).toBe("context_overflow")
      if (result.type === "context_overflow") {
        expect(result.message).toBe(message)
      }
    })
  })

  test("detects overflow via statusCode 413", () => {
    const error = makeApiError({ message: "Some generic error", statusCode: 413 })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("context_overflow")
  })

  test("detects overflow via responseBody error code", () => {
    const error = makeApiError({
      message: "Something went wrong",
      responseBody: JSON.stringify({ error: { code: "context_length_exceeded" } }),
    })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("context_overflow")
  })

  test("detects overflow via 400 (no body) pattern", () => {
    const error = makeApiError({ message: "400 (no body)" })
    const result = parseAPICallError({ providerID: ProviderID.mistral, error })
    expect(result.type).toBe("context_overflow")
  })

  test("detects overflow via 413 (no body) pattern", () => {
    const error = makeApiError({ message: "413 (no body)" })
    const result = parseAPICallError({ providerID: ProviderID.mistral, error })
    expect(result.type).toBe("context_overflow")
  })

  test("detects overflow via '400 status code (no body)' pattern", () => {
    const error = makeApiError({ message: "400 status code (no body)" })
    const result = parseAPICallError({ providerID: ProviderID.mistral, error })
    expect(result.type).toBe("context_overflow")
  })

  test("includes responseBody in context_overflow result", () => {
    const body = JSON.stringify({ error: "too long" })
    const error = makeApiError({ message: "prompt is too long", responseBody: body })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("context_overflow")
    if (result.type === "context_overflow") {
      expect(result.responseBody).toBe(body)
    }
  })
})

describe("parseAPICallError - api_error classification", () => {
  test("classifies generic error as api_error", () => {
    const error = makeApiError({ message: "Something went wrong", statusCode: 500 })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("Something went wrong")
      expect(result.statusCode).toBe(500)
    }
  })

  test("preserves isRetryable for non-OpenAI providers", () => {
    const error = makeApiError({ message: "Rate limited", statusCode: 429, isRetryable: true })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.isRetryable).toBe(true)
    }
  })

  test("non-retryable error for non-OpenAI providers", () => {
    const error = makeApiError({ message: "Bad request", statusCode: 400, isRetryable: false })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.isRetryable).toBe(false)
    }
  })

  test("OpenAI 404 is retryable", () => {
    const error = makeApiError({ message: "Not found", statusCode: 404, isRetryable: false })
    const result = parseAPICallError({ providerID: ProviderID.openai, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.isRetryable).toBe(true)
    }
  })

  test("OpenAI provider with openai-prefixed ID also gets 404 retry", () => {
    const error = makeApiError({ message: "Not found", statusCode: 404, isRetryable: false })
    const result = parseAPICallError({ providerID: "openai-compatible" as any, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.isRetryable).toBe(true)
    }
  })

  test("OpenAI non-404 non-retryable stays non-retryable", () => {
    const error = makeApiError({ message: "Bad request", statusCode: 400, isRetryable: false })
    const result = parseAPICallError({ providerID: ProviderID.openai, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.isRetryable).toBe(false)
    }
  })

  test("OpenAI retryable error without statusCode falls back to isRetryable", () => {
    const error = makeApiError({ message: "Network error", isRetryable: true })
    const result = parseAPICallError({ providerID: ProviderID.openai, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.isRetryable).toBe(true)
    }
  })

  test("preserves responseHeaders", () => {
    const headers = { "retry-after": "30", "x-request-id": "abc" }
    const error = makeApiError({ message: "Rate limited", statusCode: 429, responseHeaders: headers })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.responseHeaders).toEqual(headers)
    }
  })

  test("preserves responseBody", () => {
    const body = JSON.stringify({ error: "rate limited" })
    const error = makeApiError({ message: "Rate limited", statusCode: 429, responseBody: body })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.responseBody).toBe(body)
    }
  })

  test("includes url in metadata", () => {
    const error = makeApiError({ message: "Error", statusCode: 500, url: "https://api.example.com/v1/chat" })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.metadata).toEqual({ url: "https://api.example.com/v1/chat" })
    }
  })

  test("metadata is undefined when no url", () => {
    const error = makeApiError({ message: "Error", statusCode: 500 })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.metadata).toBeUndefined()
    }
  })
})

describe("parseAPICallError - message construction", () => {
  test("empty message with responseBody uses responseBody", () => {
    const error = makeApiError({ message: "", responseBody: "rate limited" })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("rate limited")
    }
  })

  test("empty message with statusCode uses HTTP status text", () => {
    const error = makeApiError({ message: "", statusCode: 429 })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("Too Many Requests")
    }
  })

  test("empty message with no body or statusCode returns 'Unknown error'", () => {
    const error = makeApiError({ message: "" })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("Unknown error")
    }
  })

  test("message with JSON responseBody extracts error message", () => {
    const body = JSON.stringify({ message: "Detailed error info" })
    const error = makeApiError({ message: "Internal Server Error", statusCode: 500, responseBody: body })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("Internal Server Error: Detailed error info")
    }
  })

  test("message with JSON responseBody where error is object falls through to raw body", () => {
    // body.error is an object (truthy), but typeof !== "string", so falls through to raw append
    const body = JSON.stringify({ error: { message: "Nested error" } })
    const error = makeApiError({ message: "Bad Request", statusCode: 400, responseBody: body })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe(`Bad Request: ${body}`)
    }
  })

  test("message with JSON responseBody extracts error field as string", () => {
    const body = JSON.stringify({ error: "Simple error string" })
    const error = makeApiError({ message: "Bad Request", statusCode: 400, responseBody: body })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("Bad Request: Simple error string")
    }
  })

  test("message with HTML responseBody for 401 returns gateway auth message", () => {
    const html = "<!doctype html><html><body>Blocked</body></html>"
    const error = makeApiError({ message: "Unauthorized", statusCode: 401, responseBody: html })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toContain("Unauthorized")
      expect(result.message).toContain("gateway or proxy")
    }
  })

  test("message with HTML responseBody for 403 returns gateway forbidden message", () => {
    const html = "<html><body>Forbidden</body></html>"
    const error = makeApiError({ message: "Forbidden", statusCode: 403, responseBody: html })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toContain("Forbidden")
      expect(result.message).toContain("gateway or proxy")
    }
  })

  test("message with HTML responseBody for other status returns original message", () => {
    const html = "<html><body>Server Error</body></html>"
    const error = makeApiError({ message: "Something failed", statusCode: 500, responseBody: html })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("Something failed")
    }
  })

  test("message with non-JSON non-HTML responseBody appends raw body when msg matches status text", () => {
    // Body is only appended when msg === STATUS_CODES[statusCode]; otherwise msg is returned early
    const error = makeApiError({ message: "Internal Server Error", statusCode: 500, responseBody: "plain text error" })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("Internal Server Error: plain text error")
    }
  })

  test("message equal to HTTP status text with responseBody still tries to parse body", () => {
    const body = JSON.stringify({ message: "Actual detail" })
    const error = makeApiError({ message: "Internal Server Error", statusCode: 500, responseBody: body })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("Internal Server Error: Actual detail")
    }
  })
})

describe("parseAPICallError - authentication failures", () => {
  test("401 with invalid API key message", () => {
    const error = makeApiError({ message: "Invalid API key provided", statusCode: 401 })
    const result = parseAPICallError({ providerID: ProviderID.openai, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.statusCode).toBe(401)
      expect(result.isRetryable).toBe(false)
    }
  })

  test("401 with expired token", () => {
    const error = makeApiError({ message: "Token expired", statusCode: 401 })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.statusCode).toBe(401)
    }
  })

  test("403 with missing credentials", () => {
    const error = makeApiError({ message: "Missing credentials", statusCode: 403 })
    const result = parseAPICallError({ providerID: ProviderID.google, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.statusCode).toBe(403)
      expect(result.isRetryable).toBe(false)
    }
  })
})

describe("parseAPICallError - unknown errors", () => {
  test("unrecognized error gets default classification", () => {
    const error = makeApiError({ message: "Something completely unexpected happened", statusCode: 502 })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.message).toBe("Something completely unexpected happened")
      expect(result.statusCode).toBe(502)
    }
  })

  test("error with no statusCode", () => {
    const error = makeApiError({ message: "Network failure" })
    const result = parseAPICallError({ providerID: ProviderID.anthropic, error })
    expect(result.type).toBe("api_error")
    if (result.type === "api_error") {
      expect(result.statusCode).toBeUndefined()
    }
  })
})
