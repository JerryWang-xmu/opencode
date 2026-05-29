import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import path from "path"
import { pathToFileURL } from "url"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Env } from "../../src/env"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { AccountTest } from "../fake/account"
import { AuthTest } from "../fake/auth"
import { NpmTest } from "../fake/npm"

const configLayer = Config.layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(AuthTest.empty),
  Layer.provide(AccountTest.empty),
  Layer.provide(NpmTest.noop),
  Layer.provide(FetchHttpClient.layer),
)
const it = testEffect(
  Layer.mergeAll(
    Plugin.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(configLayer),
      Layer.provide(RuntimeFlags.layer({ disableDefaultPlugins: true })),
    ),
    CrossSpawnSpawner.defaultLayer,
  ),
)

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      const file = path.join(dir, "plugin.ts")
      yield* Effect.all(
        [
          Effect.promise(() => Bun.write(file, source)),
          Effect.promise(() =>
            Bun.write(
              path.join(dir, "opencode.json"),
              JSON.stringify(
                {
                  $schema: "https://opencode.ai/config.json",
                  plugin: [pathToFileURL(file).href],
                },
                null,
                2,
              ),
            ),
          ),
        ],
        { discard: true, concurrency: 2 },
      )
      return yield* self
    }),
  )
}

const triggerSessionStop = Effect.fn("PluginSessionStopTest.triggerSessionStop")(function* (
  sessionID: string,
  reason: "completed" | "error" | "cancelled" | "context_overflow",
  message?: string,
) {
  const plugin = yield* Plugin.Service
  const out = {}
  yield* plugin.trigger("session.stop", { sessionID, reason, message }, out)
  return out
})

describe("session.stop hook", () => {
  it.live("triggers session.stop hook with completed reason", () =>
    withProject(
      [
        "export default async () => ({",
        '  "session.stop": (input, output) => {',
        '    output.triggered = true',
        '    output.sessionID = input.sessionID',
        '    output.reason = input.reason',
        '    output.message = input.message',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const result = yield* triggerSessionStop("test-session-123", "completed")
        expect(result).toEqual({
          triggered: true,
          sessionID: "test-session-123",
          reason: "completed",
          message: undefined,
        })
      }),
    ),
  )

  it.live("triggers session.stop hook with error reason and message", () =>
    withProject(
      [
        "export default async () => ({",
        '  "session.stop": (input, output) => {',
        '    output.sessionID = input.sessionID',
        '    output.reason = input.reason',
        '    output.message = input.message',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const result = yield* triggerSessionStop("test-session-456", "error", "Something went wrong")
        expect(result).toEqual({
          sessionID: "test-session-456",
          reason: "error",
          message: "Something went wrong",
        })
      }),
    ),
  )

  it.live("triggers session.stop hook with cancelled reason", () =>
    withProject(
      [
        "export default async () => ({",
        '  "session.stop": (input, output) => {',
        '    output.reason = input.reason',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const result = yield* triggerSessionStop("test-session-789", "cancelled")
        expect(result).toEqual({ reason: "cancelled" })
      }),
    ),
  )

  it.live("triggers session.stop hook with context_overflow reason", () =>
    withProject(
      [
        "export default async () => ({",
        '  "session.stop": (input, output) => {',
        '    output.reason = input.reason',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const result = yield* triggerSessionStop("test-session-overflow", "context_overflow")
        expect(result).toEqual({ reason: "context_overflow" })
      }),
    ),
  )

  it.live("triggers session.stop hook and collects calls in output", () =>
    withProject(
      [
        "export default async () => ({",
        '  "session.stop": (input, output) => {',
        '    output.calls = output.calls || []',
        '    output.calls.push("first:" + input.reason)',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const result = yield* triggerSessionStop("test-session-multi", "completed")
        expect(result).toEqual({ calls: ["first:completed"] })
      }),
    ),
  )

  it.live("allows session.stop hook to perform cleanup", () =>
    withProject(
      [
        "export default async () => ({",
        '  "session.stop": (input, output) => {',
        '    if (input.reason === "completed") {',
        '      output.cleanupPerformed = true',
        '    }',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const result = yield* triggerSessionStop("test-cleanup", "completed")
        expect(result).toEqual({ cleanupPerformed: true })
      }),
    ),
  )
})
