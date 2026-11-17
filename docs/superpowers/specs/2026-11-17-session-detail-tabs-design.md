# Session detail tabs and TODO completion

Date: 2026-11-17
Scope: User-requested follow-up to the session TODO feature. The user approved
`done` / all TODO rows as the completion calculation, with no percentage for
empty or unavailable data.
Supersedes the overview/TODO expanders and ascending TODO order in the
[earlier TODO design](2026-11-17-session-todo-status-design.md).
The [dependency-group follow-up](2026-11-17-todo-groups-design.md) extends
Todo status with a default grouped view; this document's flat ordering remains
available under All tasks.

## Observable behavior

- Replace the selected-session overview and TODO expanders with three tabs, in
  order: `Conversation`, `Session Info`, `Todo status`. Default to Conversation.
  Keep the session title, observed state, freshness warning and sidebar toggle
  outside the tab panels. Session Info contains the previous information/usage
  fields without an expander. Observed activity remains with Conversation.
- Remove the `Data coverage and limitations` disclosure and its detailed warning
  text from the selected-session UI. Preserve source/usage warnings in storage,
  Sources/Usage behavior and per-metric partial/unavailable indicators.
- Tabs expose tablist/tab/tabpanel relationships and selected state. Arrow keys
  wrap between tabs; Home/End select the first/last tab. Hidden panels are not
  interactive. Preserve tab choice, conversation settings and TODO page across
  tab switches/SSE refreshes; reset TODO pagination on session changes. Tab choice
  resets on page reload/remount. A new matching prompt search reveals Conversation.
- TODO reads/one-second refresh run only while its tab is active. Display a
  progress bar, percentage (at most one decimal), and done/total counts from the
  entire table, not just the current page. Only exact `done` statuses count as
  completed; unfamiliar and other statuses remain in the denominator.
- The bar describes TODO completion, never session completion or estimated
  fractional progress for in-progress work. Empty/unavailable data shows
  `Progress unavailable`, without a bar or misleading 0%. Known nonempty data
  with no done tasks is 0%; all done is 100%.
- Sort all TODO pages by `created_at DESC, id DESC`, with undated rows last.
  The user's `create_at` refers to the existing `created_at` column; do not
  rename the database field.

## Design and boundaries

Reuse the current compact dashboard design rather than introduce new cards,
fonts, assets or dependencies. Keep Segoe UI text, left alignment and existing
tokens: background `#101b2c`, panel `#192b42`, rule `#314760`, muted `#a9bad0`,
signal `#8acdb9`, selection/focus `#7fa8f8`. Use signal for the progress fill and
the selected tab underline; allow the three tabs to fit/wrap at 320px.

```text
Session title / observed state / sidebar control
Conversation | Session Info | Todo status
[selected panel]
Todo status: [completion bar] 33.3%   1 of 3 tasks done
             newest TODO rows ... [pagination]
```

Extend the authenticated TODO response with an all-table `completed` count:
number for available data (including zero), null for unavailable data. Aggregate
and page from the same existing disposable DB/WAL snapshot. Preserve all source
consent, bounded reads, original-file immutability and temporary-copy cleanup.
No new collection, source inspection, accounting, version or release publication.

## Acceptance

1. Synthetic API regressions verify global counts beyond a page, exact done
   matching, descending timestamps/ties, undated-last ordering and live updates.
2. UI regressions verify default/tab keyboard behavior, selection and display
   state preservation, removed coverage detail, inert TODO text, full-table
   percentages, empty/unavailable states and active-tab-only refresh.
3. Browser and WebView2 workflows exercise tab navigation, narrow layouts,
   unchanged prompt search/copy, metric partial labels and live updates.
4. Run all browser/static and Windows desktop/package/Defender gates. Any
   existing CRLF-only formatting failures remain documented, not normalized
   through unrelated edits.
