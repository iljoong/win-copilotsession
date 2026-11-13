using namespace System.Reflection.PortableExecutable

#requires -Version 7.0
<#
.SYNOPSIS
  Verifies the staged Release portable package produced by package.ps1.
.DESCRIPTION
  Script-style assertions against desktop\artifacts\Release\CopilotSessionDashboard\.
  Prints "ok: ..." for each passing check and "FAIL: ..." then exits 1 on the
  first failing check; exits 0 once every check has passed.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Reflection.Metadata

$desktopRoot = Split-Path -Parent $PSScriptRoot
$stagedRoot = Join-Path $desktopRoot 'artifacts\Release\CopilotSessionDashboard'
$downloadsRoot = Join-Path $desktopRoot 'downloads'

function Test-Assert {
    param(
        [Parameter(Mandatory)] [bool]$Condition,
        [Parameter(Mandatory)] [string]$Message
    )
    if (-not $Condition) {
        Write-Host "FAIL: $Message"
        exit 1
    }
    Write-Host "ok: $Message"
}

function Get-FileHashHex {
    param([Parameter(Mandatory)] [string]$Path)
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-BundledOriginal {
    <#
    .SYNOPSIS
      Asserts a bundled binary's bytes and Authenticode signature are unchanged
      from the verified download it was staged from.
    #>
    param(
        [Parameter(Mandatory)] [string]$StagedPath,
        [Parameter(Mandatory)] [string]$DownloadedPath,
        [Parameter(Mandatory)] [string]$Label
    )

    Test-Assert (Test-Path -LiteralPath $DownloadedPath -PathType Leaf) "reference copy exists for $Label (desktop\downloads)"
    $stagedHash = Get-FileHashHex -Path $StagedPath
    $downloadedHash = Get-FileHashHex -Path $DownloadedPath
    Test-Assert ($stagedHash -eq $downloadedHash) "$Label SHA-256 matches the verified download (unmodified)"
    $sig = Get-AuthenticodeSignature -LiteralPath $StagedPath
    Test-Assert ($sig.Status -eq 'Valid') "$Label has a valid Authenticode signature (status=$($sig.Status))"
}

Test-Assert (Test-Path -LiteralPath $stagedRoot -PathType Container) "staged package exists at $stagedRoot"

# --- Required files -----------------------------------------------------------

$requiredFiles = @(
    'CopilotSessionDashboard.exe',
    'CopilotSessionDashboard.dll',
    'CopilotSessionDashboard (Defender ASR).cmd',
    'runtime\dotnet.exe',
    'node\node.exe',
    'app\package.json',
    'app\dist\server\main.js',
    'app\dist\client\index.html',
    'README-FIRST.txt',
    'THIRD_PARTY_NOTICES.txt'
)
foreach ($relative in $requiredFiles) {
    $full = Join-Path $stagedRoot $relative
    Test-Assert (Test-Path -LiteralPath $full -PathType Leaf) "required file present: $relative"
}

# --- Forbidden content ----------------------------------------------------------

$nodeModulesDirs = @(Get-ChildItem -LiteralPath $stagedRoot -Recurse -Directory -Filter 'node_modules' -ErrorAction SilentlyContinue)
Test-Assert ($nodeModulesDirs.Count -eq 0) "no node_modules directory anywhere in the staged package"

$pdbFiles = @(Get-ChildItem -LiteralPath $stagedRoot -Recurse -File -Filter '*.pdb' -ErrorAction SilentlyContinue)
Test-Assert ($pdbFiles.Count -eq 0) "no .pdb files anywhere in the staged package"

# --- Release dll has no Testing-only diagnostics flag --------------------------

$dllPath = Join-Path $stagedRoot 'CopilotSessionDashboard.dll'
# The literal ASCII bytes of a Testing-only command-line flag round-trip
# intact through ReadAllText even though the file as a whole is binary, which
# is enough to prove its absence.
$dllText = [IO.File]::ReadAllText($dllPath)
Test-Assert (-not $dllText.Contains('--remote-debugging-port')) "Release dll has no Testing-only --remote-debugging-port string"

# --- Shell dll is IL-only, no ReadyToRun -----------------------------------------

$peBytes = [IO.File]::ReadAllBytes($dllPath)
$peStream = [IO.MemoryStream]::new($peBytes)
try {
    $peReader = [PEReader]::new($peStream)
    try {
        $corHeader = $peReader.PEHeaders.CorHeader
        Test-Assert ($null -ne $corHeader) "dll has a CLI (managed) header"
        $ilOnly = [CorFlags]::ILOnly
        Test-Assert (($corHeader.Flags -band $ilOnly) -eq $ilOnly) "dll CorHeader.Flags has ILOnly set"
        Test-Assert ($corHeader.ManagedNativeHeaderDirectory.Size -eq 0) "dll has no ReadyToRun native header"
    }
    finally {
        $peReader.Dispose()
    }
}
finally {
    $peStream.Dispose()
}

# --- apphost uses the app-relative runtime search (static check only; never run it) --

$runtimeConfigPath = Join-Path $stagedRoot 'CopilotSessionDashboard.runtimeconfig.json'
Test-Assert (Test-Path -LiteralPath $runtimeConfigPath -PathType Leaf) "CopilotSessionDashboard.runtimeconfig.json exists"
$runtimeConfig = Get-Content -LiteralPath $runtimeConfigPath -Raw | ConvertFrom-Json
$frameworkNames = @($runtimeConfig.runtimeOptions.frameworks | ForEach-Object { $_.name })
Test-Assert ($frameworkNames -contains 'Microsoft.WindowsDesktop.App') "runtimeconfig.json references the Microsoft.WindowsDesktop.App framework"

# --- Bundled third-party binaries are byte-identical to the verified downloads --

Test-BundledOriginal -StagedPath (Join-Path $stagedRoot 'node\node.exe') -DownloadedPath (Join-Path $downloadsRoot 'node\node.exe') -Label 'node.exe'

$downloadedRuntimeBinaries = @(Get-ChildItem -LiteralPath (Join-Path $downloadsRoot 'runtime') -Recurse -File -Include '*.exe', '*.dll')
Test-Assert ($downloadedRuntimeBinaries.Count -gt 0) "downloaded runtime has at least one .exe/.dll to compare against"
foreach ($downloaded in $downloadedRuntimeBinaries) {
    $relative = $downloaded.FullName.Substring((Join-Path $downloadsRoot 'runtime').Length).TrimStart('\')
    $staged = Join-Path $stagedRoot "runtime\$relative"
    Test-BundledOriginal -StagedPath $staged -DownloadedPath $downloaded.FullName -Label "runtime\$relative"
}

Write-Host 'PASS: all packaging checks passed'
