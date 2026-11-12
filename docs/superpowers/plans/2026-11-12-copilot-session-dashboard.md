# Copilot Session Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local session-first dashboard for understanding Copilot CLI and VS Code usage, monitoring observed activity, and finding/copying original prompts.

**Architecture:** Read-only source adapters normalize CLI history, imported VS Code JSON, and opt-in local telemetry into an application-owned SQLite database. One loopback Node.js server serves a React interface, authenticated APIs, and Server-Sent Events. Conservative identity reconciliation and accounting preserve unknown/partial values rather than inventing completeness.

**Tech Stack:** TypeScript, React, Vite, Node.js built-in HTTP and SQLite/FTS5, Vitest, React Testing Library, Playwright, ESLint, Prettier, npm.

**Spec:** `docs\superpowers\specs\2026-11-12-copilot-session-dashboard-design.md`

## Global Constraints

- "The initial supported environment is local Windows, matching the current machine. Remote extension hosts, WSL session discovery, and multiple machines are not included."
- "Read-only access to configured Copilot sources; no control over or automatic prompt submission into Copilot."
- "Prompt reuse means searching full original user prompts and copying one unchanged to the clipboard."
- "Text-only assistant previews of at most 1,000 Unicode code points per assistant message, with a bounded-height scrollable presentation. Full assistant transcript browsing is not part of this version."
- "Cost means reported session AI credits where available, not dollars or guessed conversions. No model-pricing estimator in this version."
- "Progress means observed activity and completed-step counts, not a fabricated completion percentage or guaranteed live token streaming."
- "No hidden changes to CLI/VS Code settings, enterprise policies, or environment variables."
- "Never render prompt/response/tool text as executable HTML."
- "Never label inactivity as completion or interruption without supporting evidence."
- "Never send stored conversations to external services."
- "Bind only to loopback by default. Local-only is not equivalent to private on a shared machine."
- "Backend checks configured sources approximately every second, using filesystem notifications as an optimization and polling as recovery."
- "Target: an appended complete source record appears in the UI within two seconds on an ordinary local workload. This target starts when the source record is written, not when the underlying tool starts."
- "Use app-owned per-user storage separate from Copilot's databases and from the repository."

## Review Focus

1. Reused native IDs in distinct clients must not merge unrelated sessions; explicitly verified cross-source matches must not double-count. Task 3 pins this.
2. CRLF, emoji, combining characters, and leading/trailing whitespace must survive prompt indexing and copying unchanged. Tasks 3 and 6 pin this.
3. JSONL records split inside UTF-8 characters, rotated files, and restarts must not lose or duplicate records. Task 4 pins this.
4. A slow or disconnected SSE consumer must not stall ingestion or leak sockets; reconnect must recover the latest database state. Tasks 5 and 8 pin this.
5. Windows junctions, traversal, changed source permissions, and source disappearance must not expand the configured read boundary or erase imported data. Task 4 pins this.

---

## Execution context and gates

- The working directory started empty and is **not a Git repository**. Do not initialize Git or create a worktree without user authorization. If no repository is authorized, skip commit steps and record that fact; keep all working files persistent.
- Node.js `v22.23.4` and npm `10.9.9` are installed. An in-memory probe confirmed `node:sqlite` and FTS5 work; SQLite emits an experimental-feature warning. Set the project runtime floor to Node `22.23.4`, and document that warning rather than suppressing unrelated warnings.
- No dependencies or product code have been installed/created. The existing `.superpowers` directory holds browser mockups and access-key state, not product code.
- The user has approved the spec, not private-history inspection. Task 2 must obtain sanitized representative inputs or explicit read-only permission before inspecting actual conversation content. Never copy secrets or private transcripts into committed fixtures.
- Use Windows paths in shell examples. These examples use PowerShell.
- A normal task has a red/green test cycle followed by a scoped commit if Git is available. Include the required Copilot trailers when actually creating a commit.

## File map

```text
package.json, package-lock.json          Scripts and dependency lock
tsconfig.json, tsconfig.server.json      Strict frontend/shared and server checks
vite.config.ts, vitest.config.ts         UI build and unit/integration tests
eslint.config.js, .prettierrc.json        Existing-tool style checks for this new app
playwright.config.ts                    Real-browser acceptance runner
.gitignore                              Exclude dependencies, builds, local data, .superpowers
index.html                              Vite entry
src\shared\contracts.ts                 Normalized records, API DTOs, filters
src\server\main.ts                      Process lifecycle, app-data paths, startup URL
src\server\http.ts                      Authenticated loopback shell and static serving
src\server\routes.ts                    Sources, import, browse, search, usage, SSE routes
src\server\events.ts                    Bounded subscriber delivery
src\server\sources\cli.ts               CLI event/metadata normalization
src\server\sources\vscode.ts            VS Code JSON-export normalization
src\server\sources\telemetry.ts         Client-specific telemetry normalization
src\server\sources\jsonl.ts             Incremental decoding and source-file identity
src\server\sources\ingestion.ts         Explicit source configuration and recovery
src\server\data\schema.ts              Application-only migrations and FTS index
src\server\data\store.ts               Transactions, identity, queries, persistence
src\server\data\accounting.ts          Scoped usage projection and interval unions
src\client\main.tsx, App.tsx            Browser entry and navigation
src\client\api.ts                      Typed requests, event subscription, reconnect
src\client\sessions.tsx                List, filters, selected conversation, activity
src\client\sources.tsx                 Consent/configuration, import, coverage warnings
src\client\usage.tsx                   Descriptive usage breakdowns
src\client\styles.css                  Session-first responsive presentation
tests\fixtures\                        Sanitized/synthetic, schema-evidenced source inputs
tests\http.test.ts                     Authentication and static-shell integration
tests\adapters.test.ts                 Source-specific normalization
tests\store.test.ts                    Identity, persistence, search, clearing
tests\accounting.test.ts               Token/credit/time aggregation
tests\ingestion.test.ts                File boundaries, tail/restart/error recovery
tests\routes.test.ts                   API/import/subscriber integration
tests\sessions.test.tsx                Prompt/list/activity rendering and interaction
tests\sources.test.tsx                 Consent/import errors and capability states
tests\usage.test.tsx                   Missing/partial usage and model presentation
tests\e2e\dashboard.spec.ts            Browser workflows against disposable files/data
README.md                              Local run/setup/limitations and safe data clearing
```

Keep related small components within the named client feature file until they need independent responsibilities. No global state library or generic plugin framework.

## Shared interface decisions

Task 2 owns `src\shared\contracts.ts`. Use these names and semantics; tasks may add fields needed for provenance, but must update dependent call sites consistently.

- `SessionState = 'active' | 'idle' | 'completed' | 'interrupted' | 'error' | 'unknown'`.
- `Coverage = 'complete' | 'partial' | 'unavailable'`.
- `SourceKind = 'cli-history' | 'vscode-import' | 'cli-telemetry' | 'vscode-telemetry'`.
- `SourceConfig`: `{ id: string; kind: SourceKind; path: string; enabled: boolean }`.
- `RecordContext`: `{ sourceId: string; recordId: string; observedAt: number }`; timestamps are epoch milliseconds.
- `ImportContext`: `{ sourceId: string; contentHash: string; importedAt: number }`.
- `NormalizedBatch`: `{ records: NormalizedRecord[]; warnings: string[] }`.
- `NormalizedRecord` is a discriminated union with `kind: 'session' | 'entry' | 'activity' | 'usage'`. Every record carries a source-local identity and session reference, native identity namespace, evidence for any cross-source mapping, and provenance. Do not put an unresolved session reference into a global native-ID map.
- An entry distinguishes `original-user`, `assistant-preview`, and `captured-context`; its `text` preserves original characters. Only `original-user` enters the prompt index. Assistant previews carry `truncated` and source-availability flags.
- `UsageObservation` records scope (`call`, `invocation`, or `session`), native call/parent identifiers, explicit authoritative-summary evidence, model, optional measured intervals, and nullable token/AIC fields with per-field coverage.
- `SessionFilter`: optional `query`, `source`, `state`, `model`, `from`, `to`; required `sort`, `offset`, `limit`. Sort is `lastActivity`, `agentTime`, or `credits`; times use epoch milliseconds.
- `Page<T> = { items: T[]; total: number; offset: number; limit: number }`.
- `UsageSummary`: nullable input/output/cache-read/cache-write/reasoning counts, nullable reported AIC, per-field coverage, nullable recorded agent milliseconds, nullable wall-span milliseconds, per-model rows, and warnings.
- `SessionSummary`: opaque canonical `id`, title, sources, model IDs, observed state/evidence scope, snapshot/freshness metadata, first/last timestamps, repository/directory when known, and `usage: UsageSummary`.
- `SessionDetails`: summary, capability warnings, and observed operation counts; entries and activity are separately paginated.
- `SourceStatus`: configuration, enabled/capability flags, last-success time, coverage warnings, and actionable error text.
- `StoreChange`: `{ sessionIds: string[]; sourceIds: string[] }`, emitted only after commit; do not include transcript text in SSE notifications.

### Task 1: Runnable authenticated local shell

**Files:** Create package/configuration files from the file map, `.gitignore`, `index.html`, `src\server\main.ts`, `src\server\http.ts`, minimal `src\client\main.tsx`, `src\client\App.tsx`, and `tests\http.test.ts`.

**Interfaces:**

- Produce `createHttpServer(options: { accessToken: string; assetDir: string; handleApi: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> }): Server` in `http.ts`.
- Produce a CLI startup entry with `--data-dir`, `--port`, and `--no-open`; default data directory is `%LOCALAPPDATA%\CopilotSessionDashboard`, port `0` chooses an available loopback port.
- Scripts: `dev`, `build`, `start`, `test`, `test:e2e`, `typecheck`, `lint`, `format:check`. `start` runs `dist\server\main.js`; `build` emits the server under `dist\server`, shared modules under `dist\shared`, and Vite assets under `dist\client`.

- [ ] **Step 1: Add the minimal npm/tool configuration needed to run shell tests.** Use React/ReactDOM plus development dependencies TypeScript, Vite/React plugin, tsx, Vitest, Testing Library/jsdom, Playwright, ESLint/TypeScript tooling, and Prettier. Use built-in SQLite/HTTP/crypto. Install only after writing the manifest; generate the npm lockfile normally.
- [ ] **Step 2: Write failing HTTP tests.** Assert `anonymousCannotReadUiOrApi` returns 401; `bootstrapExchangesTokenAndRedirects` returns a token-free location and `HttpOnly; SameSite=Strict` cookie; `authenticatedShellLoads` returns 200; `wrongHostOrForeignOriginIsRejected` returns 403; `unsafeAssetPathIsRejected` never reads outside `assetDir`. Cover wrong/missing tokens and rejection of non-loopback bind attempts.
- [ ] **Step 3: Run `npm test -- tests\http.test.ts`.** Expect failures because `createHttpServer` does not yet exist.
- [ ] **Step 4: Implement `createHttpServer` and startup.** Bind to `127.0.0.1`; generate a fresh cryptographic token per process; exchange a valid bootstrap query token for a per-run cookie, redirect to `/`, and never log requests containing tokens. Validate Host and Origin before routes/static files. Require exact same-origin checks on mutations. Use Vite middleware behind authentication in development, built assets in production, and no broad filesystem fallback.
- [ ] **Step 5: Run `npm test -- tests\http.test.ts` and `npm run build`.** Expect all shell tests and builds to pass; a startup without enabled sources must read no Copilot history.
- [ ] **Step 6: Commit the scoped runnable shell if Git is authorized.** Message: `feat: add authenticated local dashboard shell`.

### Task 2: Evidence-backed source normalization

**Files:** Create `src\shared\contracts.ts`, `src\server\sources\cli.ts`, `vscode.ts`, `telemetry.ts`, `tests\adapters.test.ts`, and `tests\fixtures\cli-events.jsonl`, `vscode-export.json`, `cli-telemetry.jsonl`, `vscode-telemetry.jsonl`. Put fixture provenance and supported client versions in `README.md`.

**Interfaces:**

- Produce `parseCliRecord(value: unknown, context: RecordContext): NormalizedBatch`.
- Produce `parseVsCodeExport(value: unknown, context: ImportContext): NormalizedBatch`.
- Produce `parseTelemetryRecord(value: unknown, context: RecordContext, client: 'cli' | 'vscode'): NormalizedBatch`.
- Produce `toAssistantPreview(text: string): { text: string; truncated: boolean }` in `vscode.ts`, reused by other adapters.

- [ ] **Step 1: Establish schemas before fixtures.** Request sanitized samples or explicit read-only inspection permission using `ask_user`. Verify installed versions/harness, original-prompt fields, state-event semantics, and exporter output timing. Record whether each source really emits AIC; do not convert undocumented AI units. Keep real inputs only in approved local/session artifacts. If essential evidence cannot be obtained, mark that adapter unsupported and report the blocker; do not claim this task complete using invented fixtures.
- [ ] **Step 2: Write failing adapter tests against sanitized/synthetic fixtures derived from that evidence.** Assert `originalPromptsAreNotExpandedModelContext`, `previewExcludesToolsAndReasoning`, `previewCapsAt1000CodePoints` using `'😀'.repeat(1001)` with length 1000 after `Array.from`, `unknownFieldsRemainUnavailable`, `snapshotDoesNotMeanCompleted`, `turnEndDoesNotMeanSessionCompleted`, `unknownEventDoesNotDiscardSession`, and `modelChangesArePreserved`. Invalid export shape must produce a recognizable unsupported-format warning without partial import.
- [ ] **Step 3: Run `npm test -- tests\adapters.test.ts`.** Expect missing parser exports to fail.
- [ ] **Step 4: Implement the three parsers and shared contracts.** Keep CLI/VS Code schemas separate, preserve provenance and timestamps, distinguish original submissions from captured context, and emit only text assistant previews. Provide capability warnings for absent metrics/content/state and distinguish agent-host telemetry when actual evidence requires it. Unknown shapes cannot become zero-cost completed sessions.
- [ ] **Step 5: Run `npm test -- tests\adapters.test.ts` and `npm run typecheck`.** Expect fixtures from both installed clients and unsupported-input cases to pass.
- [ ] **Step 6: Commit parsers, safe fixtures, and provenance documentation if Git is authorized.** Message: `feat: normalize supported Copilot session sources`.

### Task 3: Persistent sessions, prompt search, and trustworthy accounting

**Files:** Create `src\server\data\schema.ts`, `store.ts`, `accounting.ts`, `tests\store.test.ts`, `tests\accounting.test.ts`.

**Interfaces:**

- Produce `openStore(dbPath: string): Store` and `projectUsage(observations: UsageObservation[]): UsageSummary`.
- `Store` exposes `commitBatch(batch: NormalizedBatch, checkpoint?: { sourceId: string; value: string }): StoreChange`, `getCheckpoint(sourceId: string): string | null`, `listSessions(filter: SessionFilter): Page<SessionSummary>`, `getSession(id: string): SessionDetails | null`, `getEntries(id: string, offset: number, limit: number): Page<ConversationEntry>`, `getActivity(id: string, offset: number, limit: number): Page<ActivityEntry>`, `getUsage(filter: SessionFilter): UsageReport`, `saveSource(config: SourceConfig): void`, `listSources(): SourceStatus[]`, `clearLocalData(): void`, and `close(): void`.
- Define `ConversationEntry` and `ActivityEntry` as canonical persisted projections of Task 2's respective normalized records. Define `UsageReport` as totals, per-model/per-source rows, and counts of sessions with missing/partial metrics. `clearLocalData` clears app history/cursors and disables configured sources.
- Source recovery also uses `Store.setSourceStatus(id: string, update: { lastSuccessAt?: number; error?: string | null; warnings?: string[] }): void`.

- [ ] **Step 1: Write failing store/accounting tests.** Assert `reopenPreservesHistoryAndSearch`, `repeatBatchIsIdempotent`, `sameNativeIdAcrossClientsStaysSeparate`, `verifiedOverlapCountsOnce`, `ambiguousOverlapIsExcludedFromCombinedTotals`, `promptSearchFindsTextAfter1000Characters`, and `searchPreservesOriginalCrlfAndWhitespace`. Accounting assertions: parent summaries plus their child calls count once; input 100 with cache-read 60 remains input 100; reasoning is not added twice; unknown AIC stays null; 0 reported AIC stays 0; intervals `[0,100]` and `[50,150]` produce 150ms agent time, not 200ms. Clear must leave source files untouched and disable automatic reimport.
- [ ] **Step 2: Run `npm test -- tests\store.test.ts tests\accounting.test.ts`.** Expect missing store/accounting implementations to fail.
- [ ] **Step 3: Implement migrations, `Store`, and `projectUsage`.** Use `node:sqlite`, parameterized SQL, transactions covering records plus checkpoint, FTS5 original-prompt/title indexing, source-local unique keys, and conservative verified reconciliation. Prefer unique leaf calls; substitute verified authoritative summaries rather than adding them. If coverage conflicts cannot be reconciled, show partial/conflict warnings. Do not persist/index `captured-context` text: retain an availability warning instead. Store no raw model context/tool output merely for diagnostics.
- [ ] **Step 4: Implement bounded queries and projection ordering.** Default pages to 50, maximum 200; validate filter bounds, order by last activity descending by default, and put unavailable numeric values last. Treat search input as user text, not executable SQL or unescaped FTS syntax. Search results identify the matching prompt for navigation. Model filtering uses sessions containing that model; filtered totals retain all selected-session usage and state that scope in the UI.
- [ ] **Step 5: Run the combined store/accounting tests and `npm run typecheck`.** Expect restart, Unicode, duplicate, multi-model/subagent, partial-field, and overlap cases to pass.
- [ ] **Step 6: Commit if Git is authorized.** Message: `feat: persist sessions with accurate usage accounting`.

### Task 4: Read-only discovery, file tailing, and source recovery

**Files:** Create `src\server\sources\jsonl.ts`, `ingestion.ts`, `tests\ingestion.test.ts`; extend source status persistence in `store.ts`.

**Interfaces:**

- Produce `readJsonlChunk(input: { pending: Buffer; chunk: Buffer; discarding?: boolean }): { lines: string[]; pending: Buffer; discarding: boolean; warnings: string[] }` in `jsonl.ts`; retain undecoded trailing bytes until a full line arrives.
- Produce `createIngestion(options: { store: Store; onChange: (change: StoreChange) => void; pollMs?: number }): IngestionService`.
- `IngestionService` exposes `enableSource(config: SourceConfig): Promise<void>`, `disableSource(id: string): Promise<void>`, `scanNow(): Promise<void>`, `start(): void`, and `stop(): Promise<void>`. Default `pollMs` is 1000; serialize ingestion per source.

- [ ] **Step 1: Write failing ingestion tests using disposable directories only.** Assert `splitUtf8AndPartialLineWaitForCompletion`, `restartResumesWithoutDuplicates`, `truncateAndRotateDoNotSkipRecords`, `disabledSourceIsNeverRead`, `newCliSessionIsDiscovered`, `junctionOutsideRootIsRejected`, `permissionLossKeepsExistingHistory`, and `disappearedSourceRecoversWhenRestored`. `oversizedRecordIsWarnedAndNextRecordStillImports` feeds a record above 8MiB followed by a valid line and asserts bounded buffering plus successful recovery. Crash-injection between writes/checkpoint must leave either the entire batch committed or neither.
- [ ] **Step 2: Run `npm test -- tests\ingestion.test.ts`.** Expect missing ingestion exports to fail.
- [ ] **Step 3: Implement decoding and source discovery.** Resolve Windows real paths and verify boundary containment, including junction targets. Read at most 64KiB per chunk; buffer at most 8MiB per source record, discarding oversize records through their newline with an explicit warning. Use file identity plus cursor state for replacements, re-read safely after rotation/truncation, and combine record identity with byte offsets only where needed. Buffer partial lines; skip malformed completed records with a source warning, not silent data loss.
- [ ] **Step 4: Implement ingestion lifecycle and recovery.** Read only explicitly enabled paths, scan new CLI session directories, preserve source data, commit cursors atomically, and publish after commits. Poll every 1000ms; filesystem events are optional wakeups. Stop watchers/timers cleanly. Give each source independent error state; a failing source cannot stop other sources.
- [ ] **Step 5: Run `npm test -- tests\ingestion.test.ts tests\store.test.ts`.** Expect boundary, rotation, restart, permission, and recovery cases to pass.
- [ ] **Step 6: Commit if Git is authorized.** Message: `feat: ingest local session sources incrementally`.

### Task 5: Authenticated browsing, import, configuration, and live API

**Files:** Create `src\server\routes.ts`, `events.ts`, `tests\routes.test.ts`; connect `main.ts`, `http.ts`, store, and ingestion.

**Interfaces:**

- Produce `createApi(options: { store: Store; ingestion: IngestionService; events: EventHub }): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>`.
- Produce `createEventHub(): EventHub` with `publish(change: StoreChange): void`, `attach(req: IncomingMessage, res: ServerResponse): void`, and `close(): void`.
- Routes: `GET /api/sessions`, `/api/sessions/:id`, `/api/sessions/:id/entries`, `/api/sessions/:id/activity`, `/api/usage`, `/api/sources`, `/api/events`; `PUT /api/sources/:id`; `POST /api/imports/vscode`; `POST /api/local-data/clear`.
- Mutations require the Task 1 auth and exact same-origin protections. The clear request body must be `{ confirmation: 'CLEAR LOCAL DASHBOARD DATA' }`. Imports accept the raw export as `application/json`, maximum 50MiB; reject oversize with 413 and invalid/unsupported JSON with 400.

- [ ] **Step 1: Write failing API tests.** Assert pagination/filter validation, 404 for absent sessions, repeated JSON import is idempotent, unsupported import commits nothing, disabled sources do not scan, and clearing requires exact confirmation. `clearingDuringScanCannotRepopulateHistory` asserts in-flight ingestion is drained before clearing/disabling sources. Assert `slowSseClientDoesNotBlockIngestion`, disconnect cleanup, and SSE notifications contain IDs rather than transcripts. A foreign-origin import/clear is rejected before mutation; errors never expose raw prompts or credentials.
- [ ] **Step 2: Run `npm test -- tests\routes.test.ts`.** Expect missing API/event-hub exports to fail.
- [ ] **Step 3: Implement API routes and event delivery.** Use Task 3 query semantics and transactional imports, SHA-256 for import identity, explicit source enabling, typed DTOs, and JSON errors. Imported sources are snapshots and never become polled live sources. Before clearing, stop/drain ingestion, clear/disable sources transactionally, and restart the service with no enabled sources. Limit pending SSE data to 64KiB per client; disconnect slow consumers, send 15-second heartbeats, and remove listeners on disconnect. The browser refreshes authoritative data on reconnect rather than relying on event replay.
- [ ] **Step 4: Wire per-user persistence and process shutdown.** Start ingestion only for persisted enabled sources. Apply owner-restricted access to app-data files/directories on Windows using the current user's SID without modifying unrelated directories; document failure rather than claiming confidentiality. On SIGINT/SIGTERM, stop ingestion, close SSE/server, and close SQLite. Report source errors without dumping content.
- [ ] **Step 5: Run `npm test -- tests\http.test.ts tests\routes.test.ts tests\ingestion.test.ts` and `npm run build`.** Expect auth, import, lifecycle, persistence, and SSE tests to pass.
- [ ] **Step 6: Commit if Git is authorized.** Message: `feat: expose session APIs and live updates`.

### Task 6: Session-first UI, prompt reuse, and source onboarding

**Files:** Create `src\client\api.ts`, `sessions.tsx`, `sources.tsx`, `styles.css`, `tests\sessions.test.tsx`, `tests\sources.test.tsx`; extend `App.tsx`.

**Interfaces:**

- Produce `apiRequest<T>(path: string, init?: RequestInit): Promise<T>` and `subscribeChanges(onChange: (change: StoreChange) => void, onReconnect: () => void): () => void` in `api.ts`. Handle 401 as expired local access, not an empty history.
- Produce `SessionsPage(): ReactElement` and `SourcesPage(): ReactElement`. Persist selection/filter navigation in URL query parameters, not transcript text; maintain focus and loading/error states.

- [ ] **Step 1: Write failing component tests.** Assert `selectSessionShowsFullPrompt`, `searchOpensMatchingPrompt`, `copyPreservesExactOriginalText` using `'\r\n  café e\u0301 😀\r\n'`, `assistantPreviewNeverExecutesMarkup`, `snapshotAndIdleAreNotCompleted`, `multiModelSessionShowsBreakdown`, `activityShowsSourceTimeAndFreshness`, and `olderSelectionResponseCannotOverwriteNewSelection`. Sources tests assert explicit enablement, manual JSON import, capability warnings, setup instructions, and confirmed app-only clearing.
- [ ] **Step 2: Run `npm test -- tests\sessions.test.tsx tests\sources.test.tsx`.** Expect missing pages/API functions to fail.
- [ ] **Step 3: Implement session browsing and prompts.** Follow the chosen two-pane mockup; stack on narrow screens. Add source/state/model/date filters, sort controls, full-prompt search, explicit page controls, full user text/copy, bounded text previews, and metadata/coverage labels. Abort or discard stale requests on selection/filter changes. Show a copy error when clipboard access fails rather than claiming success.
- [ ] **Step 4: Implement source onboarding and live presentation.** Sources remain disabled until enabled. Show resolved CLI paths and client-specific local-file instructions grounded in Task 2 evidence; no settings edits or telemetry-content opt-in on the user's behalf. Show SSE connection state, refresh selected/list data on relevant changes/reconnect, and label stale observations after 30 seconds. A completed span cannot imply a currently running tool. Show source limitations, local-data location, and the difference between clearing app history and deleting original files.
- [ ] **Step 5: Run the two component test files, `npm run typecheck`, and `npm run build`.** Expect prompt fidelity, pagination, race handling, safety, and onboarding cases to pass.
- [ ] **Step 6: Commit if Git is authorized.** Message: `feat: add session browsing and reusable prompt history`.

### Task 7: Usage comparisons without misleading totals

**Files:** Create `src\client\usage.tsx`, `tests\usage.test.tsx`; connect the Usage navigation in `App.tsx`.

**Interfaces:**

- Produce `UsagePage(): ReactElement`, consuming `/api/usage` and the shared filter/usage DTOs.
- Produce `formatMetric(value: number | null, coverage: Coverage, unit: 'tokens' | 'aic' | 'milliseconds'): string` in `usage.tsx`, shared with session summaries where useful.

- [ ] **Step 1: Write failing usage tests.** Assert unavailable cost displays `Unavailable`, reported zero displays zero, partial AIC totals show coverage, cache-read share excludes incompatible records, token subset fields are not added twice, and multi-model rows do not attribute everything to the last model. Assert `modelFilteredSessionsExplainWholeSessionTotals` and `descriptiveComparisonMakesNoEfficiencyRankingClaim`.
- [ ] **Step 2: Run `npm test -- tests\usage.test.tsx`.** Expect missing usage view/formatting to fail.
- [ ] **Step 3: Implement date/source/model filters, totals, and model/source breakdowns.** Show recorded agent time separately from wall span, counts of missing/partial sessions, and a compatible-record denominator for cache-read share. Refresh the visible usage view on SSE change/reconnect, discarding stale responses. Use accessible tables/simple CSS bars; no chart library is necessary. Display reported AIC without AI-unit or currency conversion, and do not infer task quality.
- [ ] **Step 4: Run `npm test -- tests\usage.test.tsx tests\accounting.test.ts` and `npm run typecheck`.** Expect all unavailable/partial/subset/comparison cases to pass.
- [ ] **Step 5: Commit if Git is authorized.** Message: `feat: add usage and model breakdowns`.

### Task 8: Real-browser acceptance and reproducible local delivery

**Files:** Create `playwright.config.ts`, `tests\e2e\dashboard.spec.ts`; finish `README.md` and npm scripts/configuration.

**Interfaces:**

- Playwright starts the built app with `--data-dir` pointing to a disposable directory and `--no-open`; the harness obtains the startup URL without committing/logging its access token to reports.
- Production run: `npm ci`, `npm run build`, `npm start`. No telemetry configuration or private reads occur until sources are explicitly enabled.

- [ ] **Step 1: Write failing browser acceptance tests.** Assert import -> list -> selection -> full-prompt search/copy, filters, preview bound/text safety, partial-credit labels, and narrow-screen access. `appendedRecordAppearsWithinTwoSeconds` appends one complete compatible fixture record after enabling a disposable telemetry source. `reconnectRefreshesAuthoritativeState` interrupts SSE, appends data, reconnects, and sees it once. `restartPreservesImportsAndPrompts` restarts against the same temporary app data. Tests must not use real private histories.
- [ ] **Step 2: Run `npm run test:e2e`.** Install only the missing Playwright Chromium runtime if the runner reports it absent; expect the unimplemented acceptance wiring to fail.
- [ ] **Step 3: Complete production/test lifecycle and documentation.** Document supported verified client versions/harnesses, CLI/VS Code setup, manual export/import, missing historical metrics, source-record latency versus upstream span timing, Node SQLite warning, local authentication, source-file privacy, storage location, app-only clearing, and Windows commands. Use representative sanitized real exports from Task 2 to verify actual adapter compatibility; if one client remains unverified, report that explicitly rather than passing only synthetic fixtures as complete support.
- [ ] **Step 4: Run `npm test`, `npm run test:e2e`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build`.** Expect every command to exit 0. Verify production HTTP readiness using authenticated loopback access, then stop only the known test/server process IDs and remove only explicitly resolved disposable paths.
- [ ] **Step 5: Commit final acceptance/documentation changes if Git is authorized.** Message: `test: verify dashboard workflows and document local setup`.

## Plan self-review

- Spec coverage: source selection/consent and compatibility (2, 4, 6), original prompts/previews (2, 3, 6), identity/accounting/time (3, 7), persistence/recovery (3, 4), authenticated local access (1, 5), live activity/freshness (4, 5, 6, 8), usage comparisons (7), production delivery/real evidence (8).
- All five Review Focus conditions have explicit owning tests above.
- Interfaces share `Store`, `NormalizedBatch`, `StoreChange`, and the central DTO definitions; SSE carries invalidation IDs, not a second representation of the database.
- No implementation is authorized merely by saving this plan. Ask the user to review it and choose execution mode.
