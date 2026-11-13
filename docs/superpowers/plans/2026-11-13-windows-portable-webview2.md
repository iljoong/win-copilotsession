# 포터블 Windows 앱 (WebView2 셸 + Node 사이드카) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 Node 대시보드를 수정 없이 사이드카로 실행하는 WPF WebView2 셸을 만들고, zip을
풀어 바로 실행하는 포터블 패키지(일반 PC용 exe + ASR PC용 `.cmd`)로 배포한다.

**Architecture:** 백엔드는 수명주기 함수와 데스크톱 모드(stdout 준비 줄, stdin 종료
연결)만 추가한다. 셸은 IL 전용 framework-dependent WPF 앱이고, 동봉 공식 .NET 런타임
(`runtime\`)과 공식 `node.exe`(`node\`)를 사용한다. 패키징 스크립트는 제3자 바이너리를
원본 그대로 검증해 스테이징하고 zip을 만든다.

**Tech Stack:** Node 24 LTS(고정), TypeScript/Vitest, .NET 10 WPF, Microsoft.Web.WebView2,
xUnit, PowerShell 7 패키징 스크립트, Playwright(CDP).

**Spec:** [docs/superpowers/specs/2026-11-13-windows-portable-webview2-design.md](../specs/2026-11-13-windows-portable-webview2-design.md)
(배경: [리서치](../../research/2026-11-13-portable-webview2-defender-research.md))

## Global Constraints

- 브랜치: `feature/windows-portable-webview2`. 커밋은 각 태스크 끝에서 한다.
- 우리가 빌드하는 PE는 `CopilotSessionDashboard.exe`(apphost)와 `CopilotSessionDashboard.dll`(IL 전용)뿐이다. `PublishReadyToRun=false`, `PublishTrimmed=false`, `PublishSingleFile=false`, `SelfContained=false`, 네이티브 프로젝트 없음.
- apphost: `AppHostDotNetSearch=AppRelative`, `AppHostRelativeDotNet=runtime`.
- `node.exe`, `dotnet.exe`, `runtime\**`, `Microsoft.Web.WebView2.*.dll`, `WebView2Loader.dll`은 원본 파일 그대로 둔다(해시·Authenticode 검증).
- 실행 중 실행 파일 생성/다운로드/임시 추출 금지. 런처에 PowerShell/VBS/JS/HTA/`-EncodedCommand` 금지. Run 키·예약 작업·서비스·관리자 권한 금지.
- 셸 → `node.exe` 하나만 자식으로 실행. 네트워크는 `127.0.0.1`만.
- 데이터: `%LOCALAPPDATA%\CopilotSessionDashboard\dashboard-data`(백엔드 소유, 셸은 쓰지 않음). 셸 상태: `%LOCALAPPDATA%\CopilotSessionDashboard\desktop\WebView2`, `...\desktop\logs\shell.log`(1MB × 3 회전). 압축 해제 폴더에는 쓰지 않는다.
- 창 제목 `Copilot Session Dashboard`. 창 닫기 = 종료. 트레이/자동 시작 없음.
- 준비 타임아웃 30초, 종료 유예 5초.
- 대상: Windows 11 x64, Windows 10 22H2 x64. WebView2 Evergreen은 앱이 설치하지 않는다.
- 토큰, 쿠키, 쿼리 문자열이 있는 URL, 프롬프트는 로그·명령줄·창 제목·오류 화면에 쓰지 않는다.
- 테스트는 합성 데이터와 일회용 폴더만 쓴다. 이 VM에서 exe 진입점을 일부러 실행하지 않는다.
- 생성물(`desktop\**\bin`, `obj`, `desktop\artifacts`, `desktop\downloads`)은 git에서 제외한다.

## Review Focus

1. **공백·한글이 들어간 압축 해제 경로**(예: `C:\Users\홍길동\Downloads\Copilot Dashboard\`)에서 `.cmd`와 exe 모두 동작해야 한다 → Task 9 스모크가 이 경로를 쓴다.
2. **Node가 준비 전에 종료**(데이터 폴더 소유권 오류 등)하면 stderr 이유가 오류 화면에 나오고 빈 창이 아니어야 한다 → Task 5 `ExitedBeforeReady` 테스트.
3. **사용자 환경에 `NODE_OPTIONS=--require=…`가 설정**되어 있어도 사이드카에 전달되지 않아야 한다 → Task 4 `ChildEnvironment` 테스트, Task 5 통합 테스트.
4. **stdout 준비 줄이 여러 조각으로 오거나 앞에 다른 줄이 섞이면** 엄격하게 거부하거나 정확히 조립해야 한다 → Task 4 `ReadyLine` 테스트, Task 5 조각 전송 테스트.
5. **시작 중에 두 번째 실행**이 들어오면 두 번째 백엔드가 생기지 않아야 한다 → Task 6 단일 인스턴스 테스트.

---

### Task 1: 제3자 런타임 고정과 검증된 다운로드

**Files:**

- Create: `desktop\versions.json`, `desktop\scripts\fetch-runtimes.ps1`, `desktop\scripts\common.ps1`
- Modify: `.gitignore`(`desktop/downloads/`, `desktop/artifacts/`, `desktop/**/bin/`, `desktop/**/obj/`), `.prettierignore`(`desktop/artifacts`, `desktop/downloads`)

**Interfaces:**

- Produces: `desktop\versions.json` 스키마 `{ "node": { "version": "24.x.y", "zip": "node-v24.x.y-win-x64.zip", "sha256": "…" }, "dotnetRuntime": { "version": "10.0.z", "url": "…", "sha512": "…" }, "windowsDesktopRuntime": { "version": "10.0.z", "url": "…", "sha512": "…" } }`.
- Produces: `fetch-runtimes.ps1` → `desktop\downloads\node\node.exe`, `desktop\downloads\node\LICENSE`, `desktop\downloads\runtime\`(두 zip을 같은 폴더에 병합 해제). 반환: 스테이징 루트 경로.
- Produces: `common.ps1`의 `Assert-MicrosoftSigned([string]$Path)`, `Assert-OpenJsSigned([string]$Path)`, `Invoke-Checked([string]$Exe, [string[]]$Args)`, `Add-MarkOfTheWeb([string]$Root)`.

- [ ] **Step 1:** 현재 최신 Node 24 LTS 패치와 .NET 10 런타임 패치를 공식 페이지(nodejs.org `SHASUMS256.txt`, dotnet `releases.json`)에서 확인해 `versions.json`에 버전·URL·해시를 기록한다.
- [ ] **Step 2:** `fetch-runtimes.ps1` 작성: 다운로드 → 해시 불일치 시 throw → 해제 → `node.exe`는 `Assert-OpenJsSigned`, `runtime\dotnet.exe`와 `runtime\host\fxr\*\hostfxr.dll`은 `Assert-MicrosoftSigned`. 이미 받은 파일은 해시가 맞으면 재사용.
- [ ] **Step 3:** 실행 검증. Run: `pwsh -NoProfile -File desktop\scripts\fetch-runtimes.ps1` 후 `desktop\downloads\node\node.exe -v`와 `desktop\downloads\runtime\dotnet.exe --list-runtimes`. Expected: 고정 버전 출력, `Microsoft.NETCore.App`과 `Microsoft.WindowsDesktop.App` 표시.
- [ ] **Step 4:** 해시 변조 검증: `versions.json`의 node sha256 한 글자를 임시로 바꿔 실행 → `Hash mismatch` 오류로 실패하는지 확인 후 되돌린다.
- [ ] **Step 5:** Commit `build(desktop): pin and verify bundled Node and .NET runtimes`.

### Task 2: Defender go/no-go (중단 게이트)

**Files:**

- Modify: `docs\research\2026-11-13-portable-webview2-defender-research.md`(4절에 실험 9 결과 추가)
- 일회용 프로브는 `%TEMP%`에만 만들고 커밋하지 않는다.

**Interfaces:**

- Consumes: Task 1 `desktop\downloads\node`, `desktop\downloads\runtime`, `common.ps1`의 `Add-MarkOfTheWeb`.

- [ ] **Step 1:** `npm run build`.
- [ ] **Step 2:** `%TEMP%\cpsd-gate\공백 경로\`에 스테이징: `runtime\`(Task 1 원본), `node\node.exe`, `app\package.json`(`{"type":"module"}`), `app\dist\{server,shared,client}`.
- [ ] **Step 3:** 일회용 WPF + WebView2 프로브(IL 전용, framework-dependent)를 스테이징 루트에 publish. 프로브는 `node\node.exe app\dist\server\main.js --no-open --port 0`를 숨김 창으로 실행하고, stdout `Dashboard: ` 줄의 URL로 이동한 뒤 `NavigationCompleted` 성공 시 `%LOCALAPPDATA%\gate-result.txt`에 `ok`를 쓰고 Node stdin을 닫고 Node를 종료한 뒤 끝낸다. 콘솔 해제(`FreeConsole`)를 포함한다.
- [ ] **Step 4:** `.cmd` 작성(`@start "" /min "%~dp0runtime\dotnet.exe" "%~dp0Probe.dll"`), `Add-MarkOfTheWeb` 적용.
- [ ] **Step 5:** 일회용 `LOCALAPPDATA`/`COPILOT_HOME`(빈 임시 폴더)을 환경에 넣고 `cmd.exe /c "<경로>\Probe.cmd"`로 실행, 60초 대기. Expected: `gate-result.txt` = `ok`, `whoami`/`icacls`/`powershell` 권한 검사가 수행됨(데이터 폴더 ACL 확인), 잔여 `node.exe` 없음.
- [ ] **Step 6:** 시작 시각 이후 Defender 이벤트 조회: `Get-WinEvent -LogName 'Microsoft-Windows-Windows Defender/Operational' | ? { $_.TimeCreated -gt $start -and $_.Id -in 1116,1117,1121,1122 }`. Expected: 0건.
- [ ] **Step 7:** **게이트.** 1건이라도 있으면 이벤트 요약을 리서치 문서에 기록하고 **작업을 멈추고 사용자에게 보고**한다. 0건이면 결과(버전, 경로, 이벤트 0건)를 실험 9로 기록하고 `%TEMP%\cpsd-gate`를 삭제한다.
- [ ] **Step 8:** Commit `docs(research): record Defender go/no-go result for portable layout`.

### Task 3: 백엔드 수명주기와 데스크톱 모드

**Files:**

- Create: `src\server\lifecycle.ts`, `src\server\desktop.ts`
- Modify: `src\server\main.ts`
- Test: `tests\lifecycle.test.ts`, `tests\desktop-cli.test.ts`

**Interfaces:**

- Produces (`lifecycle.ts`):
  - `export interface DashboardOptions { dataDir?: string; port: number; dev: boolean }`
  - `export interface RunningDashboard { url: string; port: number; token: string; dataDirectory: string; stop(): Promise<void> }` — `url`은 `http://127.0.0.1:<port>/?token=<token>`. `stop()`은 멱등이며 현재 `shutdown()` 순서(ingestion 정지 → events 닫기 → watcher 닫기 → 연결 종료 → server close → store close)를 따른다.
  - `export async function startDashboard(options: DashboardOptions): Promise<RunningDashboard>` — 리슨 후 `ingestion.start()`. 브라우저 열기와 콘솔 출력은 하지 않는다.
- Produces (`desktop.ts`):
  - `export function formatReadyLine(ready: { port: number; token: string }): string` → 정확히 `{"event":"ready","port":<n>,"token":"<64 hex>"}` + `\n`.
  - `export function attachStdinLifeline(input: NodeJS.ReadableStream, stop: () => Promise<void>, exit: (code: number) => void): void` — `end`/`close` 중 첫 이벤트에서 한 번만 `await stop()` 후 `exit(0)`. stop 실패 시 stderr에 메시지, `exit(1)`.
- Produces (`main.ts` CLI): `--desktop` 플래그. `--desktop`이 `--no-open` 없이 오면 `Error('--desktop requires --no-open')`. 데스크톱 모드는 stdout에 준비 줄만 쓰고 `Dashboard:`/`Data:` 줄과 `storage.warning`은 stderr로 보낸다. 비데스크톱 모드 출력은 그대로.

- [ ] **Step 1: 실패 테스트 작성** `tests\lifecycle.test.ts`:
  - `startDashboard serves health and stops idempotently`: 임시 `dataDir`, `port: 0` → `fetch(url)`가 303 + `set-cookie`, 쿠키로 `/api/health` → `{ ok: true }`; `await stop(); await stop();` 오류 없음; 이후 연결 거부.
  - `startDashboard url carries a 64-hex token on 127.0.0.1`: `url`이 `/^http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]{64}$/`와 일치, `token`과 `port`가 URL과 일치.
  - `formatReadyLine emits one JSON line`: `formatReadyLine({port: 5, token: 'a'.repeat(64)})` === `'{"event":"ready","port":5,"token":"' + 'a'.repeat(64) + '"}\n'`.
  - `attachStdinLifeline stops once then exits 0`: `PassThrough`에 `end()`와 `emit('close')` 둘 다 → `stop` 호출 1회, `exit`가 `0`으로 1회.
  - `attachStdinLifeline exits 1 when stop fails`.
- [ ] **Step 2:** Run: `npx vitest run tests/lifecycle.test.ts`. Expected: FAIL(모듈 없음).
- [ ] **Step 3:** `lifecycle.ts`, `desktop.ts` 구현. `main.ts`의 최상위 로직을 `startDashboard` 호출로 교체하고, 기존 CLI 동작(출력 두 줄, `rundll32` 열기, `SIGINT`/`SIGTERM` → `stop()`)을 유지한다.
- [ ] **Step 4:** Run: `npx vitest run tests/lifecycle.test.ts`. Expected: PASS.
- [ ] **Step 5: 실패 테스트 작성** `tests\desktop-cli.test.ts`(자식 프로세스: `process.execPath`, `['--import', 'tsx', 'src/server/main.ts', ...]`, 일회용 `--data-dir`):
  - `desktop mode prints exactly one ready line on stdout`: stdout 전체가 `formatReadyLine` 정규식과 일치하는 한 줄, `Dashboard:` 문자열 없음, stderr에 토큰 없음.
  - `closing stdin shuts down with exit code 0 within 5 seconds`.
  - `--desktop without --no-open fails` → 0이 아닌 종료 코드, stderr에 `--desktop requires --no-open`.
  - `default mode still prints Dashboard and Data lines` (`--no-open`만).
- [ ] **Step 6:** Run: `npx vitest run tests/desktop-cli.test.ts`. Expected: 위 테스트가 PASS(Step 3 이후 미구현 분기만 실패하면 해당 분기 구현 후 재실행).
- [ ] **Step 7:** Run: `npm test; npm run typecheck; npm run lint`. Expected: 모두 통과.
- [ ] **Step 8:** Commit `feat(server): extract lifecycle and add desktop sidecar mode`.

### Task 4: 셸 솔루션과 순수 로직

**Files:**

- Create: `desktop\CopilotSessionDashboard.Desktop.sln`, `desktop\Directory.Build.props`(`Nullable=enable`, `TreatWarningsAsErrors=true`, `LangVersion=latest`), `desktop\src\Shell\Shell.csproj`, `desktop\src\Shell\ReadyLine.cs`, `NavigationPolicy.cs`, `ChildEnvironment.cs`, `LogRedactor.cs`, `AppPaths.cs`
- Test: `desktop\tests\Shell.Tests\Shell.Tests.csproj`, `ReadyLineTests.cs`, `NavigationPolicyTests.cs`, `ChildEnvironmentTests.cs`, `LogRedactorTests.cs`, `AppPathsTests.cs`
- Modify: `package.json`(`"desktop:test": "dotnet test desktop/CopilotSessionDashboard.Desktop.sln"`)

**Interfaces:**

- `Shell.csproj`: `OutputType=WinExe`, `TargetFramework=net10.0-windows`, `UseWPF=true`, `RuntimeIdentifier=win-x64`, `AssemblyName=CopilotSessionDashboard`, `SelfContained=false`, `PublishReadyToRun=false`, `AppHostDotNetSearch=AppRelative`, `AppHostRelativeDotNet=runtime`, `PackageReference Microsoft.Web.WebView2`(고정 최신 안정판). `Configuration=Testing`이면 `DefineConstants` += `TESTING`.
- `public sealed record ReadySignal(int Port, string Token);`
- `public static class ReadyLine { public static bool TryParse(string line, [NotNullWhen(true)] out ReadySignal? signal); }` — 정확히 키 3개(`event`=`"ready"`, `port` 1..65535 정수, `token` 64자 소문자 hex), 추가 키·공백 줄·배열 거부.
- `public static class NavigationPolicy { public static bool IsAllowed(Uri uri, int port); }` — `http`, 호스트 `127.0.0.1`, 정확한 포트만.
- `public static class ChildEnvironment { public static IReadOnlyDictionary<string, string> Build(IReadOnlyDictionary<string, string?> parent); }` — `NODE_`로 시작하는 모든 키 제거(대소문자 무시), null 값 제거, 나머지 보존.
- `public static class LogRedactor { public static string Redact(string text); }` — 64자 hex 연속 문자열을 `[redacted]`로, `token=<값>`을 `token=[redacted]`로, `http(s)://…?…`의 쿼리를 `?[redacted]`로.
- `public sealed record AppPaths(string AppDir, string NodeExe, string ServerMain, string AppWorkDir, string StateDir, string WebViewDir, string LogDir);` + `public static AppPaths? Resolve(string appDir, string? localAppData);` — `localAppData`가 비었거나 상대 경로면 `null`. `StateDir` = `<LOCALAPPDATA>\CopilotSessionDashboard\desktop`. `NodeExe` = `<appDir>\node\node.exe`, `ServerMain` = `<appDir>\app\dist\server\main.js`, `AppWorkDir` = `<appDir>\app`.

- [ ] **Step 1: 실패 테스트 작성**(xUnit, `[Theory]` 위주):
  - `ReadyLine`: 정상 줄 → `Port`/`Token` 일치; 거부 사례 `""`, `"Dashboard: http://…"`, 포트 `0`/`70000`/`"5"`, 토큰 63자/대문자, 추가 키 `"x":1`, `event` 누락, 잘린 JSON.
  - `NavigationPolicy`: 허용 `http://127.0.0.1:5000/`, `http://127.0.0.1:5000/api/x?y=1`; 거부 `https://127.0.0.1:5000/`, `http://localhost:5000/`, `http://127.0.0.1:5001/`, `file:///C:/`, `about:blank`, `http://127.0.0.1.evil.test:5000/`.
  - `ChildEnvironment`: `NODE_OPTIONS`, `node_path`, `NODE_INSPECT_RESUME_ON_START`, `NODE_REPL_EXTERNAL_MODULE` 제거; `PATH`, `SystemRoot`, `LOCALAPPDATA`, `USERPROFILE`, `COPILOT_HOME` 보존.
  - `LogRedactor`: 64-hex, `token=abc`, `http://127.0.0.1:5/?token=…` 모두 원문이 출력에 없음; 일반 문장 변경 없음.
  - `AppPaths`: `localAppData` `null`/`""`/`"rel\\path"` → `null`; 공백·한글 `appDir`(`C:\\사용자\\Copilot Dashboard`) 경로 조합 정확.
- [ ] **Step 2:** Run: `npm run desktop:test`. Expected: 컴파일 실패 또는 FAIL.
- [ ] **Step 3:** 다섯 타입 구현(JSON은 `System.Text.Json` `Utf8JsonReader`/`JsonDocument`).
- [ ] **Step 4:** Run: `npm run desktop:test` 및 `dotnet format desktop\CopilotSessionDashboard.Desktop.sln --verify-no-changes`. Expected: PASS, 변경 없음.
- [ ] **Step 5:** Commit `feat(desktop): add shell project with startup policy primitives`.

### Task 5: 백엔드 감독(job object, 준비 대기, 종료)

**Files:**

- Create: `desktop\src\Shell\JobObject.cs`, `BackendSupervisor.cs`, `StartupFailure.cs`, `SafeLog.cs`
- Test: `desktop\tests\Shell.Tests\BackendSupervisorTests.cs`, `desktop\tests\Shell.Tests\fixtures\fake-backend.mjs`

**Interfaces:**

- Consumes: Task 4 `ReadyLine`, `ChildEnvironment`, `LogRedactor`, `AppPaths`.
- `public enum StartupFailureReason { NodeMissing, LocalAppDataMissing, WebView2Missing, ExitedBeforeReady, ReadyTimeout, InvalidReadyLine }`
- `public sealed class StartupFailure(StartupFailureReason reason, string detail) : Exception` — `detail`은 `LogRedactor.Redact`를 거친 stderr 마지막 20줄 이하.
- `public sealed class JobObject : IDisposable { public JobObject(); public void Assign(Process process); }` — `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, P/Invoke(`CreateJobObjectW`, `SetInformationJobObject`, `AssignProcessToJobObject`).
- `public sealed record BackendLaunch(string NodeExe, IReadOnlyList<string> Arguments, string WorkingDirectory, IReadOnlyDictionary<string, string> Environment);`
- `public static BackendLaunch BackendLaunch.ForApp(AppPaths paths, IReadOnlyDictionary<string, string?> parentEnv)` → 인수 `[paths.ServerMain, "--desktop", "--no-open", "--port", "0"]`(TESTING이면 `--data-dir` 추가 오버로드).
- `public static Task<BackendSession> BackendSupervisor.StartAsync(BackendLaunch launch, TimeSpan readyTimeout, SafeLog log, CancellationToken ct)`
- `public sealed class BackendSession : IAsyncDisposable { public ReadySignal Ready { get; } public Task<int> Exited { get; } public Task StopAsync(TimeSpan grace); }` — `StopAsync`: stdin 닫기 → `grace` 대기 → job 닫기.
- `public sealed class SafeLog { public SafeLog(string logDir); public void Write(string message); }` — 모든 메시지 `LogRedactor.Redact`, `shell.log` 1MB 초과 시 `.1`→`.2`→`.3` 회전.

- [ ] **Step 1: 실패 테스트 작성** — `fake-backend.mjs`는 `process.argv`의 모드에 따라 동작: `ready`(준비 줄 출력 후 stdin 종료 시 exit 0), `chunked`(준비 줄을 3조각으로 10ms 간격 출력), `noise`(먼저 `hello\n` 출력), `exit-early`(stderr `ownership marker missing` 후 exit 3), `silent`(아무것도 안 함), `env`(stderr에 `process.env.NODE_OPTIONS ?? 'unset'` 출력 후 준비). 테스트는 dev `node`로 실행:
  - `ready line resolves session and stop exits within grace` → `Ready.Port` 일치, `StopAsync(5s)` 후 `Exited` = 0.
  - `chunked ready line is assembled`.
  - `noise before ready fails with InvalidReadyLine`.
  - `early exit fails with ExitedBeforeReady and redacted stderr detail` → `detail`에 `ownership marker missing` 포함.
  - `silent backend fails with ReadyTimeout` (타임아웃 1초).
  - `NODE_OPTIONS from parent is not inherited` → 부모 env에 `NODE_OPTIONS=--require=x`를 줘도 stderr `unset`.
  - `disposing the job kills a backend that ignores stdin` (`silent` 모드 + `JobObject.Dispose()` 후 프로세스 종료 확인).
  - `missing node exe fails with NodeMissing` (존재하지 않는 `NodeExe` 경로).
  - `SafeLog rotates at 1 MB and never writes the token`.
- [ ] **Step 2:** Run: `npm run desktop:test`. Expected: FAIL.
- [ ] **Step 3:** 구현. 시작 전 `NodeExe`가 없으면 `NodeMissing`. stdout은 줄 단위로 읽어 첫 줄만 `ReadyLine.TryParse`; 이후 stdout은 버린다. 준비되면 `SafeLog`에 정확히 `backend ready port=<n>`을 쓴다(Task 9 스모크가 이 줄을 기다린다). stderr는 `SafeLog`로 스트리밍하면서 마지막 20줄을 보관. 프로세스는 `CreateNoWindow=true`, `UseShellExecute=false`, 시작 직후 `JobObject.Assign`.
- [ ] **Step 4:** Run: `npm run desktop:test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(desktop): supervise Node sidecar with job object and ready handshake`.

### Task 6: WPF 창, WebView2 정책, 단일 인스턴스, 오류 화면

**Files:**

- Create: `desktop\src\Shell\App.xaml(.cs)`, `MainWindow.xaml(.cs)`, `DashboardWebView.cs`, `SingleInstance.cs`, `ConsoleDetach.cs`, `TestingOptions.cs`(`#if TESTING`)
- Test: `desktop\tests\Shell.Tests\SingleInstanceTests.cs`

**Interfaces:**

- Consumes: Task 4·5 전체.
- `public sealed class SingleInstance : IDisposable { public static SingleInstance? TryAcquire(string name); public static void SignalExisting(string name); public event Action? ActivationRequested; }` — 이름 `Local\CopilotSessionDashboard.Desktop.<사용자 SID>`. 활성화 신호는 같은 이름 접미사 `.activate`의 `EventWaitHandle`.
- `public static class ConsoleDetach { public static void IfHostedByDotnet(); }` — `GetConsoleWindow() != 0`이면 `FreeConsole()`.
- `public static class DashboardWebView { public static Task<CoreWebView2Environment> CreateEnvironmentAsync(string webViewDir); public static void ApplyPolicy(CoreWebView2 core, int port, bool isTesting); }` — 스펙의 설정값과 이벤트 처리(Navigation/NewWindow/Download/Permission/ProcessFailed). 컨트롤러 옵션 `IsInPrivateModeEnabled=true`.
- `#if TESTING`: `TestingOptions.FromArgs(string[] args)` → `--data-dir <path>`, `--remote-debugging-port <port>`(환경 변수 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`가 아닌 `CoreWebView2EnvironmentOptions.AdditionalBrowserArguments`로 루프백만).

- [ ] **Step 1: 실패 테스트 작성** `SingleInstanceTests`:
  - `second acquire returns null while first is held`.
  - `SignalExisting raises ActivationRequested on holder` (5초 내).
  - `acquire succeeds after holder disposes`.
- [ ] **Step 2:** Run: `npm run desktop:test`. Expected: FAIL.
- [ ] **Step 3:** `SingleInstance`, `ConsoleDetach` 구현 후 테스트 PASS 확인.
- [ ] **Step 4:** `App`/`MainWindow` 구현. 순서: 단일 인스턴스 → `ConsoleDetach` → "시작 중" 표시 → `AppPaths.Resolve`(null → `LocalAppDataMissing`) → `CoreWebView2Environment.GetAvailableBrowserVersionString()` 실패 → `WebView2Missing`(안내 `https://developer.microsoft.com/microsoft-edge/webview2/`) → `BackendSupervisor.StartAsync`(30초) → 환경 생성·정책 적용 → `url` 이동. 오류 화면: 이유 문장, 로그 폴더 경로, 재시도 버튼(새 백엔드). `Exited`가 먼저 끝나면 오류 화면. `Closing`에서 창 숨김 → `StopAsync(5s)` → 종료. `SessionEnding`도 같은 경로. `ProcessFailed`는 1회 `Reload`, 반복 시 오류 화면.
- [ ] **Step 5:** 수동 확인(dev): `npm run build` 후 `dotnet run --project desktop\src\Shell -c Testing -- --data-dir %TEMP%\cpsd-dev`로 앱 레이아웃 경로가 없을 때 `NodeMissing` 오류 화면이 뜨는지 확인. (전체 동작은 Task 7 스테이징 후 Task 8 e2e에서 검증.)
- [ ] **Step 6:** Run: `npm run desktop:test` 및 `dotnet build desktop\CopilotSessionDashboard.Desktop.sln -c Release`. Expected: PASS, 경고 0.
- [ ] **Step 7:** Commit `feat(desktop): WPF WebView2 window with locked-down policy and single instance`.

### Task 7: 포터블 패키징

**Files:**

- Create: `desktop\scripts\package.ps1`, `desktop\scripts\backend-smoke.mjs`, `desktop\packaging\launcher.cmd.template`, `desktop\packaging\README-FIRST.txt`, `desktop\scripts\notices.ps1`
- Test: `desktop\tests\packaging.tests.ps1`
- Modify: `package.json`(`"desktop:package": "pwsh -NoProfile -File desktop/scripts/package.ps1"`)

**Interfaces:**

- Consumes: Task 1 다운로드, Task 3 데스크톱 모드, Task 4–6 셸.
- `package.ps1 -Flavor Release|Testing [-SignTool <path> -CertificateThumbprint <sha1>]` → 스테이징 `desktop\artifacts\<Flavor>\CopilotSessionDashboard\`, Release일 때만 `desktop\artifacts\CopilotSessionDashboard-<package.json version>-win-x64.zip`.
- `.cmd` 이름: `CopilotSessionDashboard (Defender ASR).cmd`, 내용:

```bat
@start "" /min "%~dp0runtime\dotnet.exe" "%~dp0CopilotSessionDashboard.dll"
```

- `backend-smoke.mjs <stagedRoot>`: 일회용 `--data-dir`로 스테이징 `node\node.exe app\dist\server\main.js --desktop --no-open --port 0` 실행 → 준비 줄 파싱 → `url`로 쿠키 획득 → `/api/sessions?query=smoke` 200 → stdin 닫기 → 종료 코드 0, 5초 내 종료, 데이터 폴더에 `sessions.db`와 `-wal` 생성 확인.

- [ ] **Step 1: 실패 테스트 작성** `packaging.tests.ps1`(스크립트형 단언, 실패 시 `exit 1`), 대상은 `desktop\artifacts\Release\CopilotSessionDashboard\`:
  - 필수 파일 존재: exe, dll, `.cmd`, `runtime\dotnet.exe`, `node\node.exe`, `app\package.json`, `app\dist\server\main.js`, `app\dist\client\index.html`, `README-FIRST.txt`, `THIRD_PARTY_NOTICES.txt`.
  - 금지: `node_modules`, `*.pdb`. Release dll에 Testing 전용 문자열 `--remote-debugging-port`가 없음(`[IO.File]::ReadAllText`로 검색).
  - 셸 dll이 IL 전용: `System.Reflection.PortableExecutable.PEReader`로 `CorHeader.Flags`에 `ILOnly` 있고 ReadyToRun 헤더(`ManagedNativeHeaderDirectory.Size == 0`) 없음.
  - `node.exe`, `runtime\**\*.exe|*.dll`의 SHA-256이 `desktop\downloads`의 원본과 같고 Authenticode `Valid`.
  - exe의 apphost가 `runtime` 상대 경로를 쓰는지: `runtime` 폴더 없이 복사한 exe 실행이 아니라, 정적 검사로 `CopilotSessionDashboard.runtimeconfig.json` 존재와 `Microsoft.WindowsDesktop.App` 프레임워크 참조 확인(이 VM에서 exe는 실행하지 않는다).
- [ ] **Step 2:** Run: `pwsh -File desktop\tests\packaging.tests.ps1`. Expected: FAIL(아티팩트 없음).
- [ ] **Step 3:** `package.ps1` 구현: Task 1 fetch → `npm run build` → 고정 `node.exe`로 `node_modules\vitest\vitest.mjs run`(실패 시 중단) → `dotnet publish desktop\src\Shell -c <Flavor>` → 스테이징 → `notices.ps1`(Node LICENSE, .NET LICENSE/ThirdPartyNotices, WebView2 SDK 라이선스, `npm ls --omit=dev --all` 패키지 라이선스) → `backend-smoke.mjs` → (서명 옵션) → Release zip. 서명 인수는 둘 다 있거나 둘 다 없어야 한다.
- [ ] **Step 4:** Run: `npm run desktop:package -- -Flavor Release; pwsh -File desktop\tests\packaging.tests.ps1`. Expected: 스모크 `backend smoke ok`, 테스트 PASS. zip 크기를 출력해 기록.
- [ ] **Step 5:** Commit `build(desktop): portable zip packaging with verified third-party binaries`.

### Task 8: 데스크톱 e2e (Testing 셸, CDP)

**Files:**

- Create: `playwright.desktop.config.ts`, `tests\desktop\harness.ts`, `tests\desktop\dashboard.spec.ts`
- Modify: `package.json`(`"desktop:e2e": "npm run desktop:package -- -Flavor Testing && playwright test -c playwright.desktop.config.ts"`), `vitest.config.ts`/`playwright.config.ts`가 `tests/desktop`를 서로 포함하지 않도록 확인

**Interfaces:**

- Consumes: Task 7 Testing 스테이징, Task 6 `TestingOptions`(`--data-dir`, `--remote-debugging-port`).
- `harness.ts`: `launchDesktop({ dataDir, cliRoot }): Promise<{ page: Page; shellPid: number; close(): Promise<void> }>` — 스테이징 `.cmd`로 시작(인수 전달용으로 Testing에서는 `runtime\dotnet.exe CopilotSessionDashboard.dll --data-dir … --remote-debugging-port <free port>` 직접 실행), `chromium.connectOverCDP('http://127.0.0.1:<port>')`.

- [ ] **Step 1:** 테스트 작성(`tests\e2e\harness.ts`의 합성 픽스처 재사용): `loads sessions without token in URL`(주소에 `token=` 없음), `search finds fixture prompt`, `copy prompt keeps exact text`(CRLF·이모지 포함 픽스처), `imports VS Code JSON via file chooser`, `live refresh shows appended CLI record within 2 seconds`, `clear local data empties sessions`, `blocks navigation to external origin`(`page.evaluate(() => location.href = 'https://example.com')` 후 URL이 루프백 유지), `closing window leaves no node.exe under the staged folder within 5 seconds`.
- [ ] **Step 2:** Run: `npm run desktop:e2e`. Expected: 처음에는 실패 항목 확인 → 원인(권한 허용 목록 등)을 Task 6 코드에서 최소 수정.
- [ ] **Step 3:** Run: `npm run desktop:e2e`. Expected: 8개 PASS.
- [ ] **Step 4:** Commit `test(desktop): WebView2 end-to-end workflows over CDP`.

### Task 9: 이 VM의 Defender 스모크, 문서, 최종 검증

**Files:**

- Create: `desktop\scripts\defender-smoke.ps1`
- Modify: `README.md`, `docs\handoff.md`, `AGENTS.md`, `docs\research\2026-11-13-portable-webview2-defender-research.md`(측정값), `package.json`(`"desktop:defender-smoke": "pwsh -NoProfile -File desktop/scripts/defender-smoke.ps1"`)

**Interfaces:**

- Consumes: Task 7 Release zip, Task 1 `Add-MarkOfTheWeb`, Task 5 `shell.log` 형식(준비 시 `backend ready port=<n>` 줄, 토큰 없음).
- `defender-smoke.ps1 -Zip <path>`: `%TEMP%\cpsd-smoke\홍길동 Downloads\` 아래로 zip 해제 → 모든 파일 MOTW → 일회용 `LOCALAPPDATA`/`COPILOT_HOME`을 넣은 환경으로 `cmd.exe /c "<…>\CopilotSessionDashboard (Defender ASR).cmd"` → `shell.log`에 `backend ready` 대기(60초) → 창 제목 `Copilot Session Dashboard` 프로세스에 `CloseMainWindow()` → 5초 내 스테이징 경로의 `node.exe` 없음 → 다시 실행 후 셸 `Stop-Process -Id <셸 PID>` → 5초 내 `node.exe` 없음 → 실행 구간 Defender 1116/1117/1121/1122 0건 → 콘솔 창이 남아 있지 않음(`cmd.exe`/`dotnet.exe` 콘솔 창 핸들 없음) → 결과 JSON 출력, 실패 시 `exit 1`.

- [ ] **Step 1:** `defender-smoke.ps1` 작성.
- [ ] **Step 2:** Run: `npm run desktop:package -- -Flavor Release; npm run desktop:defender-smoke -- -Zip desktop\artifacts\CopilotSessionDashboard-0.1.0-win-x64.zip`. Expected: 모든 단계 ok, 이벤트 0건. 이벤트가 생기면 중단하고 사용자에게 보고.
- [ ] **Step 3:** 측정: zip 크기, 압축 해제 크기, 콜드 스타트(실행 → `backend ready`), 유휴 메모리(셸 + WebView2 + Node 작업 집합 합계)를 리서치 문서에 기록.
- [ ] **Step 4:** 문서 갱신: README 포터블 섹션(두 진입점, zip 속성 "차단 해제" 안내, SmartScreen/ASR, 데이터 위치, 폴더 삭제 = 앱 삭제, 브라우저 모드와 동시 실행 금지, 빌드 명령), `docs\handoff.md`(데스크톱 상태·명령·회귀 테스트 표·미검증 항목), AGENTS.md 검증 목록(`npm run desktop:test`, `npm run desktop:package`, `npm run desktop:e2e`, `npm run desktop:defender-smoke`, `dotnet format … --verify-no-changes`).
- [ ] **Step 5:** 전체 검증. Run: `npm test; npm run typecheck; npm run lint; npm run format:check; npm run test:e2e; npm run desktop:test; dotnet format desktop\CopilotSessionDashboard.Desktop.sln --verify-no-changes; npm run desktop:e2e`. Expected: 모두 통과.
- [ ] **Step 6:** 미검증 항목(ASR 없는 PC의 exe 진입점·SmartScreen 문구, Windows 10 22H2, WebView2 없음, SAC 켜진 PC, 탐색기 압축 해제 시 `.cmd` 경고)을 handoff에 기록.
- [ ] **Step 7:** Commit `docs(desktop): portable app usage, verification, and Defender smoke results`.
