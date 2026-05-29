import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { Permission, isProtectedPath } from "../../src/permission"
import { Bus } from "../../src/bus"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(Permission.defaultLayer, Bus.defaultLayer, CrossSpawnSpawner.defaultLayer),
)

// ── evaluate: basic permission evaluation ──

describe("evaluate - basic permission evaluation", () => {
  test("returns ask for empty rulesets", () => {
    expect(Permission.evaluate("bash", "ls", []).action).toBe("ask")
    expect(Permission.evaluate("edit", "src/foo.ts", []).action).toBe("ask")
    expect(Permission.evaluate("write", "/tmp/out.txt", []).action).toBe("ask")
  })

  test("allows access to allowed paths", () => {
    const ruleset: Permission.Ruleset = [{ permission: "edit", pattern: "src/*", action: "allow" }]
    expect(Permission.evaluate("edit", "src/index.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "src/utils/helper.ts", ruleset).action).toBe("allow")
  })

  test("denies access to denied paths", () => {
    const ruleset: Permission.Ruleset = [{ permission: "edit", pattern: "secret/*", action: "deny" }]
    expect(Permission.evaluate("edit", "secret/keys.txt", ruleset).action).toBe("deny")
  })

  test("returns ask when no rule matches the pattern", () => {
    const ruleset: Permission.Ruleset = [{ permission: "edit", pattern: "src/*", action: "allow" }]
    expect(Permission.evaluate("edit", "test/foo.test.ts", ruleset).action).toBe("ask")
  })

  test("returns ask when no rule matches the permission", () => {
    const ruleset: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
    expect(Permission.evaluate("edit", "src/foo.ts", ruleset).action).toBe("ask")
  })

  test("handles multiple rulesets (config + approved)", () => {
    const config: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
    const approved: Permission.Ruleset = [{ permission: "bash", pattern: "rm *", action: "deny" }]
    expect(Permission.evaluate("bash", "ls", config, approved).action).toBe("allow")
    expect(Permission.evaluate("bash", "rm -rf /", config, approved).action).toBe("deny")
  })
})

// ── evaluate: glob pattern matching ──

describe("evaluate - glob pattern matching", () => {
  test("single wildcard matches any string", () => {
    const ruleset: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
    expect(Permission.evaluate("bash", "ls", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "rm -rf /", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "git commit -m 'fix'", ruleset).action).toBe("allow")
  })

  test("prefix wildcard matches suffix", () => {
    const ruleset: Permission.Ruleset = [{ permission: "bash", pattern: "git *", action: "allow" }]
    expect(Permission.evaluate("bash", "git status", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "git commit", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "npm install", ruleset).action).toBe("ask")
  })

  test("single wildcard matches nested paths (wildcard spans /)", () => {
    // In this implementation, * matches any string including /, so src/*.ts matches deeply nested files
    const ruleset: Permission.Ruleset = [{ permission: "edit", pattern: "src/*.ts", action: "allow" }]
    expect(Permission.evaluate("edit", "src/index.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "src/utils/helper.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "src/deep/nested/file.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "src/index.js", ruleset).action).toBe("ask")
  })

  test("wildcard matches node_modules patterns", () => {
    const ruleset: Permission.Ruleset = [{ permission: "edit", pattern: "*node_modules*", action: "deny" }]
    expect(Permission.evaluate("edit", "node_modules/pkg/index.js", ruleset).action).toBe("deny")
    expect(Permission.evaluate("edit", "packages/foo/node_modules/bar/baz.ts", ruleset).action).toBe("deny")
    expect(Permission.evaluate("edit", "src/index.ts", ruleset).action).toBe("ask")
  })

  test("complex patterns with multiple wildcards", () => {
    // packages/*/src/*.ts: * spans / so this matches any depth under packages and under src
    const ruleset: Permission.Ruleset = [
      { permission: "edit", pattern: "packages/*/src/*.ts", action: "allow" },
    ]
    expect(Permission.evaluate("edit", "packages/core/src/index.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "packages/opencode/src/tool/edit.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "other/core/src/index.ts", ruleset).action).toBe("ask")
  })

  test("question mark matches single character", () => {
    const ruleset: Permission.Ruleset = [{ permission: "edit", pattern: "file?.ts", action: "allow" }]
    expect(Permission.evaluate("edit", "file1.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "fileA.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "file12.ts", ruleset).action).toBe("ask")
  })

  test("backslash paths are normalized to forward slashes", () => {
    const ruleset: Permission.Ruleset = [{ permission: "edit", pattern: "src/**/*.ts", action: "allow" }]
    expect(Permission.evaluate("edit", "src\\utils\\helper.ts", ruleset).action).toBe("allow")
  })
})

// ── evaluate: permission precedence ──

describe("evaluate - permission precedence", () => {
  test("last matching rule wins (deny after allow)", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "bash", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "rm *", action: "deny" },
    ]
    expect(Permission.evaluate("bash", "rm -rf /", ruleset).action).toBe("deny")
    expect(Permission.evaluate("bash", "ls", ruleset).action).toBe("allow")
  })

  test("last matching rule wins (allow after deny)", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "git *", action: "allow" },
    ]
    expect(Permission.evaluate("bash", "git status", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "rm -rf /", ruleset).action).toBe("deny")
  })

  test("more specific rule placed last overrides general rule", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "edit", pattern: "*", action: "deny" },
      { permission: "edit", pattern: "src/*", action: "allow" },
      { permission: "edit", pattern: "src/secret.ts", action: "deny" },
    ]
    expect(Permission.evaluate("edit", "src/index.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "src/secret.ts", ruleset).action).toBe("deny")
    expect(Permission.evaluate("edit", "test/foo.ts", ruleset).action).toBe("deny")
  })

  test("wildcard permission acts as fallback for unmatched tools", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "*", pattern: "*", action: "ask" },
      { permission: "bash", pattern: "*", action: "allow" },
    ]
    expect(Permission.evaluate("bash", "ls", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "foo.ts", ruleset).action).toBe("ask")
    expect(Permission.evaluate("unknown_tool", "anything", ruleset).action).toBe("ask")
  })

  test("later wildcard permission overrides earlier specific permission", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "bash", pattern: "*", action: "allow" },
      { permission: "*", pattern: "*", action: "deny" },
    ]
    expect(Permission.evaluate("bash", "ls", ruleset).action).toBe("deny")
    expect(Permission.evaluate("edit", "foo.ts", ruleset).action).toBe("deny")
  })

  test("glob permission pattern matches tool prefix", () => {
    const ruleset: Permission.Ruleset = [{ permission: "mcp_*", pattern: "*", action: "allow" }]
    expect(Permission.evaluate("mcp_server_tool", "anything", ruleset).action).toBe("allow")
    expect(Permission.evaluate("mcp_dangerous", "anything", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "ls", ruleset).action).toBe("ask")
  })
})

// ── evaluate: tool-specific permissions ──

describe("evaluate - tool-specific permissions", () => {
  test("bash tool with command patterns", () => {
    // Last match wins: wildcard fallback first, then specific overrides
    const ruleset: Permission.Ruleset = [
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "bash", pattern: "git *", action: "allow" },
      { permission: "bash", pattern: "npm *", action: "allow" },
      { permission: "bash", pattern: "rm -rf *", action: "deny" },
    ]
    expect(Permission.evaluate("bash", "git status", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "npm install", ruleset).action).toBe("allow")
    expect(Permission.evaluate("bash", "rm -rf /", ruleset).action).toBe("deny")
    expect(Permission.evaluate("bash", "curl https://example.com", ruleset).action).toBe("ask")
  })

  test("edit tool with file path patterns", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "edit", pattern: "*secrets*", action: "deny" },
      { permission: "edit", pattern: "src/*", action: "allow" },
      { permission: "edit", pattern: "test/*", action: "allow" },
    ]
    expect(Permission.evaluate("edit", "src/index.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "test/foo.test.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "src/secrets/keys.ts", ruleset).action).toBe("allow")
    // "src/*" is the last matching rule for src/secrets/keys.ts, so it's allowed
    // To deny secrets, the deny rule must come AFTER the allow rules
  })

  test("edit tool with deny-after-allow precedence", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "edit", pattern: "src/*", action: "allow" },
      { permission: "edit", pattern: "test/*", action: "allow" },
      { permission: "edit", pattern: "*secrets*", action: "deny" },
    ]
    expect(Permission.evaluate("edit", "src/index.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "test/foo.test.ts", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "src/secrets/keys.ts", ruleset).action).toBe("deny")
  })

  test("write tool with output path patterns", () => {
    // * spans / in this implementation, so dist/* matches dist/bundle.js and dist/deep/file.js
    const ruleset: Permission.Ruleset = [
      { permission: "write", pattern: "*", action: "ask" },
      { permission: "write", pattern: "dist/*", action: "allow" },
      { permission: "write", pattern: "/tmp/*", action: "allow" },
    ]
    expect(Permission.evaluate("write", "dist/bundle.js", ruleset).action).toBe("allow")
    expect(Permission.evaluate("write", "/tmp/output.log", ruleset).action).toBe("allow")
    expect(Permission.evaluate("write", "src/index.ts", ruleset).action).toBe("ask")
  })

  test("edit permission covers write and apply_patch for disabled check", () => {
    const ruleset: Permission.Ruleset = [{ permission: "edit", pattern: "*", action: "deny" }]
    const disabled = Permission.disabled(["edit", "write", "apply_patch", "bash"], ruleset)
    expect(disabled.has("edit")).toBe(true)
    expect(disabled.has("write")).toBe(true)
    expect(disabled.has("apply_patch")).toBe(true)
    expect(disabled.has("bash")).toBe(false)
  })
})

// ── isProtectedPath: comprehensive protected path detection ──

describe("isProtectedPath - protected path detection", () => {
  test("detects .git directory and contents", () => {
    expect(isProtectedPath(".git")).toBe(true)
    expect(isProtectedPath(".git/config")).toBe(true)
    expect(isProtectedPath(".git/HEAD")).toBe(true)
    expect(isProtectedPath(".git/hooks/pre-commit")).toBe(true)
    expect(isProtectedPath(".git/objects/pack/abc123")).toBe(true)
    expect(isProtectedPath("project/.git")).toBe(true)
    expect(isProtectedPath("deep/nested/project/.git/config")).toBe(true)
  })

  test("detects .env files and variants", () => {
    expect(isProtectedPath(".env")).toBe(true)
    expect(isProtectedPath(".env.local")).toBe(true)
    expect(isProtectedPath(".env.production")).toBe(true)
    expect(isProtectedPath(".env.development")).toBe(true)
    expect(isProtectedPath(".env.staging")).toBe(true)
    expect(isProtectedPath("project/.env")).toBe(true)
    expect(isProtectedPath("project/.env.local")).toBe(true)
  })

  test("detects SSH keys and credentials", () => {
    expect(isProtectedPath(".ssh")).toBe(true)
    expect(isProtectedPath(".ssh/id_rsa")).toBe(true)
    expect(isProtectedPath(".ssh/id_ed25519")).toBe(true)
    expect(isProtectedPath(".ssh/authorized_keys")).toBe(true)
    expect(isProtectedPath(".ssh/known_hosts")).toBe(true)
    expect(isProtectedPath(".ssh/config")).toBe(true)
    expect(isProtectedPath("home/user/.ssh/id_rsa")).toBe(true)
  })

  test("detects GnuPG directory", () => {
    expect(isProtectedPath(".gnupg")).toBe(true)
    expect(isProtectedPath(".gnupg/pubring.kbx")).toBe(true)
    expect(isProtectedPath(".gnupg/secring.gpg")).toBe(true)
    expect(isProtectedPath("home/user/.gnupg/private-keys-v1.d/key.key")).toBe(true)
  })

  test("detects cloud credentials", () => {
    expect(isProtectedPath(".aws/credentials")).toBe(true)
    expect(isProtectedPath(".aws/config")).toBe(true)
    expect(isProtectedPath("home/user/.aws/credentials")).toBe(true)
    expect(isProtectedPath(".kube/config")).toBe(true)
    expect(isProtectedPath("home/user/.kube/config")).toBe(true)
    expect(isProtectedPath(".docker/config.json")).toBe(true)
    expect(isProtectedPath("home/user/.docker/config.json")).toBe(true)
  })

  test("detects package registry configs", () => {
    expect(isProtectedPath(".npmrc")).toBe(true)
    expect(isProtectedPath(".yarnrc")).toBe(true)
    expect(isProtectedPath(".pypirc")).toBe(true)
    expect(isProtectedPath("home/user/.npmrc")).toBe(true)
    expect(isProtectedPath("home/user/.yarnrc")).toBe(true)
    expect(isProtectedPath("home/user/.pypirc")).toBe(true)
  })

  test("detects shell configuration files", () => {
    expect(isProtectedPath(".bashrc")).toBe(true)
    expect(isProtectedPath(".bash_profile")).toBe(true)
    expect(isProtectedPath(".zshrc")).toBe(true)
    expect(isProtectedPath(".profile")).toBe(true)
    expect(isProtectedPath("home/user/.bashrc")).toBe(true)
    expect(isProtectedPath("home/user/.zshrc")).toBe(true)
  })

  test("detects sensitive .config subdirectories but not .config itself", () => {
    expect(isProtectedPath(".config")).toBe(false)
    expect(isProtectedPath(".config/opencode/config.json")).toBe(false)
    expect(isProtectedPath("home/user/.config/some-app/settings")).toBe(false)
    expect(isProtectedPath(".config/git/credentials")).toBe(true)
    expect(isProtectedPath(".config/gcloud/application_default_credentials.json")).toBe(true)
    expect(isProtectedPath(".config/ssh/id_rsa")).toBe(true)
  })

  test("detects package manager lock files", () => {
    expect(isProtectedPath("package-lock.json")).toBe(true)
    expect(isProtectedPath("yarn.lock")).toBe(true)
    expect(isProtectedPath("pnpm-lock.yaml")).toBe(true)
    expect(isProtectedPath("bun.lockb")).toBe(true)
    expect(isProtectedPath("Gemfile.lock")).toBe(true)
    expect(isProtectedPath("poetry.lock")).toBe(true)
    expect(isProtectedPath("Pipfile.lock")).toBe(true)
    expect(isProtectedPath("packages/opencode/package-lock.json")).toBe(true)
    expect(isProtectedPath("deep/nested/yarn.lock")).toBe(true)
  })

  test("does not flag regular files as protected", () => {
    expect(isProtectedPath("src/index.ts")).toBe(false)
    expect(isProtectedPath("README.md")).toBe(false)
    expect(isProtectedPath("package.json")).toBe(false)
    expect(isProtectedPath("tsconfig.json")).toBe(false)
    expect(isProtectedPath("src/components/Button.tsx")).toBe(false)
    expect(isProtectedPath("test/permission/index.test.ts")).toBe(false)
    expect(isProtectedPath("dist/bundle.js")).toBe(false)
    expect(isProtectedPath("Makefile")).toBe(false)
    expect(isProtectedPath("Dockerfile")).toBe(false)
  })

  test("does not flag .gitignore and similar dotfiles as protected", () => {
    expect(isProtectedPath(".gitignore")).toBe(false)
    expect(isProtectedPath(".eslintignore")).toBe(false)
    expect(isProtectedPath(".prettierrc")).toBe(false)
    expect(isProtectedPath(".editorconfig")).toBe(false)
    expect(isProtectedPath(".env.example")).toBe(true) // .env.* IS protected
  })
})

// ── Security boundary: protected paths cannot be bypassed ──

describe("security boundary - protected path bypass prevention", () => {
  it.live("protected path requires confirmation even with wildcard allow rule", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_test-bypass1")

        const ruleset: Permission.Ruleset = [
          { permission: "edit", pattern: "*", action: "allow" },
        ]

        const askFiber = yield* permission.ask({
          sessionID,
          permission: "edit",
          patterns: [".git/config"],
          metadata: {},
          always: [],
          ruleset,
        }).pipe(Effect.forkScoped)

        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const list = yield* permission.list()
            return list.length > 0 ? list : undefined
          }),
          "permission request never became pending",
        )

        expect(pending).toHaveLength(1)
        expect(pending[0]!.permission).toBe("edit")

        yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })

        yield* Fiber.await(askFiber)
      }),
    ),
  )

  it.live("protected path requires confirmation even with ** allow rule", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_test-bypass2")

        const ruleset: Permission.Ruleset = [
          { permission: "edit", pattern: "**", action: "allow" },
        ]

        const askFiber = yield* permission.ask({
          sessionID,
          permission: "edit",
          patterns: [".env"],
          metadata: {},
          always: [],
          ruleset,
        }).pipe(Effect.forkScoped)

        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const list = yield* permission.list()
            return list.length > 0 ? list : undefined
          }),
          "permission request never became pending",
        )

        expect(pending).toHaveLength(1)
        expect(pending[0]!.permission).toBe("edit")

        yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })

        yield* Fiber.await(askFiber)
      }),
    ),
  )

  it.live("protected path requires confirmation with specific allow rule for that path", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_test-bypass3")

        const ruleset: Permission.Ruleset = [
          { permission: "edit", pattern: ".ssh/id_rsa", action: "allow" },
        ]

        const askFiber = yield* permission.ask({
          sessionID,
          permission: "edit",
          patterns: [".ssh/id_rsa"],
          metadata: {},
          always: [],
          ruleset,
        }).pipe(Effect.forkScoped)

        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const list = yield* permission.list()
            return list.length > 0 ? list : undefined
          }),
          "permission request never became pending",
        )

        expect(pending).toHaveLength(1)
        expect(pending[0]!.permission).toBe("edit")

        yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })

        yield* Fiber.await(askFiber)
      }),
    ),
  )

  it.live("mixed patterns: one protected forces confirmation for all", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_test-bypass4")

        const ruleset: Permission.Ruleset = [
          { permission: "edit", pattern: "*", action: "allow" },
        ]

        const askFiber = yield* permission.ask({
          sessionID,
          permission: "edit",
          patterns: ["src/index.ts", ".env.local", "README.md"],
          metadata: {},
          always: [],
          ruleset,
        }).pipe(Effect.forkScoped)

        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const list = yield* permission.list()
            return list.length > 0 ? list : undefined
          }),
          "permission request never became pending",
        )

        expect(pending).toHaveLength(1)
        expect(pending[0]!.permission).toBe("edit")

        yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })

        yield* Fiber.await(askFiber)
      }),
    ),
  )

  it.live("lock file requires confirmation even with broad allow", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_test-bypass5")

        const ruleset: Permission.Ruleset = [
          { permission: "edit", pattern: "*", action: "allow" },
        ]

        const askFiber = yield* permission.ask({
          sessionID,
          permission: "edit",
          patterns: ["package-lock.json"],
          metadata: {},
          always: [],
          ruleset,
        }).pipe(Effect.forkScoped)

        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const list = yield* permission.list()
            return list.length > 0 ? list : undefined
          }),
          "permission request never became pending",
        )

        expect(pending).toHaveLength(1)
        expect(pending[0]!.permission).toBe("edit")

        yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })

        yield* Fiber.await(askFiber)
      }),
    ),
  )

  it.live("shell config requires confirmation even with broad allow", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_test-bypass6")

        const ruleset: Permission.Ruleset = [
          { permission: "edit", pattern: "*", action: "allow" },
        ]

        const askFiber = yield* permission.ask({
          sessionID,
          permission: "edit",
          patterns: [".bashrc"],
          metadata: {},
          always: [],
          ruleset,
        }).pipe(Effect.forkScoped)

        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const list = yield* permission.list()
            return list.length > 0 ? list : undefined
          }),
          "permission request never became pending",
        )

        expect(pending).toHaveLength(1)
        expect(pending[0]!.permission).toBe("edit")

        yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })

        yield* Fiber.await(askFiber)
      }),
    ),
  )

  it.live("nested protected path in deep directory requires confirmation", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_test-bypass7")

        const ruleset: Permission.Ruleset = [
          { permission: "edit", pattern: "*", action: "allow" },
        ]

        const askFiber = yield* permission.ask({
          sessionID,
          permission: "edit",
          patterns: ["packages/opencode/.git/hooks/pre-commit"],
          metadata: {},
          always: [],
          ruleset,
        }).pipe(Effect.forkScoped)

        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const list = yield* permission.list()
            return list.length > 0 ? list : undefined
          }),
          "permission request never became pending",
        )

        expect(pending).toHaveLength(1)
        expect(pending[0]!.permission).toBe("edit")

        yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })

        yield* Fiber.await(askFiber)
      }),
    ),
  )

  it.live("cloud credentials require confirmation even with broad allow", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_test-bypass8")

        const ruleset: Permission.Ruleset = [
          { permission: "edit", pattern: "*", action: "allow" },
        ]

        const askFiber = yield* permission.ask({
          sessionID,
          permission: "edit",
          patterns: [".aws/credentials"],
          metadata: {},
          always: [],
          ruleset,
        }).pipe(Effect.forkScoped)

        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const list = yield* permission.list()
            return list.length > 0 ? list : undefined
          }),
          "permission request never became pending",
        )

        expect(pending).toHaveLength(1)
        expect(pending[0]!.permission).toBe("edit")

        yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })

        yield* Fiber.await(askFiber)
      }),
    ),
  )

  it.live("explicit deny still denies protected paths (deny takes priority)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_test-deny-protected")

        const ruleset: Permission.Ruleset = [
          { permission: "edit", pattern: "*", action: "deny" },
        ]

        const result = yield* permission.ask({
          sessionID,
          permission: "edit",
          patterns: [".git/config"],
          metadata: {},
          always: [],
          ruleset,
        }).pipe(
          Effect.match({
            onFailure: (error) => error._tag === "PermissionDeniedError" ? "denied" : "other-error",
            onSuccess: () => "allowed",
          }),
        )

        expect(result).toBe("denied")
      }),
    ),
  )

  it.live("non-protected paths are allowed immediately with broad allow rule", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_test-allow-normal")

        const ruleset: Permission.Ruleset = [
          { permission: "edit", pattern: "*", action: "allow" },
        ]

        yield* permission.ask({
          sessionID,
          permission: "edit",
          patterns: ["src/index.ts"],
          metadata: {},
          always: [],
          ruleset,
        })

        const pending = yield* permission.list()
        expect(pending.length).toBe(0)
      }),
    ),
  )

  it.live("multiple non-protected paths are all allowed with broad allow rule", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const sessionID = SessionID.make("ses_test-allow-multi")

        const ruleset: Permission.Ruleset = [
          { permission: "edit", pattern: "*", action: "allow" },
        ]

        yield* permission.ask({
          sessionID,
          permission: "edit",
          patterns: ["src/index.ts", "test/foo.test.ts", "README.md"],
          metadata: {},
          always: [],
          ruleset,
        })

        const pending = yield* permission.list()
        expect(pending.length).toBe(0)
      }),
    ),
  )
})

// ── Adversarial test cases ──

describe("adversarial - path traversal and edge cases", () => {
  test("path traversal into .git is detected as protected", () => {
    expect(isProtectedPath("src/../.git/config")).toBe(true)
    expect(isProtectedPath("foo/bar/../../.git/HEAD")).toBe(true)
  })

  test("nested .env in deep paths is detected", () => {
    expect(isProtectedPath("a/b/c/d/.env")).toBe(true)
    expect(isProtectedPath("a/b/c/d/.env.production")).toBe(true)
  })

  test("nested .ssh in deep paths is detected", () => {
    expect(isProtectedPath("home/user/.ssh/id_rsa")).toBe(true)
    expect(isProtectedPath("a/b/c/.ssh/authorized_keys")).toBe(true)
  })

  test("lock files in nested paths are detected", () => {
    expect(isProtectedPath("packages/sub/package-lock.json")).toBe(true)
    expect(isProtectedPath("monorepo/packages/pkg/yarn.lock")).toBe(true)
    expect(isProtectedPath("deep/nested/pnpm-lock.yaml")).toBe(true)
  })

  test("evaluate does not match unrelated permission types", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "bash", pattern: "*", action: "allow" },
      { permission: "edit", pattern: "*", action: "deny" },
    ]
    expect(Permission.evaluate("bash", "ls", ruleset).action).toBe("allow")
    expect(Permission.evaluate("edit", "src/foo.ts", ruleset).action).toBe("deny")
    expect(Permission.evaluate("read", "src/foo.ts", ruleset).action).toBe("ask")
  })

  test("evaluate with three rulesets respects ordering across all", () => {
    const defaults: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "ask" }]
    const config: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
    const approved: Permission.Ruleset = [{ permission: "bash", pattern: "rm *", action: "deny" }]

    expect(Permission.evaluate("bash", "ls", defaults, config, approved).action).toBe("allow")
    expect(Permission.evaluate("bash", "rm -rf /", defaults, config, approved).action).toBe("deny")
    expect(Permission.evaluate("edit", "foo.ts", defaults, config, approved).action).toBe("ask")
  })
})

// ── disabled: tool disabling logic ──

describe("disabled - tool disabling logic", () => {
  test("returns empty set when no deny rules exist", () => {
    const ruleset: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]
    expect(Permission.disabled(["bash", "edit", "read"], ruleset).size).toBe(0)
  })

  test("disables tool only when pattern is * and action is deny", () => {
    const ruleset: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "deny" }]
    const result = Permission.disabled(["bash", "edit"], ruleset)
    expect(result.has("bash")).toBe(true)
    expect(result.has("edit")).toBe(false)
  })

  test("does not disable tool when deny has specific pattern (not *)", () => {
    const ruleset: Permission.Ruleset = [{ permission: "bash", pattern: "rm *", action: "deny" }]
    expect(Permission.disabled(["bash"], ruleset).has("bash")).toBe(false)
  })

  test("does not disable when specific allow comes after wildcard deny", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "echo *", action: "allow" },
    ]
    expect(Permission.disabled(["bash"], ruleset).has("bash")).toBe(false)
  })

  test("wildcard permission deny disables all tools", () => {
    const ruleset: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "deny" }]
    const result = Permission.disabled(["bash", "edit", "read", "write"], ruleset)
    expect(result.has("bash")).toBe(true)
    expect(result.has("edit")).toBe(true)
    expect(result.has("read")).toBe(true)
    expect(result.has("write")).toBe(true)
  })

  test("specific allow after wildcard deny re-enables that tool", () => {
    const ruleset: Permission.Ruleset = [
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "bash", pattern: "*", action: "allow" },
    ]
    const result = Permission.disabled(["bash", "edit"], ruleset)
    expect(result.has("bash")).toBe(false)
    expect(result.has("edit")).toBe(true)
  })

  test("empty tools list returns empty set", () => {
    const ruleset: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "deny" }]
    expect(Permission.disabled([], ruleset).size).toBe(0)
  })

  test("empty ruleset does not disable any tool", () => {
    expect(Permission.disabled(["bash", "edit", "read"], []).size).toBe(0)
  })
})

// ── fromConfig: configuration conversion ──

describe("fromConfig - configuration conversion", () => {
  test("string shorthand becomes wildcard pattern rule", () => {
    expect(Permission.fromConfig({ bash: "allow" })).toEqual([
      { permission: "bash", pattern: "*", action: "allow" },
    ])
  })

  test("object value creates per-pattern rules", () => {
    expect(Permission.fromConfig({ bash: { "*": "allow", "rm *": "deny" } })).toEqual([
      { permission: "bash", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "rm *", action: "deny" },
    ])
  })

  test("empty config produces empty ruleset", () => {
    expect(Permission.fromConfig({})).toEqual([])
  })

  test("mixed string and object values", () => {
    const result = Permission.fromConfig({
      bash: "allow",
      edit: { "src/*": "allow", "secret/*": "deny" },
    })
    expect(result).toEqual([
      { permission: "bash", pattern: "*", action: "allow" },
      { permission: "edit", pattern: "src/*", action: "allow" },
      { permission: "edit", pattern: "secret/*", action: "deny" },
    ])
  })

  test("preserves config key order for precedence", () => {
    const ruleset = Permission.fromConfig({
      bash: "allow",
      edit: "deny",
      read: "ask",
    })
    expect(ruleset.map((r) => r.permission)).toEqual(["bash", "edit", "read"])
  })
})

// ── merge: ruleset merging ──

describe("merge - ruleset merging", () => {
  test("concatenates multiple rulesets", () => {
    const result = Permission.merge(
      [{ permission: "bash", pattern: "*", action: "allow" }],
      [{ permission: "edit", pattern: "*", action: "deny" }],
    )
    expect(result).toHaveLength(2)
  })

  test("empty ruleset contributes nothing", () => {
    const result = Permission.merge(
      [{ permission: "bash", pattern: "*", action: "allow" }],
      [],
    )
    expect(result).toHaveLength(1)
  })

  test("merged rulesets affect evaluation with last-match-wins", () => {
    const base: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
    const override: Permission.Ruleset = [{ permission: "bash", pattern: "rm *", action: "deny" }]
    const merged = Permission.merge(base, override)
    expect(Permission.evaluate("bash", "rm -rf /", merged).action).toBe("deny")
    expect(Permission.evaluate("bash", "ls", merged).action).toBe("allow")
  })
})
