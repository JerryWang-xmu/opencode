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

const triggerFileChanged = Effect.fn("PluginFileChangedTest.triggerFileChanged")(function* (
  filePath: string,
  event: "created" | "modified" | "deleted",
  sessionID?: string,
) {
  const plugin = yield* Plugin.Service
  const out = {}
  yield* plugin.trigger("file.changed", { path: filePath, event, sessionID }, out)
  return out
})

describe("file.changed hook", () => {
  it.live("triggers file.changed hook with modified event", () =>
    withProject(
      [
        "export default async () => ({",
        '  "file.changed": (input, output) => {',
        '    output.triggered = true',
        '    output.path = input.path',
        '    output.event = input.event',
        '    output.sessionID = input.sessionID',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const result = yield* triggerFileChanged("/test/file.ts", "modified", "test-session")
        expect(result).toEqual({
          triggered: true,
          path: "/test/file.ts",
          event: "modified",
          sessionID: "test-session",
        })
      }),
    ),
  )

  it.live("triggers file.changed hook with created event", () =>
    withProject(
      [
        "export default async () => ({",
        '  "file.changed": (input, output) => {',
        '    output.event = input.event',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const result = yield* triggerFileChanged("/test/new-file.ts", "created")
        expect(result).toEqual({ event: "created" })
      }),
    ),
  )

  it.live("triggers file.changed hook with deleted event", () =>
    withProject(
      [
        "export default async () => ({",
        '  "file.changed": (input, output) => {',
        '    output.event = input.event',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const result = yield* triggerFileChanged("/test/old-file.ts", "deleted")
        expect(result).toEqual({ event: "deleted" })
      }),
    ),
  )

  it.live("triggers file.changed hook without sessionID", () =>
    withProject(
      [
        "export default async () => ({",
        '  "file.changed": (input, output) => {',
        '    output.sessionID = input.sessionID',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const result = yield* triggerFileChanged("/test/file.ts", "modified")
        expect(result).toEqual({ sessionID: undefined })
      }),
    ),
  )

  it.live("triggers file.changed hook and collects calls in output", () =>
    withProject(
      [
        "export default async () => ({",
        '  "file.changed": (input, output) => {',
        '    output.calls = output.calls || []',
        '    output.calls.push("first:" + input.event)',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        const result = yield* triggerFileChanged("/test/file.ts", "modified")
        expect(result).toEqual({ calls: ["first:modified"] })
      }),
    ),
  )
})
