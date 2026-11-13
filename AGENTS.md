# Coding agent instructions

This is a local-only, read-only Copilot session dashboard for Windows.

## Context routing

- **Repository orientation or handoff:** read [docs/handoff.md](docs/handoff.md).
  It maps the implementation, accepted follow-ups, regression tests, and limits.
- **Product behavior, source ingestion, identity, accounting, or privacy changes:**
  read the relevant sections of the
  [approved product design](docs/superpowers/specs/2026-11-12-copilot-session-dashboard-design.md)
  and the [detailed manual](manual/README.md).
- **Desktop packaging or migration:** read the
  [portable WebView2 spec](docs/superpowers/specs/2026-11-13-windows-portable-webview2-design.md),
  the desktop section of [docs/handoff.md](docs/handoff.md), and the
  [Defender research](docs/research/2026-11-13-portable-webview2-defender-research.md).
  The older [Windows desktop research](docs/research/windows-desktop-options-research.md)
  is historical context, not an approved Electron implementation specification.
  Recheck time-sensitive platform claims.
- The [original implementation plan](docs/superpowers/plans/2026-11-12-copilot-session-dashboard.md)
  is historical. Its empty-workspace assumptions, scratch paths, and
  plugin-specific execution instructions are not prerequisites for new work.

## Explicit version policy

- [VERSION.md](VERSION.md) is the application-version authority. Its newest
  `## MAJOR.MINOR.PATCH` entry supplies native metadata/title, ZIP name and release
  tag/notes. Keep earlier entries intact.
- Never bump a version on an ordinary commit/push/build. Add an entry only when
  the user explicitly requests the next or a specific version. An unspecified
  next version increments patch; an explicit minor/major/specific choice wins.
- After an authorized edit, run `npm run version:sync` and
  `npm run version:check`. npm/lock versions are projections, not authorities.
  `desktop\versions.json` independently pins bundled dependency versions.
- See [release procedures](manual/releases.md). A main push changing VERSION.md
  triggers publication; confirm that effect before pushing. Manual dispatch and
  publication require explicit authorization. Published versions are immutable.
  Keep the repository's authorized Immutable releases setting enabled; publication
  tools must not delete/clobber assets to recover a draft.

## Spec-driven workflow

1. Inspect `git status`, relevant source, and existing tests. Preserve unrelated
   working-tree changes; the current files may include work not present in HEAD.
2. Identify the approved task and write observable acceptance criteria. For a new
   feature or architectural change, create a dated specification under
   `docs\superpowers\specs` covering scope/non-goals, behavior, data and privacy
   boundaries, compatibility, and acceptance checks. Obtain approval for unresolved
   product decisions before implementation. An explicitly requested small change
   can use its existing approved scope without repeating design approval.
3. For multi-step work, create a matching plan under `docs\superpowers\plans`.
   Map each step to files, dependencies, and verification. Research conclusions
   alone do not authorize a migration.
4. Add focused behavioral regressions, observe the expected failure, then make the
   smallest coherent implementation. Keep adapters, shared contracts, API queries,
   UI behavior, and search/pagination offsets consistent.
5. Complete the applicable verification below. Update the spec when approved
   requirements change, and update the handoff/README when their facts change.
6. Report the implemented acceptance criteria, verification evidence and gaps,
   outstanding decisions, and any required runtime restart. Commit or push only
   when requested; never treat a local working tree as a published handoff.

## Boundaries to preserve

- Access real history only with explicit permission. Use synthetic fixtures and
  disposable app-owned data in tests. Original sources remain read-only, and
  collection/telemetry changes require user consent.
- Preserve loopback authentication, source-path boundaries, exact prompt text,
  inert response previews, and existing app-data ownership protections. Consult
  the manual's storage/privacy rules before changing these paths or trust boundaries.
- Preserve missing/partial usage and source provenance. A missing metric is not
  zero; idle/turn end is not session completion. Accounting rules and desktop
  parity requirements are indexed in the handoff.

## Verification

Use the scripts and engine requirement in `package.json`; setup is in
[manual/development.md](manual/development.md), and verification details are in
[manual/testing.md](manual/testing.md).
During implementation run the smallest relevant test selection. Before a code
handoff run:

```powershell
npm test
npm run typecheck
npm run lint
npm run format:check
npm run test:e2e
```

`test:e2e` builds production assets before Playwright. Running Playwright directly
can exercise stale assets. Install Chromium only if the runner reports it missing.

When a change touches the portable desktop app (`desktop\`, `src\server\lifecycle.ts`,
the `--desktop` mode, or packaging), also run on Windows:

```powershell
npm run desktop:test
dotnet format desktop\CopilotSessionDashboard.Desktop.sln --verify-no-changes
npm run desktop:package -- -Flavor Release
npm run desktop:e2e
npm run desktop:defender-smoke -- -Zip desktop\artifacts\CopilotSessionDashboard-<version>-win-x64.zip
```

Never launch the apphost `CopilotSessionDashboard.exe` on a machine with Defender
ASR rules in Block; harnesses use the bundled `runtime\dotnet.exe` or the `.cmd`
entry point. `desktop:defender-smoke` must report zero Defender 1116/1117/1121/1122
events; if any appear, stop and report them instead of working around them.
For documentation-only work, check formatting and referenced local paths; runtime
tests are unnecessary unless executable behavior changes. Windows/package-specific
claims require evidence on that target; report unrun checks on other hosts.

Keep generated `dist`, dependencies, private logs, databases, tokens, and browser
artifacts out of commits. Use existing tooling; personal Copilot plugins or session
artifacts are not required to work on this repository.
