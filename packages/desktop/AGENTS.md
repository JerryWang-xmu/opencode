# Desktop package notes

- Renderer process should only call `window.api` from `src/preload`.
- Main process should register IPC handlers in `src/main/ipc.ts`.

## Sidecar architecture

- Main process spawns the opencode server as an Electron **utility process** (`utilityProcess.fork`).
- Entry point: `src/main/sidecar.ts` runs in the utility process, imports `virtual:opencode-server`, and starts the HTTP server.
- Spawn logic lives in `src/main/server.ts` → `spawnLocalServer()`.
- Main ↔ sidecar communication uses `postMessage` / `on("message")` with typed messages:
  - Main → sidecar: `{ type: "start", hostname, port, password, ... }` and `{ type: "stop" }`
  - Sidecar → main: `ready`, `sqlite` (migration progress), `error`, `stopped`
- Health check polls `GET /global/health` with Basic auth until the sidecar reports healthy (30s timeout).
- Sidecar binds to `127.0.0.1` on a random free port. Password is a random UUID per session.
- `killSidecar()` sends a `stop` message, waits up to 6s, then force-kills.
- Sidecar env strips `DEBUG` and (on Linux) `LD_PRELOAD` to avoid injection issues.

## IPC patterns

- All handlers registered in `src/main/ipc.ts` via `registerIpcHandlers(deps)`.
- `deps` object injected from `src/main/index.ts` so handlers stay testable and decoupled.
- Preload bridge: `src/preload/index.ts` exposes a typed `ElectronAPI` on `window.api` via `contextBridge.exposeInMainWorld`.
- Type definitions live in `src/preload/types.ts` (`ElectronAPI` interface).
- Two IPC directions:
  - **invoke** (renderer → main, request/response): `ipcMain.handle` + `ipcRenderer.invoke`
  - **events** (main → renderer, push): `win.webContents.send` + `ipcRenderer.on` (returns unsubscribe fn)
- Current event channels: `init-step`, `sqlite-migration-progress`, `menu-command`, `deep-link`, `pinch-zoom-enabled-changed`, `zoom-factor-changed`.

## Adding a new IPC handler

1. Add the method signature to `ElectronAPI` in `src/preload/types.ts`.
2. Add the `ipcMain.handle` (or `ipcMain.on`) call in `src/main/ipc.ts` inside `registerIpcHandlers`.
3. If the handler needs external logic, add it to the `Deps` type and wire it in `src/main/index.ts`.
4. Add the corresponding `ipcRenderer.invoke` (or `ipcRenderer.on`) wrapper in `src/preload/index.ts`.
5. For main → renderer events, also add a `send*` export in `ipc.ts` (e.g. `sendDeepLinks`).

## Build process

- **Dev**: `bun dev` runs `electron-vite dev` (hot reload for renderer, restarts main on change).
- **Build**: `bun run build` runs `electron-vite build`, outputs to `out/`.
- **Package**: `bun run package` runs `electron-builder` with `electron-builder.config.ts`.
  - Platform-specific: `package:mac`, `package:win`, `package:linux`.
- Three release channels controlled by `OPENCODE_CHANNEL` env: `dev`, `beta`, `prod`.
  - Each channel gets a distinct `appId`, `productName`, and (for beta/prod) GitHub publish config.
- `predev` and `prebuild` scripts in `scripts/` handle pre-build steps.
- Output artifacts land in `dist/` with naming `opencode-desktop-${os}-${arch}.${ext}`.

## Platform-specific notes

- **macOS**: hardened runtime, notarization, entitlements in `resources/entitlements.plist`. Targets: DMG + ZIP. Icon: `.icns`.
- **Windows**: NSIS one-click installer. Code signing via `script/sign-windows.ps1` (CI only). Icon: `.ico`.
- **Linux**: AppImage, deb, rpm targets. Category: `Development`. Icon: `resources/icons/` directory.
- **WSL**: Windows-only feature toggle (`getWslConfig`/`setWslConfig`). `wslPath()` converts between Windows and Linux paths.
- **Deep links**: `opencode://` protocol registered via `app.setAsDefaultProtocolClient`. Handled on macOS (`open-url`) and Windows/Linux (`second-instance` argv parsing).
- **Single instance**: enforced via `app.requestSingleInstanceLock()`. Second launch forwards deep links and focuses the existing window.
- **macOS cwd**: `process.chdir(homedir())` at startup because macOS apps launch in `/`, which breaks ripgrep.
