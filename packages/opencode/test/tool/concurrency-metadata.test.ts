import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Format } from "../../src/format"
import { LSP } from "@/lsp/lsp"
import { Ripgrep } from "../../src/file/ripgrep"
import { Instruction } from "../../src/session/instruction"
import { Plugin } from "../../src/plugin"
import { Reference } from "@/reference/reference"
import { RepositoryCache } from "@/reference/repository-cache"
import { ReadTool } from "../../src/tool/read"
import { GrepTool } from "../../src/tool/grep"
import { GlobTool } from "../../src/tool/glob"
import { LspTool } from "../../src/tool/lsp"
import { WebFetchTool } from "../../src/tool/webfetch"
import { EditTool } from "../../src/tool/edit"
import { ShellTool } from "../../src/tool/shell"
import { WriteTool } from "../../src/tool/write"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const referenceLayer = Reference.layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(RepositoryCache.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

const readLayer = Layer.mergeAll(
  AppFileSystem.defaultLayer,
  Instruction.defaultLayer,
  LSP.defaultLayer,
  referenceLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
)

const searchLayer = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  AppFileSystem.defaultLayer,
  Ripgrep.defaultLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
  referenceLayer,
)

const lspLayer = Layer.mergeAll(
  LSP.defaultLayer,
  AppFileSystem.defaultLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
)

const webfetchLayer = Layer.mergeAll(
  FetchHttpClient.layer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
)

const editLayer = Layer.mergeAll(
  LSP.defaultLayer,
  AppFileSystem.defaultLayer,
  Format.defaultLayer,
  Bus.layer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
)

const writeLayer = Layer.mergeAll(
  LSP.defaultLayer,
  AppFileSystem.defaultLayer,
  Bus.layer,
  Format.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Truncate.defaultLayer,
  Agent.defaultLayer,
)

const shellLayer = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  AppFileSystem.defaultLayer,
  Plugin.defaultLayer,
  Truncate.defaultLayer,
  Config.defaultLayer,
  Agent.defaultLayer,
  RuntimeFlags.defaultLayer,
)

const readIt = testEffect(readLayer)
const searchIt = testEffect(searchLayer)
const lspIt = testEffect(lspLayer)
const webfetchIt = testEffect(webfetchLayer)
const editIt = testEffect(editLayer)
const writeIt = testEffect(writeLayer)
const shellIt = testEffect(shellLayer)

describe("concurrency metadata", () => {
  readIt.effect("read tool has concurrency mode 'parallel'", () =>
    Effect.gen(function* () {
      const info = yield* ReadTool
      const def = yield* info.init()
      expect(def.concurrency).toEqual({ mode: "parallel" })
    }),
  )

  searchIt.effect("grep tool has concurrency mode 'parallel'", () =>
    Effect.gen(function* () {
      const info = yield* GrepTool
      const def = yield* info.init()
      expect(def.concurrency).toEqual({ mode: "parallel" })
    }),
  )

  searchIt.effect("glob tool has concurrency mode 'parallel'", () =>
    Effect.gen(function* () {
      const info = yield* GlobTool
      const def = yield* info.init()
      expect(def.concurrency).toEqual({ mode: "parallel" })
    }),
  )

  lspIt.effect("lsp tool has concurrency mode 'parallel'", () =>
    Effect.gen(function* () {
      const info = yield* LspTool
      const def = yield* info.init()
      expect(def.concurrency).toEqual({ mode: "parallel" })
    }),
  )

  editIt.effect("edit tool defaults to concurrency mode 'serial'", () =>
    Effect.gen(function* () {
      const info = yield* EditTool
      const def = yield* info.init()
      expect(def.concurrency?.mode ?? "serial").toBe("serial")
    }),
  )

  shellIt.instance("shell tool defaults to concurrency mode 'serial'", () =>
    Effect.gen(function* () {
      const info = yield* ShellTool
      const def = yield* info.init()
      expect(def.concurrency?.mode ?? "serial").toBe("serial")
    }),
  )

  writeIt.effect("write tool defaults to concurrency mode 'serial'", () =>
    Effect.gen(function* () {
      const info = yield* WriteTool
      const def = yield* info.init()
      expect(def.concurrency?.mode ?? "serial").toBe("serial")
    }),
  )
})
