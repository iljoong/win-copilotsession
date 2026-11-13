#requires -Version 7.0
<#
.SYNOPSIS
  Generates THIRD_PARTY_NOTICES.txt for a staged portable package.
.DESCRIPTION
  Combines the license texts of every third-party component bundled in the
  portable zip: the official Node.js runtime, the official .NET and
  Windows Desktop runtimes, the WebView2 SDK, and every npm production
  dependency (per `npm ls --omit=dev --all`). Throws if any component's
  license text cannot be found, so packaging aborts rather than ship
  without attribution.
.PARAMETER DestinationPath
  Full path of the THIRD_PARTY_NOTICES.txt file to write.
.PARAMETER DesktopRoot
  Path to the `desktop` folder (holds versions.json and downloads\).
.PARAMETER RepoRoot
  Repository root (holds node_modules and Shell.csproj for license lookup).
#>
param(
    [Parameter(Mandatory)] [string]$DestinationPath,
    [Parameter(Mandatory)] [string]$DesktopRoot,
    [Parameter(Mandatory)] [string]$RepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NpmProductionLicenses {
    param([Parameter(Mandatory)] [string]$RepoRoot)

    Push-Location $RepoRoot
    try {
        # `npm ls --json` output is multi-line; PowerShell captures external
        # command output as an array of lines, and piping that array straight
        # into ConvertFrom-Json parses each line separately instead of the
        # whole document, so join it back into one string first.
        $json = (npm ls --omit=dev --all --json 2>$null) -join "`n"
    }
    finally {
        Pop-Location
    }
    $tree = $json | ConvertFrom-Json

    # Preserve insertion order and de-duplicate by name@version (a package
    # can appear more than once in the tree, e.g. shared transitive deps).
    $packages = [ordered]@{}
    function Walk {
        param($deps)
        if (-not $deps) { return }
        foreach ($name in $deps.PSObject.Properties.Name) {
            $node = $deps.$name
            $version = $node.version
            if ($version -and -not $packages.Contains("$name@$version")) {
                $packages["$name@$version"] = $name
            }
            $childDeps = if ($null -ne $node.PSObject.Properties['dependencies']) { $node.dependencies } else { $null }
            Walk -deps $childDeps
        }
    }
    $rootDeps = if ($null -ne $tree.PSObject.Properties['dependencies']) { $tree.dependencies } else { $null }
    Walk -deps $rootDeps

    $results = @()
    foreach ($key in $packages.Keys) {
        $name = $packages[$key]
        $packageDir = Join-Path $RepoRoot "node_modules\$name"
        $licenseFile = Get-ChildItem -LiteralPath $packageDir -Filter 'LICENSE*' -File -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if (-not $licenseFile) {
            throw "No LICENSE file found for npm production dependency '$key' under $packageDir"
        }
        $results += [pscustomobject]@{
            Name = $key
            Text = (Get-Content -LiteralPath $licenseFile.FullName -Raw).TrimEnd()
        }
    }
    return $results
}

function Get-WebView2LicenseText {
    param([Parameter(Mandatory)] [string]$RepoRoot)

    $csprojPath = Join-Path $RepoRoot 'desktop\src\Shell\Shell.csproj'
    $match = Select-String -LiteralPath $csprojPath -Pattern 'Microsoft\.Web\.WebView2"\s+Version="([^"]+)"'
    if (-not $match) {
        throw "Could not find the Microsoft.Web.WebView2 package version in $csprojPath"
    }
    $version = $match.Matches[0].Groups[1].Value

    $packagesRoot = (dotnet nuget locals global-packages --list) -replace '^global-packages:\s*', ''
    $packagesRoot = $packagesRoot.Trim()
    $licensePath = Join-Path $packagesRoot "microsoft.web.webview2\$version\LICENSE.txt"
    if (-not (Test-Path -LiteralPath $licensePath)) {
        throw "WebView2 SDK license not found at $licensePath (expected NuGet package version $version)"
    }
    return (Get-Content -LiteralPath $licensePath -Raw).TrimEnd()
}

function New-Section {
    param(
        [Parameter(Mandatory)] [string]$Title,
        [Parameter(Mandatory)] [string]$Text
    )

    $rule = '=' * 80
    return "$rule`r`n$Title`r`n$rule`r`n$Text`r`n"
}

$versions = Get-Content -LiteralPath (Join-Path $DesktopRoot 'versions.json') -Raw | ConvertFrom-Json
$downloadsRoot = Join-Path $DesktopRoot 'downloads'

$nodeLicensePath = Join-Path $downloadsRoot 'node\LICENSE'
if (-not (Test-Path -LiteralPath $nodeLicensePath)) {
    throw "Node license not found at $nodeLicensePath; run fetch-runtimes.ps1 first."
}
$dotnetLicensePath = Join-Path $downloadsRoot 'runtime\LICENSE.txt'
$dotnetNoticesPath = Join-Path $downloadsRoot 'runtime\ThirdPartyNotices.txt'
foreach ($path in @($dotnetLicensePath, $dotnetNoticesPath)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw ".NET runtime license file not found at $path; run fetch-runtimes.ps1 first."
    }
}

$sections = @()
$sections += "THIRD-PARTY NOTICES`r`n" +
"This portable package bundles the unmodified, Microsoft/OpenJS-signed binaries " +
"and license texts listed below, plus the production npm packages used to build " +
"the bundled web client.`r`n"
$sections += New-Section -Title "Node.js $($versions.node.version) (OpenJS Foundation)" -Text (Get-Content -LiteralPath $nodeLicensePath -Raw).TrimEnd()
$sections += New-Section -Title ".NET Runtime $($versions.dotnetRuntime.version) (Microsoft Corporation) - LICENSE" -Text (Get-Content -LiteralPath $dotnetLicensePath -Raw).TrimEnd()
$sections += New-Section -Title ".NET Runtime $($versions.dotnetRuntime.version) (Microsoft Corporation) - Third-Party Notices" -Text (Get-Content -LiteralPath $dotnetNoticesPath -Raw).TrimEnd()
$sections += New-Section -Title "Microsoft Edge WebView2 SDK (Microsoft Corporation)" -Text (Get-WebView2LicenseText -RepoRoot $RepoRoot)

foreach ($license in Get-NpmProductionLicenses -RepoRoot $RepoRoot) {
    $sections += New-Section -Title $license.Name -Text $license.Text
}

$destinationDir = Split-Path -Parent $DestinationPath
New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
($sections -join "`r`n") | Set-Content -LiteralPath $DestinationPath -Encoding UTF8 -NoNewline

Write-Host "Wrote $DestinationPath"
