# 포터블 WebView2 + Node 사이드카와 Microsoft Defender 호환성 리서치

조사일: 2026-11-13. 상태: 리서치 결과. 구현 승인은
[설계 스펙](../superpowers/specs/2026-11-13-windows-portable-webview2-design.md)을 따른다.

## 1. 질문

1. 기존 Node 앱(`src\server`, `src\client`)을 유지하면서, zip을 풀고 설치 없이
   실행하는 Windows 앱으로 만들 수 있는가?
2. WebView2 + 사이드카 구조가 Microsoft Defender 정책(SmartScreen, ASR,
   Smart App Control)에서 잘 동작하는가? 특히 현재 개발 VM에서 동작하는가?
3. `node.exe` 없이 WebView2와 기존 `.ts`/`.tsx`만으로 구현할 수 있는가?

## 2. 결론

- **`node.exe`는 Defender 문제의 원인이 아니다.** 공식 서명된 `node.exe`(OpenJS
  Foundation)는 복사하거나 이름을 바꿔도 이 VM의 ASR을 통과했다. 차단 대상은
  **새로 빌드한 GUI 실행 파일(exe)**이다.
- **새로 빌드한 WPF + WebView2 exe는 이 VM에서 차단된다.** self-contained든
  framework-dependent든 ASR 규칙 `01443614-cd74-433a-b99e-2ecdc07bfc25`
  ("prevalence, age, or trusted list" 기준)에 막혔다. 이전 워크트리의 exe도
  `signtool` 서명 후까지 반복 차단되었다(이벤트 ID 1121).
- **같은 WPF + WebView2 앱을 Microsoft 서명 `dotnet.exe`가 dll로 실행하면 통과한다.**
  앱 폴더에 함께 넣은 공식 .NET 런타임과 Mark of the Web(MOTW) 조건에서도 WebView2
  렌더링까지 성공했고 Defender 이벤트는 없었다.
- **`node.exe` 없이 기존 코드를 "그대로" 쓰는 방법은 없다.** `.tsx`는 WebView2에서
  그대로 동작하지만 서버 `.ts` 9개 파일이 `node:sqlite`, `node:fs`,
  `node:http`, `node:child_process`, `node:crypto`에 의존한다. 대체 방법은 모두
  백엔드 재작성이며 Defender 문제도 해결하지 않는다(5절).
- **권장 구조:** 포터블 zip = WPF WebView2 셸 dll + 공식 .NET 런타임 + 공식
  `node.exe` + 기존 빌드 결과물. 일반 PC는 앱 exe로, ASR이 적용된 PC는 `.cmd`가
  `runtime\dotnet.exe`로 같은 셸 dll을 실행한다.

## 3. 현재 VM 보안 상태 (2026-11-13 확인)

| 항목                          | 값                                                |
| ----------------------------- | ------------------------------------------------- |
| OS                            | Windows 11 Pro 10.0.26300 x64 (Azure VM)          |
| Defender                      | 실시간 보호, Tamper Protection 켜짐, MDE 온보딩됨 |
| 클라우드 보호                 | MAPS 2, CloudBlockLevel 4 (High+), PUA 차단       |
| ASR                           | 19개 규칙 전부 Block(1). 로컬 ASR 예외 없음       |
| Smart App Control             | 꺼짐 (`VerifiedAndReputablePolicyState` 0)        |
| 사용자 모드 코드 무결성(WDAC) | 강제 안 함, AppLocker 규칙 0                      |
| PowerShell 실행 정책          | LocalMachine `RemoteSigned`                       |
| WebView2 Runtime              | 157.0.4341.46 설치됨                              |
| .NET                          | SDK 10.0.403, Runtime/WindowsDesktop 10.0.14      |

## 4. 실험 (임시 폴더에서 수행 후 삭제)

| #   | 대상                                                                                                                                                                                                                                                                                                                                                                                  | 조건                                          | 결과                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 공식 `node.exe` 복사본                                                                                                                                                                                                                                                                                                                                                                | 임시 폴더                                     | 실행됨                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | 공식 `node.exe`를 `CopilotSessionDashboard.exe`로 이름 변경                                                                                                                                                                                                                                                                                                                           | 임시 폴더                                     | 실행됨                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3   | 새 콘솔 앱 apphost exe (.NET 10)                                                                                                                                                                                                                                                                                                                                                      | MOTW 있음/없음                                | 실행됨                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4   | 새 classlib dll을 PowerShell 7이 로드                                                                                                                                                                                                                                                                                                                                                 | —                                             | 실행됨                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | 새 WPF + WebView2 exe, framework-dependent                                                                                                                                                                                                                                                                                                                                            | MOTW                                          | **ASR 1121 차단**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | 새 WPF + WebView2 exe, self-contained + ReadyToRun                                                                                                                                                                                                                                                                                                                                    | MOTW                                          | **ASR 1121 차단**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | 5와 같은 앱 dll을 설치된 `dotnet.exe`로 실행                                                                                                                                                                                                                                                                                                                                          | MOTW                                          | 실행, WebView2 렌더링 성공                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 8   | 7을 앱 폴더에 복사한 공식 런타임 `runtime\dotnet.exe`로 실행                                                                                                                                                                                                                                                                                                                          | 모든 파일 MOTW                                | 실행, WebView2 렌더링 성공, 이벤트 없음                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 9   | 실제 포터블 레이아웃 전체: WPF+WebView2 셸 dll(IL 전용, framework-dependent) + 공식 `runtime\dotnet.exe`(.NET 10.0.15) + 공식 `node\node.exe`(v24.22.3) + 빌드된 백엔드(`dist\server`,`dist\shared`,`dist\client`), MOTW 스탬프된 `.cmd`(`runtime\dotnet.exe Probe.dll`)로 기동, 공백·한글이 섞인 경로(`%TEMP%\cpsd-gate\공백 경로\`), 일회용 `LOCALAPPDATA`/`APPDATA`/`COPILOT_HOME` | 모든 파일 MOTW, WebView2 런타임 157.0.4341.46 | 실행 성공. `node.exe`가 숨김 창으로 `main.js --no-open --port 0`를 실행하고 `Dashboard: ` URL을 WebView2로 열어 `NavigationCompleted` 성공, `gate-result.txt`=`ok` 기록(기동~완료 약 74초). 백엔드가 일회용 `LOCALAPPDATA\CopilotSessionDashboard\dashboard-data`에 `whoami`/`icacls`/`powershell` ACL 검사를 포함해 정상적으로 `sessions.db*`를 생성. 종료 후 스테이징 폴더 아래의 잔여 `node.exe` 프로세스 없음. 기동 시각 이후 Defender Operational 로그에서 1116/1117/1121/1122 **0건**(최근 1시간 내 cpsd 언급 1121/1122도 0건). |

관찰:

- ASR의 prevalence 판정은 클라우드 평판 기반이므로 같은 종류의 새 exe라도 결과가
  다를 수 있다(3 통과, 5·6 차단). 새 GUI exe가 통과한다고 가정하면 안 된다.
- 7·8에서 로드된 셸 dll은 IL 전용(ReadyToRun 아님)이었다. ReadyToRun이나 네이티브
  dll을 직접 빌드해 넣는 구성은 검증하지 않았다.
- 8의 복사 런타임(Microsoft.NETCore.App + Microsoft.WindowsDesktop.App)은 압축 전
  약 171MB였다. 공식 런타임 zip 기준 크기는 패키징 시 측정해야 한다.

### 4.1 Release zip 스모크와 측정 (2026-11-13, `npm run desktop:defender-smoke`)

| #   | 대상                                                                                                                        | 조건                                                                                                                                                                      | 결과                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | Release zip `CopilotSessionDashboard-0.1.0-win-x64.zip`(셸 IL dll + 공식 .NET 10.0.15 + 공식 Node v24.22.3 + 빌드된 백엔드) | `%TEMP%\cpsd-smoke\홍길동 Downloads\`에 해제, 모든 파일 MOTW, `cmd.exe /c "…\CopilotSessionDashboard (Defender ASR).cmd"`만 사용, 일회용 `LOCALAPPDATA`·빈 `COPILOT_HOME` | 두 번 실행 모두 `shell.log`에 `backend ready` 기록. 창 닫기(`CloseMainWindow`) 후 5초 안에 스테이징 `node.exe` 0개, 셸 종료. 재실행 후 셸 `Stop-Process` 시 5초 안에 `node.exe` 0개(job object). 런처 `cmd.exe` 종료, `cmd.exe`/셸 `dotnet.exe` 소유 콘솔 창 0개. 실행 구간(11:05:51~11:06:25 KST) Defender 1116/1117/1121/1122 **0건**. 같은 날 앞선 두 번의 스크립트 개발 실행 구간도 0건. |

| 측정                                       | 값                                                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| zip 크기                                   | 113,274,719 바이트(108.0MB)                                                                                                                                                 |
| 압축 해제 크기                             | 276,891,167 바이트(264.1MB), 파일 521개                                                                                                                                     |
| 콜드 스타트(`.cmd` 실행 → `backend ready`) | 새로 해제한 폴더·새 WebView2 프로필 기준 4.3~8.0초(3회: 8.0, 7.9, 4.3초). 첫 두 번은 해제 직후 Defender 검사와 파일 캐시가 비어 있던 영향으로 보인다                        |
| 웜 스타트(같은 폴더·프로필 두 번째 실행)   | 1.2초                                                                                                                                                                       |
| 유휴 메모리(준비 후 15초, 작업 집합)       | 합계 약 434MB: 셸 `dotnet.exe` 82.7MB + `msedgewebview2.exe` 6개 293.5MB + `node.exe` 50.7MB + 셸 하위의 창 없는 `conhost.exe`(셸·런처 소유 아님) 7.2MB(3회 범위 428~438MB) |

관찰:

- 측정은 이 VM(Windows 11 Pro 10.0.26300, WebView2 157.0.4341.46)에서 스모크 3회로 잰
  값이며 하드웨어·Defender 검사 상태에 따라 달라진다. 작업 집합은 공유 페이지를
  프로세스마다 중복 계산하므로 실제 물리 메모리 사용량보다 크다.
- 콘솔 창: `.cmd`는 `start "" /min`으로 `dotnet.exe`를 띄우고 바로 끝나며, 셸이
  `FreeConsole`로 콘솔을 해제해 스모크 시점에는 콘솔 창이 남지 않았다.

## 5. `node.exe` 없이 구현하는 대안

| 대안                                                                 | 기존 코드 재사용 | Defender 영향        | 판단                                           |
| -------------------------------------------------------------------- | ---------------- | -------------------- | ---------------------------------------------- |
| C#으로 서버 재작성(SQLite/파일 감시/API)                             | `.tsx`만         | 셸 exe 문제 그대로   | 재작성, 범위 밖                                |
| 서버를 WebView2 페이지 안에서 실행(WASM SQLite + 호스트 파일 브리지) | 일부             | 셸 exe 문제 그대로   | 인증·경로 경계 재설계 필요                     |
| .NET 안에 JS 엔진(ClearScript 등) + Node API 대체 구현               | 일부             | 추가 네이티브 dll    | 비현실적                                       |
| Deno/Bun 등 다른 런타임                                              | 대부분           | 런타임 exe가 바뀔 뿐 | `node:sqlite` 호환성 별도 검증 필요, 이점 없음 |
| Node SEA(단일 exe)                                                   | 전부             | 서명이 깨진 새 PE    | ASR 차단 위험 증가                             |

## 6. Defender 계층별 정리

- **SmartScreen(App Reputation):** MOTW가 있는 서명 없는 exe를 탐색기에서 실행하면
  "Windows의 PC 보호" 경고가 뜬다. Microsoft는 Artifact Signing(구 Trusted
  Signing)을 포함한 어떤 서명도 즉시 평판을 주지 않는다고 안내한다. 평판은 사용량에
  따라 쌓인다.
- **ASR `01443614`:** 클라우드 보호가 필요하다. Microsoft Defender Antivirus 파일/폴더
  예외, 전역·규칙별 ASR 예외, 파일·인증서 IoC를 모두 존중한다. 따라서 관리자는 앱
  폴더 경로나 서명 인증서로 허용할 수 있지만, 이 앱은 예외 없이 동작하는 경로를
  제공해야 한다.
- **Smart App Control:** 켜진 PC에서는 평판이 없는 서명 없는 앱을 차단한다. 유효한
  서명은 SAC 통과에 도움이 되므로 배포가 넓어지면 서명이 필요하다. 이 VM은 SAC가
  꺼져 있어 검증하지 못했다.
- **스크립트 관련 ASR:** `d3e037e1`(JS/VBS가 다운로드한 실행 파일 실행 차단)과
  `5beb7efe`(난독화 스크립트 차단) 때문에 VBS/JS 런처와 인코딩된 PowerShell은
  피한다. `.cmd`는 이 규칙들의 대상이 아니다. 단, MOTW가 있는 `.cmd`는 탐색기에서
  "보안 경고" 확인 창이 뜰 수 있다(zip을 풀기 전에 속성의 "차단 해제"로 제거 가능).

## 7. 기존 백엔드에서 확인한 사실

- 서버는 `127.0.0.1` 루프백에서 HTTP/SSE를 제공하고 `/?token=` 교환으로 쿠키 인증을
  한다. 셸은 이 URL을 WebView2로 열면 된다.
- 종료는 `SIGINT`/`SIGTERM`에만 반응한다. Windows 부모 프로세스가 이 신호를 안정적으로
  보낼 수 없으므로 stdin 연결 종료 같은 새 종료 트리거가 필요하다.
- `storage.ts`는 권한 확인을 위해 `whoami.exe`, `icacls.exe`, `powershell.exe
-NoProfile`을 숨김 창으로 실행한다. 실험 9(포터블 레이아웃 전체)에서 이 호출이
  정상 실행되었고 Defender 탐지 이벤트도 없었다.
- 운영 서버는 런타임 npm 패키지가 필요 없다(`vite`는 `--dev`에서만 로드).

## 8. 검증하지 못한 항목

- 서명한 셸 exe가 이 VM의 ASR을 통과하는지(평판 없는 새 인증서 기준).
- Smart App Control이 켜진 개인 PC, Windows 10 22H2에서의 동작.
- ReadyToRun 셸 dll을 쓴 구성(실험 9는 여전히 IL 전용). 공식 런타임 zip 원본은
  실험 9에서 검증됨(설치본 복사가 아니라 Task 1이 다운로드·병합한 zip).
- zip을 탐색기로 풀었을 때의 MOTW 전파와 `.cmd` 보안 경고 문구.
- 웹 다운로드(Edge) 단계의 SmartScreen 다운로드 평판 경고.

## 9. 참고 자료

- [ASR rules reference](https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-reference)
- [ASR rules overview — 예외 지원 표](https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-overview)
- [Exclusions and indicators overview](https://learn.microsoft.com/en-us/defender-endpoint/defender-endpoint-exclusions-overview)
- [Artifact Signing과 SmartScreen 평판 (Microsoft Q&A)](https://learn.microsoft.com/en-sg/answers/questions/5996190/artifact-signing-smartscreen-unrecognized-app-for)
- [.NET 9 `AppHostRelativeDotNet` 제안 (dotnet/runtime#64430)](https://github.com/dotnet/runtime/issues/64430)
- 이전 리서치: [Windows desktop options](windows-desktop-options-research.md),
  [WebView2 vs Tauri](webview2-sidecar-vs-tauri-comparison.md)
