# Desktop-first documentation, explicit versions, and ZIP releases

Date: 2026-11-13
Status: Approved by the user, including default patch increments for an explicit next-version request

## Intent

Make the repository useful first to someone downloading the portable Windows
app, without losing developer documentation or privacy/accounting details.
Introduce an explicit application version history and a GitHub Actions workflow
that publishes the verified desktop ZIP for that version.

This extends the approved portable WebView2 design, not the app's collection,
accounting, authentication, storage, or conversation behavior.

## Confirmed user decisions

- README describes the Desktop app; development/testing details move under
  a new root `manual` folder.
- `VERSION.md` is the application/release version authority. Never increment
  it merely because code is committed, pushed, built, packaged, or released.
- Start at **0.1.0**. The user selected three-part public versions after the
  initial 0.1 request was clarified.
- Release on `main` pushes that change `VERSION.md`, plus manual workflow runs.
  Ordinary pushes must not publish or increment anything.
- Capture the actual requested Release `.cmd` launcher with synthetic sessions
  in disposable application data, not real history or an ordinary browser mockup.

## Documentation

- Root `README.md`: Desktop purpose/features, screenshot, Releases download link,
  portable prerequisites, extraction/start/close instructions, data location,
  source-consent/privacy summary, and links to the manual.
- `manual\README.md`: detailed source ingestion, telemetry opt-in, activity/usage
  interpretation, storage/privacy, compatibility evidence and source references
  retained from the current README.
- `manual\development.md`: source checkout, Node/npm and .NET prerequisites,
  browser/development commands, packaging and architecture/handoff links.
- `manual\testing.md`: existing browser/native/Defender gates, synthetic-only
  fixtures, production-build requirement, and current formatting limitations.
- `manual\releases.md`: explicit version updates, packaging/publication flow,
  workflow dispatch, failure/retry behavior, immutable published versions, and
  distinction between application and bundled dependency versions.
- Update AGENTS/handoff routing and relevant current instructions to reference
  the new manual. Historical specs/research remain historical documents.
- No information from the existing README is silently discarded. Correct
  relative links after moving content; avoid repeating the full manual in README.

## Version contract

- `VERSION.md` contains newest-first `## MAJOR.MINOR.PATCH` entries. The first
  entry is current; previous entries remain as history. Begin with `## 0.1.0`
  and an initial-release note/date.
- Versions are stable three-part numeric versions without leading zeroes or
  duplicate entries. An invalid/missing history must fail validation/build,
  never silently fall back to a default version.
- Add a new entry only when the user explicitly requests the next version or
  names a specific new version. Builder choice for approval: "next version"
  means a patch increment by default (0.1.0 -> 0.1.1); an explicitly requested
  minor/major/specific version takes precedence.
- npm package/lock metadata are synchronized projections, not competing version
  authorities. Provide an explicit sync/check tool; normal commits/pushes/builds
  do not change VERSION.md. A build rejects unsynchronized metadata.
- .NET build/publish derives its version from VERSION.md, including direct
  development builds. Informational/app version is 0.1.0; assembly/file versions
  use the framework-compatible equivalent. Reject conflicting overrides.
- Show the application version in the native Desktop window title; keep the
  existing frontend/navigation and authentication behavior unchanged. Adapt
  title-based smoke/harness checks accordingly.
- ZIP: `CopilotSessionDashboard-0.1.0-win-x64.zip`.
  GitHub tag/release: `v0.1.0`.
- `desktop\versions.json` continues to pin Node/.NET runtime downloads and
  hashes independently. Application version changes do not upgrade dependencies.

## GitHub Actions release behavior

- Add a Windows workflow with `push` restricted to `main` and the VERSION.md
  path, plus `workflow_dispatch`. Manual publication is restricted to main.
- Read/validate the version from the checked-out source. Build and tag the exact
  workflow source commit, not a later moving main head.
- Use first-party actions pinned by commit, declared Node/.NET tooling, verified
  bundled runtimes, and narrowly scoped GitHub-token permissions.
- Run the applicable existing unit/static/browser/native/package checks before
  publication; do not bypass a failing release gate. Provision missing CI
  prerequisites only on the runner, not on end-user machines.
- Produce the Release ZIP and verify its expected filename/version/contents.
  Native/Defender checks use bundled dotnet or the `.cmd`, never the apphost on
  an ASR-Block machine. Any Defender 1116/1117/1121/1122 event is a hard stop.
- Create/publish a release with the ZIP attached and version-specific notes.
  Keep a release draft until asset upload succeeds; do not publish an empty
  release. Published tags/assets are never silently overwritten.
- An already-published version fails early with a clear instruction to request
  a new explicit version. A failed draft may be resumed only for the same source
  commit; published assets are not replaced. Prevent duplicate concurrent
  publication of the same version.
- Keep server-side Immutable releases enabled (explicitly authorized during final
  review). Uploads never delete/clobber assets; completed same-commit draft assets
  are reused only after digest/size/state verification. Discover pending-tag drafts
  through GraphQL and validate their exact target SHA when no tag exists.
  The contents-scoped workflow token cannot inspect the admin-only setting API;
  the repository owner must retain this verified configuration.
- No personal access token, signing certificate, or other secret is committed.
  The initial release stays unsigned, as the existing Desktop design requires.
- Hosted-runner evidence is not a claim of ASR-Block or Windows 10 compatibility.
  Report unavailable platform checks, rather than calling them passed.
- Adding the workflow does not itself authorize a local commit/push, tag, manual
  dispatch, or public release. A subsequent explicit publication request is needed
  to execute the workflow against a published revision.

## Real Desktop screenshot

- Build the updated Release package, then launch exactly:
  `desktop\artifacts\Release\CopilotSessionDashboard\CopilotSessionDashboard (Defender ASR).cmd`.
- Pass disposable LOCALAPPDATA and COPILOT_HOME to that launch. Seed only
  synthetic, non-sensitive example sessions in app-owned temporary data.
  Do not read, enable, alter, or copy real source history.
- Wait for the real native window and authenticated backend to be ready.
  Capture only this app window, including its native title/version, not the
  shared desktop, another user's windows, terminal output, or access tokens.
- Store the reviewed public example PNG under `manual\images`; embed it in
  README with descriptive alternative text and a synthetic-data caption.
- Keep Release DevTools/debugging restrictions unchanged; do not use a Testing
  screenshot while claiming it is the requested Release launcher.
- Close only the app instance started for capture, verify its backend stops,
  and clean only the explicitly owned disposable data/helper paths.

## Compatibility and non-goals

Preserve the existing portable layout, launcher, read-only sources, exact prompt
copying, source consent, app-data ownership, loopback cookie authentication,
accounting semantics, and shutdown protections. No installer, auto-update,
telemetry collection, signing-policy change, ASR exception, or backend migration.
Do not normalize unrelated CRLF files as part of this change.

## Observable acceptance

1. README alone explains downloading/extracting/launching/closing the Desktop
   app without requiring Node/npm on the user's PC. It displays an actual native
   Release-window screenshot; all detailed previous documentation is reachable
   through valid manual links.
2. VERSION.md, npm/lock metadata, native version/title, ZIP filename, release
   tag and notes agree on 0.1.0. A normal build leaves version history unchanged.
3. Regressions cover invalid/duplicate history, explicit synchronization,
   conflicting metadata, and agreement of built/native/package versions.
4. Workflow event filters, main-only publication, exact source commit, published
   version refusal, same-commit draft retry, asset-before-publication behavior,
   and version-derived filenames are checked.
5. Existing browser and Windows gates run, including rebuilt production
   Playwright, shell tests/C# formatting, Release packaging, WebView2 workflows,
   and Release Defender smoke. Report the existing CRLF formatter gap precisely.
6. Screenshot capture uses synthetic disposable data; the image is inspected,
   owned processes/data are cleaned, and no shared instance/history is touched.
7. Local checks and actual GitHub-hosted runs/publication are reported separately.
   An uncommitted workflow is not presented as an executed/published release.

## First-party workflow references

- [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create)

Read on 2026-11-13. Release creation/upload/publication are separate requests;
draft handling and exact target selection are required, not assumed atomic.
