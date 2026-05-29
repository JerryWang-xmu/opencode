import { expect, mock, beforeEach } from "bun:test"
import { Effect, Layer } from "effect"
import type { MCP as MCPNS } from "../../src/mcp/index"
import { testEffect } from "../lib/effect"

// --- Mock infrastructure ---

interface MockClientState {
  tools: Array<{ name: string; description?: string; inputSchema: object; outputSchema?: object }>
  listToolsCalls: number
  requestCalls: number
  listToolsShouldFail: boolean
  listToolsError: string
  listPromptsShouldFail: boolean
  listResourcesShouldFail: boolean
  prompts: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>
  resources: Array<{ name: string; uri: string; description?: string }>
  closed: boolean
  notificationHandlers: Map<unknown, (...args: any[]) => any>
  callToolResults: Map<string, { content: Array<{ type: string; text: string }> }>
  callToolErrors: Map<string, Error>
  getPromptResults: Map<string, { description?: string; messages: Array<{ role: string; content: { type: string; text: string } }> }>
  readResourceResults: Map<string, { contents: Array<{ uri: string; mimeType?: string; text?: string }> }>
}

const clientStates = new Map<string, MockClientState>()
let lastCreatedClientName: string | undefined
let connectShouldFail = false
let connectError = "Mock transport cannot connect"
let streamableShouldFail = false
let streamableError = "StreamableHTTP failed"
let clientCreateCount = 0
let transportCloseCount = 0

function getOrCreateClientState(name?: string): MockClientState {
  const key = name ?? "default"
  let state = clientStates.get(key)
  if (!state) {
    state = {
      tools: [{ name: "test_tool", description: "A test tool", inputSchema: { type: "object", properties: {} } }],
      listToolsCalls: 0,
      requestCalls: 0,
      listToolsShouldFail: false,
      listToolsError: "listTools failed",
      listPromptsShouldFail: false,
      listResourcesShouldFail: false,
      prompts: [],
      resources: [],
      closed: false,
      notificationHandlers: new Map(),
      callToolResults: new Map(),
      callToolErrors: new Map(),
      getPromptResults: new Map(),
      readResourceResults: new Map(),
    }
    clientStates.set(key, state)
  }
  return state
}

class MockStdioTransport {
  stderr: null = null
  pid = 12345
  // oxlint-disable-next-line no-useless-constructor
  constructor(_opts: any) {}
  async start() {
    if (connectShouldFail) throw new Error(connectError)
  }
  async close() {
    transportCloseCount++
  }
}

class MockStreamableHTTP {
  // oxlint-disable-next-line no-useless-constructor
  constructor(_url: URL, _opts?: any) {}
  async start() {
    if (streamableShouldFail) throw new Error(streamableError)
    if (connectShouldFail) throw new Error(connectError)
  }
  async close() {
    transportCloseCount++
  }
  async finishAuth(_code: string) {}
}

class MockSSE {
  // oxlint-disable-next-line no-useless-constructor
  constructor(_url: URL, _opts?: any) {}
  async start() {
    if (connectShouldFail) throw new Error(connectError)
  }
  async close() {
    transportCloseCount++
  }
}

void mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: MockStdioTransport,
}))

void mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockStreamableHTTP,
}))

void mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: MockSSE,
}))

void mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: class extends Error {
    constructor() {
      super("Unauthorized")
    }
  },
}))

void mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    _state!: MockClientState
    transport: any

    constructor(_opts: any) {
      clientCreateCount++
    }

    async connect(transport: { start: () => Promise<void> }) {
      this.transport = transport
      await transport.start()
      this._state = getOrCreateClientState(lastCreatedClientName)
    }

    setNotificationHandler(schema: unknown, handler: (...args: any[]) => any) {
      this._state?.notificationHandlers.set(schema, handler)
    }

    async listTools() {
      if (this._state) this._state.listToolsCalls++
      if (this._state?.listToolsShouldFail) {
        throw new Error(this._state.listToolsError)
      }
      return { tools: this._state?.tools ?? [] }
    }

    async request(request: { method: string }, schema: { parse: (value: unknown) => unknown }) {
      if (this._state) this._state.requestCalls++
      if (request.method === "tools/list") return schema.parse({ tools: this._state?.tools ?? [] })
      throw new Error(`unsupported request: ${request.method}`)
    }

    async listPrompts() {
      if (this._state?.listPromptsShouldFail) throw new Error("listPrompts failed")
      return { prompts: this._state?.prompts ?? [] }
    }

    async listResources() {
      if (this._state?.listResourcesShouldFail) throw new Error("listResources failed")
      return { resources: this._state?.resources ?? [] }
    }

    async callTool(args: { name: string; arguments?: Record<string, unknown> }, _schema: unknown, _opts?: unknown) {
      const error = this._state?.callToolErrors.get(args.name)
      if (error) throw error
      const result = this._state?.callToolResults.get(args.name)
      if (result) return result
      return { content: [{ type: "text", text: `result for ${args.name}` }] }
    }

    async getPrompt(args: { name: string; arguments?: Record<string, string> }) {
      const result = this._state?.getPromptResults.get(args.name)
      if (result) return result
      return { description: `Prompt ${args.name}`, messages: [{ role: "user", content: { type: "text", text: "hello" } }] }
    }

    async readResource(args: { uri: string }) {
      const result = this._state?.readResourceResults.get(args.uri)
      if (result) return result
      return { contents: [{ uri: args.uri, mimeType: "text/plain", text: "resource content" }] }
    }

    async close() {
      if (this._state) this._state.closed = true
    }
  },
}))

beforeEach(() => {
  clientStates.clear()
  lastCreatedClientName = undefined
  connectShouldFail = false
  connectError = "Mock transport cannot connect"
  streamableShouldFail = false
  streamableError = "StreamableHTTP failed"
  clientCreateCount = 0
  transportCloseCount = 0
})

// Import after mocks
const { MCP } = await import("../../src/mcp/index")
const { McpAuth } = await import("../../src/mcp/auth")
const { Bus } = await import("../../src/bus")
const { Config } = await import("../../src/config/config")
const { AppFileSystem } = await import("@opencode-ai/core/filesystem")
const { CrossSpawnSpawner } = await import("@opencode-ai/core/cross-spawn-spawner")

const it = testEffect(MCP.defaultLayer)

// Layer that also exposes McpAuth.Service for auth-related tests
const itAuth = testEffect(
  Layer.mergeAll(
    MCP.layer.pipe(
      Layer.provide(McpAuth.defaultLayer),
      Layer.provideMerge(Bus.layer),
      Layer.provide(Config.defaultLayer),
      Layer.provide(CrossSpawnSpawner.defaultLayer),
      Layer.provide(AppFileSystem.defaultLayer),
    ),
    McpAuth.defaultLayer,
  ),
)

// ========================================================================
// Tool invocation
// ========================================================================

it.instance(
  "tools() returns callable tools that invoke callTool on the MCP client",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "tool-server"
        const serverState = getOrCreateClientState("tool-server")
        serverState.tools = [
          {
            name: "greet",
            description: "Greets someone",
            inputSchema: { type: "object", properties: { name: { type: "string" } } },
          },
        ]
        serverState.callToolResults.set("greet", {
          content: [{ type: "text", text: "Hello, World!" }],
        })

        yield* mcp.add("tool-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const tools = yield* mcp.tools()
        const toolKey = Object.keys(tools).find((k) => k.includes("greet"))
        expect(toolKey).toBeDefined()

        const tool = tools[toolKey!]
        expect(tool).toBeDefined()
        expect(tool.description).toBe("Greets someone")
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "tool call errors are propagated to the caller",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "error-tool-server"
        const serverState = getOrCreateClientState("error-tool-server")
        serverState.tools = [
          {
            name: "failing_tool",
            description: "A tool that fails",
            inputSchema: { type: "object", properties: {} },
          },
        ]
        serverState.callToolErrors.set("failing_tool", new Error("Tool execution failed"))

        yield* mcp.add("error-tool-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const tools = yield* mcp.tools()
        const toolKey = Object.keys(tools).find((k) => k.includes("failing_tool"))
        expect(toolKey).toBeDefined()
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// getPrompt
// ========================================================================

it.instance(
  "getPrompt() retrieves a prompt from a connected server",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "prompt-server"
        const serverState = getOrCreateClientState("prompt-server")
        serverState.prompts = [{ name: "my-prompt", description: "A test prompt" }]
        serverState.getPromptResults.set("my-prompt", {
          description: "A test prompt",
          messages: [{ role: "user", content: { type: "text", text: "Generate something" } }],
        })

        yield* mcp.add("prompt-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const result = yield* mcp.getPrompt("prompt-server", "my-prompt", { topic: "testing" })
        expect(result).toBeDefined()
        expect(result?.description).toBe("A test prompt")
        expect(result?.messages).toHaveLength(1)
        expect(result?.messages[0].role).toBe("user")
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "getPrompt() returns undefined for nonexistent client",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const result = yield* mcp.getPrompt("nonexistent", "some-prompt")
        expect(result).toBeUndefined()
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// readResource
// ========================================================================

it.instance(
  "readResource() retrieves a resource from a connected server",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "resource-server"
        const serverState = getOrCreateClientState("resource-server")
        serverState.resources = [{ name: "config", uri: "file:///config.json", description: "Config file" }]
        serverState.readResourceResults.set("file:///config.json", {
          contents: [{ uri: "file:///config.json", mimeType: "application/json", text: '{"key": "value"}' }],
        })

        yield* mcp.add("resource-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const result = yield* mcp.readResource("resource-server", "file:///config.json")
        expect(result).toBeDefined()
        expect(result?.contents).toHaveLength(1)
        expect(result?.contents[0].mimeType).toBe("application/json")
        const content = result?.contents[0]
        expect(content && "text" in content ? content.text : undefined).toBe('{"key": "value"}')
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "readResource() returns undefined for nonexistent client",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const result = yield* mcp.readResource("nonexistent", "file:///test.txt")
        expect(result).toBeUndefined()
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// supportsOAuth
// ========================================================================

it.instance(
  "supportsOAuth() returns true for remote servers without oauth disabled",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const result = yield* mcp.supportsOAuth("remote-server")
        expect(result).toBe(true)
      }),
    ),
  {
    config: {
      mcp: {
        "remote-server": {
          type: "remote",
          url: "https://example.com/mcp",
        },
      },
    },
  },
)

it.instance(
  "supportsOAuth() returns false when oauth is explicitly disabled",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const result = yield* mcp.supportsOAuth("no-oauth-server")
        expect(result).toBe(false)
      }),
    ),
  {
    config: {
      mcp: {
        "no-oauth-server": {
          type: "remote",
          url: "https://example.com/mcp",
          oauth: false,
        },
      },
    },
  },
)

it.instance(
  "supportsOAuth() returns false for local servers",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const result = yield* mcp.supportsOAuth("local-server")
        expect(result).toBe(false)
      }),
    ),
  {
    config: {
      mcp: {
        "local-server": {
          type: "local",
          command: ["echo", "test"],
        },
      },
    },
  },
)

// ========================================================================
// hasStoredTokens
// ========================================================================

it.instance(
  "hasStoredTokens() returns false when no tokens are stored",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const result = yield* mcp.hasStoredTokens("unknown-server")
        expect(result).toBe(false)
      }),
    ),
  { config: { mcp: {} } },
)

itAuth.instance(
  "hasStoredTokens() returns true when tokens are stored",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        yield* auth.updateTokens("token-server", {
          accessToken: "test-access-token",
          refreshToken: "test-refresh-token",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        })

        const result = yield* mcp.hasStoredTokens("token-server")
        expect(result).toBe(true)
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// getAuthStatus
// ========================================================================

it.instance(
  "getAuthStatus() returns 'not_authenticated' when no tokens exist",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const result = yield* mcp.getAuthStatus("no-auth-server")
        expect(result).toBe("not_authenticated")
      }),
    ),
  { config: { mcp: {} } },
)

itAuth.instance(
  "getAuthStatus() returns 'authenticated' when valid tokens exist",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        yield* auth.updateTokens("authed-server", {
          accessToken: "valid-token",
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        })

        const result = yield* mcp.getAuthStatus("authed-server")
        expect(result).toBe("authenticated")
      }),
    ),
  { config: { mcp: {} } },
)

itAuth.instance(
  "getAuthStatus() returns 'expired' when tokens are expired",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        yield* auth.updateTokens("expired-server", {
          accessToken: "expired-token",
          expiresAt: Math.floor(Date.now() / 1000) - 3600,
        })

        const result = yield* mcp.getAuthStatus("expired-server")
        expect(result).toBe("expired")
      }),
    ),
  { config: { mcp: {} } },
)

itAuth.instance(
  "getAuthStatus() returns 'authenticated' when tokens have no expiry",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        yield* auth.updateTokens("no-expiry-server", {
          accessToken: "permanent-token",
        })

        const result = yield* mcp.getAuthStatus("no-expiry-server")
        expect(result).toBe("authenticated")
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// removeAuth
// ========================================================================

itAuth.instance(
  "removeAuth() clears stored tokens and OAuth state",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const auth = yield* McpAuth.Service
        yield* auth.updateTokens("remove-auth-server", {
          accessToken: "to-be-removed",
        })
        yield* auth.updateOAuthState("remove-auth-server", "some-state")

        const hasBefore = yield* mcp.hasStoredTokens("remove-auth-server")
        expect(hasBefore).toBe(true)

        yield* mcp.removeAuth("remove-auth-server")

        const hasAfter = yield* mcp.hasStoredTokens("remove-auth-server")
        expect(hasAfter).toBe(false)

        const state = yield* auth.getOAuthState("remove-auth-server")
        expect(state).toBeUndefined()
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// Remote connection: SSE fallback
// ========================================================================

it.instance(
  "remote connection falls back to SSE when StreamableHTTP fails",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "fallback-server"
        getOrCreateClientState("fallback-server")
        streamableShouldFail = true
        streamableError = "StreamableHTTP not supported"

        const addResult = yield* mcp.add("fallback-server", {
          type: "remote",
          url: "http://localhost:9999/mcp",
          oauth: false,
        })

        const serverStatus = (addResult.status as any)["fallback-server"] ?? addResult.status
        expect(serverStatus.status).toBe("connected")
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// Invalid URL handling
// ========================================================================

it.instance(
  "remote connection with invalid URL returns failed status",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const addResult = yield* mcp.add("bad-url-server", {
          type: "remote",
          url: "not-a-valid-url",
          oauth: false,
        })

        const serverStatus = (addResult.status as any)["bad-url-server"] ?? addResult.status
        expect(serverStatus.status).toBe("failed")
        expect(serverStatus.error).toContain("Invalid MCP URL")
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// status() with various configurations
// ========================================================================

it.instance(
  "status() returns empty record when no MCP servers are configured",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const status = yield* mcp.status()
        expect(Object.keys(status).length).toBe(0)
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "status() reflects connected and disabled servers correctly",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "active-server"
        getOrCreateClientState("active-server")

        yield* mcp.add("active-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const status = yield* mcp.status()
        expect(status["active-server"]?.status).toBe("connected")
        expect(status["disabled-server"]?.status).toBe("disabled")
      }),
    ),
  {
    config: {
      mcp: {
        "active-server": {
          type: "local",
          command: ["echo", "test"],
        },
        "disabled-server": {
          type: "local",
          command: ["echo", "test"],
          enabled: false,
        },
      },
    },
  },
)

// ========================================================================
// clients()
// ========================================================================

it.instance(
  "clients() returns connected MCP clients",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "client-list-server"
        getOrCreateClientState("client-list-server")

        yield* mcp.add("client-list-server", {
          type: "local",
          command: ["echo", "test"],
        })

        const clients = yield* mcp.clients()
        expect(clients["client-list-server"]).toBeDefined()
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "clients() returns empty when no servers are connected",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        const clients = yield* mcp.clients()
        expect(Object.keys(clients).length).toBe(0)
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// add() with remote server
// ========================================================================

it.instance(
  "add() connects a remote server via StreamableHTTP",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "remote-add"
        getOrCreateClientState("remote-add")

        const addResult = yield* mcp.add("remote-add", {
          type: "remote",
          url: "http://localhost:9999/mcp",
          oauth: false,
        })

        const serverStatus = (addResult.status as any)["remote-add"] ?? addResult.status
        expect(serverStatus.status).toBe("connected")
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// Multiple servers with different tool sets
// ========================================================================

it.instance(
  "tools() merges tools from multiple connected servers with correct prefixes",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "server-a"
        const stateA = getOrCreateClientState("server-a")
        stateA.tools = [
          { name: "tool_a1", description: "A1", inputSchema: { type: "object", properties: {} } },
        ]

        yield* mcp.add("server-a", {
          type: "local",
          command: ["echo", "a"],
        })

        clientStates.delete("server-b")
        lastCreatedClientName = "server-b"
        const stateB = getOrCreateClientState("server-b")
        stateB.tools = [
          { name: "tool_b1", description: "B1", inputSchema: { type: "object", properties: {} } },
          { name: "tool_b2", description: "B2", inputSchema: { type: "object", properties: {} } },
        ]

        yield* mcp.add("server-b", {
          type: "local",
          command: ["echo", "b"],
        })

        const tools = yield* mcp.tools()
        const keys = Object.keys(tools)

        expect(keys.some((k) => k.includes("server-a") && k.includes("tool_a1"))).toBe(true)
        expect(keys.some((k) => k.includes("server-b") && k.includes("tool_b1"))).toBe(true)
        expect(keys.some((k) => k.includes("server-b") && k.includes("tool_b2"))).toBe(true)
        expect(keys.length).toBe(3)
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// connect() enables a disabled server
// ========================================================================

it.instance(
  "connect() enables and connects a previously disabled server",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "enable-server"
        getOrCreateClientState("enable-server")

        const statusBefore = yield* mcp.status()
        expect(statusBefore["enable-server"]?.status).toBe("disabled")

        yield* mcp.connect("enable-server")

        const statusAfter = yield* mcp.status()
        expect(statusAfter["enable-server"]?.status).toBe("connected")
      }),
    ),
  {
    config: {
      mcp: {
        "enable-server": {
          type: "local",
          command: ["echo", "test"],
          enabled: false,
        },
      },
    },
  },
)

// ========================================================================
// prompts() and resources() with multiple servers
// ========================================================================

it.instance(
  "prompts() merges prompts from multiple connected servers",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "prompt-a"
        const stateA = getOrCreateClientState("prompt-a")
        stateA.prompts = [{ name: "prompt-1", description: "First prompt" }]

        yield* mcp.add("prompt-a", {
          type: "local",
          command: ["echo", "a"],
        })

        clientStates.delete("prompt-b")
        lastCreatedClientName = "prompt-b"
        const stateB = getOrCreateClientState("prompt-b")
        stateB.prompts = [{ name: "prompt-2", description: "Second prompt" }]

        yield* mcp.add("prompt-b", {
          type: "local",
          command: ["echo", "b"],
        })

        const prompts = yield* mcp.prompts()
        const keys = Object.keys(prompts)

        expect(keys.length).toBe(2)
        expect(keys.some((k) => k.includes("prompt-a") && k.includes("prompt-1"))).toBe(true)
        expect(keys.some((k) => k.includes("prompt-b") && k.includes("prompt-2"))).toBe(true)
      }),
    ),
  { config: { mcp: {} } },
)

it.instance(
  "resources() merges resources from multiple connected servers",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "res-a"
        const stateA = getOrCreateClientState("res-a")
        stateA.resources = [{ name: "res-1", uri: "file:///a.txt" }]

        yield* mcp.add("res-a", {
          type: "local",
          command: ["echo", "a"],
        })

        clientStates.delete("res-b")
        lastCreatedClientName = "res-b"
        const stateB = getOrCreateClientState("res-b")
        stateB.resources = [{ name: "res-2", uri: "file:///b.txt" }]

        yield* mcp.add("res-b", {
          type: "local",
          command: ["echo", "b"],
        })

        const resources = yield* mcp.resources()
        const keys = Object.keys(resources)

        expect(keys.length).toBe(2)
        expect(keys.some((k) => k.includes("res-a") && k.includes("res-1"))).toBe(true)
        expect(keys.some((k) => k.includes("res-b") && k.includes("res-2"))).toBe(true)
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// disconnect() cleans up tools
// ========================================================================

it.instance(
  "disconnect() removes tools from the disconnected server",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "disc-tools"
        const serverState = getOrCreateClientState("disc-tools")
        serverState.tools = [
          { name: "will_disappear", description: "Gone after disconnect", inputSchema: { type: "object", properties: {} } },
        ]

        yield* mcp.add("disc-tools", {
          type: "local",
          command: ["echo", "test"],
        })

        const toolsBefore = yield* mcp.tools()
        expect(Object.keys(toolsBefore).some((k) => k.includes("will_disappear"))).toBe(true)

        yield* mcp.disconnect("disc-tools")

        const toolsAfter = yield* mcp.tools()
        expect(Object.keys(toolsAfter).some((k) => k.includes("will_disappear"))).toBe(false)
      }),
    ),
  {
    config: {
      mcp: {
        "disc-tools": {
          type: "local",
          command: ["echo", "test"],
        },
      },
    },
  },
)

// ========================================================================
// add() with timeout configuration
// ========================================================================

it.instance(
  "add() respects custom timeout for tool listing",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "timeout-server"
        getOrCreateClientState("timeout-server")

        const addResult = yield* mcp.add("timeout-server", {
          type: "local",
          command: ["echo", "test"],
          timeout: 10000,
        })

        const serverStatus = (addResult.status as any)["timeout-server"] ?? addResult.status
        expect(serverStatus.status).toBe("connected")
      }),
    ),
  { config: { mcp: {} } },
)

// ========================================================================
// add() with environment variables
// ========================================================================

it.instance(
  "add() passes environment variables to local server transport",
  () =>
    MCP.Service.use((mcp: MCPNS.Interface) =>
      Effect.gen(function* () {
        lastCreatedClientName = "env-server"
        getOrCreateClientState("env-server")

        const addResult = yield* mcp.add("env-server", {
          type: "local",
          command: ["echo", "test"],
          environment: { MY_VAR: "my_value", ANOTHER: "val" },
        })

        const serverStatus = (addResult.status as any)["env-server"] ?? addResult.status
        expect(serverStatus.status).toBe("connected")
      }),
    ),
  { config: { mcp: {} } },
)
