import type {
  Event,
  createOpencodeClient,
  Project,
  Model,
  Provider,
  Permission,
  UserMessage,
  Message,
  Part,
  Config as SDKConfig,
} from "@opencode-ai/sdk"
import type { Provider as ProviderV2, Model as ModelV2, Auth } from "@opencode-ai/sdk/v2"

import type { BunShell } from "./shell.js"
import { type ToolDefinition } from "./tool.js"

export * from "./tool.js"

export type ProviderContext = {
  source: "env" | "config" | "custom" | "api"
  info: Provider
  options: Record<string, any>
}

export type WorkspaceInfo = {
  id: string
  type: string
  name: string
  branch: string | null
  directory: string | null
  extra: unknown | null
  projectID: string
}

export type WorkspaceTarget =
  | {
      type: "local"
      directory: string
    }
  | {
      type: "remote"
      url: string | URL
      headers?: HeadersInit
    }

export type WorkspaceAdapter = {
  name: string
  description: string
  configure(config: WorkspaceInfo): WorkspaceInfo | Promise<WorkspaceInfo>
  create(config: WorkspaceInfo, env: Record<string, string | undefined>, from?: WorkspaceInfo): Promise<void>
  remove(config: WorkspaceInfo): Promise<void>
  target(config: WorkspaceInfo): WorkspaceTarget | Promise<WorkspaceTarget>
}

export type LLMClient = {
  query(prompt: string, options?: { model?: string; system?: string; temperature?: number }): Promise<string>
}

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  experimental_workspace: {
    register(type: string, adapter: WorkspaceAdapter): void
  }
  serverUrl: URL
  $: BunShell
  llm: LLMClient
}

export type PluginOptions = Record<string, unknown>

export type Config = Omit<SDKConfig, "plugin"> & {
  plugin?: Array<string | [string, PluginOptions]>
}

export type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>

export type PluginModule = {
  id?: string
  server: Plugin
  tui?: never
}

type Rule = {
  key: string
  op: "eq" | "neq"
  value: string
}

export type AuthHook = {
  provider: string
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  methods: (
    | {
        type: "oauth"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
        >
        authorize(inputs?: Record<string, string>): Promise<AuthOAuthResult>
      }
    | {
        type: "api"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              /** @deprecated Use `when` instead */
              condition?: (inputs: Record<string, string>) => boolean
              when?: Rule
            }
        >
        authorize?(inputs?: Record<string, string>): Promise<
          | {
              type: "success"
              key: string
              provider?: string
              metadata?: Record<string, string>
            }
          | {
              type: "failed"
            }
        >
      }
  )[]
}

export type AuthOAuthResult = { url: string; instructions: string } & (
  | {
      method: "auto"
      callback(): Promise<
        | ({
            type: "success"
            provider?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
                enterpriseUrl?: string
              }
            | { key: string; metadata?: Record<string, string> }
          ))
        | {
            type: "failed"
          }
      >
    }
  | {
      method: "code"
      callback(code: string): Promise<
        | ({
            type: "success"
            provider?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
                enterpriseUrl?: string
              }
            | { key: string; metadata?: Record<string, string> }
          ))
        | {
            type: "failed"
          }
      >
    }
)

export type ProviderHookContext = {
  auth?: Auth
}

export type ProviderHook = {
  id: string
  models?: (provider: ProviderV2, ctx: ProviderHookContext) => Promise<Record<string, ModelV2>>
}

/** @deprecated Use AuthOAuthResult instead. */
export type AuthOuathResult = AuthOAuthResult

export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: {
    [key: string]: ToolDefinition
  }
  auth?: AuthHook
  provider?: ProviderHook
  /**
   * Called when a new message is received
   */
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>
  /**
   * Modify parameters sent to LLM
   */
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: {
      temperature: number
      topP: number
      topK: number
      maxOutputTokens: number | undefined
      options: Record<string, any>
    },
  ) => Promise<void>
  "chat.headers"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { headers: Record<string, string> },
  ) => Promise<void>
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" }) => Promise<void>
  "command.execute.before"?: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Part[] },
  ) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>
  "shell.env"?: (
    input: { cwd: string; sessionID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: {
      title: string
      output: string
      metadata: any
    },
  ) => Promise<void>
  "experimental.chat.messages.transform"?: (
    input: {},
    output: {
      messages: {
        info: Message
        parts: Part[]
      }[]
    },
  ) => Promise<void>
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: {
      system: string[]
    },
  ) => Promise<void>
  /**
   * Called before session compaction starts. Allows plugins to customize
   * the compaction prompt.
   *
   * - `context`: Additional context strings appended to the default prompt
   * - `prompt`: If set, replaces the default compaction prompt entirely
   */
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
  /**
   * Called after compaction succeeds and before a synthetic user
   * auto-continue message is added.
   *
   * - `enabled`: Defaults to `true`. Set to `false` to skip the synthetic
   *   user "continue" turn.
   */
  "experimental.compaction.autocontinue"?: (
    input: {
      sessionID: string
      agent: string
      model: Model
      provider: ProviderContext
      message: UserMessage
      overflow: boolean
    },
    output: { enabled: boolean },
  ) => Promise<void>
  "experimental.text.complete"?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
  ) => Promise<void>
  /**
   * Modify tool definitions (description and parameters) sent to LLM
   */
  "tool.definition"?: (input: { toolID: string }, output: { description: string; parameters: any }) => Promise<void>
  /**
   * Agent executor hook - allows using LLM to process hook inputs and generate outputs.
   * This enables plugins to use LLM reasoning to make decisions about tool execution,
   * argument validation, result post-processing, and dynamic prompt generation.
   *
   * The hook receives the original hook input and can call the LLM client to generate
   * a response that modifies the hook output.
   *
   * Example use cases:
   * - Use LLM to validate/transform tool arguments before execution
   * - Use LLM to post-process and summarize tool results
   * - Use LLM to generate dynamic system prompts based on conversation context
   * - Use LLM to decide whether to allow/deny tool execution based on context
   *
   * @example
    * ```typescript
    * "agent.executor": async (hookName, input, output, llm) => {
    *   if (hookName === "tool.execute.before" && input.tool === "bash") {
    *     const response = await llm.query(
    *       `Analyze this bash command and decide if it's safe: ${input.args.command}`,
    *       { system: "You are a security expert. Respond with 'ALLOW' or 'DENY: reason'" }
    *     )
    *     if (response.startsWith("DENY")) {
    *       output.args = { command: `echo "Blocked: ${response}"` }
    *     }
    *   }
    * }
    * ```
    *
    * @security This hook is currently NOT triggered by the runtime.
    * If implemented in the future, the output parameter should be treated as
    * read-only for security-sensitive hooks (permission.ask, tool.execute.before).
    */
  "agent.executor"?: (
    hookName: string,
    input: any,
    output: any,
    llm: LLMClient,
  ) => Promise<void>
  /**
   * Called when a file is changed in the workspace.
   * This hook is triggered by the file watcher when files are created, modified, or deleted.
   *
   * @example
   * ```typescript
   * "file.changed": async (input, output) => {
   *   console.log(`File ${input.path} was ${input.event}`);
   *   // Perform actions like updating indexes, triggering builds, etc.
   * }
   * ```
   */
  "file.changed"?: (
    input: {
      path: string
      event: "created" | "modified" | "deleted"
      sessionID?: string
    },
    output: {},
  ) => Promise<void>
  /**
   * Called when a session is about to stop.
   * This hook is triggered when a session is ending, allowing plugins to perform cleanup,
   * save state, or perform final processing.
   *
   * @example
   * ```typescript
   * "session.stop": async (input, output) => {
   *   console.log(`Session ${input.sessionID} is stopping with reason: ${input.reason}`);
   *   // Perform cleanup or save final state
   * }
   * ```
   */
  "session.stop"?: (
    input: {
      sessionID: string
      reason: "completed" | "error" | "cancelled" | "context_overflow"
      message?: string
    },
    output: {},
  ) => Promise<void>
}
