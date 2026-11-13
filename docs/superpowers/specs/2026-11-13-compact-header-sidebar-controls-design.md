# Compact header and sidebar controls

Date: 2026-11-13
Status: Approved scope from the user's follow-up request and connection-status clarification
Implementation: Completed and verified; publication subsequently authorized. Evidence
and the initial Defender smoke timeout are recorded in the matching plan/handoff.

## Intent and scope

Reduce duplicate page chrome so session browsing starts closer to the app tabs.
This follows the approved
[conversation-focused UI design](2026-11-13-conversation-focused-sessions-ui-design.md).
The requirements below supersede that design's always-visible sidebar filters
and Hide/Show toolbar placement, without changing data or query behavior.

## Approved behavior

- Remove the Sessions, Usage, and Sources page-level title/description blocks
  below the main tabs. Do not remove selected-session titles, usage data
  headings, source setup instructions, consent controls, or privacy warnings.
- Show the active tab's existing explanation next to the main navigation:
  Sessions: "Trace the work. Find the prompt. Understand the usage.";
  Usage: "Recorded usage across matching sessions. No currency estimates or
  guessed billing conversions.";
  Sources: "Choose what this machine reads. Nothing is enabled automatically."
  Text changes with the selected tab, retains readable wrapping, and is not
  repeated below the header.
- Remove "On this machine". As explicitly clarified by the user, show the
  existing Live updates connected/disconnected indicator in the header only
  while Sessions is selected. Usage and Sources do not show a connection label.
- Reuse Sessions' existing SSE subscription to report status to App; do not
  open an extra stream for the header or alter other pages' refresh behavior.
  Switching away removes the indicator; returning starts disconnected until
  the new Sessions stream connects. Clicking the current Sessions tab must not
  reset a healthy connection label.
- Move the Sessions pane toggle inside the right Selected session panel at its
  upper-left edge. Replace visible button text with a local left-sidebar SVG
  icon. Retain a semantic keyboard-operable button, descriptive Hide sessions/
  Show sessions accessible name and tooltip, `aria-controls`/`aria-expanded`,
  visible focus, and the active-filter count in the restore label.
- Keep the toggle reachable in loading, no-selection, error, narrow, and
  scrolled detail states. A small sticky in-panel toolbar is an implementation
  choice; hiding must not leave the only restore control inside the hidden pane.
- Approved inline-status refinement: place the selected session's existing
  state/scope and stale-observation message beside the sidebar icon in this
  toolbar, not on separate rows below it. Keep wording, snapshot/freshness
  conditions, and the selected title unchanged. Use one row where space permits;
  wrap naturally without truncation or horizontal overflow on narrow screens.
- Wrap the sidebar's entire search/filter/sort/chip form in one native
  Search and filters expander, initially collapsed. Keep session count,
  session rows, and list pagination outside it.
- The expander's summary displays the active filter-group count even while
  closed. Collapsing never clears active query/filter/sort values or changes
  selection/pagination. Close any nested filter editor when collapsing the
  outer expander, and preserve its expansion state on session changes, pane
  hide/show, and SSE refresh within the mounted Sessions page.
- Reset the search expander to collapsed on tab remount/reload, consistent
  with existing display settings. Native `summary` supports keyboard activation.
- Preserve desktop independent pane scrolling, <=900px stacked layout,
  available Conversation width, ten-line prompt viewport, exact Copy,
  existing search offsets, combined overview, and coverage/freshness indicators.
- At 320px, active description, tabs, and Sessions status remain readable
  without page-level horizontal overflow. The header may wrap naturally;
  do not hide the description or status to fit.

## Boundaries and compatibility

UI-only React/plain CSS changes. No dependency, DTO, API, accounting, source,
privacy, storage, desktop-shell, or telemetry changes. Original history stays
read-only, tests use synthetic data, and no new preferences or URL keys are saved.
Browser mode and the portable WebView2 app use the same frontend.
The original UI request did not authorize publication; the user subsequently
authorized committing and pushing the follow-up and inline-status refinement.

## Acceptance

1. Only navigation buttons identify the active page; no duplicate page `h1`
   or page-heading block remains. The selected tab's explanation is in the header.
2. Sessions header status follows stream open/error and reconnect, without
   duplicate subscriptions. Usage/Sources have no connection indicator or
   On this machine text. Re-clicking Sessions keeps the connected label.
3. Sidebar search starts hidden; expanding reveals existing controls and
   collapsing hides them without resetting filters or their summary count.
   Session change, SSE refresh, and Hide/Show preserve the open state.
4. The toggle is an icon-only accessible button inside Selected session, stays
   reachable when scrolled, and restores the sidebar with all prior state.
5. Existing search, pagination, Copy, usage, Sources consent, and live refresh
   regressions remain valid after updating tests to open the new expander.
6. Production Chromium and WebView2 checks cover the header, collapsed search,
   in-panel icon, keyboard activation, and narrow overflow. Run the repository
   gates, report any existing CRLF formatting limitation, and leave shared
   processes and real history untouched.
