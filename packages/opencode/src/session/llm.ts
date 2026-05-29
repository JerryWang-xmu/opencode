import { Provider } from "@/provider/provider"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import * as Log from "@opencode-ai/core/util/log"
import { Cause, Context, Effect, Exit, Layer, Ref, Schema } from "effect"
import * as Stream from "effect/Stream"
import { streamText, wrapLanguageModel, type ModelMessage, type Tool } from "ai"
import type { LLMEvent } from "@opencode-ai/llm"
import { LLMClient, RequestExecutor, WebSocketExecutor } from "@opencode-ai/llm/route"
import type { LLMClientService } from "@opencode-ai/llm/route"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Bus } from "@/bus"
import { Wildcard } from "@/util/wildcard"
import { ModelTools } from "@/util/model-tools"
import { SessionID } from "@/session/schema"
import { Auth } from "@/auth"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { LLMAISDK } from "./llm/ai-sdk"
import { LLMNativeRuntime } from "./llm/native-runtime"
import { LLMRequestPrep } from "./llm/request"
import { ModelID, ProviderID } from "@/provider/schema"
import type { QuerySource } from "./retry"
import { Session } from "./session"

const log = Log.create({ service: "llm" })
export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

function waitForAbort(signal: AbortSignal) {
  if (signal.aborted) return Effect.fail(new Error("Stream aborted by caller"))
  return Effect.callback<never, Error>((resume) => {
    const onabort = () => resume(Effect.fail(new Error("Stream aborted by caller")))
    signal.addEventListener("abort", onabort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", onabort))
  })
}

export type StreamInput = {
  user: MessageV2.User
  sessionID: string
  parentSessionID?: string
  model: Provider.Model
  agent: Agent.Info
  permission?: Permission.Ruleset
  system: string[]
  staticSystem?: string[]
  dynamicSystem?: string[]
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
  querySource?: QuerySource
}

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<LLMEvent, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM") {}

export const use = serviceUse(Service)

export class LLMFallbackError extends Schema.TaggedErrorClass<LLMFallbackError>()("LLMFallbackError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export function isRetryableError(error: unknown): boolean {
  // AI SDK APICallError may expose a statusCode or status property.
  const err = error as Record<string, unknown>
  const status =
    (err?.statusCode as number | undefined) ??
    (err?.status as number | undefined) ??
    ((err?.cause as Record<string, unknown>)?.statusCode as number | undefined) ??
    ((err?.cause as Record<string, unknown>)?.status as number | undefined)
  if (typeof status === "number") {
    if (status === 429) return true
    if (status >= 500) return true
    if (status >= 400) return false
  }
  // Fall back to string matching on the error message or serialized form.
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (text.includes("401") || text.includes("unauthorized")) return false
  if (text.includes("403") || text.includes("forbidden")) return false
  if (text.includes("400") || text.includes("bad request")) return false
  if (text.includes("500") || text.includes("502") || text.includes("503") || text.includes("504")) return true
  if (text.includes("5xx") || text.includes("server error") || text.includes("internal error")) return true
  if (text.includes("429") || text.includes("rate limit") || text.includes("too many requests")) return true
  if (text.includes("network") || text.includes("timeout") || text.includes("connection")) return true
  if (text.includes("service unavailable") || text.includes("bad gateway")) return true
  return false
}

const live: Layer.Layer<
  Service,
  never,
  | Auth.Service
  | Config.Service
  | Provider.Service
  | Plugin.Service
  | Permission.Service
  | LLMClientService
  | RuntimeFlags.Service
  | Session.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service
    const llmClient = yield* LLMClient.Service
    const flags = yield* RuntimeFlags.Service
    const session = yield* Session.Service
    const latchedHeaders = yield* Ref.make<Map<string, Record<string, string>>>(new Map())

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest) {
      const l = log
        .clone()
        .tag("providerID", input.model.providerID)
        .tag("modelID", input.model.id)
        .tag("session.id", input.sessionID)
        .tag("small", (input.small ?? false).toString())
        .tag("agent", input.agent.name)
        .tag("mode", input.agent.mode)
      l.info("stream", {
        modelID: input.model.id,
        providerID: input.model.providerID,
      })

      // Get fallback models from config
      const cfg = yield* config.get()
      const fallbackModels = cfg.fallback_models ?? []
      
      // Try primary model first, then fallback models
      const modelsToTry = [
        { providerID: input.model.providerID, modelID: input.model.id },
        ...fallbackModels
          .map((modelID) => {
            const parts = modelID.split("/")
            if (parts.length !== 2 || !parts[0] || !parts[1]) {
              l.warn("invalid fallback model format, skipping", { modelID })
              return null
            }
            return { providerID: parts[0], modelID: parts[1] }
          })
          .filter((x): x is { providerID: string; modelID: string } => x !== null),
      ]

      let lastError: unknown
      for (let i = 0; i < modelsToTry.length; i++) {
        const modelInfo = modelsToTry[i]
        if (!modelInfo) continue

        const isPrimary = i === 0
        const model = isPrimary
          ? input.model
          : yield* provider.getModel(
              ProviderID.make(modelInfo.providerID),
              ModelID.make(modelInfo.modelID),
            )

        if (!isPrimary) {
          l.info("trying fallback model", {
            attempt: i + 1,
            providerID: modelInfo.providerID,
            modelID: modelInfo.modelID,
          })
        }

        const exit = yield* runWithModel({ ...input, model }).pipe(Effect.exit)
        if (Exit.isSuccess(exit)) return exit.value

        lastError = Cause.squash(exit.cause)

        if (!isRetryableError(lastError)) {
          l.warn("non-retryable error, skipping fallback", {
            error: String(lastError),
          })
          break
        }

        if (isPrimary && fallbackModels.length > 0) {
          l.warn("primary model failed, trying fallback", {
            error: String(lastError),
            fallbackCount: fallbackModels.length,
          })
        } else if (!isPrimary && i < modelsToTry.length - 1) {
          l.warn("fallback model failed, trying next", {
            attempt: i + 1,
            error: String(lastError),
          })
        }
      }

      // All models failed — emit a typed failure, not a defect
      return yield* Effect.fail(
        lastError instanceof LLMFallbackError
          ? lastError
          : new LLMFallbackError({
              message: lastError instanceof Error ? lastError.message : String(lastError ?? "All models failed"),
              cause: lastError,
            }),
      )
    })

    const runWithModel = Effect.fn("LLM.runWithModel")(function* (input: StreamRequest) {
      const l = log
        .clone()
        .tag("providerID", input.model.providerID)
        .tag("modelID", input.model.id)
        .tag("session.id", input.sessionID)
        .tag("small", (input.small ?? false).toString())
        .tag("agent", input.agent.name)
        .tag("mode", input.agent.mode)
      l.info("stream", {
        modelID: input.model.id,
        providerID: input.model.providerID,
      })

      const [language, cfg, item, info] = yield* Effect.all(
        [
          provider.getLanguage(input.model),
          config.get(),
          provider.getProvider(input.model.providerID),
          auth.get(input.model.providerID),
        ],
        { concurrency: "unbounded" },
      )

      // Check Ref for already-latched headers (fast path, no DB read needed).
      // The Ref stores the actual headers, eliminating the race between DB fetch
      // and Ref.modify that previously caused concurrent requests to diverge.
      const existingHeaders = yield* Ref.get(latchedHeaders).pipe(
        Effect.map((map) => map.get(input.sessionID)),
      )

      const isWorkflow = language instanceof GitLabWorkflowLanguageModel

      // Re-resolve tool set for the actual model being used.
      // When a fallback model differs from the primary (e.g. GPT → Claude),
      // the tool set must change: GPT models use apply_patch, others use edit/write.
      const modelApiID = input.model.api.id
      const usePatch = ModelTools.shouldUseApplyPatch(modelApiID)
      const filteredTools: Record<string, Tool> = {}
      for (const [key, t] of Object.entries(input.tools)) {
        if (key === "apply_patch" && !usePatch) continue
        if ((key === "edit" || key === "write") && usePatch) continue
        filteredTools[key] = t
      }

      // Prepare with existing latched headers from Ref (or compute new if first request)
      const prepared = yield* LLMRequestPrep.prepare({
        ...input,
        tools: filteredTools,
        provider: item,
        auth: info,
        plugin,
        flags,
        isWorkflow,
        latchedHeaders: existingHeaders,
      })

      // Atomically try to latch: winner stores headers in Ref, loser gets winner's headers
      const [won, winnerHeaders] = yield* Ref.modify(latchedHeaders, (map): [
        readonly [boolean, Record<string, string> | undefined],
        Map<string, Record<string, string>>,
      ] => {
        const existing = map.get(input.sessionID)
        if (existing) return [[false, existing], map]
        return [[true, undefined], new Map(map).set(input.sessionID, prepared.headers)]
      })

      // If we lost the race and didn't already have headers, use the winner's
      if (!won && winnerHeaders && !existingHeaders) {
        prepared.headers = winnerHeaders
      }

      // Persist to DB for session recovery (fire-and-forget).
      // sandbox+catch handles both typed failures and defects (e.g. NotFoundError
      // thrown synchronously inside SyncEvent.project when session doesn't exist).
      if (won) {
        yield* session.setLatchedHeaders({
          sessionID: SessionID.make(input.sessionID),
          headers: prepared.headers,
        }).pipe(
          Effect.sandbox,
          Effect.catch(() => Effect.void),
        )
        l.info("latched headers for session", { sessionID: input.sessionID })
      }

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      if (language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel = language as GitLabWorkflowLanguageModel & {
          sessionID?: string
          sessionPreapprovedTools?: string[]
          approvalHandler?: (approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean }>
        }
        workflowModel.sessionID = input.sessionID
        workflowModel.systemPrompt = prepared.system.join("\n")
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const t = prepared.tools[toolName]
          if (!t || !t.execute) {
            return { result: "", error: `Unknown tool: ${toolName}` }
          }
          try {
            const result = await t.execute!(JSON.parse(argsJson), {
              toolCallId: _requestID,
              messages: input.messages,
              abortSignal: input.abort,
            })
            const output = typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
            return {
              result: output,
              metadata: typeof result === "object" ? result?.metadata : undefined,
              title: typeof result === "object" ? result?.title : undefined,
            }
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e)
            return { result: "", error: message }
          }
        }

        const ruleset = Permission.merge(input.agent.permission ?? [], input.permission ?? [])
        workflowModel.sessionPreapprovedTools = Object.keys(prepared.tools).filter((name) => {
          const match = ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
          return !match || match.action !== "ask"
        })

        const bridge = yield* EffectBridge.make()
        const approvedToolsForSession = new Set<string>()
        workflowModel.approvalHandler = bridge.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
          // Auto-approve tools that were already approved in this session
          // (prevents infinite approval loops for server-side MCP tools)
          if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
            return { approved: true }
          }

          const id = PermissionID.ascending()
          let unsub: (() => void) | undefined
          try {
            unsub = Bus.subscribe(Permission.Event.Replied, (evt) => {
              if (evt.properties.requestID === id) void evt.properties.reply
            })
            const toolPatterns = approvalTools.map((t: { name: string; args: string }) => {
              try {
                const parsed = JSON.parse(t.args) as Record<string, unknown>
                const title = (parsed?.title ?? parsed?.name ?? "") as string
                return title ? `${t.name}: ${title}` : t.name
              } catch {
                return t.name
              }
            })
            const uniquePatterns = [...new Set(toolPatterns)] as string[]
            await bridge.promise(
              perm.ask({
                id,
                sessionID: SessionID.make(input.sessionID),
                permission: "workflow_tool_approval",
                patterns: uniquePatterns,
                metadata: { tools: approvalTools },
                always: uniquePatterns,
                ruleset: [],
              }),
            )
            for (const name of uniqueNames) approvedToolsForSession.add(name)
            workflowModel.sessionPreapprovedTools = [...(workflowModel.sessionPreapprovedTools ?? []), ...uniqueNames]
            return { approved: true }
          } catch {
            return { approved: false }
          } finally {
            unsub?.()
          }
        })
      }

      const tracer = cfg.experimental?.openTelemetry
        ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
        : undefined
      const telemetryTracer = tracer
        ? new Proxy(tracer, {
            get(target, prop, receiver) {
              if (prop !== "startSpan") return Reflect.get(target, prop, receiver)
              return (...args: Parameters<typeof target.startSpan>) => {
                const span = target.startSpan(...args)
                span.setAttribute("session.id", input.sessionID)
                return span
              }
            },
          })
        : undefined

      // Runtime seam: native is an opt-in adapter over @opencode-ai/llm. It
      // either returns a ready LLMEvent stream or a concrete fallback reason.
      if (flags.experimentalNativeLlm) {
        const native = LLMNativeRuntime.stream({
          model: input.model,
          provider: item,
          auth: info,
          llmClient,
          messages: prepared.messages,
          tools: prepared.tools,
          toolChoice: input.toolChoice,
          temperature: prepared.params.temperature,
          topP: prepared.params.topP,
          topK: prepared.params.topK,
          maxOutputTokens: prepared.params.maxOutputTokens,
          providerOptions: prepared.params.options,
          headers: prepared.headers,
          abort: input.abort,
        })
        if (native.type === "supported") {
          yield* Effect.logInfo("llm runtime selected").pipe(
            Effect.annotateLogs({
              "llm.runtime": "native",
              "llm.provider": input.model.providerID,
              "llm.model": input.model.id,
            }),
          )
          return {
            type: "native" as const,
            stream: native.stream,
          }
        }
        yield* Effect.logInfo("llm runtime selected").pipe(
          Effect.annotateLogs({
            "llm.runtime": "ai-sdk",
            "llm.provider": input.model.providerID,
            "llm.model": input.model.id,
            "llm.native_unsupported_reason": native.reason,
          }),
        )
        l.info("native runtime unavailable; falling back to ai-sdk", { reason: native.reason })
      }

      yield* Effect.logInfo("llm runtime selected").pipe(
        Effect.annotateLogs({
          "llm.runtime": "ai-sdk",
          "llm.provider": input.model.providerID,
          "llm.model": input.model.id,
        }),
      )
      // Default runtime path: AI SDK owns provider execution and tool dispatch;
      // LLMAISDK.toLLMEvents below normalizes fullStream parts for the processor.
      const aiResult = streamText({
        onError(error) {
          l.error("stream error", {
            error,
          })
        },
        async experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.toLowerCase()
          if (lower !== failed.toolCall.toolName && prepared.tools[lower]) {
            l.info("repairing tool call", {
              tool: failed.toolCall.toolName,
              repaired: lower,
            })
            return {
              ...failed.toolCall,
              toolName: lower,
            }
          }
          return {
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error.message,
            }),
            toolName: "invalid",
          }
        },
        temperature: prepared.params.temperature,
        topP: prepared.params.topP,
        topK: prepared.params.topK,
        providerOptions: ProviderTransform.providerOptions(input.model, prepared.params.options),
        activeTools: Object.keys(prepared.tools).filter((x) => x !== "invalid"),
        tools: prepared.tools,
        toolChoice: input.toolChoice,
        maxOutputTokens: prepared.params.maxOutputTokens,
        abortSignal: input.abort,
        headers: prepared.headers,
        maxRetries: input.retries ?? 0,
        messages: prepared.messages,
        model: wrapLanguageModel({
          model: language,
          middleware: [
            {
              specificationVersion: "v3" as const,
              async transformParams(args) {
                if (args.type === "stream") {
                  // @ts-expect-error
                  args.params.prompt = ProviderTransform.message(
                    args.params.prompt,
                    input.model,
                    prepared.messageTransformOptions,
                  )
                }
                return args.params
              },
            },
          ],
        }),
        experimental_telemetry: {
          isEnabled: cfg.experimental?.openTelemetry,
          functionId: "session.llm",
          tracer: telemetryTracer,
          metadata: {
            userId: cfg.username ?? "unknown",
            sessionId: input.sessionID,
          },
        },
      })
      // Surface HTTP errors (4xx/5xx) eagerly so the fallback loop in `run` can
      // catch them and try the next model. We peek at stream events to detect
      // errors before returning. For successful streams, we see content events
      // and return immediately (without touching `response`, which would consume
      // the stream). For failed streams, the stream ends without content events,
      // and we check `response` to get the actual error.
      const iter = aiResult.fullStream[Symbol.asyncIterator]()
      const buffered: Array<unknown> = []
      let sawContent = false

      while (true) {
        if (input.abort?.aborted) {
          return yield* Effect.fail(new Error("Stream aborted by caller"))
        }
        const read = yield* Effect.promise(() => iter.next()).pipe(
          input.abort ? (e) => Effect.raceFirst(e, waitForAbort(input.abort)) : (e) => e,
          Effect.timeoutOrElse({
            duration: "60 seconds",
            orElse: () => Effect.fail(new Error("Stream peek timed out waiting for first response")),
          }),
        )
        if (read.done) break

        const ev = read.value as { type: string; error?: unknown; finishReason?: string }
        buffered.push(read.value)

        if (ev.type === "error") {
          const err = ev.error
          return yield* Effect.fail(err instanceof Error ? err : new Error(String(err)))
        }

        if (
          ev.type === "text-delta" ||
          ev.type === "text-start" ||
          ev.type === "tool-call" ||
          ev.type === "tool-input-start" ||
          ev.type === "reasoning-delta" ||
          ev.type === "reasoning-start"
        ) {
          sawContent = true
          break
        }
      }

      // If no content events were seen, the stream may have failed.
      // Check the response promise (safe to access since stream is already consumed).
      if (!sawContent) {
        const responseResult = yield* Effect.promise(() =>
          Promise.resolve(aiResult.response)
            .then(() => ({ ok: true as const }))
            .catch((err: unknown) => ({ ok: false as const, error: err })),
        )
        if (!responseResult.ok) {
          const err = responseResult.error
          return yield* Effect.fail(err instanceof Error ? err : new Error(String(err)))
        }
      }

      // Prepend buffered events and continue with the SAME iterator.
      const wrappedFullStream = {
        async *[Symbol.asyncIterator]() {
          for (const event of buffered) yield event
          while (true) {
            const read = await iter.next()
            if (read.done) break
            yield read.value
          }
        },
      }
      return {
        type: "ai-sdk" as const,
        result: { ...aiResult, fullStream: wrappedFullStream as unknown as typeof aiResult.fullStream },
      }
    })

    const stream: Interface["stream"] = (input) =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (ctrl) => Effect.sync(() => ctrl.abort()),
            )

            const result = yield* run({ ...input, abort: ctrl.signal })

            if (result.type === "native") return result.stream

            // Adapter seam: both runtimes expose the same LLMEvent stream. Native
            // already returns one; AI SDK streams are converted here.
            const state = LLMAISDK.adapterState()
            return Stream.fromAsyncIterable(result.result.fullStream, (e) =>
              e instanceof Error ? e : new Error(String(e)),
            ).pipe(
              Stream.mapEffect((event) => LLMAISDK.toLLMEvents(state, event)),
              Stream.flatMap((events) => Stream.fromIterable(events)),
            )
          }),
        ),
      )

    return Service.of({ stream })
  }),
)

export const layer = live.pipe(Layer.provide(Permission.defaultLayer))

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(
      LLMClient.layer.pipe(Layer.provide(Layer.mergeAll(RequestExecutor.defaultLayer, WebSocketExecutor.layer))),
    ),
    Layer.provide(RuntimeFlags.defaultLayer),
    Layer.provide(Session.defaultLayer),
  ),
)

export const hasToolCalls = LLMRequestPrep.hasToolCalls

export * as LLM from "./llm"
