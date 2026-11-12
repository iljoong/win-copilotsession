# Windows desktop shell (.NET WebView2 + Node sidecar)

Date: 2026-11-12
Status: Approved by the user on 2026-11-12. Not implemented.
Size: A project (new desktop shell, backend lifecycle changes, installer)

## Intent

Ship the existing local dashboard as an installable Windows desktop app. The user
wants: a dedicated window instead of a browser tab, easy distribution, good
performance, and a path to commercial distribution.

The browser app stays the product. The desktop app is a thin native shell that
starts the existing Node backend privately and shows its UI in an embedded
WebView2 window. Behavior, data, accounting, privacy rules, and tests of the
existing app are preserved.

Background: [WebView2 vs Tauri comparison](../../research/webview2-sidecar-vs-tauri-comparison.md)
and [Windows desktop options research](../../research/windows-desktop-options-research.md).
This spec supersedes the handoff's Electron-first desktop milestones for the
desktop work; the Electron research remains a reference only.

## Decisions made by the user

- Shell approach: **.NET WebView2 shell + Node sidecar** (option B), not Electron
  or Tauri.
- Shell UI technology: **WPF on .NET 10 LTS**.
- Connection model: **keep the existing loopback HTTP server**. Node serves the
  UI, API, and SSE on `127.0.0.1`; the shell opens the startup URL in WebView2.
- Distribution: **personal/small direct distribution**, unsigned at first; signing
  added later.
- Installer: **per-user installer (no administrator rights), manual updates**.
- Supported targets: **Windows 11 x64 and Windows 10 x64**. ARM64 is out of scope.
- Closing the window (X) **quits the app**, stopping collection. No tray mode.
- **No** start-at-login option.
- Uninstall **keeps** dashboard data. Data is deleted only through the existing
  in-app **Clear local data** flow or manually.
- Node runtime: **bundled official `node.exe`**, pinned version; the user's
  installed Node is never used.

## Assistant-proposed decisions requiring design approval

- **Installer tool: Inno Setup** (per-user, `PrivilegesRequired=lowest`,
  installs to `%LOCALAPPDATA%\Programs\CopilotSessionDashboard`). Scriptable,
  no admin, simple in-place upgrade; leaves room to add a signing step later.
- **.NET deployment: self-contained** `win-x64`, ReadyToRun, not single-file and
  not trimmed (WPF trimming is unsupported). No .NET runtime prerequisite for
  users; larger install size is accepted.
- **Bundled Node: the current Node 24 LTS line**, exact version pinned in one
  repository file. Rationale: longer support window than Node 22 for a product
  intended for distribution. Gate: the Vitest suite and the staged backend smoke
  (see Build and packaging pipeline) must pass under the pinned binary on every
  packaging run, and the desktop e2e must pass before handoff. If they don't, pin
  the latest Node 22 LTS patch instead and record why.
- **Packaging form of the backend:** plain `node.exe` + built `dist\server`,
  `dist\shared`, `dist\client` + a minimal `package.json` (`"type": "module"`).
  Not Node SEA (still in active development, single-script only).
- **WebView2 runtime: Evergreen.** The installer checks for it and runs the
  bundled Evergreen bootstrapper per-user if missing (Windows 10 case; requires
  internet). Fixed Version is not used.
- **Third-party notices** (Node, .NET, WebView2 SDK, React, and other shipped
  packages) are generated and installed as `THIRD_PARTY_NOTICES.txt`, as
  groundwork for commercial distribution.
- The product name in the shell and installer stays "Copilot Session Dashboard"
  for now; see Open questions.

## Goals and acceptance criteria

Each item is observable and testable.

1. **Install without admin.** Running the installer as a standard user installs
   to `%LOCALAPPDATA%\Programs\CopilotSessionDashboard`, adds a Start menu
   shortcut, and needs no UAC prompt. Reinstalling a newer version over an older
   one upgrades in place.
2. **Launch into the app window.** Starting the app shows one window with the
   dashboard loaded and authenticated, with no browser tab, console window, or
   visible token. The Sessions view appears without the user opening any URL.
3. **Same data, same place.** The app uses
   `%LOCALAPPDATA%\CopilotSessionDashboard\dashboard-data` exactly as the browser
   app does (same ownership marker, permission checks and warnings, source
   consent, checkpoints). A database created by `npm start` opens unchanged in the
   desktop app, and vice versa (not simultaneously; see 7).
4. **Feature parity.** All existing workflows work inside the window: session
   search/filter/sort/paging, conversation view, prompt copy (unchanged text),
   VS Code JSON import via file picker, Sources consent/enable/disable, Usage, live
   refresh via SSE, Clear local data.
5. **Clean quit.** Closing the window ends the Node process within 5 seconds after
   a graceful shutdown (ingestion stopped, server closed, database closed). No
   `node.exe` started by the app remains afterwards. If the shell is killed
   abruptly (Task Manager), the Node process is also terminated by the OS.
6. **Crash visibility.** If Node fails to start, exits unexpectedly, or does not
   report readiness within 30 seconds, the window shows a native error view with
   a short reason, the log folder location, and a Retry button. It never shows a
   blank window.
7. **Single instance.** Launching the app while it runs focuses the existing
   window and starts no second backend. Running the browser app (`npm start`) at
   the same time against the same data directory is unsupported and documented.
8. **Locked-down web view.** The window can only show
   `http://127.0.0.1:<port>/…` from its own backend. Other navigations and new
   windows are blocked. DevTools, host objects, web messaging, autofill, and
   password saving are disabled in release builds. Web permission requests are
   denied by default except those needed for acceptance 4 (verified in PoC).
9. **No secret leakage.** The startup token never appears in logs, window title,
   command-line arguments, crash dialogs, or persistent WebView2 history after
   the redirect. The auth cookie remains a per-run session cookie.
10. **Uninstall keeps data.** Uninstalling removes program files, shortcuts, and
    the WebView2 user data folder, but keeps `dashboard-data`. The uninstaller
    says where the data remains.
11. **Browser mode still works.** `npm start`, `npm run dev`, and all existing
    tests behave exactly as before.

## Non-goals

- macOS, Linux, ARM64, Windows 7/8.
- Tray icon, background collection after the window closes, start at login,
  notifications.
- Auto-update, MSIX, Microsoft Store, enterprise/MDM deployment.
- Code signing in this version (the build leaves a hook for it).
- Replacing HTTP/SSE with WebView2 messaging, a custom protocol, or virtual host
  mapping.
- Any change to ingestion, accounting, search, identity, or UI features.
- Rewriting backend logic in C#.

## Anti-goals (failure even if it works)

- The desktop app weakens existing protections: loopback-only binding, Host/Origin
  checks, cookie authentication, path boundaries, inert previews, data-directory
  ownership checks.
- The app silently moves, copies, or reinitializes existing dashboard data, or
  starts collecting from a source without the existing consent flow.
- Orphaned `node.exe` processes or a database left open after quitting.
- The shell grows its own copy of business logic, so desktop and browser behavior
  diverge.

## Constraints from the existing code

- `src\server\main.ts` is a CLI entry with top-level startup: parses args, prepares
  storage, opens the store, listens on `127.0.0.1` (random port with `--port 0`),
  starts ingestion after listening, prints `Dashboard: <url with token>` to stdout,
  and opens the browser via `rundll32` on Windows unless `--no-open`.
- Shutdown runs only on `SIGINT`/`SIGTERM`. A Windows parent cannot reliably
  deliver these to a child process, so a new shutdown trigger is needed.
- `src\server\http.ts` exchanges `/?token=…` for an HttpOnly SameSite=Strict
  per-run cookie and redirects (303) to `/`. It rejects mismatched `Host`,
  `Origin`, and cross-site `Sec-Fetch-Site`.
- The client uses same-origin `fetch`, `EventSource('/api/events')`,
  `navigator.clipboard.writeText`, and a file `<input>`.
- The server build (`tsconfig.server.json`) emits `dist\server` and `dist\shared`;
  the Vite build emits `dist\client`. The server needs no runtime npm packages in
  production (`vite` is only imported with `--dev`).

## Design

### Repository layout

```text
desktop\
  CopilotSessionDashboard.Desktop.sln
  node-version.txt                 pinned Node version (+ SHA-256 per artifact)
  src\Shell\                       WPF app (net10.0-windows, win-x64)
  tests\Shell.Tests\               xUnit tests for non-UI shell logic
  installer\setup.iss              Inno Setup script
  scripts\package.ps1              build + stage + installer (+ optional signing hook)
```

Generated output (`desktop\**\bin`, `obj`, staging, installers, downloaded Node)
is git-ignored. npm scripts call the PowerShell script, for example
`npm run desktop:package`; exact script names are the builder's call.

### Installed layout

```text
%LOCALAPPDATA%\Programs\CopilotSessionDashboard\
  CopilotSessionDashboard.exe      WPF shell (self-contained .NET)
  <.NET + WebView2 SDK files>
  node\node.exe                    pinned official Node (license included)
  app\package.json                 {"type":"module"} only
  app\dist\server\…  app\dist\shared\…  app\dist\client\…
  THIRD_PARTY_NOTICES.txt

%LOCALAPPDATA%\CopilotSessionDashboard\
  dashboard-data\                  unchanged, owned by the backend
  desktop\WebView2\                WebView2 user data folder (shell-owned)
  desktop\logs\                    shell + backend stderr logs (rotated)
```

The shell never writes inside `dashboard-data`. `desktop\` is a sibling the
backend never touches, so the backend's "empty or app-owned" check on
`dashboard-data` is unaffected.

### Backend changes (TypeScript, minimal)

1. **Extract lifecycle.** Move startup/shutdown out of top-level code into
   `startDashboard(options) → { url, port, stop() }` (module name is the
   builder's call). `main.ts` keeps the existing CLI behavior by calling it. This
   is what handoff milestone 2 already asked for.
2. **Desktop mode flag** `--desktop` (name is the builder's call), accepted only
   together with `--no-open`:
   - **Readiness handshake:** after listening, writes exactly one JSON line to
     stdout, e.g. `{"event":"ready","port":53122,"token":"…"}`, and does **not**
     print the human `Dashboard: …` or `Data: …` lines. Nothing else is written
     to stdout; diagnostics go to stderr. (The data path stays visible in the
     Sources view.)
   - **Parent-tied shutdown:** stdin is the lifeline. On stdin end/close, run the
     same graceful shutdown as `SIGINT`, then exit with code 0. A shutdown that
     exceeds the shell's grace period is ended by the job object (below).
3. **Do not change** binding, auth, cookie, Host/Origin checks, data path default,
   storage checks, or API/SSE behavior.

Tests (Vitest): handshake line format and that the token appears only there;
stdin close triggers shutdown (ingestion stopped, store closed, process exits);
existing CLI mode unchanged.

### Shell (WPF, C#)

**Startup sequence**

1. Acquire a per-user single-instance lock (named mutex scoped to the user
   session). If already held, signal the running instance to activate its
   window (for example a named event or pipe), then exit.
2. Show the main window with a native "Starting…" state.
3. Check the WebView2 Runtime is available; if not, show an error view telling
   the user to rerun the installer or install the Evergreen runtime.
4. Start `node\node.exe app\dist\server\main.js --desktop --no-open --port 0`
   with: no console window, redirected stdin/stdout/stderr, and working directory
   `app\`. The child **inherits the user's environment** (the backend depends on
   `LOCALAPPDATA`, `USERPROFILE`, optional `COPILOT_HOME`, and on `PATH`/
   `SystemRoot` to run `whoami.exe`, `icacls.exe`, `powershell.exe` for the
   permission check). The shell removes only Node code-injection variables
   (`NODE_OPTIONS`, `NODE_PATH`, `NODE_REPL_EXTERNAL_MODULE`, and any
   `NODE_*` debug/inspect settings). Do not pass the token or any secret on the
   command line. If `LOCALAPPDATA` is missing, the shell shows the error view
   instead of letting the backend fall back to the home directory.
5. Immediately assign the Node process to a **job object** with
   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so it dies if the shell dies.
6. Read stdout for the ready line (30 s timeout). Parse strictly; reject
   anything else. Hold the token only in memory.
7. Create the WebView2 environment with user data folder
   `%LOCALAPPDATA%\CopilotSessionDashboard\desktop\WebView2` and a controller
   with **InPrivate mode enabled**, apply settings (below), then navigate to
   `http://127.0.0.1:<port>/?token=<token>`. The backend's 303 redirect removes
   the token from the address. InPrivate keeps Chromium from persisting the
   token URL in its history database (redirect chains are normally recorded) and
   leaves no cache of conversation content on disk. The client uses no
   `localStorage`/`sessionStorage`/IndexedDB, so nothing is lost; the auth cookie
   is per-run anyway.
8. Stream stderr to the log file. Never log stdout content.

**WebView2 settings and policy**

- `AreDevToolsEnabled = false`, `AreHostObjectsAllowed = false`,
  `IsWebMessageEnabled = false`, `IsGeneralAutofillEnabled = false`,
  `IsPasswordAutosaveEnabled = false`, `IsStatusBarEnabled = false`,
  `AreBrowserAcceleratorKeysEnabled = false` (release builds). Debug builds may
  enable DevTools.
- `NavigationStarting`: allow only scheme `http`, host `127.0.0.1`, and the
  backend's port; cancel everything else.
- `NewWindowRequested`: always cancel. (The app has no external links today.)
- `PermissionRequested`: deny by default. Keep only what the PoC proves is needed
  for prompt copy (`clipboard.writeText`) and the file picker.
- `DownloadStarting`: cancel (the app has no downloads).
- The default context menu may stay for text copy; remove "Inspect" in release.
- `ProcessFailed` (renderer/browser crash): reload once; on repeat, show the
  error view.

**Running and quitting**

- If Node exits unexpectedly, show the error view (reason, log folder, Retry).
  Retry restarts the backend with a new token and port.
- On window close, Windows session end, or app shutdown: hide the window, close
  Node's stdin, wait up to 5 seconds for exit, then close the job handle (which
  kills Node if still running). Exit.
- Window title: "Copilot Session Dashboard". Window size/position persistence is
  optional and, if added, stored under `desktop\`.

**Logs**

- `desktop\logs\shell.log` with size-based rotation (for example 1 MB × 3).
- Contents: timestamps, shell events, backend exit codes, backend stderr. Never
  the token, cookies, URLs with query strings, prompts, or source file contents.
  The backend does not log prompts today; keep it that way.

### Installer (Inno Setup)

- Per-user install (`PrivilegesRequired=lowest`), x64 only. Minimum Windows 10
  22H2 (build 19045) or Windows 11. Note: Windows 10 consumer support has ended;
  it remains supported by this app only as long as .NET 10, the pinned Node, and
  WebView2 still support it. The builder rechecks these support lists when
  pinning versions.
- Installs the staged layout; Start menu shortcut; optional desktop shortcut.
- Same `AppId` across versions for in-place upgrades. Refuses to upgrade while the
  app runs (or asks the user to close it).
- Includes the WebView2 Evergreen bootstrapper; runs it if the runtime is missing.
- Uninstall: removes program files, shortcuts, and `desktop\WebView2`; keeps
  `dashboard-data` and, by default, `desktop\logs`. Shows the kept data path.
- Version comes from `package.json` `version`.
- Signing hook: optional `signtool` step in `package.ps1`, off by default. Unsigned
  builds show SmartScreen warnings; documented, not hidden.

### Build and packaging pipeline

1. `npm ci`, `npm run build`.
2. Download the pinned Node zip from `nodejs.org`, verify its SHA-256 against
   `desktop\node-version.txt`, extract `node.exe` and its `LICENSE`.
3. Run the Vitest suite with the pinned `node.exe` from the repository
   (e.g. `node.exe node_modules\vitest\vitest.mjs run`). Runs on **every**
   packaging run; a failure stops packaging.
4. `dotnet publish` the shell (self-contained, `win-x64`, ReadyToRun), Release
   and Testing flavors (see Verification).
5. Stage the installed layout, generate `THIRD_PARTY_NOTICES.txt`.
6. **Staged backend smoke** (every run): start `node\node.exe
app\dist\server\main.js --desktop --no-open --port 0 --data-dir <temp>` from
   the staged layout (no `node_modules`), read the ready line, perform an
   authenticated request that exercises the database (WAL, FTS5 search), close
   stdin, confirm exit 0 and that no process remains. This is handoff milestone 1
   for the packaged process.
7. Build the installer from the Release flavor.

## Verification

Before handoff (in addition to AGENTS.md's gates: `npm test`, `npm run typecheck`,
`npm run lint`, `npm run format:check`, `npm run test:e2e`):

- `dotnet build` and `dotnet test` for `desktop\` (warnings as errors);
  `dotnet format --verify-no-changes`.
- Vitest coverage for the backend desktop mode (above).
- xUnit coverage for shell logic that doesn't need a UI: ready-line parsing,
  navigation allow-list, log redaction, startup timeout/exit handling.
- **Two shell flavors from the same commit and code**, differing only by a
  compile-time `TESTING` symbol:
  - **Release** (shipped): no remote-debugging port, no data-directory override,
    DevTools off. These hooks do not exist in the binary, not even behind an
    environment variable.
  - **Testing** (never shipped or installed): accepts a synthetic data directory
    and enables WebView2 remote debugging on a loopback port for Playwright.
- **Desktop e2e (Testing flavor):** start the staged app with a synthetic data
  directory, attach Playwright over CDP to the WebView2, and run a subset of the
  existing e2e workflows: load, search, copy prompt, import JSON, live refresh,
  clear data.
- **Release flavor automated smoke:** launch the staged Release app against the
  real default path of a disposable Windows test user (or VM), confirm the
  window starts its backend, quit, and confirm no `node.exe` child remains. Also
  kill the shell process and confirm the job object ends Node.
- The Release flavor is additionally covered by the manual checklist below.
- Manual checklist on a clean Windows 10 x64 and Windows 11 x64 user account:
  install without UAC, first launch, single instance, quit leaves no `node.exe`,
  Task Manager kill of the shell leaves no `node.exe`, upgrade keeps data,
  uninstall keeps data, missing WebView2 runtime path (Windows 10).
- Record measured install size, idle memory (shell + WebView2 + Node), and cold
  start time on the target machines. No numbers are promised in this spec.

Real Copilot history is used only with explicit permission; tests use synthetic
fixtures and disposable data directories.

## Compatibility and privacy boundaries

- Existing data, consent, and checkpoints are reused in place; no migration.
- The auth model is unchanged. The token moves from terminal output to an
  in-memory handoff between the two processes of this app.
- Loopback authentication is still not isolation from other processes running as
  the same user (unchanged README statement). The WebView2 user data folder may
  hold cache for the local origin; it is per-user and removed at uninstall.
- No telemetry, crash reporting, or update checks are added.

## Risks and how this design handles them

| Risk                                         | Handling                                                    |
| -------------------------------------------- | ----------------------------------------------------------- |
| Bundled Node major differs from dev Node 22  | Full test suite gate with the pinned binary; fallback to 22 |
| Orphaned Node after crash                    | Job object kill-on-close + stdin lifeline                   |
| WebView2 missing on some Windows 10 machines | Installer bootstrapper; shell error view                    |
| Clipboard/file picker blocked by permissions | PoC confirms minimal allowed permissions                    |
| SmartScreen warnings (unsigned)              | Documented; signing hook for later                          |
| Browser app and desktop app on same data     | Documented unsupported; desktop single-instance only        |

## Documentation updates (part of the implementation)

- README: add a desktop section (install, data location, uninstall keeps data,
  SmartScreen for unsigned builds, browser and desktop mode must not run on the
  same data at the same time). Keep the browser-mode instructions.
- `docs\handoff.md`: replace the Electron-first desktop status and milestones with
  this spec, and add the desktop regression tests to the regression map.
- AGENTS.md verification list: add the `desktop\` commands.

## Left to the builder

- Exact names: CLI flag, lifecycle module, npm scripts, C# namespaces.
- How the second instance signals the first (event, pipe, or window message).
- Error view visuals (native WPF, simple and accessible).
- Log rotation details within the stated limits.
- Whether to keep logs on uninstall (default: keep).

## Open questions (not blocking this spec)

- **Product name for commercial use.** "Copilot" is a GitHub/Microsoft trademark.
  Before any commercial release, confirm naming rights or choose a new name.
- **Signing channel** (Azure Artifact Signing vs OV certificate) when moving
  beyond personal distribution.
- **Auto-update** approach if distribution grows (for example Velopack or MSIX).
