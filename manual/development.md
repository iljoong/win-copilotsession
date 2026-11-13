# Development

Run commands from the repository root in Windows PowerShell.
End users only need the portable ZIP; these tools are for contributors.

## Prerequisites

- Node.js >=22.23.4 and npm (the existing engine requirement).
- PowerShell 7 and .NET 10 SDK for Desktop development.
- Microsoft Edge WebView2 Runtime for native acceptance.
- Git; GitHub CLI for release preflight/publication.

```powershell
npm ci
npm run version:check
npm run build
npm start
```

If required by your environment, use
`npm ci --registry=https://packagefeedproxy.microsoft.io/npm/` with existing
registry authentication. The project never configures/prints credentials.

## Browser and development mode

The server binds to `127.0.0.1`, chooses a free port and opens a browser on Windows.

```powershell
npm start -- --no-open --port 4210 --data-dir 'C:\local-dashboard'
npm run dev -- --no-open
```

Use the terminal's **startup access URL** privately. It establishes an HttpOnly,
SameSite=Strict per-run cookie, then removes the token from the visible URL.
Never share terminal screenshots containing the access URL. Use the new URL
after a restart; stop with Ctrl+C. Node 22 may print an experimental SQLite warning.

Production assets use no CDN/remote fonts. Development rebuilds into
`dist\dev-client` without a separate HMR/WebSocket listener; refresh after edits.
Browser and Desktop modes share the same app-owned data and must not run together.

## Architecture and authority

The React/TypeScript frontend uses a Node HTTP/SQLite/SSE backend. Desktop adds
a WPF WebView2 shell and the same backend as a supervised sidecar, not Electron.

- [Repository handoff](../docs/handoff.md): implementation map and limits.
- [Product design](../docs/superpowers/specs/2026-11-12-copilot-session-dashboard-design.md).
- [Portable Desktop design](../docs/superpowers/specs/2026-11-13-windows-portable-webview2-design.md).
- [Source/privacy reference](README.md).
- [Coding workflow](../AGENTS.md).

## Package the Desktop app

```powershell
npm run desktop:package -- -Flavor Release
```

The package script fetches pinned official runtimes, verifies hashes/signatures,
builds the frontend/backend, runs its packaging gate, publishes the shell, stages
the app, creates notices and smoke-tests the staged backend. Only Release produces
`desktop\artifacts\CopilotSessionDashboard-<version>-win-x64.zip`.

Application metadata/title and ZIP naming use [VERSION.md](../VERSION.md).
`desktop\versions.json` pins bundled dependency versions separately; application
version changes must not upgrade Node/.NET downloads automatically.

The optional existing signing arguments require both `-SignTool` and
`-CertificateThumbprint`; the initial release is unsigned. Do not commit signing
secrets. See [release procedures](releases.md) and [verification](testing.md).
