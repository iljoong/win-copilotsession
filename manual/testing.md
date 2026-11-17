# Testing and verification

Use synthetic fixtures and disposable app-owned data only. Real Copilot history
requires explicit permission and is never a default test input.
Run these commands from the repository root.

## Browser and static gates

```powershell
npm test
npm run typecheck
npm run lint
npm run format:check
npm run test:e2e
```

`test:e2e` builds production assets before Playwright. Running Playwright directly
can exercise stale assets. Install Chromium only if it is missing:

```powershell
npx playwright install chromium
```

Acceptance uses authenticated loopback readiness and disposable app/source
directories. It covers exact prompt copying, inert bounded previews, source
consent, filters/pagination, narrow layouts, complete-record latency, reconnects
and persistence. Harnesses keep startup tokens out of reports and terminate only
their own processes.

Version/release regressions additionally cover invalid/duplicate history,
explicit synchronization, native metadata disagreement, published-version refusal,
foreign-commit tags, upload failure and same-commit draft retry.

The Vitest suite includes real Windows ACL/PowerShell checks, three MSBuild
invocations and multi-poll TODO UI scenarios. Its bounded per-test budget is
30 seconds to accommodate cold hosted runners. TODO sorting waits for its
asynchronous response for up to four seconds, like the existing TODO refresh
assertions. These are test-runner budgets, not relaxed application latency
requirements; browser/WebView2 complete-record latency checks are unchanged.

Polling assertions re-query the currently rendered graph after source
unavailability/recovery: a safe snapshot refusal can unmount an old SVG.
Retaining that detached node tests stale DOM rather than the visible result.

## Windows Desktop gates

```powershell
npm run desktop:test
dotnet format desktop\CopilotSessionDashboard.Desktop.sln --verify-no-changes
npm run desktop:package -- -Flavor Release
npm run desktop:e2e
$version = (node scripts\version.mjs --json | ConvertFrom-Json).version
npm run desktop:defender-smoke -- -Zip "desktop\artifacts\CopilotSessionDashboard-$version-win-x64.zip"
```

`desktop:e2e` rebuilds a Testing package and exercises WebView2. Release has no
Testing/debugging endpoint. Native readiness includes the canonical versioned
window title. The packaging subset still excludes the historical Sessions/Usage
baseline files; **npm test remains a required full-suite gate**, including both
files, and the release workflow runs it independently.

Never start `CopilotSessionDashboard.exe` on an ASR-Block machine. Harnesses use
bundled `runtime\dotnet.exe`; Defender smoke starts the `.cmd` entry point.

The smoke extracts into a disposable path containing spaces/non-ASCII characters,
stamps files with Mark-of-the-Web, uses an empty synthetic COPILOT_HOME and isolated
LOCALAPPDATA, and checks startup, close, forced-shell termination and console
windows. Defender 1116/1117/1121/1122 events must be zero; stop and report any event,
never disable protection or add an exception. Successful runs clean their own
temporary data/processes; failed runs retain diagnosis files.

Hosted-runner results do not establish ASR-Block or Windows 10 compatibility.
Report unsupported/unrun environments explicitly.

## Formatting and current evidence

With Windows `core.autocrlf=true`, unrelated checked-out CRLF files can fail the
standard Prettier check. Do not normalize unrelated files during a focused task.
Check changed files with the standard formatter and separately inspect:

```powershell
npx prettier --check --end-of-line auto .
```

The release workflow uses an LF checkout on its disposable runner so the standard
format gate remains enforced. This does not change local Git settings.

C# formatting must also be checked with actual LF sources. The initial hosted
release caught legacy `AssemblyInfo.cs` comment formatting that passed a CRLF
working tree. A default `git archive` can inherit `core.autocrlf=true`; use
`git -c core.autocrlf=false archive` for an LF reproduction and verify the copied
file's bytes. Removing the redundant scaffold comments fixes both layouts without
changing ThemeInfo values or skipping the formatter.

See [handoff evidence](../docs/handoff.md) for actual counts, transient failures
and platform gaps, not a blanket assumption that every environment passed.
