# Dependency-based TODO groups

Date: 2026-11-17
Status: Approved by the user for native execution.
Scope: The user's requested implementation of the recommended dependency groups,
completion summaries, creation-to-last-modification spans, and expanded visuals.
Extends the [detail-tabs design](2026-11-17-session-detail-tabs-design.md).
The user's 2026-11-17 card simplification supersedes the original expanded
timeline/task table: expanded cards now show Dependencies only.

## Observable behavior

- Keep the three session tabs. Todo status defaults to **Groups**; **All tasks**
  retains the existing newest-created-first, 50-row table and global progress.
  Add the source `updated_at` column to task details.
- Form groups from weakly connected components of `todo_deps`, over the entire
  selected session, before pagination. An edge means `depends_on` is a
  prerequisite of `todo_id`. Include isolated TODOs; never group by timestamp or
  ID prefix. A common ID prefix may name an already established group; otherwise
  use a root task's title. IDs remain visible in details.
- Group summaries show done/all, percentage, exact source-status counts, earliest
  known creation, latest known modification, and their span. Completion is exact
  `status='done'` / all members. Unknown statuses are preserved, not completed.
  Global completion still counts every TODO, not only visible groups.
- Default group order is latest modification descending; offer creation
  descending. Unknown sort times are last, with creation and stable group ID as
  tie breakers. Group IDs derive deterministically from the minimum member ID.
- Use 20 groups per page. Completed groups start collapsed; initially expand the
  first unfinished group on the first page, if any. One group is open at a time
  to limit information density and snapshot work. Expansion, sorting and pages
  survive polling/detail-tab changes and reset on session changes. Changing group
  page/order closes the group.
- Expanded groups contain **Dependencies** only: a local left-to-right SVG.
  Each node shows the task title followed by `id`, raw `created_at`, then
  `status`. Missing creation times say **Unavailable**; zero and other source
  representations are preserved without timezone conversion or inferred units.
  All labels and tooltips are inert text. Increase box height/row spacing and
  keep connectors centered so three metadata lines fit, including CJK titles.
  Last modification timeline, Task details and task-page controls are removed
  from cards. The separate All tasks table remains unchanged.
- Provide accessible labels, keyboard-operable controls and horizontally
  scrollable diagrams without document overflow at 320px. Creation-to-last-update
  spans remain in summaries; equal endpoints say **Same timestamp recorded**
  rather than implying instantaneous execution. No execution-history timeline,
  Gantt duration or critical path.

## Time and compatibility boundaries

- Preserve original timestamp representations in tables and labels. Accept
  strictly valid SQLite-style/ISO date-time strings for comparison and span
  arithmetic. Offset-free timestamps use an unspecified source clock, not a
  guessed local timezone. Explicit-offset strings compare as instants.
  When groups use different clock types, explicitly warn that clock types are
  sorted separately, not compared as instants.
- Never compute a span from missing/invalid timestamps, mixed
  offset-free/explicit-offset clocks, numeric timestamps of unknown units, or
  modification-before-creation data. Show known extrema with an incomplete-time
  notice and keep raw values in the table.
- Missing `updated_at` becomes null, not a copy of creation. Missing or unsupported
  `todo_deps` retains task/progress visibility, with a prominent warning that
  separately displayed tasks do not prove independence.
- Deduplicate edges. Dangling edges never create phantom tasks; warn on affected
  groups and draw only known endpoints. Cycles do not break grouping/progress;
  report them and point to All tasks instead of a misleading acyclic graph.
- Group at most 10,000 tasks and 50,000 dependency rows. Above these bounds,
  grouped view is explicitly unavailable; All tasks remains usable. Never group
  a truncated subset. Omit graphs above 80 nodes or 400 edges with an explicit
  size notice; All tasks remains available.

## Data, privacy and architecture

- No new dependency, CDN, telemetry, source writes, persistent TODO indexing,
  version bump, commit, push or publication.
- Read only the five requested TODO fields and two dependency fields, on demand,
  from an enabled CLI source's existing bounded disposable DB/WAL snapshot.
  Preserve the 64 MiB snapshot limit, path/identity checks, source revalidation,
  temporary cleanup, authentication and inactive-tab aborts.
- Extend the existing reader with a shared safe snapshot callback. Add
  `/api/sessions/:id/todo-groups`, returning paginated summaries, global task
  counts and at most one requested group's detail from the same snapshot.
  Retain existing detail-page response fields for API compatibility; the card
  UI consumes the full bounded graph, not the paginated task items.
  Refresh only the selected TODO view, sequentially about once per second.
  Old flat TODO requests remain supported.
- Reuse Segoe UI and existing dark/mint/focus tokens. Status is never conveyed by
  color alone. Group cards replace the default wall of rows; All tasks preserves
  direct source inspection.

## Acceptance checks

1. Synthetic API data with branch/merge dependencies produces connected groups
   independent of timestamps/pagination, includes standalone tasks, and calculates
   global/per-group counts and source-clock spans correctly.
2. Equal timestamps, missing columns/tables, dangling/duplicate/cyclic edges,
   incompatible/invalid times and size bounds have truthful, bounded fallbacks.
3. UI/browser checks cover default grouping/order, alternate order, expansion,
   graph direction, ID/creation/status metadata order, removed card sections,
   inert text, pagination, polling/state
   preservation and 320px overflow. Existing flat view and source immutability
   regressions remain effective.
4. Run all standard repository checks. If desktop workflows are updated, run
   native, packaging, WebView2 and Defender checks, retaining application 0.1.0.
   Record unrelated CRLF-only formatting failures without normalizing them.
