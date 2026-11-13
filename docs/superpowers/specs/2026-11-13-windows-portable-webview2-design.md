# 포터블 Windows 앱 (WebView2 셸 + Node 사이드카)

Date: 2026-11-13
Status: 2026-11-13 사용자 승인. 구현 전.
Size: 프로젝트 (데스크톱 셸, 백엔드 수명주기 변경, 포터블 패키징)
Supersedes: [2026-11-12 Windows desktop shell](2026-11-12-windows-desktop-shell-design.md)
(설치형 Inno Setup 설계. 그 스펙의 WPF exe는 이 VM의 ASR에 차단되었다.)
Research: [포터블 WebView2 + Defender 리서치](../../research/2026-11-13-portable-webview2-defender-research.md)

## 의도

기존 Node 대시보드를 그대로 유지하면서 Windows 앱처럼 사용할 수 있게 한다. 사용자는
zip을 받아 풀고 설치 없이 바로 실행한다. 브라우저 탭 대신 전용 창이 열리고, 앱은
Microsoft Defender의 기본 보호와 강화된 ASR 정책(현재 개발 VM)에서 예외 등록 없이
동작해야 한다.

브라우저 앱이 제품이고, 데스크톱 앱은 기존 Node 백엔드를 비공개로 시작해 그 UI를
WebView2 창에 보여 주는 얇은 셸이다. 동작, 데이터, 사용량 계산, 개인정보 규칙,
기존 테스트를 보존한다.

## 사용자가 결정한 사항

- 기존 Node 앱을 유지한다. 백엔드를 다시 작성하지 않는다.
- 배포: **zip 파일을 받아 풀고, 설치 없이 바로 실행**한다.
- 구조: **WebView2 + 사이드카** 방식을 검토해 적용한다.
- Windows Defender 보안 정책에서 잘 동작해야 한다. 대상은 **개인 PC와 현재 Azure
  Windows VM**(MDE 온보딩, ASR 19개 규칙 Block)이다.
- 작업은 새 브랜치에서 진행한다(`feature/windows-portable-webview2`).

이전 스펙(2026-11-12)에서 사용자가 결정했고 이번 대화와 충돌하지 않아 이어받는 항목:

- 셸 UI: **WPF, .NET 10 LTS**. 연결 방식: **기존 루프백 HTTP 서버 유지**.
- 대상: **Windows 11 x64, Windows 10 x64**. ARM64 제외.
- 창 닫기(X) = 앱 종료(수집 중지). 트레이 없음. 로그인 시 자동 시작 없음.
- Node 런타임은 **공식 `node.exe`를 동봉하고 버전을 고정**한다. 사용자 PC의 Node는
  사용하지 않는다.
- 처음에는 서명 없이 배포하고, 서명은 나중에 추가한다.
- 앱 삭제 시 대시보드 데이터는 남긴다. 데이터는 앱의 **Clear local data**로만 지운다.

## 어시스턴트가 정한 사항 (승인 필요)

- **두 개의 진입점, 같은 셸 코드.**
  - `CopilotSessionDashboard.exe`: 일반 PC용 apphost exe.
  - `CopilotSessionDashboard (Defender ASR).cmd`: ASR 규칙
    `01443614`가 새 exe를 막는 PC용. Microsoft 서명 `runtime\dotnet.exe`로 같은
    셸 dll을 실행한다. 이번 대화에서 확인 질문에 직접 답을 받지 못했으므로 어시스턴트의
    결정으로 표시한다.
- **셸 배포 형태:** framework-dependent, IL 전용(ReadyToRun 끔, 트리밍 끔, 단일 파일
  아님). apphost는 `AppHostRelativeDotNet=runtime`으로 앱 폴더의 런타임을 찾는다.
  이유: 실험에서 새 GUI exe는 차단되고 서명된 `dotnet.exe`가 실행한 IL 전용 셸 dll은
  통과했다. 두 진입점이 한 런타임 사본을 공유한다.
- **동봉 .NET 런타임:** Microsoft 공식 `dotnet-runtime`과 `windowsdesktop-runtime`
  win-x64 zip을 내려받아 공개 해시로 검증하고 **수정 없이** `runtime\`에 둔다.
- **동봉 Node:** 현재 Node 24 LTS 줄의 공식 win-x64 zip. 정확한 버전과 SHA-256을
  저장소 파일 하나에 고정한다. 동봉 `node.exe`로 Vitest 전체와 패키지 백엔드 스모크가
  통과해야 하며, 실패하면 최신 Node 22 LTS 패치로 고정하고 이유를 기록한다.
- **데이터 위치:** 브라우저 앱과 같은
  `%LOCALAPPDATA%\CopilotSessionDashboard\dashboard-data`. 셸 전용 상태는 형제 폴더
  `%LOCALAPPDATA%\CopilotSessionDashboard\desktop\`(WebView2 사용자 데이터, 로그)에
  둔다. 포터블이지만 압축을 푼 폴더에는 쓰지 않는다(읽기 전용 위치에 풀어도 동작).
- **WebView2 Runtime:** Evergreen을 사용하며 앱이 설치하지 않는다. 없으면 오류 화면에
  Microsoft 공식 다운로드 페이지 주소를 표시한다. 앱이 다운로드한 실행 파일을 실행하는
  동작은 Defender에 민감하므로 하지 않는다.
- **제3자 고지:** `THIRD_PARTY_NOTICES.txt`(Node, .NET, WebView2 SDK, React 등)와
  `README-FIRST.txt`(실행 방법, Defender/SmartScreen 안내, 데이터 위치)를 zip에 넣는다.

## Defender 친화 설계 규칙

모든 규칙은 구현과 리뷰의 합격 조건이다.

1. **새 PE를 최소화한다.** 우리가 빌드하는 PE는 apphost exe와 IL 전용 셸 dll 둘뿐이다.
   네이티브 dll, ReadyToRun, 패커/UPX, 단일 파일 번들, Node SEA를 쓰지 않는다.
2. **제3자 바이너리는 원본 그대로 둔다.** `node.exe`, `dotnet.exe`, 런타임, WebView2
   SDK dll의 파일과 Authenticode 서명을 바꾸지 않는다. 패키징은 해시와 서명을 검증한다.
3. **실행 중 실행 파일을 만들지 않는다.** 임시 폴더 추출, 코드 다운로드, 실행 중 exe/dll
   쓰기, 자체 업데이트를 하지 않는다.
4. **런처는 단순하게 만든다.** `.cmd` 한 줄로 `start`만 쓴다. PowerShell, VBS/JS/HTA,
   `-EncodedCommand`, 실행 정책 우회, `rundll32` 우회를 쓰지 않는다.
5. **지속성과 권한 상승이 없다.** Run 키, 예약 작업, 서비스, 관리자 권한, 방화벽 규칙
   변경이 없다. 레지스트리 쓰기는 WebView2 자체 동작 외에 없다.
6. **프로세스 트리를 예측 가능하게 유지한다.** 셸 → `node.exe` 하나. `node.exe`의 기존
   `whoami.exe`/`icacls.exe`/`powershell.exe -NoProfile` 호출 외에 새 자식 프로세스가
   없다. 프로세스 인젝션, 디버그 권한, 다른 프로세스 메모리 접근이 없다.
7. **네트워크는 루프백만 쓴다.** 앱이 외부 네트워크에 연결하지 않는다(WebView2 런타임
   자체 업데이트 제외).

## 목표와 합격 기준

1. **설치 없이 실행.** zip을 사용자 폴더에 풀고 진입점을 실행하면 UAC 없이 앱이 열린다.
   관리자 권한, 레지스트리 설치, 시작 메뉴 등록이 없다.
2. **이 VM에서 예외 없이 실행.** 모든 파일에 MOTW(ZoneId=3)를 붙인 상태로
   `.cmd` 진입점을 실행하면 대시보드가 열린다. 실행부터 종료까지 Defender 이벤트
   1116/1117/1121/1122가 0건이다.
3. **일반 PC 진입점.** ASR이 없는 Windows 11에서 exe 진입점이 동작한다. 서명이 없으면
   SmartScreen 경고가 뜰 수 있으며 README-FIRST에 문서화한다.
4. **앱 창으로 실행.** 창 하나에 인증된 대시보드가 표시된다. 브라우저 탭, 남아 있는
   콘솔 창, 노출된 토큰이 없다. `.cmd` 진입점의 콘솔 창은 시작 직후 사라진다(짧게
   보이는 것은 허용).
5. **같은 데이터, 같은 위치.** 소유권 마커, 권한 검사와 경고, 소스 동의, 체크포인트를
   브라우저 앱과 공유한다. `npm start`로 만든 DB가 앱에서 그대로 열리고 반대도 된다
   (동시 실행은 지원하지 않는다).
6. **기능 동등.** 세션 검색/필터/정렬/페이지, 대화 보기, 프롬프트 복사(원문 그대로),
   파일 선택기로 VS Code JSON 가져오기, Sources 동의/켜기/끄기, Usage, SSE 실시간
   갱신, Clear local data가 창 안에서 동작한다.
7. **깨끗한 종료.** 창을 닫으면 정상 종료(수집 중지, 서버 종료, DB 닫기) 후 5초 안에
   `node.exe`가 끝난다. 셸이 강제 종료되어도 job object가 `node.exe`를 끝낸다.
8. **실패가 보인다.** Node 시작 실패, 예기치 않은 종료, 30초 안에 준비 신호 없음,
   WebView2 Runtime 없음 → 이유, 로그 폴더, 재시도가 있는 네이티브 오류 화면.
   빈 창을 보여 주지 않는다.
9. **단일 인스턴스.** 실행 중에 다시 실행하면 기존 창을 앞으로 가져오고 두 번째
   백엔드를 시작하지 않는다. 두 진입점 모두 같은 잠금을 쓴다.
10. **잠긴 웹 뷰.** 자기 백엔드의 `http://127.0.0.1:<port>/…`만 표시한다. 다른 탐색과
    새 창, 다운로드를 막는다. 릴리스에서는 DevTools, 호스트 객체, 웹 메시지, 자동
    완성, 비밀번호 저장이 꺼져 있다. 권한 요청은 6번에 필요한 것만 허용한다.
11. **비밀 유출 없음.** 시작 토큰은 로그, 창 제목, 명령줄, 오류 화면, WebView2 기록에
    남지 않는다. 쿠키는 실행마다 새 세션 쿠키다.
12. **삭제 = 폴더 삭제.** 앱 폴더를 지우면 앱이 사라진다. `dashboard-data`는 남고,
    `desktop\` 폴더를 지워도 데이터에는 영향이 없다. README-FIRST에 적는다.
13. **브라우저 모드 유지.** `npm start`, `npm run dev`, 기존 테스트가 그대로 동작한다.

## 범위 밖

- macOS, Linux, ARM64. 설치 프로그램, MSIX, Store, 자동 업데이트.
- 트레이, 창을 닫은 뒤 백그라운드 수집, 로그인 시 시작, 알림.
- 이번 버전의 코드 서명(빌드에 선택적 서명 단계만 둔다).
- HTTP/SSE를 WebView2 메시지, 커스텀 프로토콜, 가상 호스트로 바꾸는 것.
- 수집, 사용량 계산, 검색, 식별, UI 기능 변경. C#으로 백엔드 로직 재작성.
- 이 VM의 Defender 정책이나 예외 변경.

## 실패로 간주하는 경우 (동작하더라도)

- 루프백 바인딩, Host/Origin 검사, 쿠키 인증, 경로 경계, 비활성 미리보기, 데이터 폴더
  소유권 검사가 약해진다.
- 기존 데이터를 몰래 옮기거나 복사하거나 초기화한다. 동의 없이 수집을 시작한다.
- 종료 후 `node.exe`가 남거나 DB가 열린 채로 남는다.
- 셸에 업무 로직 사본이 생겨 데스크톱과 브라우저 동작이 달라진다.
- Defender를 피하려고 탐지 회피 기법(난독화, 인젝션, 서명 위장, 정책 변경)을 쓴다.

## 설계

### zip 구성

```text
CopilotSessionDashboard-<version>-win-x64.zip
  CopilotSessionDashboard\
    CopilotSessionDashboard.exe          apphost (일반 PC)
    CopilotSessionDashboard (Defender ASR).cmd
    CopilotSessionDashboard.dll          셸 (IL 전용) + .runtimeconfig.json/.deps.json
    Microsoft.Web.WebView2.*.dll         Microsoft 서명 SDK
    runtimes\win-x64\native\WebView2Loader.dll
    runtime\                             공식 .NET 런타임 (dotnet.exe, host\, shared\)
    node\node.exe, node\LICENSE          공식 Node
    app\package.json                     {"type":"module"}만
    app\dist\server\…  app\dist\shared\…  app\dist\client\…
    README-FIRST.txt
    THIRD_PARTY_NOTICES.txt
```

`.cmd` 내용(의미 기준, 정확한 문법은 구현자 판단):

```bat
@start "" /min "%~dp0runtime\dotnet.exe" "%~dp0CopilotSessionDashboard.dll"
```

`dotnet.exe`는 콘솔 프로그램이므로 셸은 시작할 때 자기 콘솔을 해제(`FreeConsole`)해
콘솔 창이 남지 않게 한다. exe 진입점에서는 이 동작이 아무 영향을 주지 않는다.

### 앱 소유 폴더

```text
%LOCALAPPDATA%\CopilotSessionDashboard\
  dashboard-data\        변경 없음, 백엔드 소유
  desktop\WebView2\      WebView2 사용자 데이터 (셸 소유)
  desktop\logs\          셸 + 백엔드 stderr 로그 (회전)
```

셸은 `dashboard-data` 안에 쓰지 않는다. 백엔드는 `desktop\`를 건드리지 않는다.

### 백엔드 변경 (TypeScript, 최소)

1. **수명주기 분리.** 최상위 시작/종료 코드를 `startDashboard(options) → { url, port,
stop() }` 형태로 옮긴다. `main.ts`는 이를 호출해 기존 CLI 동작을 유지한다.
2. **데스크톱 모드 플래그**(예: `--desktop`, `--no-open`과 함께만 허용):
   - 리슨 후 stdout에 JSON 한 줄만 쓴다. 예: `{"event":"ready","port":53122,"token":"…"}`.
     사람용 `Dashboard:`/`Data:` 줄은 쓰지 않는다. 진단은 stderr로 보낸다.
   - stdin이 끝나거나 닫히면 `SIGINT`와 같은 정상 종료를 수행하고 코드 0으로 끝난다.
3. 바인딩, 인증, 쿠키, Host/Origin 검사, 기본 데이터 경로, 저장소 검사, API/SSE는
   바꾸지 않는다.

Vitest: 준비 줄 형식과 토큰이 그 줄에만 나오는지, stdin 종료 시 정상 종료하는지, 기존
CLI 모드가 그대로인지 확인한다.

### 셸 (WPF, C#)

시작 순서:

1. 사용자 세션 범위 단일 인스턴스 잠금. 이미 있으면 기존 창을 활성화하고 끝낸다.
2. `dotnet.exe`로 실행된 경우 콘솔 해제. "시작 중" 상태의 창 표시.
3. WebView2 Runtime 확인. 없으면 오류 화면.
4. `node\node.exe app\dist\server\main.js --desktop --no-open --port 0` 실행: 창 없음,
   stdin/stdout/stderr 리디렉션, 작업 폴더 `app\`. 사용자 환경을 상속하되 Node 코드
   주입 변수(`NODE_OPTIONS`, `NODE_PATH`, `NODE_REPL_EXTERNAL_MODULE`, 디버그/inspect
   설정)는 제거한다. 토큰이나 비밀을 명령줄로 넘기지 않는다. `LOCALAPPDATA`가 없으면
   오류 화면을 보여 준다.
5. 즉시 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` job object에 넣는다.
6. stdout에서 준비 줄을 엄격하게 읽는다(30초). 토큰은 메모리에만 둔다.
7. `desktop\WebView2` 사용자 데이터 폴더와 InPrivate 모드로 WebView2를 만든 뒤
   `http://127.0.0.1:<port>/?token=<token>`으로 이동한다. 백엔드의 303 리디렉션이
   주소에서 토큰을 지운다.
8. stderr를 로그로 보낸다. stdout 내용은 기록하지 않는다.

WebView2 정책: DevTools, 호스트 객체, 웹 메시지, 자동 완성, 비밀번호 저장, 상태
표시줄, 브라우저 가속키를 릴리스에서 끈다. `NavigationStarting`은 `http`,
`127.0.0.1`, 백엔드 포트만 허용한다. `NewWindowRequested`와 `DownloadStarting`은
취소한다. `PermissionRequested`는 기본 거부하고, 클립보드 쓰기와 파일 선택에 필요한
것만 PoC로 확인해 허용한다. `ProcessFailed`는 한 번 다시 불러오고 반복되면 오류
화면을 보여 준다.

종료: 창 닫기나 Windows 세션 종료 시 창을 숨기고 Node stdin을 닫은 뒤 최대 5초
기다린다. 그 뒤 job 핸들을 닫는다. Node가 예기치 않게 끝나면 오류 화면을 보여 주며,
재시도하면 새 토큰과 포트로 다시 시작한다.

로그: `desktop\logs\shell.log`, 크기 기준 회전(예: 1MB × 3). 토큰, 쿠키, 쿼리 문자열이
있는 URL, 프롬프트, 소스 파일 내용을 쓰지 않는다.

### 첫 단계: Defender go/no-go (어시스턴트 결정)

백엔드나 패키징 작업보다 먼저, 리서치 실험 8이 다루지 못한 조건을 이 VM에서 확인한다.

- 공식 런타임 zip 원본(설치본 복사가 아님)으로 만든 `runtime\`.
- 최소 셸이 동봉 `node.exe`로 실제 `dist\server`를 데스크톱 모드로 시작한다. 이때
  `whoami.exe`/`icacls.exe`/`powershell.exe` 권한 검사 경로도 포함한다.
- 모든 파일에 MOTW를 붙이고 `.cmd` 진입점으로 실행한다.

Defender 이벤트 1116/1117/1121/1122가 하나라도 생기면 **작업을 멈추고 사용자에게
보고**한다. 서명, 설치된 .NET 사용, 관리자 예외 같은 대안은 사용자가 결정한다.

### 빌드와 패키징

1. `npm ci`, `npm run build`.
2. 고정 Node zip과 .NET 런타임 zip을 공식 주소에서 받아 해시를 검증한다(저장소에
   버전과 해시 고정). 받은 파일은 git에서 제외한다.
3. 고정 `node.exe`로 Vitest 전체를 실행한다. 실패하면 패키징을 멈춘다.
4. `dotnet publish`로 셸을 빌드한다(framework-dependent, `win-x64`, IL 전용,
   `AppHostRelativeDotNet=runtime`). Release와 Testing 두 가지로 빌드한다.
5. zip 구성대로 스테이징하고 고지 파일을 만든다. 제3자 바이너리의 해시와
   Authenticode 서명이 원본과 같은지 검증한다.
6. **스테이징 백엔드 스모크:** 스테이징된 `node.exe`로 임시 데이터 폴더에서 데스크톱
   모드를 시작하고, 준비 줄을 읽고, DB를 쓰는 인증 요청(WAL, FTS5 검색)을 보낸 뒤
   stdin을 닫아 코드 0과 잔여 프로세스 없음을 확인한다.
7. Release 스테이징을 zip으로 만든다. 선택적 `signtool` 단계는 기본으로 꺼 둔다.

## 검증

AGENTS.md 게이트(`npm test`, `npm run typecheck`, `npm run lint`,
`npm run format:check`, `npm run test:e2e`)에 더해 다음을 수행한다.

- `desktop\`의 `dotnet build`/`dotnet test`(경고를 오류로 처리)와
  `dotnet format --verify-no-changes`.
- xUnit: 준비 줄 파싱, 탐색 허용 목록, 로그 마스킹, 시작 타임아웃/종료 처리, 환경
  변수 정리.
- **Testing 셸**(배포 금지, 컴파일 심볼로만 구분): 합성 데이터 폴더와 루프백
  원격 디버깅 포트를 허용한다. Playwright가 CDP로 붙어 로드, 검색, 프롬프트 복사,
  JSON 가져오기, 실시간 갱신, 데이터 지우기를 확인한다. Release 바이너리에는 이 기능이
  환경 변수 뒤에도 존재하지 않는다.
- **이 VM의 Defender 스모크(Release zip):** zip을 새 폴더에 풀고 모든 파일에 MOTW를
  붙인 뒤 `.cmd` 진입점을 실행한다. 창 표시, 백엔드 준비, 종료, 잔여 `node.exe` 없음,
  셸 강제 종료 시 Node 종료를 확인한다. 실행 구간의 Defender 1116/1117/1121/1122
  이벤트가 0건임을 기록한다. 실제 기록을 읽지 않도록, 스모크로 시작한 프로세스에만
  `LOCALAPPDATA`와 `COPILOT_HOME`을 일회용 폴더로 지정한다. Release 바이너리 코드는
  바꾸지 않는다(어시스턴트 결정).
- 이 VM에서 exe 진입점을 일부러 실행해 ASR 차단 경보를 만들지 않는다. 차단 근거는
  리서치의 기존 이벤트로 갈음하고, exe 진입점은 ASR이 없는 PC에서 확인한다(어시스턴트
  결정).
- 수동 확인(가능한 환경에서): ASR 없는 Windows 11에서 exe 진입점과 SmartScreen 문구,
  Windows 10 22H2, WebView2 Runtime이 없는 경우, 탐색기로 zip을 풀 때 `.cmd` 보안
  경고. 수행하지 못한 항목은 인계 문서에 미검증으로 남긴다.
- zip 크기, 유휴 메모리(셸 + WebView2 + Node), 콜드 스타트 시간을 측정해 기록한다.
  수치를 약속하지는 않는다.

실제 Copilot 기록은 명시적 허락이 있을 때만 사용한다. 테스트는 합성 데이터와 일회용
폴더를 쓴다.

## 호환성과 개인정보 경계

- 기존 데이터, 동의, 체크포인트를 그대로 쓰며 마이그레이션은 없다.
- 인증 모델은 같다. 토큰은 터미널 출력 대신 같은 앱의 두 프로세스 사이 메모리로
  전달된다. 루프백 인증은 같은 사용자의 다른 프로세스로부터의 격리가 아니라는 README
  설명도 그대로 유효하다.
- 텔레메트리, 오류 보고, 업데이트 확인을 추가하지 않는다.

## 위험과 대응

| 위험                                          | 대응                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Defender 클라우드 판정이 바뀌어 셸 dll도 차단 | Defender 스모크를 매 릴리스 실행. 서명 단계 준비. README-FIRST에 관리자용 예외(폴더/인증서) 안내 |
| exe 진입점이 ASR PC에서 차단                  | `.cmd` 진입점 제공, README-FIRST 안내                                                            |
| 서명 없는 exe의 SmartScreen 경고, SAC PC 차단 | 문서화. 배포가 넓어지면 Artifact Signing 도입                                                    |
| 동봉 런타임으로 zip 크기 증가                 | 크기 측정·기록. 필요한 공유 프레임워크 2개만 포함                                                |
| `dotnet.exe` 콘솔 창이 남음                   | 셸 시작 시 콘솔 해제, 합격 기준 4                                                                |
| Node 버전 차이                                | 고정 바이너리로 전체 테스트 게이트, Node 22 대안                                                 |
| 비정상 종료 후 Node 잔존                      | job object + stdin 연결                                                                          |
| WebView2 Runtime 없음(Windows 10)             | 오류 화면에 공식 다운로드 안내                                                                   |
| 브라우저 앱과 동시 실행                       | 문서로 미지원 명시                                                                               |

## 문서 갱신 (구현에 포함)

- README: 포터블 앱 섹션(실행 방법, 두 진입점, 데이터 위치, 삭제 시 데이터 유지,
  SmartScreen/ASR 안내, 브라우저 모드와 동시 실행 금지). 브라우저 모드 안내는 유지한다.
- `docs\handoff.md`: 데스크톱 상태와 마일스톤을 이 스펙으로 교체하고 회귀 테스트
  표에 데스크톱 테스트를 추가한다.
- AGENTS.md 검증 목록에 `desktop\` 명령을 추가한다.

## 구현자에게 맡기는 사항

- CLI 플래그, 수명주기 모듈, npm 스크립트, C# 네임스페이스, `.cmd` 파일 이름.
- 두 번째 인스턴스가 첫 번째에 알리는 방법(이벤트, 파이프, 창 메시지).
- 오류 화면 디자인(네이티브 WPF, 단순하고 접근성 있게). 로그 회전 세부 값.
- 공식 런타임 zip에서 필요한 파일만 고를지 여부(원본 파일은 수정 금지).

## 열린 질문 (이 스펙을 막지 않음)

- **상용 제품 이름.** "Copilot"은 GitHub/Microsoft 상표다. 상용 배포 전에 이름을
  확인한다.
- **서명 채널**(Artifact Signing 또는 OV 인증서)과 시점.
- 배포 규모가 커질 때의 자동 업데이트 방식.
