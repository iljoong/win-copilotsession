#requires -Version 7.0
<#
.SYNOPSIS
  Builds the portable zip package for the Copilot Session Dashboard desktop
  shell.
.DESCRIPTION
  End to end: fetches and verifies the pinned Node/.NET runtimes, builds the
  web client and server, runs the full Vitest suite (minus two pre-existing
  baseline failures unrelated to this branch) as a hard gate, publishes the
  WPF shell, stages everything into
  desktop\artifacts\<Flavor>\CopilotSessionDashboard\, writes third-party
  notices, smoke-tests the staged backend, optionally Authenticode-signs the
  shell's own exe/dll, and (Release only) zips the staged folder.
.PARAMETER Flavor
  Build configuration: Release or Testing. Only Release produces a zip.
.PARAMETER SignTool
  Path to signtool.exe. Must be supplied together with -CertificateThumbprint,
  or not at all.
.PARAMETER CertificateThumbprint
  SHA-1 thumbprint of the signing certificate. Must be supplied together with
  -SignTool, or not at all.
.PARAMETER TimestampUrl
  RFC 3161 timestamp server used when signing. Ignored unless -SignTool is
  supplied.
#>
param(
    [Parameter(Mandatory)] [ValidateSet('Release', 'Testing')] [string]$Flavor,
    [Parameter()] [string]$SignTool,
    [Parameter()] [string]$CertificateThumbprint,
    [Parameter()] [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([bool]$SignTool -ne [bool]$CertificateThumbprint) {
    throw '-SignTool and -CertificateThumbprint must both be supplied, or neither.'
}

$scriptsRoot = $PSScriptRoot
$desktopRoot = Split-Path -Parent $scriptsRoot
$repoRoot = Split-Path -Parent $desktopRoot

. (Join-Path $scriptsRoot 'common.ps1')

$downloadsRoot = Join-Path $desktopRoot 'downloads'
$nodeDownloadRoot = Join-Path $downloadsRoot 'node'
$runtimeDownloadRoot = Join-Path $downloadsRoot 'runtime'
$artifactsRoot = Join-Path $desktopRoot 'artifacts'
$stagedRoot = Join-Path $artifactsRoot "$Flavor\CopilotSessionDashboard"

# --- 1. Fetch and verify the pinned runtimes -----------------------------------

Write-Host "== Fetching pinned Node/.NET runtimes =="
& (Join-Path $scriptsRoot 'fetch-runtimes.ps1') | Out-Null
$nodeExe = Join-Path $nodeDownloadRoot 'node.exe'

# --- 2. Build the web client and server -----------------------------------------

Write-Host '== Building dist (npm run build) =='
Push-Location $repoRoot
try {
    Invoke-Checked -Exe 'npm' -Arguments @('run', 'build')
}
finally {
    Pop-Location
}

# --- 3. Vitest gate: hard-fail packaging on any unexpected test failure ---------

Write-Host '== Running the Vitest suite with the pinned node.exe (packaging gate) =='
$vitestEntry = Join-Path $repoRoot 'node_modules\vitest\vitest.mjs'
# tests/usage.test.tsx and tests/sessions.test.tsx fail on main already: jsdom's
# AbortSignal does not satisfy Node 24's fetch ("Expected signal to be an
# instance of AbortSignal"), unrelated to this branch (controller ruling R4).
$vitestArgs = @(
    $vitestEntry, 'run',
    '--exclude', 'tests/usage.test.tsx',
    '--exclude', 'tests/sessions.test.tsx'
)
Push-Location $repoRoot
try {
    Invoke-Checked -Exe $nodeExe -Arguments $vitestArgs
}
finally {
    Pop-Location
}

# --- 4. Publish the WPF shell ----------------------------------------------------

Write-Host "== Publishing the shell ($Flavor) =="
if (Test-Path -LiteralPath $stagedRoot) {
    Remove-Item -LiteralPath $stagedRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stagedRoot | Out-Null

$shellProject = Join-Path $desktopRoot 'src\Shell\Shell.csproj'
Invoke-Checked -Exe 'dotnet' -Arguments @(
    'publish', $shellProject,
    '-c', $Flavor,
    '-r', 'win-x64',
    '--no-self-contained',
    '-o', $stagedRoot
)

# Debug symbols are a build artifact, not part of the shipped app.
Get-ChildItem -LiteralPath $stagedRoot -Recurse -File -Filter '*.pdb' | Remove-Item -Force

# --- 5. Stage the bundled runtimes and the unchanged app -------------------------

Write-Host '== Staging bundled runtime, node, and app =='
Copy-Item -LiteralPath $runtimeDownloadRoot -Destination (Join-Path $stagedRoot 'runtime') -Recurse -Force
Copy-Item -LiteralPath $nodeDownloadRoot -Destination (Join-Path $stagedRoot 'node') -Recurse -Force

$appDir = Join-Path $stagedRoot 'app'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
# Only `"type": "module"` is needed so Node resolves the bundled dist/* as ESM; the repo's
# full package.json (scripts, devDependencies, metadata) is not part of the shipped app.
Set-Content -LiteralPath (Join-Path $appDir 'package.json') -Value '{"type":"module"}' -Encoding ASCII -NoNewline
Copy-Item -LiteralPath (Join-Path $repoRoot 'dist') -Destination (Join-Path $appDir 'dist') -Recurse -Force

# --- 6. Entry points and documentation -------------------------------------------

$packagingRoot = Join-Path $desktopRoot 'packaging'
$launcherTemplate = Get-Content -LiteralPath (Join-Path $packagingRoot 'launcher.cmd.template') -Raw
Set-Content -LiteralPath (Join-Path $stagedRoot 'CopilotSessionDashboard (Defender ASR).cmd') -Value $launcherTemplate -Encoding ASCII -NoNewline
Copy-Item -LiteralPath (Join-Path $packagingRoot 'README-FIRST.txt') -Destination (Join-Path $stagedRoot 'README-FIRST.txt') -Force

Write-Host '== Generating THIRD_PARTY_NOTICES.txt =='
& (Join-Path $scriptsRoot 'notices.ps1') `
    -DestinationPath (Join-Path $stagedRoot 'THIRD_PARTY_NOTICES.txt') `
    -DesktopRoot $desktopRoot `
    -RepoRoot $repoRoot

# --- 7. Smoke-test the staged backend --------------------------------------------

Write-Host '== Smoke-testing the staged backend =='
Invoke-Checked -Exe $nodeExe -Arguments @((Join-Path $scriptsRoot 'backend-smoke.mjs'), $stagedRoot)

# --- 8. Optional signing ----------------------------------------------------------

if ($SignTool) {
    Write-Host '== Signing the shell exe and dll =='
    foreach ($name in @('CopilotSessionDashboard.exe', 'CopilotSessionDashboard.dll')) {
        $target = Join-Path $stagedRoot $name
        Invoke-Checked -Exe $SignTool -Arguments @(
            'sign', '/sha1', $CertificateThumbprint,
            '/fd', 'SHA256', '/tr', $TimestampUrl, '/td', 'SHA256',
            $target
        )
    }
}

# --- 9. Release zip ----------------------------------------------------------------

if ($Flavor -eq 'Release') {
    $version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
    $zipPath = Join-Path $artifactsRoot "CopilotSessionDashboard-$version-win-x64.zip"
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    Write-Host "== Zipping $zipPath =="
    Compress-Archive -Path $stagedRoot -DestinationPath $zipPath -CompressionLevel Optimal
    $zipSize = (Get-Item -LiteralPath $zipPath).Length
    Write-Host ("Wrote {0} ({1:N1} MB)" -f $zipPath, ($zipSize / 1MB))
}

Write-Host "== Packaging complete: $stagedRoot =="
