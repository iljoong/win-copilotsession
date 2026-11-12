# Copilot Session Dashboard

Local-only session browser for Copilot CLI and VS Code.

Browse sessions, search and copy complete original prompts, inspect text-only
assistant previews, and monitor observed activity. The session-first workspace
stacks on narrow screens. Usage views distinguish reported zero, missing data,
partial coverage, and overlapping sources.

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

## Choose sources explicitly

Open **Sources**. No source collection or client telemetry is enabled for you.

### Copilot CLI history

The page shows the resolved history path, normally
`C:\Users\<you>\.copilot\session-state`, honoring `COPILOT_HOME`. Choose **Copilot
CLI history**, review the path, check read-only consent, and select **Enable
source**. Existing session folders are indexed and new complete JSONL records
are polled about once a second. Source files are never modified.

Full original user text comes from `user.message.content`, not expanded model
context. Assistant previews exclude reasoning and tool results and retain at
most 1,000 Unicode code points. Prompts are copied exactly, not submitted.

### Existing VS Code chats

Open the desired conversation in VS Code and run **Chat: Export Chat...**.
Choose its JSON file under **Import an existing VS Code chat**.
Exports are historical snapshots, not active sessions. Reimporting an unchanged
file is idempotent. Imports without native identity are not merged with live
sessions by title or prompt text. A changed snapshot can be a separate session.

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
- Activity is observed events and counts, not a percent-complete estimate or a
  guarantee that a tool is currently running. Source time, dashboard observation
  time, connection status, and observations older than 30 seconds are visible.
- The target is a UI update within two seconds **after a complete source record
  is written**, not after an operation starts. Upstream exporters may flush only
  completed spans. Large history catch-up is bounded and may take longer.
- Credits are reported **AIC only**, never dollars or guessed conversions.
  CLI credit conversion remains unverified. Missing values are not zero.
  Unidentified import snapshots are excluded from combined totals.
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
- CLI billing fields such as `cost` and `totalNanoAiu` are not treated as AIC without a verified mapping. VS Code snapshot `copilotCredits` can be displayed as partial per-request reported credits, but unidentified snapshots are excluded from combined totals.

Source documentation:

- https://code.visualstudio.com/docs/agents/run/sessions/session-history
- https://code.visualstudio.com/docs/agents/guides/monitoring-agents
- https://github.com/microsoft/vscode/blob/69047191fc427f2f92828279aae1d90d8eeda7ab/src/vs/workbench/contrib/chat/common/model/chatModel.ts
- https://github.com/microsoft/vscode-copilot-chat/blob/main/src/platform/otel/node/fileExporters.ts
