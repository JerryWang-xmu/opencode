# PROJECT KNOWLEDGE BASE

**Generated:** 2026-05-25
**Branch:** dev (default)

## OVERVIEW
OpenCode — open-source AI coding agent. Monorepo (Bun workspaces + Turborepo) with 21 packages. Stack: TypeScript 5.8, Effect v4, SolidJS, Drizzle/SQLite, Electron, Astro. CLI ships as platform-specific native binaries via npm.

## STRUCTURE
```
packages/
├── opencode/       # Core CLI/TUI/server — the main product
├── core/           # Shared schemas, Effect services, plugin system
├── llm/            # Schema-first LLM core (provider-agnostic)
├── app/            # SolidJS web UI (shared by desktop + browser)
├── ui/             # Shared UI component library
├── desktop/        # Electron app (sidecar architecture)
├── console/        # SaaS platform (nested monorepo: app/core/function/mail/resource)
├── enterprise/     # Teams/enterprise SolidStart app
├── web/            # Marketing/docs site (Astro + Starlight)
├── sdk/js/         # JavaScript SDK (OpenAPI codegen)
├── plugin/         # Plugin system runtime
├── effect-drizzle-sqlite/  # Vendored Drizzle Effect SQLite adapter
├── http-recorder/  # HTTP recording for tests
├── function/       # Cloudflare Workers (opencode.ai API)
├── containers/     # CI Docker images (base, bun-node, rust, tauri, publish)
├── identity/       # Logo/brand assets only (no code)
├── extensions/zed/ # Zed editor extension config
├── storybook/      # UI component Storybook
├── script/         # Shared build script utilities
├── slack/          # Slack integration
└── docs/           # Documentation helpers
sdks/vscode/        # VS Code extension (OUTSIDE workspace, own bun.lock)
infra/              # SST infrastructure (Cloudflare, PlanetScale, Stripe)
github/             # GitHub Action (outside packages/, own bun.lock)
script/             # Root-level release/build scripts (not a package)
nix/                # Nix flake packaging
specs/              # Design specifications
patches/            # Dependency patches (6 patched deps)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| CLI commands | `packages/opencode/src/cli/cmd/` | yargs-based, 20+ subcommands |
| TUI (terminal UI) | `packages/opencode/src/cli/cmd/tui/` | SolidJS rendered via @opentui/solid |
| HTTP server | `packages/opencode/src/server/` | Effect HTTP + Hono, SSE + WebSocket |
| AI tools | `packages/opencode/src/tool/` | 46 files — edit, grep, shell, etc. |
| Session management | `packages/opencode/src/session/` | LLM orchestration, message processing |
| Config system | `packages/opencode/src/config/` | Self-export pattern |
| Database schema | `packages/opencode/src/**/*.sql.ts` | Drizzle, snake_case |
| LLM providers | `packages/llm/src/providers/` | Facade pattern over routes |
| LLM protocols | `packages/llm/src/protocols/` | OpenAI, Anthropic, Gemini, Bedrock |
| Plugin system | `packages/core/src/plugin/` | Hook-based, 31 provider plugins |
| Shared schemas | `packages/core/src/schema.ts` | Branded types, withStatics |
| Web UI components | `packages/app/src/components/` | SolidJS |
| UI library | `packages/ui/src/components/` | Shared component library |
| Desktop main | `packages/desktop/src/main/` | Electron main + sidecar spawner |
| Console app | `packages/console/app/` | SolidStart, billing, workspace mgmt |
| Infrastructure | `infra/` + `sst.config.ts` | SST v4, Cloudflare-focused |
| VS Code extension | `sdks/vscode/` | Separate from workspace |

## COMMANDS
```bash
bun dev                    # CLI in dev mode (TUI)
bun dev:web                # Web UI dev server (needs backend at :4096)
bun dev:desktop            # Electron desktop dev
bun dev:console            # Console app dev
bun run lint               # OxLint (type-aware)
bun turbo typecheck        # Full monorepo typecheck
bun run db generate --name <slug>  # Drizzle migration (from packages/opencode)
bun test                   # Run from package dirs ONLY, never root
bunx playwright install chromium && bun run test:e2e:local  # E2E (from packages/app)
./packages/sdk/js/script/build.ts  # Regenerate JS SDK
```

## CONVENTIONS
- **No semicolons** (Prettier: `semi: false`), 2-space indent, 120-char print width, LF line endings
- **Effect v4** throughout core: `Effect.gen(function* () {...})`, `Effect.fn("Domain.method")`, `Effect.void`
- **Self-export pattern**: `export * as Foo from "./foo"` — no `export namespace`, no barrel `index.ts` in multi-sibling dirs
- **Module resolution**: Bun-native with `"exports": { "./*": "./src/*.ts" }` — direct TypeScript imports
- **Conditional imports**: `#db` for bun vs node SQLite, `#pty` for bun vs node PTY
- **Platform files**: `*.bun.ts` / `*.node.ts` for runtime-specific code
- **Prompt templates**: `.txt` files alongside TypeScript tool implementations
- **Catalog versions**: Root `package.json` uses Bun's `catalog:` for dependency pinning
- **Exact installs**: `bunfig.toml` sets `exact = true` + 3-day `minimumReleaseAge`
- **Pre-push hook**: Validates Bun version matches `packageManager` field, runs `bun typecheck`

## ANTI-PATTERNS (THIS PROJECT)
- **Never run tests from repo root** — enforced by `bunfig.toml` guard
- **Never run `tsc` directly** — use `bun typecheck` from package dirs
- **Never use `export namespace`** — breaks tree-shaking and Node's TS runner
- **Never use `Effect.fork` / `Effect.forkDaemon`** — use `Effect.forkIn(scope)` (v4 API)
- **Never restart the app/server in debugging** — explicit rule in packages/app
- **`as any` is forbidden** by style guide (586 violations exist — known debt, don't add more)
- **No barrel `index.ts`** in multi-sibling directories — defeats tree-shaking
- **No `try`/`catch`** where avoidable, no `else` statements, prefer `const` + ternary

## UNIQUE STYLES
- **Native binary distribution**: CLI ships as platform-specific npm packages (`opencode-darwin-arm64`, etc.). `bin/opencode` is a CJS shim that detects AVX2, musl/glibc, and spawns the right binary.
- **TUI as SolidJS**: Terminal UI uses `@opentui/solid` to render SolidJS in terminal — same framework as web/desktop.
- **Worker thread TUI**: Default `opencode` command spawns TUI in a worker thread with RPC bridge.
- **Desktop sidecar**: Electron runs opencode server as a utility process (sidecar), not in-process.
- **AI-powered CI**: Multiple GitHub workflows use OpenCode AI agent for PR review, issue triage, beta conflict resolution, docs updates.

## NOTES
- `packages/console/` is a nested monorepo (app/core/function/mail/resource) — each sub-package is individually referenced in root workspaces.
- `sdks/vscode/` and `github/` are outside the workspace with their own `bun.lock`.
- 6 dependencies are patched via `patchedDependencies` (solid-js, virtua, @ai-sdk/xai, etc.).
- `packages/identity/` and `packages/extensions/zed/` contain only assets/config — no code.
- The `effect-drizzle-sqlite` package is vendored — keep it generic, no opencode-specific code.
- `packages/opencode/src/session/processor.ts` has 15x `TODO(v2): Temporary dual-write` — migration debt.

---

- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Complex Logic

When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.

```ts
// Good
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) {
  ...
}
```

- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.
