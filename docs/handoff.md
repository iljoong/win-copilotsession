# Repository and implementation handoff

Snapshot: 2026-11-13. This document describes the implemented browser application,
accepted follow-ups, and the portable WebView2 desktop app (see the desktop
section below for its status and unverified items).

## Reading map and authority

| Document                                                                                            | Use                                                                               |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [AGENTS.md](../AGENTS.md)                                                                           | Spec-driven coding workflow and completion gates                                  |
| [README](../README.md)                                                                              | Desktop download/start, data summary and actual synthetic-window example          |
| [Detailed manual](../manual/README.md)                                                              | Source consent, usage semantics, privacy and compatibility reference              |
| [Development](../manual/development.md) / [Testing](../manual/testing.md)                           | Contributor setup and full browser/native gates                                   |
| [Versions/releases](../manual/releases.md) / [VERSION.md](../VERSION.md)                            | Explicit application versions and guarded Desktop ZIP publication                 |
| [Approved design](superpowers/specs/2026-11-12-copilot-session-dashboard-design.md)                 | Original product scope and acceptance boundaries                                  |
| [Original plan](superpowers/plans/2026-11-12-copilot-session-dashboard.md)                          | Completed implementation history, not a task list to restart                      |
| [Desktop research](research/windows-desktop-options-research.md)                                    | Electron/WebView2/C# tradeoffs, sources, and unresolved PoC gates                 |
| [WebView2 vs Tauri](research/webview2-sidecar-vs-tauri-comparison.md)                               | .NET WebView2 + Node sidecar vs Tauri on Windows and macOS (research only)        |
| [Portable WebView2 + Defender research](research/2026-11-13-portable-webview2-defender-research.md) | ASR/SmartScreen evidence on this VM; why the shell runs via bundled `dotnet.exe`  |
| [Portable desktop spec](superpowers/specs/2026-11-13-windows-portable-webview2-design.md)           | Approved 2026-11-13 desktop design (portable zip); supersedes the 2026-11-12 spec |
| [Portable desktop plan](superpowers/plans/2026-11-13-windows-portable-webview2.md)                  | Task-by-task implementation plan for the approved desktop spec                    |

The original design is the baseline. Accepted follow-ups below record subsequent
user-requested refinements. For new work, use the explicit approved task/spec;
resolve conflicts rather than silently treating a research recommendation or an
implementation detail as a new requirement. Historical brainstorming scratch
files referenced by the original design are not required for this handoff.

## Desktop documentation and explicit releases

The approved [documentation/release design](superpowers/specs/2026-11-13-desktop-readme-version-release-design.md)
was implemented on `feature/desktop-docs-version-releases`. The user subsequently
authorized committing/pushing to main and triggering the initial 0.1.0 Release
workflow, without a version increment. Root README is Desktop-first; detailed original guidance is retained
under `manual`, with development/testing/release guides and an inspected actual
Release-window PNG containing synthetic snapshots only.

Root VERSION.md starts at 0.1.0 and supplies native title/metadata, ZIP name,
tag and release notes. `version:sync` updates npm/lock projections only after an
explicit version request; normal builds never increment or edit history.
The nearest desktop props import root props, and validation independently checks
all native properties, including an overridden ApplicationVersion.

The new workflow triggers on main/VERSION.md pushes or main manual dispatch.
Publication uses exact-SHA targets, draft-aware GraphQL/ID lookup, uploaded-asset
confirmation and no clobber/deletion. Matching complete draft ZIPs are reused
only after digest/size/state checks. Immutable releases was enabled and verified
with explicit owner authorization; retain it as an administrative prerequisite.
The contents-scoped workflow token cannot query that admin-only settings API.

Final evidence: 142 unit tests, typecheck/lint, 13 Chromium workflows, 57 shell
tests, C# format, Release package and nine WebView2 workflows passed. Defender
cold/warm startup was 8.33/1.47 seconds with zero 1116/1117/1121/1122 events and
complete cleanup. Ordinary builds preserved VERSION.md/npm/lock hashes.
Actionlint, seven embedded PowerShell blocks and the workflow's exact local
ZIP/native checks passed; 61 local documentation/image paths resolve.
Changed-file formatting passes; standard repository formatting still flags
56 unrelated CRLF files (`--end-of-line auto` passes).

Final review's pending-draft, native-authority and published-asset-race findings
were fixed RED-to-GREEN; no minors deferred. A final package rerun initially hit
a newly opened external Desktop instance's folder lock. Closure was authorized;
the app had already exited, and the subsequent package/native/Defender run passed.
The earlier packaging run overlapping new RED tests also failed before rerun.
Hosted Actions and Windows 10 were not part of the local verification above.
Main publication is now authorized; verify its hosted outcome in Actions rather
than interpreting local checks as a completed public release.
The local Release ZIP is rebuilt and the app must be relaunched to use it.

Initial hosted run `43378151156` passed browser/static checks and all 57 shell
tests, then stopped at C# formatting before producing a ZIP. `AssemblyInfo.cs`
scaffold comments failed only with LF source bytes; both SDK 10.0.403 and
10.0.404 reproduced the same errors. A default archive initially inherited local
autocrlf and masked the issue. The fix removes those redundant comments, retains
the same ThemeInfo values, and passes the complete format gate in a verified LF
copy with hosted SDK 10.0.404. The user authorized publishing the fix and manually
dispatching the workflow against its new commit, without changing 0.1.0.
Local fix verification passed 142 unit tests, typecheck/lint, 13 Chromium
workflows, 57 shell tests, Release packaging and nine WebView2 workflows.
Hosted-SDK 10.0.404 shell tests and the full LF format gate also passed.
Defender startup was 9.25/1.35 seconds with zero events and complete cleanup.
Repackaging initially encountered the user's open Desktop folder lock; normal
closure was separately authorized. The current CRLF checkout flags 72 unrelated
Prettier files, while changed documentation and `--end-of-line auto` pass.
Hosted retry [43381153906](https://github.com/iljoong/win-copilotsession/actions/runs/43381153906)
then passed every gate and published [v0.1.0](https://github.com/iljoong/win-copilotsession/releases/tag/v0.1.0).
The immutable release tag targets `fe0d5506fe626835e3aedc6ec4a74abc94990c26`;
its `CopilotSessionDashboard-0.1.0-win-x64.zip` asset is uploaded (113,279,898
bytes). GitHub confirmed `draft=false` and `immutable=true`; VERSION.md stayed
0.1.0. Hosted LF formatting, packaging, WebView2 and Defender gates are now
verified; Windows 10 and managed ASR-Block coverage remain separate local/target
claims, not inferred from this hosted success.

## Stack and entry points

Application versions are authoritative in root `VERSION.md`; npm/lock metadata
are checked projections. Dependency versions and commands remain in `package.json`
and its lock; bundled native/runtime pins remain in `desktop\versions.json`.
The current declared stack is:

| Layer        | Implementation                                                             |
| ------------ | -------------------------------------------------------------------------- |
| Runtime      | Node.js >=22.23.4; ESM TypeScript                                          |
| UI           | React 19, TypeScript 5.9, Vite 7, plain CSS                                |
| Server       | Built-in Node HTTP, filesystem, crypto, and process APIs; no web framework |
| Persistence  | Built-in `node:sqlite` / `DatabaseSync`, WAL, FTS5                         |
| Live refresh | Authenticated Server-Sent Events, followed by authoritative API refetches  |
| Tests        | Vitest 3, React Testing Library, Playwright Chromium                       |
| Style        | ESLint 9 and Prettier 3                                                    |

The portable desktop app adds a WPF WebView2 shell in C# (.NET 10, IL-only,
framework-dependent) under desktop\; it runs the unchanged Node backend as a
sidecar. There is no Electron or Rust application.
Node 22 can emit the expected experimental SQLite warning.

```text
Authorized CLI history / imported VS Code JSON / opt-in telemetry
  -> source adapters -> normalized records
  -> transactional SQLite store + prompt FTS + ingestion checkpoints
  -> authenticated loopback API / SSE invalidations
  -> React Sessions / Usage / Sources
```

| Area                                                    | Source                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Browser entry and navigation                            | `src\client\main.tsx`, `src\client\App.tsx`                                    |
| Session list, conversation, sorting, badges, activity   | `src\client\sessions.tsx`, `src\client\styles.css`                             |
| Source consent/import and usage analysis                | `src\client\sources.tsx`, `src\client\usage.tsx`                               |
| HTTP requests and SSE recovery                          | `src\client\api.ts`                                                            |
| Shared records, DTOs, filters                           | `src\shared\contracts.ts`                                                      |
| Process startup/shutdown and paths                      | `src\server\main.ts`                                                           |
| Loopback binding, cookie authentication, static files   | `src\server\http.ts`                                                           |
| API, imports, source configuration, local clearing      | `src\server\routes.ts`                                                         |
| SSE subscriber delivery                                 | `src\server\events.ts`                                                         |
| App-owned storage and Windows permission checks         | `src\server\storage.ts`                                                        |
| Schema, identity, search, persistence, usage projection | `src\server\data\schema.ts`, `store.ts`, `accounting.ts`                       |
| CLI, VS Code, and telemetry normalization               | `src\server\sources\cli.ts`, `vscode.ts`, `telemetry.ts`, `values.ts`          |
| JSONL decoding, tailing, rotation/restart recovery      | `src\server\sources\jsonl.ts`, `ingestion.ts`                                  |
| Runner/build configuration                              | `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig*.json` |

Production builds produce `dist\server` and `dist\client`; `npm start` runs
`dist\server\main.js`. Development watches into `dist\dev-client` and serves it
through the same authenticated server, without a separate Vite/HMR listener.
Refresh the browser after frontend rebuilds. Server-code changes need a process
restart unless the development watcher handles it.

## Implemented behavior and accepted follow-ups

### Sessions and conversation

- Session-first two-pane layout with source/state/model/date filters, usage sorts,
  full original-prompt/title search, and matching-prompt navigation/highlighting.
- The approved [conversation-focused UI follow-up](superpowers/specs/2026-11-13-conversation-focused-sessions-ui-design.md)
  is implemented. Search and compact icon disclosures for filters live in the
  320px sidebar; source/state editors use radios, model stays free text, and
  dates retain native inputs. Active filter chips are removable; sort uses icons.
- The approved [compact header/sidebar follow-up](superpowers/specs/2026-11-13-compact-header-sidebar-controls-design.md)
  removes duplicate page titles/descriptions. The active tab's explanation is
  beside navigation; connection status appears there on Sessions only, forwarded
  from its existing stream, with late unmounted callbacks ignored.
- One icon-only Hide/Show button inside the right Selected session panel keeps
  selection, filters, both pagination offsets, and list scroll intact. Its
  toolbar stays reachable when scrolling, including <=900px stacked document
  flow. Selected state/scope, snapshot label, and the unchanged stale-observation
  message share the icon's toolbar instead of separate rows below it; they wrap
  without truncation on narrow screens. Desktop list/detail panes scroll independently. The stacked workspace
  uses `overflow: clip` rather than a sticky-trapping scroll container.
  Navigation, descriptions, and status wrap without 320px overflow.
- Search/filter/sort/chip controls share a Search and filters expander,
  collapsed by default. Its summary keeps the active filter count visible;
  closing clears only the nested editor, not query values or selection.
  Expansion survives session changes, SSE refresh, and Hide/Show.
- Session information and all eight usage fields share one native
  collapsed-by-default expander. Title/state/scope, stale observations, and
  coverage warning counts remain outside; expansion survives session changes
  and same-session refreshes within the mounted page.
- Conversation prompt/preview bodies use the available panel width. Original
  prompts cap at ten rendered line heights, not source-newline count, and scroll
  internally without truncation. Short prompts retain natural height. Search
  reveals the relevant body match after pagination, including case/diacritic and
  Greek sigma variants; SSE refresh does not reset manual prompt scroll.
- Full user prompts are rendered as text and copied unchanged, including CRLF,
  combining characters, emoji, and leading/trailing whitespace.
- Assistant previews are inert text, limited to 1,000 Unicode code points and a
  bounded scrollable display. Tool results/reasoning are not assistant previews.
- Conversation defaults to newest first and hides empty/whitespace-only assistant
  previews. Original user prompts are retained. The hide checkbox is checked by
  default and remains user-toggleable.
- Page sizes are 25 (default), 50, 100, or 150. Filtering and ordering happen before
  pagination; totals and search-match offsets use the same visible ordering.
- Down/up icon buttons beside the page-size select choose descending/ascending
  order. Selected state is exposed through `aria-pressed` and visual emphasis;
  buttons have accessible labels and native keyboard activation.
- Source timestamps determine order. Timestamp ties use insertion order in the
  selected direction; undated entries stay last.
- Original prompt bodies are yellow. Model badges distinguish GPT (mint), Claude
  (peach), and other models (lavender).
- Observed activity is a collapsed-by-default native details expander. It shows
  exported event counts/times and freshness, not fabricated running progress.
  An opened expander survives live refreshes of the same selected session.

Conversation and pane/expander settings are component state, not persistent preferences. Switching
tabs remounts the page. List/search filters and selected session are reflected in
the URL; do not assume all display controls are saved there.

### Sources and live ingestion

- CLI history is explicitly enabled, read-only polling of configured session
  folders. New complete records are discovered incrementally.
- VS Code historical chats are manually exported/imported JSON snapshots. Identical
  content is idempotent; changed exports with reused request IDs are kept as
  separate snapshots. Private VS Code persistence is not parsed.
- CLI/VS Code telemetry requires explicit client configuration and source consent.
  Captured model input is not indexed as original user prompts.
- Split UTF-8/JSONL records, persisted partial lines, truncation, rotation, restart,
  source failures/recovery, and configured path boundaries are handled.
- Readers drain old file identities before replacements. Restart recovery checks
  bounded same-directory candidates for the previously authorized identity.
  Missing/incomplete rotated history yields coverage warnings.
- SSE triggers refetches rather than becoming the authoritative data store.
  Reconnect refreshes state; stale selection responses cannot overwrite newer
  selections. The two-second target starts at a complete record write, excluding
  upstream exporter delays and large initial catch-up.

### Accounting, identity, and persistence

- Canonical identities keep CLI and VS namespaces distinct. Verified duplicate
  records are idempotent; ambiguous cross-source matches are not silently merged.
- `sessions`, `records`, `source_links`, `sources`, and `checkpoints` persist
  summaries, normalized records, source configuration, and ingestion positions.
  `prompt_search` is the FTS5 virtual table.
- Missing metrics remain null/unavailable; reported zero remains zero; partial
  coverage stays labeled. Cache/reasoning subsets are not added to token totals.
- CLI `usage.copilotUsage.totalNanoAiu` and telemetry
  `github.copilot.nano_aiu` convert at 10^9 nano AIU per AIC. Premium-request `cost`
  is not substituted. CLI `aiCreditsStatus` preserves unavailable/partial values.
- Enabled CLI history sources replay legacy cursors once (`creditsVersion`) to
  enrich missing stored AIC from readable original logs. Only missing billing
  fields are enriched; record identity, prompt text, token totals, and original
  observation timestamps are preserved.
- Existing CLI history is preferred over overlapping telemetry call totals.
  Unidentified VS snapshots are excluded from combined usage, while their
  reported `copilotCredits` can appear as partial per-snapshot credits.
- Agent time is a union of measured root invocation intervals. Model-call
  `duration` alone is not total agent time. CLI-history-only sessions can therefore
  show AIC while agent time remains unavailable. Wall span is a separate measure.

Storage normally uses `%LOCALAPPDATA%\CopilotSessionDashboard\dashboard-data`.
It contains full prompts and other sensitive history; it is not a distributable
fixture or a portable public database. The ownership marker, permission warnings,
explicit clearing confirmation, and source-disable behavior are described in
README and must survive any packaging/migration.

## Regression map and verification snapshot

| Change area                                                     | Relevant tests                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| Auth, loopback/static serving                                   | `tests\http.test.ts`                                            |
| Schemas, safe previews, billing conversion                      | `tests\adapters.test.ts`                                        |
| FTS, canonical identity, sort/filter offsets, persisted queries | `tests\store.test.ts`                                           |
| Parent/child usage, null/partial coverage, interval union       | `tests\accounting.test.ts`                                      |
| Partial records, rotated files, checkpoints, credit replay      | `tests\ingestion.test.ts`                                       |
| API bounds, imports, consent/clearing, storage permissions      | `tests\routes.test.ts`                                          |
| Session UI, Sources, Usage                                      | `tests\sessions.test.tsx`, `sources.test.tsx`, `usage.test.tsx` |
| Actual production server/browser workflows                      | `tests\e2e\dashboard.spec.ts`, `harness.ts`                     |
| Backend lifecycle and `--desktop` sidecar mode                  | `tests\lifecycle.test.ts`, `tests\desktop-cli.test.ts`          |
| Shell policy, paths, log redaction, supervisor, single instance | `desktop\tests\Shell.Tests\*.cs` (`npm run desktop:test`)       |
| Package layout, pinned runtimes, hashes/signatures, notices     | `desktop\tests\packaging.tests.ps1`, `desktop\scripts\*.ps1`    |
| Staged WebView2 shell workflows over CDP                        | `tests\desktop\dashboard.spec.ts`, `harness.ts`                 |
| Release zip under Defender ASR (`.cmd` entry point)             | `desktop\scripts\defender-smoke.ps1`                            |

Last observed verification on 2026-11-12: 103 unit/integration tests and seven
Chromium workflows passed; typecheck, lint, formatting, and production build
passed. This is a snapshot, not evidence that a later checkout or desktop runtime
passes. Use AGENTS.md's gates for each new code handoff. Browser fixtures and app
data are synthetic/disposable; the harness avoids recording startup secrets.

Known evidence limits: real VS Code exports from this installation and live
telemetry delivery timing have not been validated. Compatibility sources and
checked client versions are recorded in README.

## Desktop implementation handoff

**Status: implemented on branch `feature/windows-portable-webview2`; verified on
one Windows 11 VM with Defender for Endpoint (all ASR rules Block).** The binding
design is the [portable WebView2 spec](superpowers/specs/2026-11-13-windows-portable-webview2-design.md);
its [plan](superpowers/plans/2026-11-13-windows-portable-webview2.md) records the
task history. The 2026-11-12 Electron-first research is historical context only.

The app is a zip: a WPF WebView2 shell (`desktop\src\Shell`, .NET 10, IL-only,
framework-dependent; the only PEs we build are `CopilotSessionDashboard.exe` and
`.dll`) plus unmodified official `runtime\` (.NET) and `node\node.exe`, and the
unchanged built backend under `app\`. Pinned runtime versions and hashes are in
`desktop\versions.json`. The shell starts exactly one child, `node.exe
app\dist\server\main.js --desktop --no-open --port 0`, waits up to 30 seconds for its ready line,
and opens the loopback dashboard in a locked-down WebView2. Closing the window
stops the backend within the 5-second grace; a job object kills `node.exe` if the
shell dies. Two entry points share one single-instance lock:
`CopilotSessionDashboard.exe` (ordinary PCs) and
`CopilotSessionDashboard (Defender ASR).cmd`, which runs
`runtime\dotnet.exe CopilotSessionDashboard.dll` because this VM's ASR rule
`01443614` blocked new WPF apphost exes (research experiments 5–6).

| Area                                              | Source                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Backend lifecycle extraction and `--desktop` mode | `src\server\lifecycle.ts`, `src\server\main.ts`                                  |
| Shell startup, window, WebView2 policy            | `desktop\src\Shell\App.xaml.cs`, `MainWindow.xaml.cs`, `DashboardWebView.cs`     |
| Sidecar supervision, ready handshake, job object  | `BackendSupervisor.cs`, `ReadyLine.cs`, `JobObject.cs`, `ChildEnvironment.cs`    |
| Paths, redacted rotating log, single instance     | `AppPaths.cs`, `SafeLog.cs`, `LogRedactor.cs`, `SingleInstance.cs`               |
| Runtime fetch/verify, staging, notices, zip       | `desktop\scripts\fetch-runtimes.ps1`, `package.ps1`, `notices.ps1`, `common.ps1` |
| Entry point and in-zip guide                      | `desktop\packaging\launcher.cmd.template`, `README-FIRST.txt`                    |

Commands (Windows, PowerShell 7, .NET 10 SDK):

```powershell
npm run desktop:test                                   # shell unit tests (dotnet test)
npm run desktop:package -- -Flavor Release             # desktop\artifacts\CopilotSessionDashboard-<version>-win-x64.zip
npm run desktop:e2e                                    # Testing package + 8 WebView2 workflows over CDP
npm run desktop:defender-smoke -- -Zip desktop\artifacts\CopilotSessionDashboard-0.1.0-win-x64.zip
pwsh -NoProfile -File desktop\tests\packaging.tests.ps1  # staged Release layout checks
dotnet format desktop\CopilotSessionDashboard.Desktop.sln --verify-no-changes
```

Harnesses never execute the apphost exe; they run the shell dll through the
bundled Microsoft-signed `runtime\dotnet.exe` with disposable `LOCALAPPDATA`,
data, and `COPILOT_HOME`. Generated `desktop\artifacts`, `desktop\downloads`, and
`desktop\**\bin|obj` are ignored by Git, ESLint, and Prettier.

Verification snapshot on 2026-11-13 (this VM): `desktop:defender-smoke` passed
with zero Defender 1116/1117/1121/1122 events, no lingering console windows, and
`node.exe` gone within 5 seconds after both window close and shell kill; size and
startup/memory measurements are in the
[Defender research](research/2026-11-13-portable-webview2-defender-research.md)
section 4.1. `npm run desktop:test`, `dotnet format --verify-no-changes`,
`npm run desktop:e2e`, `npm run test:e2e`, `npm run typecheck`, and `npm run lint`
passed. The later conversation-focused UI work fixes the Node 24/jsdom
`AbortSignal` test-harness incompatibility by bridging to a native signal only
at the test fetch boundary, preserving cancellation; production requests are
unchanged. `npm run format:check` still reports unrelated CRLF working-tree files
under `core.autocrlf=true`, while
`npx prettier --check --end-of-line auto .` passes. Do not normalize unrelated
files as part of a UI-only handoff.

Unverified (no suitable environment here; check before wider release):

- The exe entry point and its SmartScreen "Windows protected your PC" wording on
  a Windows 11 PC without ASR. On this VM the exe is never launched by design.
- Windows 10 22H2 x64.
- A PC without the WebView2 Runtime (the native error screen is not exercised by any automated test).
- A PC with Smart App Control on; the unsigned exe and dll may be blocked there.
- Extracting with File Explorer: MOTW propagation and the `.cmd` "Open File -
  Security Warning" prompt wording (the smoke uses `Expand-Archive` plus an
  explicit Zone.Identifier stamp), and Edge download reputation warnings.
- Code signing: `package.ps1` has an optional signing step, unused so far.

### Conversation-focused UI verification (2026-11-13)

The local implementation passed 120 unit/integration tests, 11 production
Chromium workflows, 57 shell tests, and nine WebView2 workflows (including the
combined expander, sidebar hide/show, prompt cap/scroll, and exact Copy).
Typecheck, ESLint, `dotnet format --verify-no-changes`, Release packaging, and
the final Release Defender smoke passed. The smoke reported zero
1116/1117/1121/1122 events and cleaned up its disposable processes/data.

The standard `npm run format:check` remains blocked by 58 unrelated CRLF files;
the changed files pass the standard formatter, and the repository passes
`npx prettier --check --end-of-line auto .`. An initial concurrent full test run
failed `rotationDrainsRecordsWrittenBetweenPolls` and
`restartRecoversRotatedIdentityInTheSameDirectory`; the unchanged ingestion file
passed alone and the subsequent full suites passed. This is transient evidence,
not a claimed ingestion fix.

The generated Release zip is
`desktop\artifacts\CopilotSessionDashboard-0.1.0-win-x64.zip`.
Refresh browser mode after rebuilding, or relaunch the updated portable package.
The user authorized in-place implementation on `main`, then approved publishing
the previously unpushed desktop work and this UI work as one squash commit.
No shared process was restarted and no real history was inspected.

### Compact header/sidebar follow-up verification (2026-11-13)

The follow-up passed 124 unit/integration tests, 12 rebuilt production
Chromium workflows, 57 shell tests, and nine WebView2 workflows. Typecheck, ESLint,
C# formatting, and Release packaging passed. Packaging's pinned-runtime subset
passed 94 tests. Both browser engines cover collapsed search, the in-panel icon,
keyboard controls, header descriptions/status, and 640/320px overflow/scrolling.
Desktop/narrow synthetic screenshots were inspected.

Final review identified a narrow-screen sticky toolbar trapped by the workspace's
`overflow: hidden`. A page-scroll regression failed before changing only the
stacked workspace to `overflow: clip`, then passed, including Hide/Show after
scrolling. Existing query, pagination, prompt fidelity, consent, accounting,
and live refresh regressions remain green.

The first Release Defender smoke timed out waiting 60.1 seconds for initial
backend readiness, with no shell log and zero Defender events. Both extracted
runtimes were present and no matching application crash event was found.
The same zip and unchanged smoke command subsequently passed: cold/warm starts
8.17/1.56 seconds, no console windows, no staged Node after close/kill, zero
1116/1117/1121/1122 events, and disposable data/process cleanup completed.
The initial timeout's cause remains unconfirmed; no startup or security-setting
change is claimed.

Standard `npm run format:check` still reports 59 unrelated line-ending files.
All changed files pass the standard formatter; the repository passes
`npx prettier --check --end-of-line auto .`. Referenced local Markdown paths exist.

The updated local Release zip remains
`desktop\artifacts\CopilotSessionDashboard-0.1.0-win-x64.zip`.
Refresh browser mode or relaunch the updated portable package to use this UI.
The user subsequently authorized committing and pushing this follow-up together
with the inline-status refinement. No shared process was restarted and no real
history was inspected.

The subsequent approved inline-status refinement puts state/scope and the
unchanged stale warning beside the icon, keeping snapshot/freshness conditions
and title intact. Wide alignment and 320px full-message wrapping were checked
with synthetic screenshots. Revalidation passed 124 unit tests, 13 Chromium
workflows, 57 shell tests, nine WebView2 workflows, static/C# formatting checks,
and updated Release packaging. Its Defender smoke passed on the first attempt
(cold/warm 4.80/1.57 seconds, zero events, complete cleanup). The existing
59 unrelated CRLF formatter warnings remain. Git history and remote tracking
identify the published handoff.

## Publishing this handoff

The configured origin is `https://github.com/iljoong/win-copilotsession.git`.
Use Git status, history, and remote tracking to establish which handoff is
published; a local package or verification report alone is not a remote release.
Before handing work to an agent that only sees a remote repository, ensure the
desired code, specs, and these documents are committed and available on its target
branch. The portable package is generated locally; committing source does not
automatically publish the zip or implement Electron.
