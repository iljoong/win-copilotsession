# TODO Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dependency-based TODO group progress, safe modification spans and
expandable diagrams/timelines without losing the source table.

**Architecture:** Reuse the read-only temporary snapshot for a new grouped API.
Compute whole-session components server-side, returning summary pages and one
expanded detail. React renders bounded local SVG and source-clock timeline dots.

**Tech Stack:** Existing TypeScript, React, Node SQLite, CSS, Vitest/Playwright.

**Spec:** [Approved recommendation and implementation decisions](../specs/2026-11-17-todo-groups-design.md).

## Global Constraints

- No new dependency, CDN, telemetry, source writes, persistent TODO indexing,
  version bump, commit, push or publication.
- Preserve the 64 MiB snapshot limit, path/identity checks, source revalidation,
  temporary cleanup, authentication and inactive-tab aborts.
- Group at most 10,000 tasks and 50,000 dependency rows.
- Omit graphs above 80 nodes or 400 edges with an explicit size notice.
- Group pages contain 20 groups; task pages contain 50 tasks.
- Completion is exact `status='done'` / all members.
- A time span is creation to last modification, never actual execution duration.

## Review Focus

- Late dependency edges must join groups even across raw TODO pages (Task 1).
- Missing dependency data must not falsely establish task independence (Task 1).
- Cycles/dangling links must not fabricate members or hang layout (Tasks 1/2).
- Invalid, numeric, mixed-clock and inverted timestamps must not produce durations
  or off-chart timeline markers (Tasks 1/2).
- Polling after group/page deletion or tab switches must not show stale detail,
  reset manual expansion, or continue reading inactive views (Task 2).

---

### Task 1: Snapshot-backed group API and time semantics

**Files:**

- Modify `src\shared\contracts.ts`, `src\server\sources\todos.ts`,
  `src\server\routes.ts`, `tests\routes.test.ts`.
- Create `src\shared\todo-time.ts`, `src\server\sources\todo-groups.ts`,
  `tests\todo-time.test.ts`.

**Interfaces:**

- Consume the existing enabled-source `{ root, sessionRef }` identity.
- Produce `SessionTodo.updated_at`, `TodoGroupSummary`, `TodoGroupDetail` and
  `SessionTodoGroups`; summary fields include stable ID/label, total/completed,
  status counts, created/updated extrema, span and warnings.
- Produce `readSessionTodoGroups(location, offset, limit, options)` with group
  order `updated | created`, optional group ID and task offset.
- Produce a shared `todoTime(value)` parser returning a valid comparison value
  and clock basis, or null. Use the same parser for server ranges/client dots.
- `/api/sessions/:id/todo-groups` returns group pages, full task counts and one
  requested detail; flat TODO API remains backwards compatible except added
  nullable `updated_at`.

- [x] Add API regressions for branch/merge components, standalone nodes, exact
      completion, updated/created ordering, detail task pagination and cross-page
      edges. Assert 3m 8s and same-time spans from synthetic source-clock strings.
- [x] Add regressions for missing columns/dependencies, duplicate/dangling/cyclic
      edges, unknown statuses, invalid/mixed/numeric/inverted times, full-source
      immutability and 10,001-task / 50,001-edge refusal.
- [x] Run `npx vitest run tests\routes.test.ts tests\todo-time.test.ts`;
      observe expected missing API/parser assertions fail.
- [x] Extract the existing snapshot callback without weakening original checks.
      Implement validated optional-column reads, deduplicated component grouping,
      bounded detail/graph generation and source-change response clearing.
- [x] Repeat targeted tests; expect all pass.
- [x] Keep changes uncommitted as requested by repository policy.

### Task 2: Group-first UI, diagrams and timelines

**Files:**

- Modify `src\client\session-todos.tsx`, `src\client\styles.css`,
  `tests\sessions.test.tsx`, `src\client\sources.tsx`.
- Create `src\client\todo-groups.tsx`,
  `src\client\todo-group-visuals.tsx`.

**Interfaces:**

- Consume Task 1 contracts/API and `todoTime`.
- Produce `TodoGroupsPanel({ sessionId, active })`, maintaining one group's
  expansion/task page and group order/page.
- Produce local `TodoGroupVisuals({ detail })` with prerequisite-to-dependent SVG
  and page-scoped update dots. No HTML execution or external rendering.
- The existing panel defaults to Groups and preserves All tasks as a toggle;
  only the visible active view polls.

- [x] Add failing UI tests for default groups, completed-collapsed/unfinished-open
      behavior, status/progress, source-time labels, graph/timeline, alternate order,
      raw updated column and missing-data notices. Select All tasks in pre-existing
      flat-view regressions rather than weakening them.
- [x] Add polling regressions for preserved expansion/task page, deletion and
      aborted/inactive view requests. Assert inert titles and unknown statuses.
- [x] Run `npx vitest run tests\sessions.test.tsx`; observe expected failures.
- [x] Implement the view toggle, bounded group polling and accessible controls,
      card summaries, SVG DAG layout, timeline/table pagination and narrow CSS.
      Keep all task/source text inert and time caveats visible.
- [x] Repeat targeted tests plus typecheck/lint; expect all pass.
- [x] Keep changes uncommitted.

### Task 3: Runtime parity, documentation and complete verification

**Files:**

- Modify `tests\e2e\dashboard.spec.ts`, `tests\desktop\dashboard.spec.ts`,
  `README.md`, `manual\README.md`, `docs\handoff.md`.

**Interfaces:**

- Consume Tasks 1/2 behavior; no new application/version interfaces.
- Produce browser/native synthetic evidence and an accurate local handoff.

- [x] Extend the browser TODO workflow with synthetic dependencies/updated times:
      check default order, graph direction, span, alternate order, live completion,
      All tasks ordering and 320px overflow; retain screenshot artifacts.
- [x] Extend native live-refresh coverage to grouped TODOs and raw-view parity.
- [x] Update user/privacy/handoff documentation and supersession links.
- [x] Run `npm test`, `npm run typecheck`, `npm run lint`,
      `npm run format:check`, `npm run test:e2e`. Check changed-file formatting if
      unrelated baseline CRLF failures remain; check local documentation links.
- [x] Run `npm run desktop:test`,
      `dotnet format desktop\CopilotSessionDashboard.Desktop.sln --verify-no-changes`,
      `npm run desktop:package -- -Flavor Release`, `npm run desktop:e2e`, and
      `npm run desktop:defender-smoke -- -Zip desktop\artifacts\CopilotSessionDashboard-0.1.0-win-x64.zip`.
      Defender must report zero 1116/1117/1121/1122 events; stop if any appear.
- [x] Obtain one bounded whole-change review, resolve material findings and
      repeat affected checks. Inspect the final diff without reverting prior work.
- [x] Report acceptance evidence, gaps and local package/restart requirements.
      Do not commit, push, publish or change version.

## Verification record (initial group implementation)

Native execution approved by the user. Implementation remains uncommitted.
The final full run passed 156 unit tests, typecheck/lint, 14 production browser
workflows, 57 shell tests, C# formatting and nine WebView2 workflows.
Both pinned-Node packaging gates passed 122 tests; Release backend smoke passed.
The 0.1.0 Release ZIP contains the tested grouped reader/time module and matching
client assets (hash-checked). Defender smoke reported zero events and complete
cleanup, with cold/warm startup 9.53s/1.44s.

Changed-file formatting, repository `--end-of-line auto`, diff whitespace and 49
local documentation references passed. Standard `format:check` still reports
67 untouched CRLF files; these were not normalized.
Independent final review found no actionable correctness/regression issues.
The packaged app must be relaunched to load the updated local build.

## Follow-up: Dependencies-only cards (2026-11-17)

Explicitly requested small change; no new architecture, dependency, collection
or version decision. Preserve group summaries/ordering/expansion and All tasks.

- [x] Update `tests\sessions.test.tsx` to assert only Dependencies in cards,
      node metadata ordered ID/creation/status, raw missing/zero creation values,
      inert text, all graph members across the old task-page boundary and live
      deletion/tab-state behavior. Observe expected failures before implementation.
- [x] Remove timeline/task-table/task-page UI and unused CSS from
      `src\client\todo-group-visuals.tsx`, `src\client\todo-groups.tsx`,
      `src\client\styles.css`; fit the added creation line and recenter connectors.
      Keep grouped API detail fields compatible; update its graph-fallback copy to
      point at All tasks.
- [x] Update browser/native regressions for metadata order/fit, absent sections,
      graph direction and 320px overflow. Update spec/manual/README/handoff.
- [x] Run targeted tests, all standard checks and the Windows package gates.
      Keep version 0.1.0, record pre-existing formatting failures, and leave the
      working tree uncommitted.

Follow-up verification: new metadata/missing-time regressions failed before
implementation, then all 48 targeted sessions/routes tests passed. The full
run passed 156 unit tests, typecheck/lint, 14 browser workflows, 57 shell tests,
C# formatting, Release packaging and nine WebView2 workflows.
Browser checks confirm ID/creation/status order, all metadata inside the taller
node boxes, absent card sections, preserved graph direction and 320px fit.
Desktop/narrow synthetic screenshots were inspected. Both packaging gates passed
122 tests. Defender reported zero events and complete cleanup, cold/warm startup
4.96s/1.80s. Changed formatting and 49 local documentation paths pass; standard
formatting still flags the same 67 untouched CRLF files.
