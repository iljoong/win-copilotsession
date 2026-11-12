# Coding agent instructions

This is a local-only, read-only Copilot session dashboard for Windows.

## Context routing

- **Repository orientation or handoff:** read [docs/handoff.md](docs/handoff.md).
  It maps the implementation, accepted follow-ups, regression tests, and limits.
- **Product behavior, source ingestion, identity, accounting, or privacy changes:**
  read the relevant sections of the
  [approved product design](docs/superpowers/specs/2026-11-12-copilot-session-dashboard-design.md)
  and [README](README.md).
- **Desktop packaging or migration:** also read the
  [Windows desktop research](docs/research/windows-desktop-options-research.md).
  This is a recommendation with unresolved compatibility gates, not an approved
  Electron implementation specification. Recheck time-sensitive platform claims.
- The [original implementation plan](docs/superpowers/plans/2026-11-12-copilot-session-dashboard.md)
  is historical. Its empty-workspace assumptions, scratch paths, and
  plugin-specific execution instructions are not prerequisites for new work.

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
  README's storage/privacy rules before changing these paths or trust boundaries.
- Preserve missing/partial usage and source provenance. A missing metric is not
  zero; idle/turn end is not session completion. Accounting rules and desktop
  parity requirements are indexed in the handoff.

## Verification

Use the scripts and engine requirement in `package.json`; setup is in README.
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
For documentation-only work, check formatting and referenced local paths; runtime
tests are unnecessary unless executable behavior changes. Windows/package-specific
claims require evidence on that target; report unrun checks on other hosts.

Keep generated `dist`, dependencies, private logs, databases, tokens, and browser
artifacts out of commits. Use existing tooling; personal Copilot plugins or session
artifacts are not required to work on this repository.
