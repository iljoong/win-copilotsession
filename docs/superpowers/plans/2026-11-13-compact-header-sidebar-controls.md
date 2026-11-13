# Compact header and sidebar controls implementation plan

**Spec:** [Approved follow-up design](../specs/2026-11-13-compact-header-sidebar-controls-design.md).
**Execution:** Native continuation in the current authorized main working tree;
no commits/pushes without a new request.
**Publication:** Subsequently authorized by the user's commit/push request,
including the inline-status refinement.

## Constraints

Preserve original data/privacy rules, existing subscriptions, exact prompt
fidelity, pagination/filter parameters, the ten-line viewport and combined
overview. Reuse local SVG/native details/plain CSS; add no dependencies.
Tests use synthetic fixtures and existing harnesses only.

## File map and dependencies

| Files                                                            | Responsibility                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src\client\App.tsx`                                             | Active-tab explanation and Sessions-only header connection                |
| `src\client\sessions.tsx`                                        | Existing stream status callback, collapsed search expander, in-panel icon |
| `src\client\usage.tsx`, `src\client\sources.tsx`                 | Remove duplicate page chrome, preserve data/consent                       |
| `src\client\styles.css`                                          | Wrapping compact header and sticky icon toolbar                           |
| `tests\app.test.tsx`, `tests\sessions.test.tsx`                  | Header/connection and expander behavior                                   |
| `tests\e2e\dashboard.spec.ts`, `tests\desktop\dashboard.spec.ts` | Production/WebView2 acceptance and adapted interaction paths              |
| README/handoff                                                   | Implemented facts and actual verification evidence                        |

Tasks 1 and 2 share Sessions/App rendering; execute sequentially. Task 3 verifies
their integrated result. Review risks: duplicate/stale subscriptions on tab
switch, hidden active filters, missing restore control with no selection,
sticky controls obscuring content, and overflowing long descriptions at 320px.

## Task 1: Compact tabs and Sessions-only connection

- [x] Add App regressions for tab descriptions, no duplicate `h1`, Sessions-only
      connected/disconnected status, and clicking the already-selected tab.
- [x] Observe expected failures before implementation.
- [x] Add `onConnectionChange?: (connected: boolean) => void` to SessionsPage;
      forward the existing stream status callback, with cleanup that ignores
      callbacks after unmount. Do not add another stream.
- [x] Let App render the active description and Sessions-only status, resetting
      connection on an actual tab change only. Remove the three page-heading blocks
      and Usage's now-unused connection display state.
- [x] Pass focused App/Sessions/Usage/Sources tests.

## Task 2: Collapsed sidebar form and in-panel icon

- [x] Add regressions for default collapsed search, hidden controls, retained
      query/active count/open state, and the icon toggle inside Selected session.
- [x] Observe expected failures before implementation.
- [x] Add `filtersOpen` component state and controlled native
      `details.session-search`; clear nested editor only on collapse, retaining
      all other state. Keep count/rows/pagination outside.
- [x] Move the toggle into the detail panel, provide local left-sidebar SVG,
      accessible name/tooltip/expanded state, and a sticky in-panel toolbar.
- [x] Update existing tests to explicitly open search before interacting;
      preserve result, cancellation, geometry, selection, and Copy assertions.
- [x] Pass focused tests, then production checks for 320px/1280px header
      wrapping and a restore icon reachable after detail scrolling.

## Task 3: Integration and handoff

- [x] Extend WebView2 checks and replace old duplicate-page-title assertions
      with the active navigation state (not weaker startup checks).
- [x] Run `npm test`, `npm run typecheck`, `npm run lint`,
      `npm run format:check`, and `npm run test:e2e`.
- [x] Run `npm run desktop:test`,
      `dotnet format desktop\CopilotSessionDashboard.Desktop.sln --verify-no-changes`,
      Release packaging, `npm run desktop:e2e`, and Release Defender smoke.
      Never run the apphost on this ASR-Block VM; stop on any Defender event.
- [x] Obtain one final code review and fix important findings with regressions.
- [x] Update README/handoff with implemented behavior and actual evidence;
      state formatting/target gaps. Preserve generated artifacts outside Git.
- [x] Report runtime refresh/relaunch requirements, leaving commits/pushes to
      a separate user instruction.

## Verification evidence

Completed locally on 2026-11-13: 124 unit/integration tests, 12 production
Chromium workflows, 57 shell tests, and nine WebView2 workflows. Typecheck,
ESLint, C# formatting, and Release packaging passed; the pinned packaging subset
passed 94 tests. Final review's narrow sticky failure was reproduced before the
stacked workspace `overflow: clip` fix, then passed at 640/320px.

Release Defender smoke first timed out at 60.1 seconds with zero Defender
events and no shell log. The unchanged command/zip passed on recheck
(cold/warm 8.17/1.56 seconds, zero 1116/1117/1121/1122 events, complete cleanup).
The initial timeout's cause is unconfirmed; no security workaround was used.

The standard repository formatter still reports 59 unrelated line-ending files;
changed files and the repository's `--end-of-line auto` check pass.
README/handoff document behavior, actual evidence, and refresh/relaunch needs.
No real history, shared runtime, commits, or pushes were touched.

## Approved inline-status refinement

The subsequent small request places state/scope and the unchanged stale message
beside the existing icon instead of below it. Snapshot/freshness conditions,
title, sidebar focus, and sticky behavior are preserved; narrow text wraps.

- [x] Extend `tests\sessions.test.tsx` to require state/warning beside the icon
      through Hide/Show, and add production wide alignment/narrow wrapping coverage
      in `tests\e2e\dashboard.spec.ts`. Observe both failures before implementation.
- [x] Move the existing render block in `src\client\sessions.tsx` and use compact
      wrapping flex styling in `src\client\styles.css`; no data/query changes.
- [x] Revalidate and update README/handoff/spec. Final results: 124 unit tests,
      13 Chromium workflows, 57 shell tests, nine WebView2 workflows; typecheck,
      lint, C# formatting, Release packaging, and updated Release Defender smoke
      pass. Smoke cold/warm startup: 4.80/1.57 seconds, zero Defender events and
      complete cleanup. The existing 59 unrelated CRLF formatter warnings remain.
