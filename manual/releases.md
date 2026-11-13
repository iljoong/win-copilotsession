# Explicit application versions and Desktop releases

[VERSION.md](../VERSION.md) is the source of truth for the application version.
The initial version is **0.1.0**. Tags use `v0.1.0`; ZIPs use
`CopilotSessionDashboard-0.1.0-win-x64.zip`.

## Change a version only when requested

Never increment a version just because you commit, push, build, package or publish.
Only an explicit next-version or specific-version request authorizes a new entry.
An unspecified "next version" means a patch increment: 0.1.0 -> 0.1.1.
Explicit minor/major/specific requests take precedence.

1. Add a new `## MAJOR.MINOR.PATCH` entry **above** existing entries in VERSION.md,
   with date and release notes. Keep previous history intact.
2. Synchronize the projected npm/lock metadata, then validate:

```powershell
npm run version:sync
npm run version:check
```

The sync tool does not increment or edit VERSION.md. Normal builds only check
metadata. Missing/malformed/duplicate entries and conflicting native overrides
fail instead of falling back to a guessed/default version.

The first history entry supplies version-specific release notes. .NET metadata,
native window title and ZIP filename derive from it. `desktop\versions.json`
is an independent pin for official Node/.NET runtimes, not the application version.

## GitHub Actions publication

`.github\workflows\desktop-release.yml` runs on:

- A push to **main** that changes VERSION.md, including the initial entry.
- **Actions > Desktop ZIP release > Run workflow**, on main.

Ordinary pushes do not release or increment anything. A workflow runs from the
exact triggering commit and creates `v<version>` at that commit, not moving main.
Published versions cannot be overwritten; request a new version for changed code.

The workflow first validates version/release state, then uses a Windows runner
with first-party actions pinned to commits. It restores tools, runs the full
browser/static/native/package/Defender gates, checks ZIP layout and native version,
uploads the ZIP to a draft, confirms the asset, and only then publishes.
Missing WebView2 is provisioned on the CI runner using a verified Microsoft-signed
installer; the end-user app never installs it.

`contents: write` is limited to the publication/build job; other jobs are read-only.
No personal token or signing secret is needed. Same-version runs are serialized,
and both preflight and publication recheck existing release state.

The repository owner must keep **Settings > General > Releases > Immutable
releases** enabled. It was enabled with explicit authorization for this
repository. This server-side protection prevents a competing publisher from
changing a release during upload; workflow concurrency alone cannot exclude
other writers. Inspect the setting as an administrator before publication.
The standard contents-scoped workflow token cannot inspect its admin-only API.

## Retry and diagnose

- A published version fails preflight. It is not replaced, even after a rerun.
- Upload failure leaves an unpublished draft. Rerun the same source commit to
  resume its draft; the tool refuses a tag/draft belonging to another commit.
- Do not silently reuse a version for newer code. Updating only old release notes
  in VERSION.md still triggers the path filter, but cannot overwrite a release.
- Upload never uses `--clobber` or deletes assets. An already uploaded draft ZIP
  is reused only when its SHA-256, size and upload state match. A conflicting or
  unfinished asset fails closed: an authorized owner can remove that asset from
  the draft and rerun the same commit. A confirmed ZIP is required before publication.
- Pending-tag drafts are discovered through GraphQL and fetched by release ID.
  If no tag exists yet, the draft's target must be the exact source SHA, not main.
- A missing/denied GitHub lookup is distinguished from HTTP 404; permission or
  network failures do not authorize treating a release as absent.
- Read failure logs without exposing tokens/private data. Stop on Defender events.

The locally generated ZIP is not a GitHub Release, and local validation is not a
hosted Actions run. New workflows must first be committed/pushed with authorization.
Use a subsequent explicit publication request before a local push, manual dispatch
or release creation; this documentation does not grant that permission.
