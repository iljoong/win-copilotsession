# Conversation-focused Sessions UI

Date: 2026-11-13
Status: Approved by the user on 2026-11-13 with one combined information/usage expander
Scope: Sessions-page presentation in browser mode and the shared WebView2 UI

## Intent and confirmed understanding

Make it faster to switch among many sessions and scan more conversation content
at once. Conversation is the primary reading surface; session discovery remains
readily available, while metadata and usage details move out of the default
reading path.

The user requested:

- Original user prompt and Assistant preview bodies use the available
  Conversation width instead of occupying a narrow central area.
- Original user prompts display at most ten lines with internal scrolling.
- The left Sessions list can be hidden and restored to widen Conversation.
- Session search and filters move from above the workspace into the left list.
  Prefer compact icons over always-visible pulldowns.
- Selected-session information and statistics share one combined expander.

The user explicitly clarified that ten lines means a maximum, not a fixed
ten-line allocation: short prompts use their natural height.

On 2026-11-13, the user approved the remaining draft requirements and defaults,
replacing the proposed separate Session information and Session usage expanders
with one combined expander.

This document defines one integrated UI change, not a new ingestion or accounting
feature. It supplements the [approved product design](2026-11-12-copilot-session-dashboard-design.md)
and preserves the accepted behavior in the [handoff](../../handoff.md).

## Current implementation and diagnosis

The current implementation is in `src\client\sessions.tsx` and
`src\client\styles.css`, with regression coverage in
`tests\sessions.test.tsx` and `tests\e2e\dashboard.spec.ts`.

- Global `pre` styling limits bodies to `79ch`. This explains unused space on
  wide Conversation panels. The inspected CSS does not explicitly center these
  bodies; do not claim centering is the root cause without browser evidence.
- The workspace assigns 31% to the left list, with a 270px minimum.
- Search, source, state, model, dates, and sort occupy a form above both panes.
- Selected-session metadata and an eight-field metrics grid appear before
  Conversation without a collapse control.
- Assistant previews already have a scrollable 17rem maximum height; original
  prompts have no height cap.
- Observed activity and coverage warnings already use native `details`.

## Approved defaults

The user approved these defaults, including the combined expander revision.

| Decision                  | Recommendation                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Initial left pane         | Visible, to support switching among many sessions                                                                           |
| Left-pane desktop width   | 320px rather than a percentage of a wide workspace                                                                          |
| Selected-session expander | One combined Session information and usage expander, initially collapsed                                                    |
| State lifetime            | Display state survives session changes and live refreshes within the mounted Sessions page; resets on tab remount or reload |
| Scroll structure          | Independently scrollable list and detail panes on desktop; normal document flow on narrow screens                           |
| Search-match visibility   | Scroll the matched prompt body to expose the match, including matches after the tenth displayed line                        |

No new preference persistence, storage schema, or URL parameters are proposed.

## Layout

```text
Sessions                                      Live updates connected
+-------------------------+------------------------------------------+
| Sessions          [Hide]| [Show sessions, only when hidden]        |
| Search prompts/titles   | Selected session title / observed state  |
| Source State Model Date | Freshness / coverage notice if needed    |
| compact icon buttons   | > Session information and usage          |
| Sort icon buttons      |                                          |
| Active filter summary  |                                          |
| 126 sessions            | Conversation            existing controls|
|-------------------------| Original user prompt                Copy |
| Selected session       | full-width text, at most 10 display lines |
| Other sessions         | internal scroll for remaining text        |
| ...                     | Assistant preview                         |
| Session pagination      | full-width bounded text preview           |
|                         | Conversation pagination                   |
|                         | > Observed activity                       |
+-------------------------+------------------------------------------+
```

Existing app navigation, source setup, Usage page, colors, model-family badges,
and yellow original-prompt text remain unchanged. Labels in the diagram are
structural, not a new localization requirement.

### Conversation width and prompt height

- Apply full-width behavior only inside Conversation. Remove the effective
  character-based maximum from both prompt and preview bodies; use the
  Conversation content box, accounting for existing padding and prompt border.
  Entry labels, timestamps, and Copy controls align with that same box.
- Do not remove the application-wide 1800px outer maximum in this change. Full
  width means the available Conversation panel width, not edge-to-edge monitor
  width. Do not change typography or reduce font size to fit more content.
- Preserve `white-space: pre-wrap` and wrapping of long unbroken text. No
  page-level horizontal overflow from long prompts, paths, or model names.
- A displayed line is a rendered line after wrapping, not a newline-delimited
  source line. The prompt viewport maximum is ten computed line heights
  (currently 13px at 1.8 line height, approximately 234px for content).
  Borders/padding/scrollbar dimensions must not consume one of those ten lines.
- Use a maximum height, never a line clamp, ellipsis, substring, or replacement
  text. Overflow scrolls vertically; ten or fewer displayed lines have natural
  height and no unnecessary scroll area.
- Resizing, changing pane visibility, and zooming recompute wrapping and keep
  the ten-line maximum. They do not change the underlying prompt.
- Copy always copies the entire exact original string, including text outside
  the viewport, CRLF, leading/trailing spaces, emoji, and combining characters.
- Scrollable prompt bodies are keyboard-reachable and have an accessible name
  tied to the entry. Copy remains outside the scrolling body.
- Preserve the existing assistant preview limit of 1,000 Unicode code points,
  17rem display-height limit, truncation notice, and inert text rendering.
- When search selects a matching entry, keep its existing page navigation and
  highlight and reveal the first relevant text match inside a capped body.
  Preserve exact text; do not inject HTML. Repeated live refreshes must not
  repeatedly reset a user's internal scroll position.

### Hide and restore the Sessions pane

- Hide removes the entire pane, including its search, filters, and pagination,
  from layout and keyboard traversal. No blank 320px column remains.
- A clearly labeled Show sessions control remains in the detail toolbar,
  outside the hidden pane, including loading, empty, and error states.
- Toggling does not remount the Sessions page, change selection, fetch a
  different session, clear filters, reset either pagination offset, or reset
  Conversation ordering/page-size settings.
- Keep list scroll position and the selected row when restoring. Hidden
  filters remain active; Show sessions displays the active-filter count.
  Count the nonempty source/state/model/date-range groups and search; sort is
  not a filter and the date range counts as one group.
- Hide moves focus to Show sessions; restoration returns focus to the pane's
  Hide control. Use `aria-controls`, `aria-expanded`, and descriptive names.
- Close any open filter editor before hiding to prevent orphaned overlays.

### Search and compact filters inside the left pane

- Search is a full-width, always-visible input at the top of the shown pane;
  preserve the accessible name Search original prompts and title/prompt scope.
- Below search, provide four icon-led filter buttons: Source, State, Model,
  Date range. Each opens a small, labeled in-pane disclosure, not a
  permanently visible select or an unlabeled icon-only choice matrix.
- One filter editor is open at a time. Activating its trigger toggles it.
  Escape closes it and returns focus to the trigger. Use native buttons and
  ordinary form controls with `aria-expanded` and `aria-controls`; no menu
  role requiring a separate menu keyboard model.
- Source editor uses single-choice radio rows: All sources, CLI history,
  CLI telemetry, VS Code import, VS Code telemetry. Do not collapse history
  and telemetry into one CLI/VS Code filter; their provenance differs.
- State editor uses single-choice radio rows: All states, Active (observed),
  Idle, Completed, Interrupted, Error, Unknown. Snapshot labels do not become
  a new filter value.
- Model editor retains the current free-text input and matching semantics.
  Do not replace it with a GPT/Claude-only selector or fetch new model lists.
- Date editor retains labeled From and To native date inputs and the current
  local-day boundary conversion. Native calendar controls are appropriate;
  the request does not forbid every native picker.
- Sort uses three mutually exclusive icon buttons for Latest activity,
  Recorded agent time, Reported AIC, exposing `aria-pressed`. Preserve the
  current sort direction and unavailable-value ordering.
- Use local inline SVGs, not external icon services or an additional library.
  Triggers expose descriptive accessible names and tooltip text. Active
  filters have a shape/border indicator as well as color; icons alone must
  not require guessing current values.
- Show removable, wrapping text chips for active filters/search and an
  explicit Clear filters action. Clearing a chip clears only its group;
  clearing Date range clears both bounds. Clear filters clears query/source/
  state/model/from/to, leaves sort unchanged, and follows normal filtering
  selection behavior.
- Preserve existing URL keys, request parameters, filter combination,
  first-page reset on filter changes, result totals, session auto-selection,
  search-match navigation, and before-pagination filtering/order.
- Keep list controls/count visible while session rows scroll on desktop.
  Pagination remains usable inside the pane. Controls and chips wrap at
  narrow widths; do not squeeze them into unreadably small targets.

### Combined selected-session information and usage expander

- Outside the combined expander, keep the session title, observed state or Imported
  snapshot label, turn-scope qualifier, and any stale-observation warning.
  Keep connection status visible in the page heading.
- The Session information subsection contains models, repository/directory, first/last
  source timestamps, and the ordinary latest-observation explanation.
- The Session usage subsection contains the existing Input, Output, Cache read, Cache
  write, Reasoning, Reported AIC, Recorded agent time, and Wall span fields.
  Preserve values, labels, unavailable/partial states, and warnings.
- Use one native `details`/`summary` expander labeled Session information and
  usage, initially collapsed. Its content contains both subsections with
  ordinary headings, not nested or independently collapsible expanders.
  One action shows or hides all session information and statistics together.
  Keep expansion state on
  same-session refresh and across session switches within the mounted page,
  so users comparing metadata do not need to reopen it for every session.
- Keep Data coverage and limitations outside the combined expander when warnings
  exist. Its collapsed summary displays a warning indicator/count; detailed
  warning text can remain collapsed. Never hide all evidence of limitations.
- Existing Observed activity remains its own collapsed-by-default expander,
  with its established same-session-refresh preservation behavior. No
  fabricated running/completion status or changed accounting is introduced.

### Desktop and narrow layouts

- At viewport widths above 900 CSS pixels, constrain the workspace to the
  available viewport height below the existing headers, without clipping
  controls. Left rows and right details scroll independently.
- At 900px and below, use a stacked, normal-flow layout rather than an overlay
  drawer. Put the show/hide toggle before the workspace so Conversation can
  be reached without scrolling through the shown session list.
- At 320px, all controls remain accessible, text wraps, and there is no
  horizontal page overflow. At 200% zoom, allow the narrow layout to apply.
- Restoring a narrow-screen list does not silently change session selection.
  Selecting a row does not automatically hide the list in this iteration.

## Data, privacy, compatibility, and non-goals

- UI-only changes using the existing React/plain CSS stack. No server routes,
  shared DTOs, database migrations, ingestion, identity, or billing changes.
- Original sources remain read-only. No real history inspection, telemetry
  collection, external content requests, or automatic source enablement.
- Keep loopback authentication and app-data ownership/consent protections.
- Do not store prompt content or new display preferences in localStorage,
  logs, analytics, or new URL parameters.
- Browser and desktop use the same frontend behavior. Native shell controls,
  packaging, window lifecycle, and distribution are outside scope.
- No full assistant transcript, Markdown execution, cross-session combined
  timeline, infinite scrolling, virtualization, resizable splitter, new sort
  direction, or larger page-size options.
- Faster scanning is a usability goal, not a measured performance claim or
  permission to fetch all sessions/conversation entries at once.

## Observable acceptance checks

Use synthetic fixtures and disposable app-owned data only.

1. At 1280px and 1600px viewport widths, both types of body fill their parent
   Conversation content box (allowing declared padding/borders); increasing
   panel width increases body width rather than stopping at `79ch`.
2. A short prompt has natural height; a prompt with twelve explicit lines and
   a single long wrapped line both cap at ten computed display-line heights,
   have vertical overflow, and expose their final text through scrolling.
   Verify again after Hide/Show and viewport resizing.
3. Copy from a capped prompt reproduces the complete fixture exactly,
   including CRLF and Unicode; markup-looking content remains inert.
4. Hide expands Conversation, removes sidebar descendants from the tab order,
   and leaves Show usable. Restore retains selection, filters, list offset/
   scroll position, Conversation page/controls, and correct focus.
5. Search and filter controls are contained in the left pane. All existing
   source/state values, free-text model, date bounds, and sorts produce the
   same API parameters/results as before. Filters reset the session-list
   offset; Clear filters and individual chips obey the specified behavior.
6. Search finds a prompt on a later Conversation page with a match below its
   ten-line viewport and reveals that match without corrupting copied text.
   Source-time order, tie/undated ordering, empty-preview filtering, totals,
   and 25/50/100/150-entry pagination remain unchanged.
7. One combined Session information and usage expander starts collapsed.
   Opening it shows both subsections and all existing fields and their
   unavailable/partial labels; closing it hides both subsections together.
   Neither subsection has its own expander. Expansion survives live refresh and
   a switch to another session. Title/state, stale warning, and coverage
   warning indicator remain visible when the combined expander is closed.
8. At 320px and 200% zoom, the layout follows the narrow behavior with no
   page-level horizontal overflow. Keyboard users can operate all icon
   triggers, filter choices, expanders, scroll bodies, Copy, and Hide/Show.
9. An SSE refetch preserves display state and manual prompt scroll positions;
   stale selection responses still cannot replace a newer session.
10. Production browser checks exercise built assets, not stale dev output.
    Shared frontend behavior must also be exercised in the desktop WebView2
    workflow before claiming verified desktop parity.

## Implementation and verification handoff

The design is approved and implemented locally under the
[matching implementation plan](../plans/2026-11-13-conversation-focused-sessions-ui.md).
This document is not the implementation plan. The user subsequently approved
publishing the unpushed desktop work and this UI implementation as one squash
commit; Git history and remote tracking establish publication.

Expected files: `src\client\sessions.tsx`, scoped changes in
`src\client\styles.css`, `tests\sessions.test.tsx`, and
`tests\e2e\dashboard.spec.ts`; desktop UI assertions may be added to
`tests\desktop\dashboard.spec.ts`. Update README/handoff only when the described
behavior is actually implemented.

Use React tests for state/selection/filter/accessibility behavior and production
Playwright tests for actual widths, wrapped lines, scrolling, responsive layout,
and search-match visibility; jsdom geometry is not sufficient.
Run the repository's required test/typecheck/lint/format/e2e gates before a code
handoff. Run applicable Windows desktop gates if desktop harness or packaging
files change; otherwise run the shared-UI WebView2 acceptance before claiming
desktop parity, and state any unrun target checks.

Implementation requires the browser and Windows checks above. Refresh browser
mode after rebuilding the frontend, or relaunch the updated portable package
for desktop mode; no source collection or backend configuration change is needed.

## Review artifact

A self-contained, synthetic HTML layout mockup is stored in this Copilot
session's `files` directory, not in application assets. It demonstrates pane
hide/show, compact filter disclosures, the combined information/usage expander,
natural short-prompt height,
and a scrollable long prompt. Example titles/values are fictional. Filtering,
search, copying, API behavior, and persistence are not product implementations.
The static file is viewable locally without a server or external requests and
is not a required dependency for building from this specification.
