# Session TODO status

Date: 2026-11-17
Scope: User-requested small feature; the request authorizes the four TODO fields,
placement below Session information and usage, and default-collapsed disclosure.

The later [session detail tabs design](2026-11-17-session-detail-tabs-design.md)
supersedes the expander layout and ascending order below, adding exact all-table
TODO completion. Source read-only/privacy boundaries remain applicable.

## Behavior and compatibility

- Add a separate native `TODO Status` expander immediately below the existing
  overview. It starts closed and does not change the overview or conversation.
- For the selected session, show `id`, `created_at`, `title`, and `status` from
  its CLI `session.db`. Support the CLI `todos` table and a legacy `todo` table.
  Preserve source status values and creation-time representations, including
  unfamiliar statuses; do not infer session completion or a progress percentage.
- Read only while expanded, refreshing about once a second without overlapping
  requests. Keep expansion within the mounted page; reset pagination and discard
  stale results when switching sessions. Page 50 rows in creation-time/id order.
- Distinguish an empty table from unavailable data (missing DB/table, unsupported
  schema, disabled/non-CLI source, unsafe paths, oversized DB, or read failure).
  Retain ordinary session browsing when TODO reads fail.

## Data and privacy boundaries

- Resolve the original CLI session reference from stored normalized records,
  never from a browser-supplied filesystem path or the hashed dashboard ID.
  Read only an enabled CLI-history source already linked to that session.
- No real history is used in verification. No source writes, SQLite migrations,
  telemetry, dependency, packaging, version, or usage-accounting changes.
- Restrict the session directory, DB, and optional WAL to the selected root and
  session boundary. Refuse escaping links and nonregular source files.
- SQLite WAL readers can modify source shared-memory sidecars even on a
  read-only connection. Instead, read bounded DB/WAL bytes (64 MiB combined) into
  a disposable private temporary snapshot, open that snapshot read-only, and
  remove it in `finally`. Never copy the source SHM or open the source in SQLite.
  Reject files that change during copying and nonempty rollback journals rather
  than attempting source recovery; retry on the next poll.
- Temporary copies contain the DB/WAL bytes, potentially including other tables,
  but only the four requested columns leave the reader. Nothing is indexed or
  retained in dashboard storage. Errors never echo SQL, source contents or paths.

## Acceptance checks

1. Authenticated API returns the selected session's four fields with deterministic
   pagination; updates and deletions appear on the next read, including WAL data.
2. Source DB, WAL, SHM, and directory entries remain unchanged by reads.
3. Missing, malformed, incompatible, disabled, imported and escaping sources
   report unavailability rather than a misleading empty task list.
4. The expander is below the overview, initially closed, keyboard-operable,
   shows source text inertly, refreshes while open, and stops reads when closed.
   Narrow layouts contain the table without page-level horizontal overflow.
5. Focused API/UI/browser regressions and the repository browser/static gates
   pass. Desktop packaging is unchanged.
