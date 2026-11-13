# Copilot Session Dashboard

Local-only session browser for Copilot CLI and VS Code.

Browse sessions, search and copy complete original prompts, inspect text-only
assistant previews, and monitor observed activity. The session-first workspace
puts search and compact icon-led filters inside the hideable Sessions pane.
Session information and usage share one collapsed-by-default expander, leaving
Conversation as the main reading surface. The workspace stacks on narrow screens.
Usage views distinguish reported zero, missing data,
partial coverage, and overlapping sources.

## Documentation and agent handoff

- [AGENTS.md](AGENTS.md): spec-driven development instructions for coding agents.
- [Repository handoff](docs/handoff.md): architecture, stack, implemented behavior,
  regression map, current limitations, and desktop implementation handoff.
- [Approved product design](docs/superpowers/specs/2026-11-12-copilot-session-dashboard-design.md):
  baseline scope and acceptance boundaries.
- [Conversation-focused UI design](docs/superpowers/specs/2026-11-13-conversation-focused-sessions-ui-design.md):
  approved sidebar, combined expander, and prompt-viewport behavior.
- [Windows desktop research](docs/research/windows-desktop-options-research.md):
  Electron, WebView2, and native C# comparison (historical research).
- [Portable desktop spec](docs/superpowers/specs/2026-11-13-windows-portable-webview2-design.md)
  and [Defender research](docs/research/2026-11-13-portable-webview2-defender-research.md):
  the implemented portable WebView2 app described below.

## Run on Windows

Requires Node.js **22.23.4 or newer** and npm. From this folder in PowerShell:

```powershell
npm ci
npm run build
npm start
```

If your environment requires the Microsoft package proxy, use
`npm ci --registry=https://packagefeedproxy.microsoft.io/npm/` with your existing
registry authentication. This project does not configure or print credentials.

The app binds only to `127.0.0.1`, chooses a free port, and opens the browser on
Windows. Alternatively:

```powershell
npm start -- --no-open --port 4210 --data-dir 'C:\local-dashboard'
```

Open the **startup access URL** printed in that terminal. It establishes a
per-run HttpOnly, SameSite=Strict cookie, then removes the token from the browser
URL. Treat that initial URL as a local secret; do not share terminal screenshots
containing it. After restarting, use the new startup URL. Stop with Ctrl+C.
Node may print an experimental SQLite warning; this is expected on Node 22.

`npm run dev -- --no-open` runs the authenticated development server. Production
serves bundled assets with no CDN, remote fonts, or cloud account requirement.
Development watches and rebuilds the frontend into `dist\dev-client` without
WebSocket/HMR listeners; refresh the browser after frontend edits.

## Portable Windows app

The portable app is a zip (`CopilotSessionDashboard-<version>-win-x64.zip`) for
Windows 11 x64 and Windows 10 22H2 x64. It contains a WebView2 window, the
unchanged Node backend, and unmodified official .NET and Node.js runtimes. There
is no installer, no administrator prompt, no tray icon, and no auto-start. It
needs the Microsoft Edge WebView2 Runtime, which Windows 11 includes; the app
never installs it.

1. Before extracting, right-click the downloaded zip, choose **Properties**, tick
   **Unblock**, and select **OK**. This avoids a per-file "Open File - Security
   Warning" prompt for the `.cmd` entry point.
2. Extract the zip to a folder you own, for example under `Downloads`.
3. Start one of the two entry points in the extracted `CopilotSessionDashboard`
   folder:
   - `CopilotSessionDashboard.exe` for ordinary PCs. It is unsigned, so Microsoft
     Defender SmartScreen may show "Windows protected your PC"; choose
     **More info** then **Run anyway** if you trust the download.
   - `CopilotSessionDashboard (Defender ASR).cmd` when a managed PC's Defender
     Attack Surface Reduction rules block the exe (event 1121). It runs the same
     app through the bundled, Microsoft-signed `runtime\dotnet.exe`. A console
     window may flash briefly at start.

Closing the window quits the app and its backend. Starting it again while it is
running brings the existing window forward. Do **not** run the portable app and
the browser mode (`npm start`/`npm run dev`) at the same time; they share the
same data folder and simultaneous use is unsupported.

The app shares browser mode's data at
`%LOCALAPPDATA%\CopilotSessionDashboard\dashboard-data` (same consent, ownership,
and permission rules as below). The window's own WebView2 profile and
`logs\shell.log` live under `%LOCALAPPDATA%\CopilotSessionDashboard\desktop`; the
log never contains startup tokens or prompts. Nothing is written inside the
extracted folder. Deleting that folder removes the app; dashboard data stays and is
removed only with **Clear local data**. Deleting the `desktop` folder only removes
logs and the WebView2 profile without touching dashboard data.

Build and verify the package from this repository (Windows, PowerShell 7, .NET 10
SDK; runtimes are downloaded once and verified by hash and signature):

```powershell
npm run desktop:test                 # shell unit tests
npm run desktop:package -- -Flavor Release   # desktop\artifacts\*.zip
npm run desktop:e2e                  # Testing package + WebView2 workflows
npm run desktop:defender-smoke -- -Zip desktop\artifacts\CopilotSessionDashboard-0.1.0-win-x64.zip
```

`desktop:defender-smoke` extracts the zip to a temporary folder with spaces and
non-ASCII characters, marks every file as downloaded, starts only the `.cmd`
entry point with disposable `LOCALAPPDATA` and an empty `COPILOT_HOME`, checks
startup, close, forced shell termination, and console windows, and fails on any
Defender 1116/1117/1121/1122 event during the run. Harnesses never start the exe
entry point directly.

## Choose sources explicitly

Open **Sources**. No source collection or client telemetry is enabled for you.

### Copilot CLI history

The page shows the resolved history path, normally
`C:\Users\<you>\.copilot\session-state`, honoring `COPILOT_HOME`. Choose **Copilot
CLI history**, review the path, check read-only consent, and select **Enable
source**. Existing session folders are indexed and new complete JSONL records
are polled about once a second. Source files are never modified.

Enabled readers retain the selected file identity and drain it before switching
to a replacement. After restart, recovery checks up to 1,000 regular files in
that same directory for the previously approved identity; unrelated file contents
are not read. A deleted/moved-out rotated file or an incomplete final record
cannot be reconstructed and produces a persistent coverage warning.

Full original user text comes from `user.message.content`, not expanded model
context. Assistant previews exclude reasoning and tool results and retain at
most 1,000 Unicode code points. Prompts are copied exactly, not submitted.

### Existing VS Code chats

Open the desired conversation in VS Code and run **Chat: Export Chat...**.
Choose its JSON file under **Import an existing VS Code chat**.
Exports are historical snapshots, not active sessions. Reimporting an unchanged
file is idempotent. Imports without native identity are not merged with live
sessions by title or prompt text. Changed file contents are kept as a separate
snapshot, even when request IDs are unchanged.

Missing historical model, token, timing, or credit fields remain unavailable.
JSON imports are limited to 50 MiB. No VS Code private storage is read.

### Optional future telemetry

Configure the client yourself, then enable only the selected local JSONL file
in Sources. Telemetry settings and content capture are never edited by this app.

For a new CLI process, use the client's file exporter:

```powershell
$env:COPILOT_OTEL_FILE_EXPORTER_PATH = 'C:\path\cli-otel.jsonl'
# Start Copilot CLI from this PowerShell window.
```

For supported VS Code chat harnesses, configure Settings JSON:

```json
{
  "github.copilot.chat.otel.enabled": true,
  "github.copilot.chat.otel.exporterType": "file",
  "github.copilot.chat.otel.outfile": "C:\\path\\vscode-otel.jsonl"
}
```

Settings depend on the active client/harness; consult the first-party monitoring
documentation below and reload if required. Usage-only telemetry does not need
content capture. Optional CLI
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT=SPAN_ONLY` or VS Code `captureContent`
can write sensitive expanded context; enable those only if you understand the
privacy implications. Telemetry input is **not** a reliable original-prompt
transcript. Use CLI history or VS Code chat import for prompt reuse.

## Interpret activity and usage

- **Active (observed)**, idle, completed, interrupted, error, and unknown reflect
  source evidence. Idle and an assistant turn ending are not session completion.
  Imported snapshots are labeled separately.
- Conversation entries default to descending source-time order (newest first);
  choose ascending for oldest first. Timestamp ties follow insertion order in
  the selected direction. Undated entries stay last; their times are not guessed.
  Empty assistant previews are hidden by default before pagination, with 25 entries
  per page by default and 50, 100, or 150 available. Down/up buttons beside the page
  size select descending/ascending order.
- Conversation bodies use the panel's available width. Original prompts display
  at most ten wrapped lines with keyboard-accessible internal scrolling; short
  prompts use their natural height. Copy still uses the full unchanged prompt,
  and search reveals matches below the viewport.
- The active tab's explanation appears beside navigation, without a duplicate
  page title below it. Live connection status appears in the header on Sessions
  only; Usage and Sources retain their existing refresh behavior.
- The sidebar icon at the upper-left of the right session panel hides/shows
  the list while preserving selection, filters, pagination, and list scroll.
  It stays reachable while scrolling. The selected state/scope and stale-observation
  message share the icon's toolbar, wrapping when necessary. Search and
  source/state/model/date filters
  are inside the left pane's **Search and filters** expander, collapsed by default;
  its summary shows the active filter count even while closed. Expanding reveals
  icon-led labeled filter controls and removable chips. Collapsing closes any
  nested editor without clearing filters.
  Above 900 CSS pixels the list and details scroll independently; narrower
  screens use stacked document flow. Session information and usage expand
  together; title, observed state, freshness warnings, and coverage indicators
  remain visible when collapsed.
- Pane/expander and Conversation display settings survive session switching
  and live updates within the mounted Sessions page, but reset on reload or
  tab remount. Existing search/filter/selection URL state is unchanged.
- Activity is observed events and counts, not a percent-complete estimate or a
  guarantee that a tool is currently running. Source time, dashboard observation
  time, connection status, and observations older than 30 seconds are visible.
- The target is a UI update within two seconds **after a complete source record
  is written**, not after an operation starts. Upstream exporters may flush only
  completed spans. Large history catch-up is bounded and may take longer.
- Credits are reported **AIC only**, never dollars or guessed conversions.
  CLI history `copilotUsage.totalNanoAiu` and telemetry
  `github.copilot.nano_aiu` use the documented conversion of 10^9 nano AIU per
  AI credit. Premium-request `cost` is not converted into credits. Enabled CLI
  history sources replay legacy checkpoints once to fill missing credits without
  duplicating records; original logs must still be readable. Missing values are
  not zero, and partial totals stay labeled. Unidentified import snapshots are
  excluded from combined totals.
- Model filters select matching **whole sessions**, including their other models.
  Model/source tables are descriptive, not model quality or efficiency rankings.
  Cache and reasoning tokens are subsets, not extra tokens added to input/output.
  Cache-read share shows its compatible-record denominator.
- Agent time is the union of measured root invocation intervals. Session wall
  span includes waiting and is shown separately. No guessed duration fills gaps.
  Verified parent/child and overlapping-source identities prevent double counts;
  uncertain overlaps prefer CLI history and show a warning.

## Storage and privacy

App-owned SQLite data normally lives in
`%LOCALAPPDATA%\CopilotSessionDashboard\dashboard-data`. `--data-dir` changes the
base; the app always uses its dedicated `dashboard-data` child, refuses unrelated
existing nonempty directories, and attempts owner-only Windows permissions.
Sources shows the actual location and any permission warning.
Explicit shared grants on that directory or known database/marker files are
preserved but trigger a warning; do not collect sensitive history until resolved.

The database contains **full original prompts**, bounded assistant previews,
session metadata, usage observations, and ingestion checkpoints. Protect it like
your Copilot history. Loopback authentication is not isolation from other
processes running as your user. Do not expose the app through a proxy or tunnel.

**Clear local data** requires typing `CLEAR LOCAL DASHBOARD DATA`. It clears
dashboard records and disables collection, without deleting original Copilot
history, exports, or telemetry files. Re-enabling a source can import it again.
This is logical clearing, not secure disk erasure; backups may retain old data.

## Development and acceptance

```powershell
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run format:check
npm run build
```

If Playwright reports that Chromium is missing, run
`npx playwright install chromium` once and retry. Browser acceptance uses the
built production server, authenticated loopback readiness, disposable app/source
directories, and synthetic conversations. It covers prompt fidelity, safe bounded
previews, source/filter navigation, narrow layouts, source-record latency,
reconnection without duplicates, and restart persistence. The harness keeps
startup tokens out of Playwright URLs/reports, terminates only its own server
processes, and removes only its own temporary directories.

## Compatibility evidence

- CLI event shapes were inspected read-only from Copilot CLI 1.0.109. No original conversation text is included in fixtures.
- VS Code 1.146.0 export shapes were checked against first-party source at commit `69047191fc427f2f92828279aae1d90d8eeda7ab`, `src/vs/workbench/contrib/chat/common/model/chatModel.ts`. Fixture contents are synthetic. A real user-selected export from this installation has not yet been validated.
- VS Code telemetry file spans follow the first-party `microsoft/vscode-copilot-chat` file exporter (`src/platform/otel/node/fileExporters.ts`) and official monitoring documentation. Fixtures are synthetic, not a live capture.
- Exported completed spans do not guarantee visibility into a tool currently running. Live exporter timing remains unmeasured.
- CLI `copilotUsage.totalNanoAiu` and telemetry `github.copilot.nano_aiu` use the verified nano-AIU conversion described above; premium-request `cost` is not AIC. VS Code snapshot `copilotCredits` can be displayed as partial per-request reported credits, but unidentified snapshots are excluded from combined totals.

Source documentation:

- https://code.visualstudio.com/docs/agents/run/sessions/session-history
- https://code.visualstudio.com/docs/agents/guides/monitoring-agents
- https://github.com/microsoft/vscode/blob/69047191fc427f2f92828279aae1d90d8eeda7ab/src/vs/workbench/contrib/chat/common/model/chatModel.ts
- https://github.com/microsoft/vscode-copilot-chat/blob/main/src/platform/otel/node/fileExporters.ts
