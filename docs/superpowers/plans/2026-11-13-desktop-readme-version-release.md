# Desktop documentation and versioned releases implementation plan

> **For agentic workers:** Implement task-by-task using executing-plans when
> available. Native execution is recommended; the commands and acceptance
> requirements do not depend on personal plugins.

**Goal:** Ship Desktop-first documentation, explicit 0.1.0 version authority,
and a version-triggered GitHub ZIP release workflow with a real app screenshot.

**Architecture:** VERSION.md is the newest-first version/notes authority.
Small Node tools validate/synchronize metadata and coordinate GitHub release
publication; .NET derives native metadata/title from the same history.
Existing Windows packaging/harnesses remain the execution path.

**Tech stack:** Existing Node/TypeScript/Vitest, PowerShell 7, .NET 10/WPF/WebView2,
GitHub Actions/GitHub CLI, Markdown, native Windows window capture.

**Spec:** [Approved design](../specs/2026-11-13-desktop-readme-version-release-design.md).

## Constraints and review focus

- Start at 0.1.0. Never edit VERSION.md on ordinary build/commit/push.
  Add a version only on an explicit request; default next-version increment is patch.
- Preserve old history, privacy/source/accounting rules and all existing UI.
- Do not publish a moving source revision, overwrite a published asset, or
  treat a failed draft as a published release.
- Reject malformed/duplicate history, unsynchronized manifests and conflicting
  native version overrides. Tests belong to Task 1.
- Handle an orphan/draft tag, failed upload and same-commit retry without
  exposing an empty release. Tests belong to Task 2.
- Keep native title-based readiness checks consistent. Verify with Tasks 1/3.
- Screenshot is the real requested Release .cmd, synthetic data only, native
  app window only; no Release debugging-policy change. Task 3 verifies this.
- No local commit/push/dispatch/publication without a subsequent request.
  Report unexecuted GitHub-hosted validation separately.

## Task 1: Application version authority

**Files:** create `VERSION.md`, `scripts\version.mjs`, root
`Directory.Build.props`/`Directory.Build.targets`; modify `package.json`,
`package-lock.json` if synchronization requires it, `desktop\scripts\package.ps1`,
`desktop\src\Shell\MainWindow.xaml.cs`, native title/readiness harnesses;
test in `tests\version.test.ts` and existing shell/native tests.

**Interfaces:** `readVersionHistory(text)` returns `{ version, notes }`;
`readVersion(root)` reads VERSION.md; `syncPackageVersions(root)` updates only
package/root-lock metadata. CLI `--json`, `--check`, `--sync`.
Current version is the first `## MAJOR.MINOR.PATCH` heading; duplicates/invalid
entries fail. Native title is `Copilot Session Dashboard v<version>`.

- [x] Add a CLI regression expecting valid version/notes from a disposable
      VERSION.md; observe failure before adding the tool.
- [x] Cover invalid/duplicate history, history preservation, explicit sync,
      check-mode refusal on metadata mismatch, and no writes during validation.
- [x] Implement version validation/sync; wire checks into normal builds.
      Derive .NET metadata/title from VERSION.md and reject conflicting overrides.
- [x] Replace package.json-derived ZIP naming with the canonical version.
      Update native title-based checks without weakening readiness/cleanup checks.
- [x] Run focused version/native tests and a build. Validate 0.1.0 metadata and
      confirm a normal build does not modify VERSION.md or synchronized manifests.

## Task 2: Version-triggered ZIP publication

**Files:** create `.github\workflows\desktop-release.yml`,
`scripts\release-desktop.mjs`, `tests\release-desktop.test.ts`.

**Interfaces:** release tool consumes canonical `{ version, notes }`, explicit
repository/source SHA and ZIP path. Expose preflight and publish operations.
Tests supply a stateful fake external GitHub boundary; production uses gh.

- [x] Add failing regressions for published-version refusal, foreign-commit tag/
      draft refusal, draft upload failure remaining unpublished, and same-commit
      draft retry with a ZIP attached before publication.
- [x] Implement strict preflight/error handling and draft -> upload -> publish,
      preserving published versions and using the exact source SHA.
- [x] Add main/VERSION.md push filtering and workflow_dispatch, main-only
      publication, same-version concurrency protection, pinned first-party actions,
      existing Windows validation/package gates and narrowly scoped permissions.
- [x] Validate YAML/action syntax and run release-boundary tests. Execute the
      workflow's local build/check commands; document that the hosted run itself
      awaits publication authorization.

## Task 3: Desktop documentation and real screenshot

**Files:** rewrite `README.md`; create `manual\README.md`,
`manual\development.md`, `manual\testing.md`, `manual\releases.md`,
`manual\images\desktop-session-dashboard.png`; update AGENTS/handoff.
Capture helpers/disposable fixtures remain session artifacts, not product code.

- [x] Move all current README information to the appropriate manual sections,
      retaining first-party references and repairing relative links.
- [x] Document download/extraction/start/close, WebView2 and bundled runtimes,
      unsigned/ASR entry points, source consent/privacy, and explicit version policy.
- [x] Build Release; seed only disposable synthetic app-owned data using existing
      adapters/store helpers; launch the exact requested staged .cmd.
- [x] Wait for the native versioned window and backend, capture that window
      including its title, inspect the PNG for correct content/privacy, close only
      the owned instance and verify backend/data cleanup.
- [x] Embed the reviewed PNG with alt text/synthetic caption; validate all local
      Markdown paths and review README as a Desktop user without developer context.

## Task 4: Final verification and handoff

- [x] Run `npm test`, `npm run typecheck`, `npm run lint`,
      `npm run format:check`, and rebuilt `npm run test:e2e`.
- [x] Run `npm run desktop:test`, C# format verification, Release packaging,
      `npm run desktop:e2e`, and Release Defender smoke using the canonical ZIP.
      Stop on any Defender 1116/1117/1121/1122 event.
- [x] Verify package/native/title/release naming agreement and version-history
      immutability on repeated ordinary builds. Review meaningful release/privacy
      risks and fix regressions before handoff.
- [x] Update actual evidence/gaps in the plan/handoff; keep generated packages,
      browser artifacts, private logs/tokens and temporary state outside commits.
- [x] Report refresh/relaunch requirements and distinguish local validation from
      unrun GitHub-hosted publication. Do not commit/push or release automatically.

## Execution evidence and rulings

Implemented and locally verified on `feature/desktop-docs-version-releases`.
The subsequent user request explicitly authorized committing/pushing to main and
triggering the initial 0.1.0 Release workflow, without incrementing VERSION.md.
Hosted publication must be confirmed separately from the local evidence below.

- 142 unit tests, typecheck/lint, 13 production Chromium workflows, 57 shell tests,
  C# formatting, Release packaging, nine WebView2 workflows passed.
- Final Defender smoke: cold/warm 8.33/1.47 seconds, zero 1116/1117/1121/1122
  events, cleanup complete. Ordinary builds preserved VERSION.md/npm/lock hashes.
- actionlint 1.7.12 passed; seven multiline Actions PowerShell blocks parsed,
  and its exact ZIP/native verification block executed successfully.
- All 61 referenced local documentation/image paths exist. Standard formatting
  passes for changed files; the repository gate still flags 56 unrelated CRLF
  files. Whole-repository `--end-of-line auto` passes; no normalization performed.
- One final fresh-context review found three Important issues, all fixed with
  RED-to-GREEN regressions: pending-tag draft lookup/recovery, overriding native
  version authority, and deleting a published asset during an upload race.
  No deferred minors. Drafts use GraphQL/ID lookup and exact target SHA; uploads
  never clobber assets, with digest/size/state-checked reuse.
- Ruling: retained the approved feature branch and SQL/session ledger instead
  of plugin-only workspaces. Root props are explicitly imported by nearest
  desktop props. Cost if wrong: tooling/import correction, not changed data UX.
- Ruling: the contents-scoped workflow token cannot inspect admin-only immutable
  settings. The owner explicitly authorized enabling them; the setting was
  changed and verified remotely, without publishing. Keeping that configuration
  is an administrative prerequisite; disabling it weakens future-release safety.
- The actual Release CMD window was captured with PrintWindow and synthetic
  snapshots, including v0.1.0 title; its shell/backend/temp data were cleaned.
- An overlapping RED-test packaging attempt initially failed. Final repeated
  packaging also encountered a newly opened external Desktop folder lock;
  after explicit close permission the app had already exited, and rerun passed.
  No unowned process was force-killed or real history read.
- Hosted Actions and Windows 10 remain unverified. The local Release ZIP was
  rebuilt; start the updated CMD/EXE as appropriate to inspect it.
