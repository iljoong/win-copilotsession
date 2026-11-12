# .NET WebView2 셸 + Node 사이드카 vs Tauri: Windows 적합성과 macOS 확장성 비교

- 작성일: 2026-11-12
- 상태: 리서치/권고. 승인된 구현 스펙이 아니며, 기존
  [Windows 데스크톱 옵션 조사](windows-desktop-options-research.md)(Electron 1순위
  권고)를 대체하지 않고 B안과 Tauri안을 보충 비교한다.
- 근거: 기존 조사 문서, 이 저장소 코드 직접 검사, 공개 1차 자료(Tauri v2 문서·이슈,
  Node.js 문서, Microsoft Learn, crates.io). 설치·빌드·벤치마크는 하지 않았다.
  크기/메모리 수치는 측정값이 아니다.
- 평가 기준: 보안, Portability, 성능, 기능 확장성, 안정성, 개발 복잡도(Coding Agent 기준).

## 1. 결론

| 시나리오                       | 권고                                              | 핵심 이유                                                                                                          |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Windows 전용으로 확정          | **B. .NET(WPF) + WebView2 + Node 사이드카**(근소) | 렌더링 엔진이 Tauri와 같음(WebView2). .NET LTS 성숙도, 풍부한 WebView2 호스트 API, Job Object로 사이드카 수명 통제 |
| macOS 확장 가능성이 실재함     | **Tauri v2 + Node 사이드카**(명확)                | 한 셸 코드베이스로 Windows(WebView2)·macOS(WKWebView) 모두 지원. B는 macOS에서 셸을 새로 써야 함                   |
| 결정 보류(가장 흔한 실무 상황) | Tauri 쪽으로 시작                                 | Windows에서 B 대비 손실이 작고(엔진 동일), macOS로 갈 때 재작성 비용을 피함                                        |

공통 전제: 두 안 모두 **Node 백엔드·React UI·루프백 인증을 그대로 재사용**하며, 셸은 얇게
유지한다. Windows 단독 이점(B)은 "작지만 확실"하고, macOS 확장 시 B의 비용은 "크고
확실"하다. 따라서 macOS 확장 확률이 낮지 않다면 Tauri가 기대 비용이 더 작다(판단).

참고: Electron(기존 1순위)도 Windows/macOS 모두 지원하고 Node를 내장해 사이드카가
필요 없다. 이 문서는 요청 범위상 B와 Tauri만 비교하며, 최종 선택 시 Electron의
`node:sqlite` PoC 게이트 결과와 함께 놓고 결정해야 한다.

## 2. 이 저장소에서 확인한 셸 독립적 사실

- 백엔드는 Node 내장 모듈만 사용(`package.json` 의존성은 React뿐). 네이티브 애드온이
  없으므로 사이드카는 **공식 `node`/`node.exe` + `dist\server`** 동봉으로 충분하다.
- UI는 same-origin `fetch`/쿠키와 상대경로 SSE를 쓴다. 두 셸 모두 웹뷰를
  `http://127.0.0.1:PORT/?token=...`로 이동시키기만 하면 되고, IPC는 필요 없다.
- 시작 토큰은 `src\server\main.ts:75-79`에서 stdout으로 출력되고, `src\server\http.ts:79-83`이
  토큰을 HttpOnly SameSite=Strict 쿠키로 교환한다. 셸은 사이드카 stdout에서 URL을 읽어
  웹뷰에 넘기면 된다(두 안 동일). 단, 사람이 읽는 로그 형식 대신 기계 판독용 핸드셰이크
  (예: JSON 한 줄)로 바꾸는 것이 안전하다(권고).
- 종료는 `SIGINT`/`SIGTERM` 핸들러(`main.ts:102-103`)뿐이다. Windows에서 자식 프로세스에
  POSIX 시그널을 보내는 일반적 수단이 없으므로, **두 안 모두** stdin 종료 감지 또는 부모
  PID 감시로 정리(WAL 체크포인트·DB close)를 트리거하는 수명주기 추출이 필요하다.
- macOS 이식 시 백엔드 변경점:
  - 데이터 루트가 `LOCALAPPDATA ?? homedir()`(`main.ts:28`)라서 macOS에서는
    `~/CopilotSessionDashboard`가 된다. `~/Library/Application Support/...`로 바꾸려면
    기존 데이터 위치 정책과 함께 스펙 결정이 필요하다.
  - 권한 보호는 비-Windows에서 `chmod 0700`(`src\server\storage.ts:65`)로 이미 분기돼 있다.
  - 브라우저 자동 열기는 `win32` 전용(`main.ts:82`)이지만 셸 사용 시 `--no-open`으로 불필요.
- 테스트는 Chromium만 사용한다. macOS WKWebView(WebKit) 동작은 현재 자동 검증되지 않는다.

## 3. 항목별 비교

### 3.1 보안

| 관점                  | B. .NET WebView2 + Node                                                                | Tauri v2 + Node                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 웹뷰→호스트 노출면    | 기본 없음. `AddHostObjectToScript`/`WebMessage`를 쓰지 않으면 노출면 0                 | 외부 URL(127.0.0.1)로 로드된 페이지에는 `window.__TAURI__`가 주입되지 않는다는 보고([tauri#11934](https://github.com/tauri-apps/tauri/issues/11934)). capability를 비워 두면 노출면 최소 |
| 권한 모델             | 코드로 직접 통제(`NavigationStarting`, `NewWindowRequested` 차단 등). 선언적 모델 없음 | 선언적 capability/permission, 원격 출처 IPC는 `remote.urls`로 명시 허용해야 함([Capabilities](https://v2.tauri.app/security/capabilities/))                                              |
| 사이드카 실행 통제    | `Process.Start` 인자를 C# 코드가 고정                                                  | `shell:allow-spawn`의 `sidecar:true` + 인자 허용 목록/정규식([Sidecar](https://v2.tauri.app/develop/sidecar/)). Rust에서만 spawn하고 JS에 shell 권한을 주지 않는 구성 권장               |
| 셸 메모리 안전성      | 관리 코드(.NET)                                                                        | Rust                                                                                                                                                                                     |
| 루프백 인증·Host 검사 | 그대로 유지                                                                            | 그대로 유지                                                                                                                                                                              |
| 런타임 패치 책임      | WebView2 Evergreen 자동 갱신 + .NET 런타임 + Node 런타임(앱이 갱신)                    | WebView2/WKWebView는 OS가 갱신 + Node 런타임(앱이 갱신)                                                                                                                                  |

평가: **사실상 동등**. 두 안 모두 웹뷰는 신뢰된 로컬 origin만 열고 IPC를 쓰지 않는 구성이
가능하다. Tauri는 "기본 거부 + 선언적 권한"이라 실수 여지가 작고, B는 런타임이 하나(.NET)
더 있어 패치 대상이 많다. 실질 위험은 셸이 아니라 **Node 런타임 패치 주기**와 **대화 텍스트
XSS**(기존 이스케이프 테스트 + CSP 추가)에 있다. 공통 필수: 외부 네비게이션/새 창 차단,
`127.0.0.1` 외 출처 거부, devtools 프로덕션 비활성.

### 3.2 Portability

| 대상              | B                                                                                                                         | Tauri                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows x64/ARM64 | 지원(WebView2, .NET)                                                                                                      | 지원(WebView2). Windows 7 지원 종료([Tauri 2.12](https://v2.tauri.app/de/blog/tauri-2.12/))                                                                      |
| macOS             | **불가**. WebView2·WPF·WinForms·WinUI 3는 Windows 전용 → Avalonia WebView/MAUI(Mac Catalyst)/Photino/Swift 셸을 별도 작성 | 동일 코드. WKWebView. 사이드카는 `node-aarch64-apple-darwin`, `node-x86_64-apple-darwin` 등 트리플별 파일 필요([Sidecar](https://v2.tauri.app/develop/sidecar/)) |
| Linux(참고)       | 불가                                                                                                                      | WebKitGTK로 가능(이 앱 범위 밖)                                                                                                                                  |

평가: **Tauri 압도적 우위**. B의 macOS 경로는 사실상 "두 번째 셸 프로젝트"다. .NET 크로스
플랫폼 대안(Avalonia `Avalonia.Controls.WebView`, MAUI)은 존재하나 라이선스/성숙도/Mac
Catalyst 세부를 이번에 검증하지 못했다.

### 3.3 성능

- 렌더링: **Windows에서 동일**(둘 다 WebView2). 백엔드도 동일한 Node 프로세스.
- 셸 오버헤드: Rust 네이티브 바이너리가 .NET 런타임 셸보다 작고 가볍다고 일반적으로 알려져
  있으나 **미측정**. 다만 설치 용량·상주 메모리의 지배 항목은 **동봉 Node 런타임과
  WebView2 프로세스군**이라 셸 차이는 2차적이다(추론).
- 시작 시간: 두 안 모두 "셸 기동 → Node 기동 → 포트 핸드셰이크 → 네비게이션" 직렬 경로.
  차이는 .NET 런타임 로드 정도(미측정).
- macOS: WKWebView는 시스템 공유라 Electron 대비 가볍다(구조적 사실). 수치는 PoC 측정 대상.

평가: **Windows에서 근소하게 Tauri 우위(미측정, 체감 차 작을 것)**.

### 3.4 향후 기능 확장성

| 기능                                                                | B                                               | Tauri                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 트레이/단일 인스턴스/자동 시작                                      | WPF/WinForms + Win32로 직접 구현(자료 풍부)     | 공식 플러그인(tray는 core feature, single-instance/autostart 플러그인; 세부 동작 미검증) |
| 자동 업데이트                                                       | 직접 설계(MSIX App Installer, Velopack 등 선택) | 공식 updater 플러그인(서명된 업데이트; 세부 미검증)                                      |
| Windows 깊은 통합(토스트, 패키지 ID, 점프리스트, 엔터프라이즈 MSIX) | **강함**(Windows App SDK를 WPF에서도 사용 가능) | 가능하나 Rust Win32 바인딩/플러그인 의존                                                 |
| 크로스 플랫폼 기능 추가                                             | 플랫폼마다 재구현                               | 플러그인 단위로 공통 구현                                                                |
| 백엔드를 장기적으로 셸에 흡수                                       | C#로 점진 이식 가능(재작성 비용 큼)             | Rust로 점진 이식 가능(재작성 비용 큼)                                                    |

평가: Windows 전용 심화는 B, 플랫폼 확장은 Tauri.

### 3.5 안정성

- B: .NET 10 LTS(2025-11 출시, 지원 종료 2028-11 — endoflife.date 기준, Microsoft 정책
  페이지 재확인 필요) + WebView2(Microsoft 지원). API 변동이 작고 장기 예측 가능성이 높다.
- Tauri: 2.12(2026-09)가 최신 안정 계열, MSRV 1.90([Tauri 2.12](https://v2.tauri.app/de/blog/tauri-2.12/)).
  `tauri` 3.0.0-alpha가 진행 중([crates.io](https://crates.io/api/v1/crates/tauri/versions))이라
  향후 메이저 마이그레이션 리스크가 있다.
- **사이드카 고아 프로세스**: Tauri에서 Windows 앱 종료 후 사이드카가 남는 이슈가 보고됨
  ([tauri#10377](https://github.com/tauri-apps/tauri/issues/10377) → #8572 중복),
  수명주기 플러그인 요청이 열려 있음([plugins-workspace#3062](https://github.com/tauri-apps/plugins-workspace/issues/3062)).
  B도 자동 해결되지 않지만 .NET에서 Job Object(`KILL_ON_JOB_CLOSE`) P/Invoke가 단순하다.
  **두 안 모두** Job Object + Node 측 stdin/부모 PID 감시를 이중으로 두어야 DB가 열린 채
  남는 상황을 막을 수 있다(권고).
- Node 사이드카 형태: Node SEA는 아직 Stability 1.1(Active development)이고 단일 스크립트
  임베드 구조라([Node SEA](https://nodejs.org/api/single-executable-applications.html)) ESM
  다중 파일 백엔드에는 **`node` 바이너리 + `dist\server` 동봉**이 더 안정적이다. SEA 안에서
  `node:sqlite` 동작은 미검증.

평가: **B 우위**(성숙한 LTS, 수명 제어 단순). Tauri의 사이드카 리스크는 알려진 패턴으로
완화 가능.

### 3.6 개발 복잡도 (Coding Agent 기준)

| 관점               | B                                                                         | Tauri                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 언어/툴체인 추가   | C# + .NET SDK 하나(`dotnet build`로 끝)                                   | Rust + Cargo + Windows MSVC Build Tools + Tauri CLI. 첫 빌드가 길어 에이전트 반복 루프가 느림                                                                             |
| 학습 데이터 신뢰도 | C#/WPF/WebView2 예제 풍부, API 안정 → 생성 코드 정확도 높음               | **v1/v2 API·설정 키가 학습 데이터에 섞여 있음**(예: `dangerousRemoteDomainIpcAccess`(v1) vs `remote.urls`(v2), allowlist vs capabilities). 잘못된 설정을 생성할 위험이 큼 |
| 오류 피드백 품질   | 컴파일러 오류 명확, 런타임 예외 메시지 명확                               | Rust 컴파일러 오류는 정확하지만 소유권/라이프타임 수정 반복이 생길 수 있음. capability JSON 오류는 런타임에 드러나는 경우가 있음(추론)                                    |
| 셸 코드 규모(추정) | 소규모(창, 사이드카, Job Object, 핸드셰이크, 네비게이션 차단)             | 소규모(유사) + 설정 파일(`tauri.conf.json`, capabilities, 트리플별 바이너리 준비 스크립트)                                                                                |
| 자동 E2E 검증      | WebView2는 CDP 원격 디버깅 포트로 Playwright 연결 가능(설정 필요, 미검증) | Windows에서는 같은 WebView2라 동일 방식 가능(미검증). macOS WKWebView는 Playwright로 직접 제어 불가 → 수동/웹킷 대리 테스트 필요                                          |
| 2개 OS 지원 시     | 셸 2개 → 에이전트가 두 코드베이스를 동기화해야 함                         | 셸 1개 + 플랫폼별 서명/노타라이즈 설정                                                                                                                                    |

평가: **Windows 단독이면 B가 에이전트에게 더 쉽다.** 2개 OS를 지원하면 Tauri가 총
복잡도에서 앞선다. Tauri 선택 시 v2 공식 문서를 컨텍스트에 명시적으로 넣고(예: Context7 등),
`tauri.conf.json`/capabilities를 스키마 검증하는 단계를 루프에 포함시키는 것이 에이전트
실패율을 낮춘다(권고).

## 4. macOS 확장 상세

| 항목            | B                                                                         | Tauri                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 셸              | 새로 작성(Avalonia/MAUI/Swift). Windows 셸과 기능 동기화 부담             | 그대로                                                                                                                                                                                                                                                             |
| 웹 엔진 차이    | WKWebView 계열 사용 시 동일 이슈                                          | WKWebView(Safari 엔진). Chromium 전용 테스트로는 검증 안 됨 → Playwright WebKit 프로젝트를 대리 지표로 추가 권장. 127.0.0.1 HttpOnly/SameSite=Strict 쿠키, EventSource 동작은 **미검증, PoC 필수**                                                                 |
| 서명/노타라이즈 | 셸 방식별로 별도 설계                                                     | Developer ID 서명 + notarize 필요, 무료 계정 불가([macOS signing](https://v2.tauri.app/distribute/sign/macos/)). **동봉 Node 바이너리도** Hardened Runtime으로 서명해야 하고 V8 JIT용 `com.apple.security.cs.allow-jit` entitlement가 필요할 가능성이 높음(미검증) |
| 아키텍처        | 셸 방식별                                                                 | arm64/x64 사이드카 각각 필요. universal 빌드 시 사이드카 처리 미검증 → 아키텍처별 DMG가 단순                                                                                                                                                                       |
| 백엔드 변경     | 공통: 데이터 경로 정책(`main.ts:28`), 소스 기본 경로(`~/.copilot`는 동일) | 공통                                                                                                                                                                                                                                                               |

결론: macOS 확장 시 **Tauri가 명확히 더 좋다.** B로 시작했다가 macOS로 가면 사실상 셸
재작성 + 두 셸 유지가 된다.

## 5. 의사결정 가이드

1. macOS 지원이 로드맵에 있거나 미정이면 → **Tauri v2**(2.x 고정, 3.0 알파 회피).
2. Windows 전용 확정 + Windows 깊은 통합(MSIX 패키지 ID, 엔터프라이즈 배포, 토스트 등)이
   중요하면 → **B(.NET 10 LTS + WPF + WebView2)**.
3. 어느 쪽이든 먼저 **셸 독립 작업**을 한다: 백엔드 start/stop 수명주기 추출, 기계 판독
   핸드셰이크, stdin/부모 PID 감시 종료, 데이터 경로 정책. 이렇게 하면 셸 교체 비용이 작아진다.

## 6. PoC 체크리스트 (구현은 승인된 스펙 이후)

1. 동봉 `node`(사이드카)로 `node:sqlite` WAL/FTS5와 핵심 테스트 일부 통과(두 안 공통).
2. 셸 강제 종료(작업 관리자 종료 포함) 시 Node가 남지 않고 DB가 손상되지 않는지(Job Object).
3. 웹뷰에서 토큰→쿠키 교환, SSE 재연결, 외부 네비게이션 차단 확인. macOS WKWebView 포함.
4. Tauri: 외부 localhost 창에 IPC/shell 권한이 노출되지 않는지 capability 검증.
5. macOS: 서명·노타라이즈된 앱에서 Node 사이드카 실행(entitlement 필요 여부 확정).
6. 설치 크기·상주 메모리·시작 시간 실측(Windows 대상 기기).

## 7. 검증하지 못한 항목

- WebView2/WKWebView에서 `127.0.0.1` HttpOnly SameSite=Strict 쿠키와 EventSource 동작.
- Tauri updater/single-instance/autostart 플러그인의 플랫폼별 세부 동작, WebView2 설치 모드.
- macOS에서 Node 사이드카의 entitlement 요구(Node 공식 문서 근거), universal 빌드 처리.
- SEA 내 `node:sqlite` 동작.
- WebView2 호스트 API 세부(Microsoft Learn 원문 재확인), Playwright CDP 연결 설정.
- Avalonia WebView 라이선스, MAUI Mac Catalyst 세부, Photino.NET 상태.
- .NET 지원 종료일(Microsoft 공식 정책 페이지 재확인).
- 셸별 크기·메모리·시작 시간(전부 미측정).

## 8. 참고 자료 (조회일 2026-11-12)

- Tauri Sidecar: https://v2.tauri.app/develop/sidecar/
- Tauri Capabilities: https://v2.tauri.app/security/capabilities/
- Tauri macOS 서명: https://v2.tauri.app/distribute/sign/macos/
- Tauri Windows 설치 프로그램: https://v2.tauri.app/distribute/windows-installer/
- Tauri 2.12 릴리스: https://v2.tauri.app/de/blog/tauri-2.12/
- tauri 크레이트 버전: https://crates.io/api/v1/crates/tauri/versions
- 사이드카 고아 프로세스: https://github.com/tauri-apps/tauri/issues/10377
- 사이드카 수명주기 요청: https://github.com/tauri-apps/plugins-workspace/issues/3062
- 외부 localhost와 IPC 주입: https://github.com/tauri-apps/tauri/issues/11934
- Node SEA: https://nodejs.org/api/single-executable-applications.html
- WebView2 배포: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- .NET MAUI 10: https://learn.microsoft.com/en-us/dotnet/maui/whats-new/dotnet-10
- Avalonia WebView: https://github.com/AvaloniaUI/Avalonia.Controls.WebView
- .NET 수명주기(2차 자료): https://endoflife.date/api/dotnet.json
