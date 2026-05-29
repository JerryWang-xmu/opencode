import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import type { Agent } from "../../src/agent/agent"
import type { Auth } from "../../src/auth"
import type { RuntimeFlags } from "../../src/effect/runtime-flags"
import type { Plugin } from "../../src/plugin"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "../../src/provider/provider"
import { Permission } from "../../src/permission"
import type { MessageV2 } from "../../src/session/message-v2"
import { LLMRequestPrep } from "../../src/session/llm/request"
import { MessageID, SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const anthropicModel: Provider.Model = {
  id: ModelID.make("claude-sonnet-4-20250514"),
  providerID: ProviderID.anthropic,
  api: { id: "claude-sonnet-4-20250514", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
  name: "Claude Sonnet 4",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 200000, output: 8192 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2025-05-14",
}

const openaiModel: Provider.Model = {
  id: ModelID.make("gpt-4o"),
  providerID: ProviderID.make("openai"),
  api: { id: "gpt-4o", url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
  name: "GPT-4o",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 128000, output: 16384 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2024-05-13",
}

const testAgent: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const testUser: MessageV2.User = {
  id: MessageID.make("msg_01test"),
  sessionID: SessionID.make("ses_01test"),
  role: "user",
  time: { created: 1700000000000 },
  agent: "build",
  model: {
    providerID: ProviderID.anthropic,
    modelID: ModelID.make("claude-sonnet-4-20250514"),
  },
}

const testProvider: Provider.Info = {
  id: ProviderID.anthropic,
  name: "Anthropic",
  source: "config",
  env: [],
  options: {},
  models: {},
}

const openaiProvider: Provider.Info = {
  id: ProviderID.make("openai"),
  name: "OpenAI",
  source: "config",
  env: [],
  options: {},
  models: {},
}

const noopFlags: RuntimeFlags.Info = {
  autoShare: false,
  pure: false,
  disableDefaultPlugins: false,
  disableChannelDb: false,
  disableEmbeddedWebUi: false,
  disableExternalSkills: false,
  disableLspDownload: false,
  skipMigrations: false,
  disableClaudeCodePrompt: false,
  disableClaudeCodeSkills: false,
  enableExa: false,
  enableParallel: false,
  enableExperimentalModels: false,
  enableQuestionTool: false,
  experimentalScout: false,
  experimentalBackgroundSubagents: false,
  experimentalCoordinator: false,
  experimentalMemoryRetrieval: false,
  experimentalAutoDream: false,
  experimentalLspTy: false,
  experimentalLspTool: false,
  experimentalOxfmt: false,
  experimentalPlanMode: false,
  experimentalEventSystem: false,
  experimentalWorkspaces: false,
  experimentalIconDiscovery: false,
  acpNext: false,
  outputTokenMax: undefined,
  bashDefaultTimeoutMs: undefined,
  experimentalNativeLlm: false,
  experimentalWebSockets: false,
  client: "cli",
}

const passthroughPlugin: Plugin.Interface = {
  trigger: (_name, _input, output) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.void,
}

const baseInput = {
  user: testUser,
  sessionID: "ses_01test",
  agent: testAgent,
  permission: undefined,
  system: [],
  messages: [{ role: "user" as const, content: "Hello" }],
  small: false,
  tools: {},
  auth: undefined as Auth.Info | undefined,
  flags: noopFlags,
  isWorkflow: false,
}

describe("session.system-layering", () => {
  it.effect("static system parts sent as first system message", () =>
    Effect.gen(function* () {
      const envParts = ["Environment: test-env"]
      const instructions = ["Instructions from: /tmp/AGENTS.md\n# Project rules"]
      const skills = "<skills><name>git-master</name></skills>"

      const prepared = yield* LLMRequestPrep.prepare({
        ...baseInput,
        model: anthropicModel,
        provider: testProvider,
        plugin: passthroughPlugin,
        staticSystem: [...envParts, ...instructions, skills],
        dynamicSystem: [],
      })

      // First system message should contain base template + static parts
      expect(prepared.system[0]).toContain("Environment: test-env")
      expect(prepared.system[0]).toContain("Instructions from: /tmp/AGENTS.md")
      expect(prepared.system[0]).toContain("<skills><name>git-master</name></skills>")
      // Should also contain the base template (Anthropic prompt)
      expect(prepared.system[0].length).toBeGreaterThan(100)
    }),
  )

  it.effect("dynamic parts sent as second system message", () =>
    Effect.gen(function* () {
      const userSystemOverride = "User custom system prompt override"
      const structuredOutputPrompt = "IMPORTANT: Use structured output."

      const userWithSystem: MessageV2.User = {
        ...testUser,
        system: userSystemOverride,
      }

      const prepared = yield* LLMRequestPrep.prepare({
        ...baseInput,
        user: userWithSystem,
        model: anthropicModel,
        provider: testProvider,
        plugin: passthroughPlugin,
        staticSystem: ["Static env content"],
        dynamicSystem: [structuredOutputPrompt],
      })

      // Should have two system messages for Anthropic
      expect(prepared.system.length).toBe(2)
      // Second system message should contain dynamic parts
      expect(prepared.system[1]).toContain(structuredOutputPrompt)
      expect(prepared.system[1]).toContain(userSystemOverride)
      // First system message should NOT contain dynamic parts
      expect(prepared.system[0]).not.toContain(userSystemOverride)
      expect(prepared.system[0]).not.toContain(structuredOutputPrompt)
    }),
  )

  it.effect("plugin transform applies to dynamic part only for Anthropic", () =>
    Effect.gen(function* () {
      const pluginMarker = "PLUGIN_INJECTED_CONTENT"
      const transformingPlugin: Plugin.Interface = {
        trigger: (name, _input, output) => {
          if (name === "experimental.chat.system.transform") {
            const sys = (output as { system: string[] }).system
            // Plugin modifies the dynamic system array
            sys[0] = sys[0] + "\n" + pluginMarker
          }
          return Effect.succeed(output)
        },
        list: () => Effect.succeed([]),
        init: () => Effect.void,
      }

      const prepared = yield* LLMRequestPrep.prepare({
        ...baseInput,
        model: anthropicModel,
        provider: testProvider,
        plugin: transformingPlugin,
        staticSystem: ["Static content that should not change"],
        dynamicSystem: ["Dynamic content"],
      })

      // Static part should NOT contain plugin marker
      expect(prepared.system[0]).not.toContain(pluginMarker)
      expect(prepared.system[0]).toContain("Static content that should not change")
      // Dynamic part should contain plugin marker
      expect(prepared.system[1]).toContain(pluginMarker)
    }),
  )

  it.effect("Anthropic cache_control metadata on static block", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMRequestPrep.prepare({
        ...baseInput,
        model: anthropicModel,
        provider: testProvider,
        plugin: passthroughPlugin,
        staticSystem: ["Static content"],
        dynamicSystem: ["Dynamic content"],
      })

      // Find the system messages in the messages array
      const systemMessages = prepared.messages.filter((m) => m.role === "system")
      expect(systemMessages.length).toBeGreaterThanOrEqual(2)

      // First system message (static) should have cache_control providerOptions
      const staticMsg = systemMessages[0] as any
      expect(staticMsg.providerOptions).toBeDefined()
      expect(staticMsg.providerOptions.anthropic).toBeDefined()
      expect(staticMsg.providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" })

      // Second system message (dynamic) should NOT have cache_control
      const dynamicMsg = systemMessages[1] as any
      expect(dynamicMsg.providerOptions).toBeUndefined()
    }),
  )

  it.effect("non-Anthropic models get single joined system string", () =>
    Effect.gen(function* () {
      const openaiUser: MessageV2.User = {
        ...testUser,
        model: {
          providerID: ProviderID.make("openai"),
          modelID: ModelID.make("gpt-4o"),
        },
      }

      const prepared = yield* LLMRequestPrep.prepare({
        ...baseInput,
        user: openaiUser,
        model: openaiModel,
        provider: openaiProvider,
        plugin: passthroughPlugin,
        staticSystem: ["Static env content"],
        dynamicSystem: ["Dynamic structured output prompt"],
      })

      // Non-Anthropic should have single system string
      expect(prepared.system.length).toBe(1)
      // Should contain both static and dynamic parts joined
      expect(prepared.system[0]).toContain("Static env content")
      expect(prepared.system[0]).toContain("Dynamic structured output prompt")

      // System messages in messages array should also be single
      const systemMessages = prepared.messages.filter((m) => m.role === "system")
      expect(systemMessages.length).toBe(1)

      // No cache_control providerOptions on non-Anthropic
      const sysMsg = systemMessages[0] as any
      expect(sysMsg.providerOptions).toBeUndefined()
    }),
  )
})
