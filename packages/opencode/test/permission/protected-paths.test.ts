import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Permission, isProtectedPath } from "../../src/permission"
import { Bus } from "../../src/bus"
import { SessionID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(Permission.defaultLayer, Bus.defaultLayer, CrossSpawnSpawner.defaultLayer),
)

describe("Permission protected paths", () => {
  describe("isProtectedPath", () => {
    test("identifies .git paths as protected", () => {
      expect(isProtectedPath(".git")).toBe(true)
      expect(isProtectedPath(".git/config")).toBe(true)
      expect(isProtectedPath(".git/HEAD")).toBe(true)
      expect(isProtectedPath("project/.git/hooks/pre-commit")).toBe(true)
    })

    test("identifies environment files as protected", () => {
      expect(isProtectedPath(".env")).toBe(true)
      expect(isProtectedPath(".env.local")).toBe(true)
      expect(isProtectedPath(".env.production")).toBe(true)
      expect(isProtectedPath("project/.env.development")).toBe(true)
    })

    test("identifies SSH and credentials as protected", () => {
      expect(isProtectedPath(".ssh")).toBe(true)
      expect(isProtectedPath(".ssh/id_rsa")).toBe(true)
      expect(isProtectedPath(".ssh/authorized_keys")).toBe(true)
      expect(isProtectedPath(".aws/credentials")).toBe(true)
      expect(isProtectedPath(".kube/config")).toBe(true)
    })

    test("identifies shell config files as protected", () => {
      expect(isProtectedPath(".bashrc")).toBe(true)
      expect(isProtectedPath(".zshrc")).toBe(true)
      expect(isProtectedPath(".profile")).toBe(true)
      expect(isProtectedPath(".bash_profile")).toBe(true)
    })

    test("identifies package manager locks as protected", () => {
      expect(isProtectedPath("package-lock.json")).toBe(true)
      expect(isProtectedPath("yarn.lock")).toBe(true)
      expect(isProtectedPath("pnpm-lock.yaml")).toBe(true)
      expect(isProtectedPath("bun.lockb")).toBe(true)
    })

    test("does not identify regular files as protected", () => {
      expect(isProtectedPath("src/index.ts")).toBe(false)
      expect(isProtectedPath("README.md")).toBe(false)
      expect(isProtectedPath("package.json")).toBe(false)
      expect(isProtectedPath("tsconfig.json")).toBe(false)
      expect(isProtectedPath("src/components/Button.tsx")).toBe(false)
    })

    test("does not identify .gitignore as protected", () => {
      expect(isProtectedPath(".gitignore")).toBe(false)
      expect(isProtectedPath(".eslintignore")).toBe(false)
    })

    test("project-level .config directories are not protected", () => {
      expect(isProtectedPath("src/.config/settings.json")).toBe(false)
    })

    test("root-level .config non-sensitive paths are not protected", () => {
      expect(isProtectedPath(".config/fish/config.fish")).toBe(false)
    })

    test("nested .config in subdirectories is not protected", () => {
      expect(isProtectedPath("packages/foo/.config/rc")).toBe(false)
    })

    // F8: .config/opencode should NOT be blocked
    test(".config/opencode/config.json is NOT protected", () => {
      expect(isProtectedPath(".config/opencode/config.json")).toBe(false)
    })

    test(".config/git/credentials IS protected", () => {
      expect(isProtectedPath(".config/git/credentials")).toBe(true)
    })

    test(".config/gcloud/application_default_credentials.json IS protected", () => {
      expect(isProtectedPath(".config/gcloud/application_default_credentials.json")).toBe(true)
    })

    // F9: missing sensitive paths
    test(".netrc IS protected", () => {
      expect(isProtectedPath(".netrc")).toBe(true)
      expect(isProtectedPath("home/.netrc")).toBe(true)
    })

    test(".gitconfig IS protected", () => {
      expect(isProtectedPath(".gitconfig")).toBe(true)
    })

    test(".yarnrc.yml IS protected", () => {
      expect(isProtectedPath(".yarnrc.yml")).toBe(true)
    })

    test("terraform files IS protected", () => {
      expect(isProtectedPath(".terraform/terraform.tfstate")).toBe(true)
      expect(isProtectedPath("terraform.tfstate")).toBe(true)
    })
  })

  describe("ask with protected paths", () => {
    it.live("requires confirmation for protected path patterns", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const sessionID = SessionID.make("ses_test-session")

          // Grant broad permission to all bash commands
          const ruleset = [
            {
              permission: "bash",
              pattern: "*",
              action: "allow" as const,
            },
          ]

          // Protected path patterns should require confirmation
          // This will hang waiting for user confirmation, so we use a timeout
          const askEffect = permission.ask({
            sessionID,
            permission: "bash",
            patterns: [".git/config"],
            metadata: {},
            always: [],
            ruleset,
          })

          // The ask should not complete immediately (it's waiting for user input)
          // We use a race with a short timeout to verify it's blocked
          const result = yield* Effect.race(
            askEffect.pipe(Effect.as("completed")),
            Effect.sleep("100 millis").pipe(Effect.as("timeout")),
          )

          expect(result).toBe("timeout")
        }),
      ),
    )

    it.live("allows non-protected paths with broad allow rule", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const sessionID = SessionID.make("ses_test-session")

          // Grant broad permission to all bash commands
          const ruleset = [
            {
              permission: "bash",
              pattern: "*",
              action: "allow" as const,
            },
          ]

          // Non-protected paths should be allowed immediately
          yield* permission.ask({
            sessionID,
            permission: "bash",
            patterns: ["echo hello"],
            metadata: {},
            always: [],
            ruleset,
          })

          // If we reach here, the permission was granted
          expect(true).toBe(true)
        }),
      ),
    )

    it.live("denies paths with explicit deny rule", () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          const sessionID = SessionID.make("ses_test-session")

          // Explicitly deny rm commands
          const ruleset = [
            {
              permission: "bash",
              pattern: "rm *",
              action: "deny" as const,
            },
          ]

          // Should be denied
          const result = yield* permission.ask({
            sessionID,
            permission: "bash",
            patterns: ["rm -rf node_modules"],
            metadata: {},
            always: [],
            ruleset,
          }).pipe(
            Effect.match({
              onFailure: (error) => {
                if (error._tag === "PermissionDeniedError") {
                  return "denied"
                }
                return "other-error"
              },
              onSuccess: () => "allowed",
            }),
          )

          expect(result).toBe("denied")
        }),
      ),
    )
  })
})
