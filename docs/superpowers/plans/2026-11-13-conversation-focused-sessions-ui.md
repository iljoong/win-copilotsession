# Conversation-focused Sessions UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if explicitly selected. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make session switching and conversation scanning easier with compact
sidebar filters, a hideable list, full-width capped prompts, and one combined
information/usage expander.

**Architecture:** Keep the existing `SessionsPage` request, URL, selection, and
pagination state authoritative. Add presentation state and scoped CSS without
changing API contracts or the database. Use native controls and inline SVGs.

**Tech Stack:** Existing React 19, TypeScript, plain CSS, Vitest/Testing Library,
Playwright Chromium, and the Windows WebView2 harness; Node.js >=22.23.4.

**Spec:** [Approved conversation-focused Sessions UI design](../specs/2026-11-13-conversation-focused-sessions-ui-design.md).

## Global Constraints

- One combined Session information and usage expander, initially collapsed.
- Desktop left-pane width: 320px; desktop layout above 900 CSS pixels.
- Original prompts: maximum ten rendered line heights; short prompts use natural height.
- Assistant previews: at most 1,000 Unicode code points and 17rem display height.
- Keep the application-wide 1800px outer maximum and existing typography/colors.
- Preserve exact full prompt copying, inert text, URL keys, API parameters, and provenance.
- Preserve 25/50/100/150-entry pagination, ordering, empty-preview filtering, and search offsets.
- Display state survives session switches/live refresh in the mounted Sessions page; no new persistence.
- Only synthetic fixtures and disposable app-owned data; no real-history inspection.
- No new dependencies, server routes, shared DTOs, database changes, or native shell features.
- Do not commit or push without a separate user request.

## Review Focus

- Rapid selection while a detail request is delayed must not display the previous session (Task 2).
- A search hit after line ten, including case/diacritic differences, must be revealed without changing copied text (Task 4).
- SSE refresh while a user has manually scrolled a prompt must not jump back to the match (Task 4).
- Hiding a pane with an open editor or no matching sessions must retain a reachable restore control and correct focus (Task 3).
- Long paths/model names and large headers at 320px/200% zoom must not overflow or clip controls (Task 3).

## File map and task dependencies

| File                              | Responsibility                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `src\client\sessions.tsx`         | Expander, filter controls/chips, hide/show state, prompt viewport and match revelation |
| `src\client\styles.css`           | Sessions-scoped geometry, capped bodies, desktop/narrow scroll structure               |
| `tests\sessions.test.tsx`         | Behavior, state, accessibility, request/URL parity regressions                         |
| `tests\e2e\dashboard.spec.ts`     | Production browser geometry, scroll/focus, search, existing workflow updates           |
| `tests\desktop\dashboard.spec.ts` | Shared UI smoke through the existing safe WebView2 harness                             |
| `README.md`, `docs\handoff.md`    | Implemented behavior and fresh verification facts, after implementation                |

No new product files are necessary. Execute Tasks 1-4 sequentially because they
share the Sessions component; Task 5 verifies the integrated result.
Do not extract generic control frameworks or restructure unrelated Usage/Sources.
Existing fixture/harness files change only if the targeted tests require it.

## Before Task 1

- [ ] Inspect `git status --short`, the approved spec, relevant current source,
      and tests again; preserve both this plan/spec and unrelated work.
- [ ] Run `npm test -- tests\sessions.test.tsx` to establish the current baseline.
      The handoff reports a Node 24/jsdom AbortSignal incompatibility; recheck rather
      than treating that historical report as current evidence.
- [ ] If the baseline is blocked by that incompatibility, diagnose before
      continuing. Prefer an already available compatible supported Node runtime.
      If the harness needs a change, keep it narrowly scoped to the fetch signal
      bridge, preserve cancellation, and add a focused harness regression. Never
      strip signals from production requests or count infrastructure failures as
      the intended red test.

### Task 1: One combined information/usage expander

**Files:** Modify `src\client\sessions.tsx`, `src\client\styles.css`,
`tests\sessions.test.tsx`, and affected assertions in `tests\e2e\dashboard.spec.ts`.

**Interfaces:** Consume current `SessionDetails`/`SessionSummary`. Produce one
`details.session-overview` with summary `Session information and usage`, ordinary
Session information/Session usage headings, and all eight existing metrics.
Keep `overviewOpen: boolean` in `SessionsPage`; do not key it by session ID.

- [ ] Add `combinedOverviewShowsInformationAndUsageTogether` using the client
      harness and two synthetic sessions. Assert the combined details starts closed,
      has no nested details, opens both subsections together, contains eight metrics,
      and retains `open` when selecting the other session.

  ```typescript
  expect(overview).not.toHaveAttribute('open');
  expect(overview.querySelector('details')).toBeNull();
  await user.click(within(overview).getByText('Session information and usage'));
  expect(overview).toHaveAttribute('open');
  expect(overview.querySelectorAll('.metrics > div')).toHaveLength(8);
  ```

- [ ] Add `closedOverviewKeepsStateAndWarningsVisible` with a turn-scoped stale
      session and partial/unavailable metrics. Assert title, state/scope, stale
      warning, and coverage warning count are outside the combined details.
- [ ] Run `npm test -- tests\sessions.test.tsx -t "combinedOverview|closedOverview"`;
      expect failures for the absent combined expander, not request infrastructure.
- [ ] Move existing metadata/metrics into the combined details. Keep title,
      state/scope/freshness and coverage outside. Synchronize `open` via `onToggle`;
      preserve existing Observed activity behavior and warning deduplication.
- [ ] Update existing browser metadata/AIC assertions to open the expander
      before expecting visibility, including after app restart. Do not merely remove
      those assertions because content is now initially collapsed.
- [ ] Rerun the targeted tests; expect pass and intact existing labels/values.

### Task 2: Compact sidebar search, filters, chips, and sort

**Files:** Modify `src\client\sessions.tsx`, `src\client\styles.css`,
`tests\sessions.test.tsx`, and `tests\e2e\dashboard.spec.ts`.

**Interfaces:** Consume existing `query/source/state/model/from/to/sort` strings
and `reset(setter, value)`. Add
`filterEditor: 'source' | 'state' | 'model' | 'date' | null`.
Produce `form.session-filters`, four named disclosure buttons, three
`aria-pressed` sort buttons, and chips. Existing request effects remain unchanged.

- [ ] Add `sidebarFiltersPreserveQueriesAndClearGroups`: seed synthetic matching
      and nonmatching sessions; assert search is inside Session list, four source
      values and all six state values remain available, model is free text, date
      bounds serialize to existing URL keys, and clearing date clears both bounds.
      Clear filters clears query/source/state/model/from/to and retains sort.

  ```typescript
  expect(
    sidebar.contains(
      screen.getByRole('searchbox', {
        name: 'Search original prompts',
      }),
    ),
  ).toBe(true);
  expect(new URLSearchParams(window.location.search).get('sort')).toBe(
    'credits',
  );
  ```

- [ ] Add `filterEditorsHaveExclusiveKeyboardDisclosure` asserting only one
      editor opens, `aria-controls` resolves, Escape closes/returns focus, and source/
      state choices are radios rather than comboboxes. Add a paginated fixture to
      assert filtering resets list offset while existing delayed-selection regression
      still protects against stale responses.
- [ ] Run `npm test -- tests\sessions.test.tsx -t "sidebarFilters|filterEditors|olderSelection"`;
      observe expected new-test failures.
- [ ] Move the existing filter form into the sidebar controls area. Replace
      source/state selects with labeled radio groups, leave model/date inputs native,
      add SVG disclosure/sort buttons and removable wrapping chips. Count search,
      source, state, model, and date as five possible filter groups; sort does not count.
- [ ] Update existing browser selectors to open the appropriate editor and choose
      its radio, retaining the same result/no-result assertions. Add equivalent
      assertions for sort/model/date values and chip clearing.
- [ ] Rerun the targeted tests; expect pass without changes to backend search,
      filtering, date boundary conversion, or list auto-selection.

### Task 3: Hide/show and independently scrolling desktop panes

**Files:** Modify `src\client\sessions.tsx`, `src\client\styles.css`,
`tests\sessions.test.tsx`, and `tests\e2e\dashboard.spec.ts`.

**Interfaces:** Consume Task 2's editor state and current list/detail state.
Add `listVisible: boolean` initially true and refs for Hide/Show/scroll containers.
Keep sidebar DOM mounted under `hidden`; use `workspace-list-hidden` for geometry.
Produce `.session-list-controls`, `.session-list-rows`, `.session-detail-toolbar`,
and `.session-list-pagination` wrappers.

- [ ] Add `hideRestoreRetainsSessionAndControls` with more than 50 sessions and
      more than 25 conversation entries. Set nondefault ordering/page size, advance
      both pages, hide/restore, and assert the same selection, offsets, filters, and
      controls remain. Assert Hide focuses Show and Show focuses Hide.
- [ ] Add `restoreAvailableWithoutSelectionOrWithEditor` for no-result/loading/
      error states and an open filter editor. Assert Show stays outside the hidden
      aside, hidden descendants are not keyboard-reachable, and the editor closes.
- [ ] Run `npm test -- tests\sessions.test.tsx -t "hideRestore|restoreAvailable"`;
      expect failures for missing controls/state.
- [ ] Implement show/hide without unmounting the page or triggering query resets.
      Restore count reflects Task 2's active groups. Keep toggle accessible outside
      the sidebar on narrow screens, and close editors before hiding.
- [ ] Replace conflicting existing Sessions media rules with Sessions-scoped
      geometry: 320px left column above 900px, zero sidebar column when hidden,
      viewport-available workspace height, fixed list controls with scrollable rows,
      reachable pagination, and an independently scrolling detail panel.
      Compute available height from actual header/workspace position if necessary;
      do not depend on a constant header height that clips controls after wrapping.
      At <=900px use stacked document flow with controls before the list; preserve
      unrelated settings/usage breakpoints.
- [ ] Add production test `conversationPaneVisibilityAndResponsiveLayout`:
      compare body widths before/after Hide, verify retained sidebar scrollTop and
      correct focus, reach list and conversation pagination, then assert no page
      horizontal overflow at 320px with long paths/model names. Exercise 200% zoom
      using supported browser zoom or an equivalent verified layout viewport,
      not deviceScaleFactor alone.
- [ ] Rerun targeted React tests. Run `npm run build` then
      `npx --no-install playwright test tests\e2e\dashboard.spec.ts -g "conversationPaneVisibility"`;
      expect pass against production assets.

### Task 4: Full-width capped prompts and visible search matches

**Files:** Modify `src\client\sessions.tsx`, `src\client\styles.css`,
`tests\sessions.test.tsx`, and `tests\e2e\dashboard.spec.ts`.

**Interfaces:** Consume `ConversationEntry`, `matchedEntryId`, query, and current
entry pagination. Produce full-width `.conversation-entry pre` and accessible
focusable prompt viewports. Keep stable entry keys. Use
`revealPromptMatch(body: HTMLPreElement, query: string): void` as a local DOM-only
helper; it adjusts scrolling without modifying text or introducing API fields.

- [ ] Add `cappedPromptRetainsExactFullTextAndAccessibleScroll` using CRLF,
      combining characters, emoji, markup-looking text, and a match on line twelve.
      Assert the entire `pre.textContent`, named keyboard focusability, unchanged
      full clipboard text, no executable HTML, and the existing 1,000-code-point
      preview cap. jsdom tests do not assert pixel geometry.
- [ ] Run `npm test -- tests\sessions.test.tsx -t "cappedPrompt"`;
      observe missing viewport accessibility before implementation.
- [ ] Scope width overrides to Conversation (`width: 100%; max-width: none`).
      Apply original prompt `max-height` equivalent to ten content line heights with
      `overflow-y: auto`, retaining `pre-wrap` and `overflow-wrap`. Do not allocate
      ten lines for short prompts, truncate text, or cap assistant previews differently.
- [ ] Reveal a matched body's relevant text using DOM Range geometry. Account
      for FTS phrase matching's case and diacritic tolerance when mapping a query to
      original character offsets; preserve exact body text. A title-only hit does
      not invent a prompt-body match. Do not change the server's quoted FTS phrase
      semantics or add regex/HTML interpretation of user queries.
      Gate automatic scrolling by selected-session/matched-entry/query identity;
      remounting a relevant page can reveal again, ordinary SSE updates cannot.
- [ ] Add production test `promptViewportWidthHeightAndSearchReveal`: at 1280px
      and 1600px compare both body widths with their content boxes; assert short
      natural height and twelve-line/long-wrapped fixtures capped to ten computed
      line heights (one-pixel rounding tolerance), final text reachable, and no
      horizontal overflow after resize/Hide/Show.
- [ ] Add production test `searchRevealsLaterMatchWithoutRefreshScrollReset`:
      use >25 entries and a matching phrase after line ten, including case/accent
      differences. Assert correct page and visible hit, then manually scroll,
      append a synthetic source event, and assert SSE refresh retains manual
      scroll. Copy still equals the complete original string.
- [ ] Rerun targeted React tests. Run `npm run build` then
      `npx --no-install playwright test tests\e2e\dashboard.spec.ts -g "promptViewport|searchReveals"`;
      expect pass and preserve existing pagination/search regressions.

### Task 5: Integrated browser/WebView2 acceptance and handoff

**Files:** Modify `tests\desktop\dashboard.spec.ts`, `README.md`,
`docs\handoff.md`; update spec only for newly approved requirement changes.

**Interfaces:** Consume existing `launchDesktop` and safe bundled-runtime harness,
shared synthetic `exported`/`prompt` fixtures, and Tasks 1-4's accessible controls.
No apphost launch, native policy/lifecycle changes, or new entry points.

- [ ] Add `conversationFocusedLayoutInWebView2`: import a synthetic conversation,
      assert initially collapsed single overview with both subsections inside,
      open/close it, hide/restore sidebar while retaining selection, operate one
      filter disclosure, verify prompt cap/scroll and full exact copy using existing
      clipboard helpers. Keep desktop traces/screenshots disabled per harness policy.
- [ ] Run all required browser gates:

  ```powershell
  npm test
  npm run typecheck
  npm run lint
  npm run format:check
  npm run test:e2e
  ```

  Expect all pass; report and diagnose failures rather than marking them as
  accepted based only on old handoff notes. Formatting must not rewrite
  unrelated CRLF files; scope any necessary line-ending resolution.

- [ ] Since this task changes the desktop test workflow, run Windows gates:

  ```powershell
  npm run desktop:test
  dotnet format desktop\CopilotSessionDashboard.Desktop.sln --verify-no-changes
  npm run desktop:package -- -Flavor Release
  npm run desktop:e2e
  npm run desktop:defender-smoke -- -Zip desktop\artifacts\CopilotSessionDashboard-0.1.0-win-x64.zip
  ```

  Confirm the manifest version before selecting the Release zip. Never launch
  `CopilotSessionDashboard.exe` on this ASR-Block machine. Defender smoke must
  report zero 1116/1117/1121/1122 events; stop and report any event, with no bypass.

- [ ] Update README/handoff with implemented controls, defaults, display-state
      lifetime, and fresh verification evidence/gaps. Do not present the mockup or
      approved design as proof that real product acceptance has passed.
- [ ] Inspect `git diff --check` and final scope, preserving original sources,
      generated artifacts/secrets exclusions, and unrelated work. Record completed
      acceptance checks and any unrun/blocked checks in the handoff.
- [ ] Report the result and required runtime action: refresh the browser after
      frontend rebuild, or relaunch the newly packaged desktop UI. Do not restart
      another user's process or commit/push without permission.

## Plan review and execution boundary

Self-review mapping: overview/warnings -> Task 1; filter semantics/accessibility ->
Task 2; hide/show/scroll/desktop/narrow layout -> Task 3; prompt fidelity/geometry/
matching -> Task 4; target parity and repository verification -> Task 5.
All five Review Focus conditions have named regressions in their owning tasks.

The user approved native execution and in-place changes on `main`. All five
tasks were executed locally on 2026-11-13; the checklists above retain the
original task brief, with actual results recorded below. Do not restart these
tasks from the original checklists.

| Task | Execution result                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Combined expander/state/visibility regressions observed RED then GREEN                                                                        |
| 2    | Sidebar editor/chip/query regressions observed RED then GREEN                                                                                 |
| 3    | Hide/restore regressions and production pane geometry observed RED then GREEN                                                                 |
| 4    | Prompt viewport/search regressions observed RED then GREEN; final Greek sigma review finding also fixed RED then GREEN                        |
| 5    | Final 120 unit/integration tests, 11 browser workflows, 57 shell tests, nine WebView2 workflows, and zero-event Release Defender smoke passed |

Typecheck, lint, C# formatting, Release packaging, changed-file formatting, and
local-reference checks passed. Standard repository formatting reports 58
unrelated CRLF files; the existing `--end-of-line auto` check passes.
The unchanged ingestion tests failed twice in the initial concurrent run,
then passed in isolation and in the subsequent complete suites.

Execution decisions: keep one persistent toolbar Hide/Show control, as in the
approved mockup, for both desktop and narrow layouts; wrap pre-existing narrow
app navigation to meet 320px acceptance; bridge Node/jsdom signals only in the
test harness while retaining cancellation; use CRLF native clipboard fixtures
and preserve mixed-ending fidelity at the app's write boundary; use Playwright
`-g` selectors because Windows path arguments are interpreted as regexes.
The 55-session production fixture covers list pagination/scroll while the
40-entry React fixture isolates Conversation state preservation.

No per-task implementation agents, commits, pushes, or worktree cleanup occurred
during implementation.
One fresh final reviewer found the Greek sigma issue; it was fixed with a new
production regression and the full suites were rerun. No findings were deferred.
The user subsequently approved squashing the previously unpushed desktop work
and this UI work into one commit and pushing it to `main`, with the prior local
history retained on a backup branch and no force push.
