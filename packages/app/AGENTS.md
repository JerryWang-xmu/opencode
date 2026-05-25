## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, run the backend and app dev servers separately.
- Backend (from `packages/opencode`): `bun run --conditions=browser ./src/index.ts serve --port 4096`
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

## Structure

```
src/
├── app.tsx              # Provider tree + route definitions (AppBaseProviders, AppInterface)
├── entry.tsx            # Browser entry point: platform setup, Sentry, render()
├── index.ts             # Public exports consumed by packages/desktop
├── components/          # Reusable UI components (session, prompt-input, dialogs, etc.)
├── context/             # State management: one file per domain (server, settings, sync, ...)
├── pages/               # Route-level components (home, session, layout, directory-layout)
│   ├── layout.tsx       # App shell with sidebar, session list, drag-and-drop
│   ├── directory-layout.tsx  # Per-project wrapper: decodes base64 dir slug, provides SDK
│   ├── home.tsx         # Landing page: project picker + recent sessions
│   └── session/         # Session page helpers (composer, review-tab, terminal-panel, ...)
├── i18n/                # Translation dictionaries: en.ts (source of truth), zh.ts, de.ts, ...
├── utils/               # Pure helpers (server SDK factory, persist, diffs, path-key, ...)
├── hooks/               # Custom SolidJS hooks (use-providers, etc.)
└── constants/           # Shared constants (file-picker filters, etc.)
```

## Entry & Provider Hierarchy

Boot order: `entry.tsx` → `AppBaseProviders` → `AppInterface`.

```
AppBaseProviders (theme, language, i18n bridge, error boundary, query, dialog, marked)
  └─ AppInterface (server connection, health gate, SDK, sync)
       └─ Router
            ├─ / → HomeRoute (lazy)
            └─ /:dir → DirectoryLayout (SDK + sync scoped to project)
                 └─ /session/:id? → SessionRoute (lazy, wrapped in SessionProviders)
```

- `SessionProviders` (terminal, file, prompt, comments) mount only inside a session.
- `AppShellProviders` (settings, permission, layout, notification, models, command, highlights) wrap all routes.

## State Management

- **`createSimpleContext`** (from `@opencode-ai/ui/context`): the standard pattern for domain state. Returns `{ use, provider }`. One context per file.
  ```ts
  export const { use: useSettings, provider: SettingsProvider } = createSimpleContext({
    name: "Settings",
    init: () => { /* return the context value */ },
  })
  ```
- **`createStore`** over `createSignal` for structured state (always).
- **`persisted()`** wraps a store with localStorage sync. Two scopes: `Persist.global(key)` and `Persist.workspace(dir, key)`.
- **`@tanstack/solid-query`** for server-fetched data with caching (see `createQuery`, `useMutation` in session page).
- **SSE event stream**: `server-sdk.tsx` opens a global SSE connection, batches events per frame, and fans them out via `createGlobalEmitter`. Per-directory contexts (`sdk.tsx`) subscribe to the global stream.

## Routing

- Router: `@solidjs/router`. Routes defined in `app.tsx` inside `AppInterface`.
- Directory scoping: the `:dir` param is a base64-encoded project path. `directory-layout.tsx` decodes it and provides `SDKProvider` + `DirectoryDataProvider`.
- Navigation: `useNavigate()` from `@solidjs/router`. Session links use `/${base64Encode(directory)}/session/${sessionID}`.
- Lazy loading: page components use `lazy(() => import("@/pages/..."))`.

### Adding a new page

1. Create the page component in `src/pages/` (default export, lazy-loadable).
2. Add a `<Route>` inside `AppInterface` in `app.tsx`.
3. If it needs project-scoped SDK/sync, nest it under `/:dir` inside `DirectoryLayout`.
4. Add any new context providers to `AppShellProviders` or `SessionProviders` as appropriate.

## Backend Connection

- SDK client: `createOpencodeClient` from `@opencode-ai/sdk/v2/client`. Factory in `utils/server.ts` (`createSdkForServer`).
- Two SDK instances per server: one for SSE events (`eventSdk`), one for API calls (`sdk`).
- Access in components: `useSDK()` for directory-scoped client, `useServerSDK()` for server-level.
- Data sync: `server-sync.tsx` holds server-wide state (projects, sessions). `sync.tsx` holds per-directory state (messages, parts, diffs). Both use `createStore` + event listeners.
- API calls use `@tanstack/solid-query` mutations with optimistic updates where applicable.
- Dev connection: `entry.tsx` points at `http://localhost:4096` (or `VITE_OPENCODE_SERVER_HOST`/`VITE_OPENCODE_SERVER_PORT`).

## i18n

- Source of truth: `src/i18n/en.ts` exports a flat `dict` object with dot-separated keys.
- Other locales: one file per locale (`zh.ts`, `de.ts`, ...), same shape. Loaded lazily via dynamic `import()`.
- UI package strings: merged from `@opencode-ai/ui/i18n/{locale}` at load time.
- Access in components: `const language = useLanguage()`, then `language.t("key.path", { param: value })`.
- Template params: `{{paramName}}` in dict values, resolved by `i18n.resolveTemplate`.
- Parity test: `src/i18n/parity.test.ts` verifies targeted keys exist in all locales. Run after adding keys that must be translated.
- Adding a new key: add to `en.ts` first, then add translations to each locale file. Missing keys fall back to English.
