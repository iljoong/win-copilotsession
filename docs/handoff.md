# Repository and implementation handoff

Snapshot: 2026-11-12. This document describes the implemented browser application
and accepted follow-ups. Desktop application packaging is research, not an
implemented feature or an approved migration specification.

## Reading map and authority

| Document                                                                            | Use                                                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [AGENTS.md](../AGENTS.md)                                                           | Spec-driven coding workflow and completion gates                                  |
| [README](../README.md)                                                              | Running the app, source consent, usage semantics, privacy, compatibility evidence |
| [Approved design](superpowers/specs/2026-11-12-copilot-session-dashboard-design.md) | Original product scope and acceptance boundaries                                  |
| [Original plan](superpowers/plans/2026-11-12-copilot-session-dashboard.md)          | Completed implementation history, not a task list to restart                      |
| [Desktop research](research/windows-desktop-options-research.md)                    | Electron/WebView2/C# tradeoffs, sources, and unresolved PoC gates                 |
| [WebView2 vs Tauri](research/webview2-sidecar-vs-tauri-comparison.md)               | .NET WebView2 + Node sidecar vs Tauri on Windows and macOS (research only)        |

The original design is the baseline. Accepted follow-ups below record subsequent
user-requested refinements. For new work, use the explicit approved task/spec;
resolve conflicts rather than silently treating a research recommendation or an
implementation detail as a new requirement. Historical brainstorming scratch
files referenced by the original design are not required for this handoff.

## Stack and entry points

Declared versions and commands are authoritative in `package.json` and its lock.
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

There is no Electron, WebView2, C#, or Rust application in this repository yet.
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

Conversation settings are component state, not persistent preferences. Switching
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

Last observed verification on 2026-11-12: 103 unit/integration tests and seven
Chromium workflows passed; typecheck, lint, formatting, and production build
passed. This is a snapshot, not evidence that a later checkout or desktop runtime
passes. Use AGENTS.md's gates for each new code handoff. Browser fixtures and app
data are synthetic/disposable; the harness avoids recording startup secrets.

Known evidence limits: real VS Code exports from this installation and live
telemetry delivery timing have not been validated. Compatibility sources and
checked client versions are recorded in README.

## Desktop implementation handoff

**Status: researched, not implemented.** The current recommendation is Electron
reuse, conditional on packaged `node:sqlite` compatibility. C# + WebView2 + Node
is a middle path; a native C# UI/backend is a separate rewrite decision.

Before desktop implementation, obtain approval for a new spec covering supported
Windows versions/architectures, distribution/update/signing channel, close versus
tray behavior, startup collection policy, and data retention/uninstall behavior.
Then use these bounded milestones:

1. Prove SQLite import, WAL, FTS5, ESM, and required queries in the chosen packaged
   Electron/backend process. Existing Node tests do not establish this.
2. Extract callable backend start/stop lifecycle from the CLI entry. Keep the
   current loopback API/SSE and authentication initially; retain renderer isolation
   and validate navigation/IPC boundaries.
3. Preserve existing storage paths, source consent, database contents, and
   checkpoints. Add single-instance and deterministic backend shutdown behavior.
4. Verify packaged install/update/restart behavior with synthetic sources and
   measure footprint on target Windows. Treat signing and SmartScreen reputation
   as distinct concerns; neither packaging nor a certificate guarantees no warning.

Research versions/tooling are time-sensitive. Recheck the report's official
references rather than treating its snapshot as a pinned runtime requirement.

## Publishing this handoff

At this snapshot the branch is `feature/session-dashboard`, with HEAD `2cf5b0b`.
Subsequent accepted UI/billing changes are in the local working tree and no remote
is configured. Recheck Git state; these facts are not a permanent branch policy.
Before handing work to an agent that only sees a remote repository, ensure the
desired code, specs, and these documents are committed and available on its target
branch. This documentation task does not itself commit, push, or implement Electron.
