#requires -Version 7.0
<#
.SYNOPSIS
  Shared helpers for desktop runtime fetch/staging scripts.
.DESCRIPTION
  Dot-sourced by other scripts (e.g. fetch-runtimes.ps1). Provides:
    - Invoke-Checked: run an external command, throw on non-zero exit code.
    - Assert-MicrosoftSigned / Assert-OpenJsSigned: validate Authenticode
      signatures on bundled third-party binaries before they are trusted.
    - Add-MarkOfTheWeb: stamp a Zone.Identifier ADS (zone 3, internet) onto
      every file under a staged folder, used by later packaging tasks.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    <#
    .SYNOPSIS
      Runs an external executable and throws if it exits with a non-zero code.
    #>
    param(
        [Parameter(Mandatory)] [string]$Exe,
        # Named "Arguments", not "Args": PowerShell reserves $args as the
        # automatic variable for unbound positional arguments, and a
        # parameter named Args does not reliably bind when splatted by
        # callers (e.g. `-Args @('run','build')` silently leaves this empty).
        [Parameter()] [string[]]$Arguments = @()
    )

    & $Exe @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "Command failed (exit code $code): $Exe $($Arguments -join ' ')"
    }
}

function Assert-MicrosoftSigned {
    <#
    .SYNOPSIS
      Throws unless $Path has a valid Authenticode signature from Microsoft.
    #>
    param(
        [Parameter(Mandatory)] [string]$Path
    )

    Assert-SignedBy -Path $Path -SubjectContains 'O=Microsoft Corporation'
}

function Assert-OpenJsSigned {
    <#
    .SYNOPSIS
      Throws unless $Path has a valid Authenticode signature from the OpenJS
      Foundation (the signer used for official node.exe builds).
    #>
    param(
        [Parameter(Mandatory)] [string]$Path
    )

    Assert-SignedBy -Path $Path -SubjectContains 'OpenJS Foundation'
}

function Assert-SignedBy {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$SubjectContains
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Cannot verify signature: file not found: $Path"
    }

    $sig = Get-AuthenticodeSignature -LiteralPath $Path
    if ($sig.Status -ne 'Valid') {
        throw "Authenticode signature invalid for '$Path': status=$($sig.Status) ($($sig.StatusMessage))"
    }

    $subject = $sig.SignerCertificate.Subject
    if ($subject -notlike "*$SubjectContains*") {
        throw "Unexpected signer for '$Path': expected subject to contain '$SubjectContains', got '$subject'"
    }
}

function Add-MarkOfTheWeb {
    <#
    .SYNOPSIS
      Writes a Zone.Identifier alternate data stream (zone 3 / internet) onto
      every file under $Root, recursively.
    .DESCRIPTION
      Used by later packaging tasks to mark staged files as having originated
      from the internet, matching what Windows would do had the files been
      downloaded directly by the user. No caller in this task; included here
      because fetch-runtimes.ps1 depends on common.ps1.
    #>
    param(
        [Parameter(Mandatory)] [string]$Root
    )

    if (-not (Test-Path -LiteralPath $Root)) {
        throw "Add-MarkOfTheWeb: path not found: $Root"
    }

    $zoneContent = "[ZoneTransfer]`r`nZoneId=3`r`n"

    Get-ChildItem -LiteralPath $Root -File -Recurse | ForEach-Object {
        Set-Content -LiteralPath $_.FullName -Stream 'Zone.Identifier' -Value $zoneContent -Encoding ASCII
    }
}
