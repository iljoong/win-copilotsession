# Copilot session dashboard

Date: 2026-11-12
Status: Approved by the user on 2026-11-12
Size: A full application, not a small change

## Intent

Help an individual understand Copilot usage and improve token/cost efficiency, while making previous user prompts easy to find and reuse for consistent or reproducible work.

The user wants both historical and new sessions from Copilot CLI and Visual Studio Code, with a session list, usage details, full user prompts, short assistant response previews, and progress/activity for a selected active session.

Reusing a prompt alone does not guarantee reproducible output: model, repository state, instructions, and conversation context also matter.

## Decisions made by the user

- Include Copilot CLI and VS Code.
- Include existing history and future sessions.
- Use the compatibility-first approach: read CLI history; import old VS Code chats through JSON exports; collect future telemetry with explicit opt-in.
- Use the session-first layout, with a session list beside the selected session's details. Efficiency analysis is secondary navigation.

## Assistant-proposed decisions requiring design approval

- A browser application running on this machine, not a hosted service or an IDE extension.
- TypeScript for backend and frontend, React for the interface, a small Node.js HTTP server, and a separate app-owned SQLite database.
- Read-only access to configured Copilot sources; no control over or automatic prompt submission into Copilot.
- Prompt reuse means searching full original user prompts and copying one unchanged to the clipboard.
- Text-only assistant previews of at most 1,000 Unicode code points per assistant message, with a bounded-height scrollable presentation. Full assistant transcript browsing is not part of this version.
- Cost means reported session AI credits where available, not dollars or guessed conversions. No model-pricing estimator in this version.
- Progress means observed activity and completed-step counts, not a fabricated completion percentage or guaranteed live token streaming.
- The initial supported environment is local Windows, matching the current machine. Remote extension hosts, WSL session discovery, and multiple machines are not included.

## Goals and success criteria

1. Browse historical CLI sessions and imported VS Code sessions in one searchable list.
2. Select a session and understand its source, model usage, timestamps, token breakdown, recorded time, and available credits.
3. Search full original user prompts and copy a selected prompt without truncation or formatting changes.
4. See newly ingested activity for a selected session without manually refreshing the browser.
5. Compare available usage by model, source, and date without presenting missing data as zero or double-counting overlapping records.
6. Preserve useful imported history, search indexes, ingestion positions, and configuration across app restarts.

## Non-goals and anti-goals

- No team accounts, cloud synchronization, public deployment, billing-account integration, or IDE marketplace extension.
- No automatic parsing of VS Code's private history storage.
- No inline code-completion analytics; scope is conversational/agent sessions.
- No session cancellation, deletion, resumption, or prompt injection into running clients.
- No model quality scores, automatic efficiency advice, or claim that a cheaper session performed an equivalent task.
- No hidden changes to CLI/VS Code settings, enterprise policies, or environment variables.
- Never render prompt/response/tool text as executable HTML.
- Never label inactivity as completion or interruption without supporting evidence.
- Never send stored conversations to external services.

## Approaches

### Selected: compatibility-first local dashboard

Read CLI session files with an isolated compatibility adapter. Import existing VS Code chats using the documented JSON export. Ingest future CLI and VS Code telemetry from explicitly configured local JSONL files.

Trade-off: existing VS Code chats need manual export, and old exports may have no token or credit information. CLI file formats and telemetry schemas still need version-aware parsing; this is not a universal stable session API.

The user selected this approach to avoid relying on VS Code's private persistence.

### Considered: automatic-history local dashboard

Add a read-only parser for VS Code's internal history files.

Trade-off: less manual importing, but a larger compatibility and privacy surface, with breakage possible after client updates. It still cannot recover metrics that were never recorded. The user did not select this approach.

## Product layout and behavior

The approved visual direction is the session-first option in:
`.superpowers\brainstorm\571-1794449924\content\dashboard-layout.html`.
The mockup contains fictional data and is a layout reference, not a commitment to its example metrics.

```text
Sessions | Usage | Sources
Search original prompts...   Source   State   Model   Date range

Session list                 Selected session
Title / source               Metadata / models / token breakdown / credits
Observed state               Original user prompt                  [Copy]
Recorded time / credits      Assistant preview (text, <= 1,000 characters)
Last activity                Further prompt/response entries
                             Observed activity / freshness / warnings
```

### Session list

- Paginated list ordered by last observed activity, newest first.
- Title uses an explicit session title where available, otherwise a short first-prompt excerpt or source session identifier.
- Show source, repository/directory when available, observed state, models used, recorded agent time, reported credits and completeness, and last activity.
- Filters: source, observed state, model, date range. Sort by last activity, recorded agent time, or reported credits. Unknown values sort last in numeric sorts.
- Full-text search operates on original user prompts and session titles; selecting a result opens and highlights the relevant prompt.
- If a session uses several models, show "Multiple" with individual models in details rather than attributing all usage to the last model.

### Selected session

- Metadata and token/credit breakdown appear above a chronological conversation timeline.
- Show original user prompts in full, with independent copy buttons. Preserve original text and whitespace in the copied value.
- Show assistant-authored text only in response previews: exclude reasoning, tool results, and non-text attachments. Indicate truncation and unavailable content.
- Page long conversations; do not silently truncate user prompts. Render source-provided truncation warnings where known.
- Do not misrepresent system instructions or expanded model context as user-authored prompts.
- Display source and coverage warnings near affected fields, not just in a settings page.

### Activity and progress

- Selected session has an activity timeline: observed prompt/turn events, model-call completions, tool start/end events when emitted, errors, and explicit interruptions.
- Summarize counts of observed model/tool calls and the latest observed action. Do not invent a task completion percentage.
- Show source event timestamp and dashboard ingestion/freshness information.
- Backend checks configured sources approximately every second, using filesystem notifications as an optimization and polling as recovery. It pushes committed changes to the browser using Server-Sent Events.
- Target: an appended complete source record appears in the UI within two seconds on an ordinary local workload. This target starts when the source record is written, not when the underlying tool starts.
- Reconnect SSE automatically and refresh from the database after reconnecting.
- Some exporters emit spans only after operations finish. Such sessions show "Last observed activity" and an explicit delayed/incomplete visibility notice, not an asserted currently running tool.
- No always-on hook or unsupported extension API is introduced to overcome missing events.

### Usage view

- Time-range totals and per-model/per-source breakdowns for recorded agent time, tokens, cache-read share, and reported AI credits.
- Show the count of sessions with missing/partial metrics alongside totals.
- Input, output, cache-read, cache-write, and reasoning tokens are separate fields. Cache counts and reasoning counts can be subsets of other totals; they are not blindly added to input/output.
- Cache-read share is cache-read input divided by total input for records with compatible, known counts. Exclude incompatible or unknown records and show coverage.
- Credit totals are labeled "Reported AIC" and may be partial. Missing credits display "Unavailable", never zero.
- Compare usage descriptively, not as evidence of equal task quality or model superiority.

### Sources view and onboarding

- Configure the CLI history root, VS Code JSON imports, and separate local telemetry files.
- Discover the default CLI history root from the effective `COPILOT_HOME` or user profile; show the resolved path before collection begins. Persist only explicitly enabled sources.
- Import VS Code exports using a local file picker/upload to the loopback server. A user-selected file is not a grant to scan unrelated directories.
- Show source capabilities: history/content/usage/activity availability, client/schema information when detectable, last successful import, and actionable warnings.
- Provide client-specific setup instructions for local file telemetry and explain optional content capture before enabling it. The app does not edit client configuration itself.
- Explain that content capture can include much more than the typed prompt and will not backfill older data. New/restarted clients may be necessary for changed settings to apply.
- If telemetry is not enabled, browsing/importing still works, with live coverage clearly unavailable.

## Collection and compatibility

### CLI history adapter

- Read configured session metadata and event logs; never modify Copilot's session files or databases.
- Initial implementation inspects the installed client's actual schemas read-only, with explicit user approval for real-history inspection or user-supplied sanitized samples.
- Handle unknown event kinds without dropping the rest of the session. Unsupported shapes produce a warning, not fabricated metrics.
- Tail JSONL incrementally; retain incomplete trailing lines until complete, handle rotation/truncation, and resume after restart without duplicate records.
- Limit parsing to selected source roots; do not follow links outside the configured boundary.

### VS Code history import

- Parse the documented chat-export JSON through a source-specific adapter.
- Validate structure and file size before committing; malformed/unsupported imports report actionable errors.
- Import prompts and assistant text; model, timestamps, status, tokens, and credits remain unknown when the export does not include them.
- Importing the same export again is idempotent.
- An imported transcript is a snapshot, not evidence that the underlying session is completed.

### Future telemetry

- Prefer local file export: no hosted collector, external upload, or modification of an existing organization's exporter configuration.
- Keep CLI and VS Code normalization separate. Their attributes, signal shapes, and client versions can differ.
- Attach telemetry to a session only through an explicit compatible source session/conversation identity or a verified mapping. Resource/window identifiers are not conversation identifiers.
- Preserve raw source identifiers and provenance for accounting and diagnostics. Do not merge sessions based only on title, prompt similarity, or timestamps.
- When identity cannot be established, retain a separate clearly labeled record rather than invent a cross-source match.
- OTel model input may contain repeated conversation context. Prefer original transcript submissions for prompt search; if original user-message boundaries cannot be established, label content as captured model input and exclude it from the original-prompt index.

## Session state

Track connection/observation freshness separately from conversation state.

- **Active:** explicit start/resume evidence without a corresponding observed end; display it as observed state with timestamp, not proof the client process is still alive.
- **Idle:** explicit idle evidence where available; not completed.
- **Completed:** only an explicit source event whose verified semantics end the session/task, not a single model call or assistant reply.
- **Canceled/interrupted:** explicit interruption evidence, retaining whether it ended a turn or the whole session.
- **Error:** explicit failure evidence, with scope; a recoverable failed tool does not automatically make the whole session failed.
- **Unknown:** insufficient evidence, including snapshot-only imports without state information.

An unpaired start eventually becomes stale observation, not an assumed cancellation. Keep its last observed state and show a freshness warning after 30 seconds without ingestion; telemetry-only sources explain that long operations can legitimately be silent. Imported snapshots are labeled snapshots rather than continuously stale live sources.

## Accounting and time

- Store timestamps and durations in canonical units; display timestamps in the browser's local timezone and durations with explicit labels.
- **Wall span:** first-to-last observed session timestamp, clearly distinct from time actively working. For explicit active observations, optionally show time since the recorded start with an observation label.
- **Recorded agent time:** union of measured top-level invocation intervals, so overlapping subagents do not inflate elapsed work time. Unknown when intervals are unavailable.
- Per-model inference time can overlap; do not imply its sum equals wall span or recorded agent time.
- Token and credit records have provenance, aggregation scope, and coverage state: complete, partial, unavailable.
- Use identifiable leaf LLM calls as the preferred token accounting level. Do not add parent invocation summaries to their children.
- Session-level authoritative totals may replace, not add to, less-complete aggregates. Conflicting or ambiguous totals surface a warning.
- Preserve subagent usage when it is distinguishable, but count it only once in session totals.
- Treat vendor AI-unit attributes as unknown billing data until their relationship to displayed AIC is verified against the actual client. No currency conversion.

## Architecture and persistence

```text
Read-only CLI files ----\
VS Code JSON imports ---+--> source adapters --> normalized records --> app SQLite
Opt-in telemetry files -/                                  |
                                               local HTTP API + SSE
                                                          |
                                                  React browser UI
```

- One local Node.js process serves the built UI, reads selected sources, owns SQLite writes, and exposes the API/SSE endpoint. No service daemon or extension is required.
- Use app-owned per-user storage separate from Copilot's databases and from the repository. The exact local app-data directory is a builder decision; show it in Sources.
- Logical entities: source configuration, sessions, conversation entries, activity events, usage observations, ingestion cursors, and prompt search index.
- Use a unique source/event identifier where available, otherwise a deterministic source-local fingerprint. Never deduplicate distinct sessions because they happen to have identical prompts.
- Cross-source reconciliation is conservative: verified IDs can unify records; unresolved overlaps remain labeled and are excluded from combined totals until accounting is unambiguous.
- Commit normalized records and ingestion cursors transactionally. Restart/reimport must not change totals or duplicate messages.
- Save full original user prompts and assistant preview text. Do not copy complete raw telemetry payloads or tool outputs into the application database merely for debugging. Configured source files may independently retain full content.
- Keep app-owned history until the user clears it through a confirmed local-data action. That action affects only the app database, not Copilot history, imports, or telemetry files; explain that re-enabling a source may reimport records.
- No application analytics, CDN dependencies, remote fonts, or automatic remote requests.

## Local privacy and access

- Bind only to loopback by default. Local-only is not equivalent to private on a shared machine.
- Gate UI/API/SSE access with an unpredictable startup access token, exchanged for a same-site, HTTP-only session cookie. Scrub the token from the visible browser URL after bootstrap and do not log it.
- Enforce same-origin requests, reject untrusted Host/Origin values, disable permissive CORS, and protect state-changing endpoints.
- Restrict app data to the current OS user where supported. This does not claim protection from administrators or compromise of the same OS account.
- Treat all imported content as untrusted text; no arbitrary HTML execution or tool-result rendering.
- Set bounded file/record sizes and paginated queries. Reject oversized individual imports with a clear error; stream historical logs without loading all history into memory.
- Startup/configuration must not overwrite telemetry destinations or other users' settings.
- Identity capture is not required for this personal dashboard.
- Generated mockup/access-key files under `.superpowers` are local artifacts, not product assets. Exclude `.superpowers` and local application data from version control if a repository is initialized.

## Implementation sequencing constraints

1. Confirm real source formats and capabilities using sanitized fixtures or explicitly approved read-only inspection. Verify actual live export timing and any AIC mapping before claiming support.
2. Build the normalized store and historical browse/search/import flow.
3. Add telemetry ingestion, observable activity, freshness, and SSE.
4. Add descriptive usage comparisons and coverage indicators.

These are ordering constraints, not the implementation plan. If installed sources lack required events, keep the data limitation visible; do not silently replace the chosen integration with a private VS Code parser or extension.

## Acceptance criteria

- Supported CLI fixtures and VS Code JSON exports produce the expected sessions and full original prompts.
- Reimporting or restarting ingestion does not duplicate sessions, messages, tokens, or credits.
- Prompt search can find text beyond the first 1,000 characters; copying returns the full original prompt.
- Assistant previews contain at most 1,000 Unicode code points of assistant text, with no tool output, reasoning, or interpreted HTML.
- Partial JSONL writes, source truncation/rotation, unknown events, malformed imports, and absent fields behave as documented without corrupting existing data.
- Parent/child and overlapping-source accounting fixtures do not double-count. Missing cost is never displayed as zero.
- Multi-model and subagent usage are attributed only where supported, with unknown/partial coverage retained.
- Idle and imported snapshots are not mislabeled completed; interrupted turns are not automatically labeled canceled sessions.
- A complete record appended to a configured source becomes visible without a manual refresh, and live-source delays/unavailability are apparent.
- End-to-end tests exercise session selection, prompt search/copy, VS Code import, filtering, and live update/reconnect behavior.
- Loopback authentication and origin checks reject unauthorized access; adversarial transcript text remains inert.
- At least one real sanitized session/export from each supported installed client is checked before calling those adapters supported. Where allowed, a live end-to-end export confirms latency from record emission, separate from upstream operation timing.

## Left to the builder

- Exact package choices, API shapes, database schema, indexes, migration tooling, and test runner.
- Pagination sizes, nonessential visual styling, accessible interaction details, and responsive breakpoints, following the selected layout.
- Adapter internals and capability detection for the inspected client versions.
- Deterministic field precedence within the accounting and provenance rules above.
- Import size thresholds and recovery/backoff details, with clear user-facing errors.
- Small-screen behavior: stack the selected session below the list rather than changing the information architecture.

## Evidence and remaining technical uncertainty

- VS Code export: https://code.visualstudio.com/docs/agents/run/sessions/session-history
- VS Code telemetry and content-capture controls: https://code.visualstudio.com/docs/agents/guides/monitoring-agents
- CLI installed-build documentation: local storage, telemetry activation/file export, usage completeness, and ACP foreground/session idle semantics.
- Research notes are in the Copilot session artifacts at `files\vscode-session-data-research.md`.

No private session histories were inspected during design. Installed VS Code version/harness, exact export shapes, status-event persistence, credit mapping, and live span delivery timing still require technical verification. Unknown values and delayed observation are deliberate product behavior, not a promise of complete or instantaneous instrumentation.

## Builder check

A fresh software-engineering reviewer found no important unanswered questions needed to plan this design. This is a completeness check, not verification of the installed clients or their data.
