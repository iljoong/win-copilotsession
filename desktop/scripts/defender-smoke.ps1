#requires -Version 7.0
<#
.SYNOPSIS
  Runs the Release portable zip through its Defender-ASR entry point on this
  machine and checks startup, shutdown, console windows, and Defender events.
.DESCRIPTION
  Extracts the zip under "%TEMP%\cpsd-smoke\홍길동 Downloads\", stamps every
  file with Mark-of-the-Web, and launches
  "CopilotSessionDashboard (Defender ASR).cmd" through cmd.exe with a
  disposable LOCALAPPDATA and an empty synthetic COPILOT_HOME. It never runs
  the apphost CopilotSessionDashboard.exe.

  Checks, in order:
    1. shell.log gets a "backend ready port=" line within 60 seconds.
    2. CloseMainWindow() on the "Copilot Session Dashboard" window leaves no
       staged node.exe within 5 seconds.
    3. After a second launch, Stop-Process on the shell leaves no staged
       node.exe within 5 seconds.
    4. No Defender 1116/1117/1121/1122 events were logged during the run.
    5. No console window from the launcher cmd.exe or the dotnet.exe shell
       remained open.

  Also measures zip size, extracted size, cold start (launch to backend
  ready), and idle working set (shell + WebView2 + node). Prints a JSON
  result and exits 1 if any check fails. Temporary folders are removed on
  success; on failure they are kept for diagnosis, but no processes are left.
#>
param(
    [Parameter(Mandatory)] [string]$Zip,
    [int]$ReadyTimeoutSeconds = 60,
    [int]$ExitTimeoutSeconds = 5,
    [int]$IdleSeconds = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$windowTitle = 'Copilot Session Dashboard'
$launcherName = 'CopilotSessionDashboard (Defender ASR).cmd'
$defenderLog = 'Microsoft-Windows-Windows Defender/Operational'
$defenderIds = 1116, 1117, 1121, 1122

$zipPath = (Resolve-Path -LiteralPath $Zip).Path
$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) 'cpsd-smoke'
$extractDir = Join-Path $smokeRoot '홍길동 Downloads'
$localAppData = Join-Path $smokeRoot 'state'
$copilotHome = Join-Path $smokeRoot 'copilot-home'
$appDir = Join-Path $extractDir 'CopilotSessionDashboard'
$stagedPrefix = $appDir + '\'
$shellLog = Join-Path $localAppData 'CopilotSessionDashboard\desktop\logs\shell.log'

Add-Type -Namespace CpsdSmoke -Name Win32 -MemberDefinition @'
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool EnumWindows(EnumWindowsProc callback, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsWindowVisible(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint processId);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern int GetClassName(System.IntPtr hWnd, System.Text.StringBuilder name, int max);
'@

$checks = [ordered]@{}
$measurements = [ordered]@{}
$failures = [Collections.Generic.List[string]]::new()
$events = @()

function Add-Check([string]$Name, [bool]$Ok, [string]$Detail) {
    $checks[$Name] = [ordered]@{ ok = $Ok; detail = $Detail }
    if (-not $Ok) { $failures.Add("${Name}: $Detail") }
}

function Get-StagedProcess([string]$Name) {
    @(Get-CimInstance Win32_Process -Filter "Name='$Name'" |
            Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($stagedPrefix, [StringComparison]::OrdinalIgnoreCase) })
}

function Get-ProcessTree([int]$RootPid) {
    $all = @(Get-CimInstance Win32_Process)
    $ids = [Collections.Generic.List[int]]::new()
    $queue = [Collections.Generic.Queue[int]]::new()
    $queue.Enqueue($RootPid)
    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        $ids.Add($current)
        foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $current -and -not $ids.Contains([int]$_.ProcessId) }) {
            $queue.Enqueue([int]$child.ProcessId)
        }
    }
    @($all | Where-Object { $ids.Contains([int]$_.ProcessId) })
}

function Wait-Until([scriptblock]$Condition, [double]$TimeoutSeconds) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        if (& $Condition) { return $true }
        Start-Sleep -Milliseconds 100
    }
    [bool](& $Condition)
}

function Read-ShellLog {
    if (-not (Test-Path -LiteralPath $shellLog)) { return '' }
    try {
        $stream = [IO.File]::Open($shellLog, 'Open', 'Read', 'ReadWrite')
        try { ([IO.StreamReader]::new($stream)).ReadToEnd() } finally { $stream.Dispose() }
    }
    catch { '' }
}

function Get-ConsoleWindow([int[]]$Pids) {
    $found = [Collections.Generic.List[string]]::new()
    $callback = [CpsdSmoke.Win32+EnumWindowsProc] {
        param($hWnd, $lParam)
        $owner = [uint32]0
        [void][CpsdSmoke.Win32]::GetWindowThreadProcessId($hWnd, [ref]$owner)
        if ([CpsdSmoke.Win32]::IsWindowVisible($hWnd) -and $Pids -contains [int]$owner) {
            $class = [Text.StringBuilder]::new(256)
            [void][CpsdSmoke.Win32]::GetClassName($hWnd, $class, $class.Capacity)
            if ($class.ToString() -in 'ConsoleWindowClass', 'PseudoConsoleWindow', 'CASCADIA_HOSTING_WINDOW_CLASS') {
                $found.Add("pid=$owner class=$class")
            }
        }
        $true
    }
    [void][CpsdSmoke.Win32]::EnumWindows($callback, [IntPtr]::Zero)
    @($found)
}

function Stop-Staged {
    foreach ($name in 'dotnet.exe', 'node.exe', 'msedgewebview2.exe') {
        foreach ($p in Get-StagedProcess $name) {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    if ($script:shellPid) {
        foreach ($p in Get-ProcessTree $script:shellPid) {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Start-Launcher {
    $psi = [Diagnostics.ProcessStartInfo]::new($env:ComSpec)
    # cmd.exe strips the outer quote pair, leaving the quoted launcher path
    # (it contains spaces and parentheses).
    $psi.Arguments = "/d /c `"`"$(Join-Path $appDir $launcherName)`"`""
    $psi.UseShellExecute = $false
    $psi.WorkingDirectory = $appDir
    $psi.Environment['LOCALAPPDATA'] = $localAppData
    $psi.Environment['COPILOT_HOME'] = $copilotHome
    [Diagnostics.Process]::Start($psi)
}

function Wait-Shell([int]$ReadyCount) {
    # Returns the launched shell after the next "backend ready" log line.
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $cmd = Start-Launcher
    $ready = Wait-Until {
        ([regex]::Matches((Read-ShellLog), 'backend ready port=\d+')).Count -ge $ReadyCount
    } $ReadyTimeoutSeconds
    $readySeconds = $sw.Elapsed.TotalSeconds
    $shell = $null
    if ($ready) {
        [void](Wait-Until {
                $script:shellCandidate = Get-StagedProcess 'dotnet.exe' | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } |
                    Where-Object { $_.MainWindowTitle -eq $windowTitle } | Select-Object -First 1
                $null -ne $script:shellCandidate
            } 30)
        $shell = $script:shellCandidate
    }
    [pscustomobject]@{ Cmd = $cmd; Ready = $ready; ReadySeconds = $readySeconds; Shell = $shell }
}

$script:shellPid = $null
$runStart = Get-Date
try {
    if (Test-Path -LiteralPath $smokeRoot) {
        Remove-Item -LiteralPath $smokeRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $extractDir, $localAppData, (Join-Path $copilotHome 'session-state') -Force | Out-Null

    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir
    Add-MarkOfTheWeb -Root $extractDir
    if (-not (Test-Path -LiteralPath (Join-Path $appDir $launcherName))) {
        throw "Launcher not found in zip: $launcherName"
    }

    $measurements.zipBytes = (Get-Item -LiteralPath $zipPath).Length
    $measurements.extractedBytes = (Get-ChildItem -LiteralPath $appDir -File -Recurse | Measure-Object Length -Sum).Sum
    $measurements.extractedFiles = @(Get-ChildItem -LiteralPath $appDir -File -Recurse).Count

    # Run 1: launch, measure, close via the window.
    $run = Wait-Shell 1
    Add-Check 'run1BackendReady' $run.Ready ('{0:N1}s' -f $run.ReadySeconds)
    if (-not $run.Ready -or -not $run.Shell) { throw 'First launch never became ready.' }
    $script:shellPid = $run.Shell.Id
    $measurements.coldStartSeconds = [math]::Round($run.ReadySeconds, 2)

    Start-Sleep -Seconds $IdleSeconds
    $tree = @(Get-ProcessTree $script:shellPid)
    $memory = [ordered]@{}
    foreach ($p in $tree) {
        $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
        if ($proc) { $memory[$p.Name] = [long]$memory[$p.Name] + $proc.WorkingSet64 }
    }
    $measurements.idleSeconds = $IdleSeconds
    $measurements.idleWorkingSetBytes = $memory
    $measurements.idleWorkingSetTotalBytes = ($memory.Values | Measure-Object -Sum).Sum
    $measurements.processCounts = [ordered]@{}
    foreach ($group in $tree | Group-Object Name) { $measurements.processCounts[$group.Name] = $group.Count }

    $launcherConsole = $run.Cmd.WaitForExit(5000)
    $consoles = @(Get-ConsoleWindow @($run.Cmd.Id, $script:shellPid))
    # node.exe gets a windowless conhost of its own; only the launcher's or the shell's console matters.
    $conhosts = @($tree | Where-Object { $_.Name -in 'conhost.exe', 'OpenConsole.exe' -and $_.ParentProcessId -in $run.Cmd.Id, $script:shellPid })
    Add-Check 'noConsoleWindow' ($launcherConsole -and $consoles.Count -eq 0 -and $conhosts.Count -eq 0) `
        "launcherExited=$launcherConsole windows=[$($consoles -join '; ')] conhostChildren=$($conhosts.Count)"

    $webViewPids = @($tree | Where-Object Name -eq 'msedgewebview2.exe' | ForEach-Object { [int]$_.ProcessId })
    [void]$run.Shell.CloseMainWindow()
    $nodeGone = Wait-Until { @(Get-StagedProcess 'node.exe').Count -eq 0 } $ExitTimeoutSeconds
    Add-Check 'closeWindowStopsNode' $nodeGone "staged node.exe left: $(@(Get-StagedProcess 'node.exe').Count)"
    $shellGone = $run.Shell.WaitForExit(15000)
    Add-Check 'closeWindowExitsShell' $shellGone "shell pid $($script:shellPid)"
    if (-not $shellGone) { throw 'Shell did not exit after CloseMainWindow.' }
    [void](Wait-Until { $webViewPids.Count -eq 0 -or @(Get-Process -Id $webViewPids -ErrorAction SilentlyContinue).Count -eq 0 } 10)

    # Run 2: launch again, then kill the shell outright.
    $run2 = Wait-Shell 2
    Add-Check 'run2BackendReady' $run2.Ready ('{0:N1}s' -f $run2.ReadySeconds)
    if (-not $run2.Ready -or -not $run2.Shell) { throw 'Second launch never became ready.' }
    $script:shellPid = $run2.Shell.Id
    $measurements.warmStartSeconds = [math]::Round($run2.ReadySeconds, 2)
    [void]$run2.Cmd.WaitForExit(5000)
    $consoles2 = @(Get-ConsoleWindow @($run2.Cmd.Id, $script:shellPid))
    Add-Check 'noConsoleWindowRun2' ($run2.Cmd.HasExited -and $consoles2.Count -eq 0) `
        "launcherExited=$($run2.Cmd.HasExited) windows=[$($consoles2 -join '; ')]"

    $webViewPids = @(Get-ProcessTree $script:shellPid | Where-Object Name -eq 'msedgewebview2.exe' | ForEach-Object { [int]$_.ProcessId })
    Stop-Process -Id $script:shellPid
    $nodeGone2 = Wait-Until { @(Get-StagedProcess 'node.exe').Count -eq 0 } $ExitTimeoutSeconds
    Add-Check 'killShellStopsNode' $nodeGone2 "staged node.exe left: $(@(Get-StagedProcess 'node.exe').Count)"
    [void](Wait-Until { $webViewPids.Count -eq 0 -or @(Get-Process -Id $webViewPids -ErrorAction SilentlyContinue).Count -eq 0 } 10)
}
catch {
    $failures.Add("error: $($_.Exception.Message)")
}
finally {
    Stop-Staged
}

# Give Defender a moment to flush events from the run window.
Start-Sleep -Seconds 5
try {
    $events = @(Get-WinEvent -FilterHashtable @{ LogName = $defenderLog; Id = $defenderIds; StartTime = $runStart.AddSeconds(-1) } -ErrorAction Stop |
            ForEach-Object {
                $xml = [xml]$_.ToXml()
                $data = @{}
                foreach ($d in $xml.Event.EventData.Data) { $data[$d.Name] = $d.'#text' }
                [ordered]@{
                    time = $_.TimeCreated.ToString('o')
                    id = $_.Id
                    ruleId = $data['ID']
                    path = if ($data['Path']) { $data['Path'] } else { $data['Process Name'] }
                    threat = $data['Threat Name']
                }
            })
    Add-Check 'defenderEvents' ($events.Count -eq 0) "$($events.Count) event(s)"
}
catch {
    if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') {
        Add-Check 'defenderEvents' $true '0 event(s)'
    }
    else {
        Add-Check 'defenderEvents' $false "could not read ${defenderLog}: $($_.Exception.Message)"
    }
}

$ok = $failures.Count -eq 0
$logTail = Read-ShellLog
$result = [ordered]@{
    ok = $ok
    zip = $zipPath
    extractDir = $extractDir
    runStart = $runStart.ToString('o')
    runEnd = (Get-Date).ToString('o')
    checks = $checks
    measurements = $measurements
    defenderEvents = $events
    failures = @($failures)
}
if (-not $ok) {
    $result.shellLogTail = $logTail.Substring([math]::Max(0, $logTail.Length - 2000))
}

if ($ok) {
    $removed = Wait-Until {
        Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
        -not (Test-Path -LiteralPath $smokeRoot)
    } 15
    $result.cleanedUp = $removed
}
else {
    $result.keptForDiagnosis = $smokeRoot
}

$result | ConvertTo-Json -Depth 6
if (-not $ok) { exit 1 }
