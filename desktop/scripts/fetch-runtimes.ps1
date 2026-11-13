#requires -Version 7.0
<#
.SYNOPSIS
  Downloads, verifies, and stages the pinned Node and .NET runtimes used by
  the portable desktop shell.
.DESCRIPTION
  Reads desktop\versions.json (relative to this script), downloads the
  pinned Node win-x64 zip and the pinned .NET runtime/windowsdesktop win-x64
  zips, verifies their published hashes, extracts them, and checks
  Authenticode signatures on the resulting binaries:
    - node.exe must be signed by the OpenJS Foundation.
    - runtime\dotnet.exe and runtime\host\fxr\*\hostfxr.dll must be signed
      by Microsoft.
  Already-downloaded zips are reused if their hash still matches, so re-runs
  are cheap. Returns the staging root path (desktop\downloads).
.OUTPUTS
  System.String - the full path to desktop\downloads.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$desktopRoot = Split-Path -Parent $PSScriptRoot
$versionsPath = Join-Path $desktopRoot 'versions.json'
$downloadsRoot = Join-Path $desktopRoot 'downloads'
$cacheRoot = Join-Path $downloadsRoot '.cache'
$nodeRoot = Join-Path $downloadsRoot 'node'
$runtimeRoot = Join-Path $downloadsRoot 'runtime'

function Get-FileHashHex {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [ValidateSet('SHA256', 'SHA512')] [string]$Algorithm
    )

    (Get-FileHash -LiteralPath $Path -Algorithm $Algorithm).Hash.ToLowerInvariant()
}

function Get-VerifiedDownload {
    <#
    .SYNOPSIS
      Downloads $Url to $cacheRoot\$FileName unless a file with a matching
      hash is already cached there; throws "Hash mismatch" on mismatch.
    #>
    param(
        [Parameter(Mandatory)] [string]$Url,
        [Parameter(Mandatory)] [string]$FileName,
        [Parameter(Mandatory)] [string]$ExpectedHash,
        [Parameter(Mandatory)] [ValidateSet('SHA256', 'SHA512')] [string]$Algorithm
    )

    New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
    $destination = Join-Path $cacheRoot $FileName

    $needsDownload = $true
    if (Test-Path -LiteralPath $destination) {
        $existingHash = Get-FileHashHex -Path $destination -Algorithm $Algorithm
        if ($existingHash -eq $ExpectedHash.ToLowerInvariant()) {
            Write-Host "Reusing cached $FileName (hash matches)"
            $needsDownload = $false
        }
        else {
            Write-Host "Cached $FileName hash does not match; re-downloading"
            Remove-Item -LiteralPath $destination -Force
        }
    }

    if ($needsDownload) {
        Write-Host "Downloading $FileName from $Url"
        Invoke-WebRequest -Uri $Url -OutFile $destination -UseBasicParsing
    }

    $actualHash = Get-FileHashHex -Path $destination -Algorithm $Algorithm
    if ($actualHash -ne $ExpectedHash.ToLowerInvariant()) {
        throw "Hash mismatch for $FileName`: expected $ExpectedHash, got $actualHash"
    }

    return $destination
}

# --- Load pinned versions ---------------------------------------------------

$versions = Get-Content -LiteralPath $versionsPath -Raw | ConvertFrom-Json

$nodeVersion = $versions.node.version
$nodeZipName = $versions.node.zip
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeZipName"
$nodeSha256 = $versions.node.sha256

$dotnetRuntimeUrl = $versions.dotnetRuntime.url
$dotnetRuntimeSha512 = $versions.dotnetRuntime.sha512

$windowsDesktopUrl = $versions.windowsDesktopRuntime.url
$windowsDesktopSha512 = $versions.windowsDesktopRuntime.sha512

# --- Download + verify -------------------------------------------------------

$nodeZipPath = Get-VerifiedDownload -Url $nodeUrl -FileName $nodeZipName -ExpectedHash $nodeSha256 -Algorithm 'SHA256'
$dotnetRuntimeZipName = [System.IO.Path]::GetFileName($dotnetRuntimeUrl)
$dotnetRuntimeZipPath = Get-VerifiedDownload -Url $dotnetRuntimeUrl -FileName $dotnetRuntimeZipName -ExpectedHash $dotnetRuntimeSha512 -Algorithm 'SHA512'
$windowsDesktopZipName = [System.IO.Path]::GetFileName($windowsDesktopUrl)
$windowsDesktopZipPath = Get-VerifiedDownload -Url $windowsDesktopUrl -FileName $windowsDesktopZipName -ExpectedHash $windowsDesktopSha512 -Algorithm 'SHA512'

# --- Extract ------------------------------------------------------------------

if (Test-Path -LiteralPath $nodeRoot) {
    Remove-Item -LiteralPath $nodeRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $nodeRoot | Out-Null

$nodeExtractTemp = Join-Path $cacheRoot 'node-extract'
if (Test-Path -LiteralPath $nodeExtractTemp) {
    Remove-Item -LiteralPath $nodeExtractTemp -Recurse -Force
}
Expand-Archive -LiteralPath $nodeZipPath -DestinationPath $nodeExtractTemp -Force

$nodeZipBaseName = [System.IO.Path]::GetFileNameWithoutExtension($nodeZipName)
$nodeExtractedDir = Join-Path $nodeExtractTemp $nodeZipBaseName
Copy-Item -LiteralPath (Join-Path $nodeExtractedDir 'node.exe') -Destination (Join-Path $nodeRoot 'node.exe') -Force
Copy-Item -LiteralPath (Join-Path $nodeExtractedDir 'LICENSE') -Destination (Join-Path $nodeRoot 'LICENSE') -Force
Remove-Item -LiteralPath $nodeExtractTemp -Recurse -Force

if (Test-Path -LiteralPath $runtimeRoot) {
    Remove-Item -LiteralPath $runtimeRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

# Merge-extract both .NET zips into the same folder; overlapping identical
# files (dotnet.exe, LICENSE.txt, etc.) are expected and fine.
Expand-Archive -LiteralPath $dotnetRuntimeZipPath -DestinationPath $runtimeRoot -Force
Expand-Archive -LiteralPath $windowsDesktopZipPath -DestinationPath $runtimeRoot -Force

# --- Signature verification ---------------------------------------------------

$nodeExePath = Join-Path $nodeRoot 'node.exe'
Assert-OpenJsSigned -Path $nodeExePath

$dotnetExePath = Join-Path $runtimeRoot 'dotnet.exe'
Assert-MicrosoftSigned -Path $dotnetExePath

$hostfxrDlls = @(Get-ChildItem -LiteralPath (Join-Path $runtimeRoot 'host\fxr') -Filter 'hostfxr.dll' -Recurse)
if ($hostfxrDlls.Count -eq 0) {
    throw "No hostfxr.dll found under $runtimeRoot\host\fxr"
}
foreach ($dll in $hostfxrDlls) {
    Assert-MicrosoftSigned -Path $dll.FullName
}

Write-Host "Staged Node $nodeVersion and .NET runtime $($versions.dotnetRuntime.version) under $downloadsRoot"

return $downloadsRoot
