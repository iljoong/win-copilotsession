# Copilot 세션 대시보드의 Windows 데스크톱화 옵션 조사

- 조사일: 2026-11-12
- 범위: 공개 1차 자료(Electron 공식 문서/소스/이슈·PR, Microsoft Learn, Node.js 공식 문서, Tauri 공식 문서)만 사용. 워크스페이스 소스, Copilot 세션 로그, 개인 데이터는 열람하거나 외부 검색에 보내지 않음. 설치·프로세스 변경·구현·데이터 마이그레이션은 하지 않았고, 크기/성능 벤치마크와 일정 추정은 하지 않음.
- 전제(사용자 제공): React 19 + TS + Vite 프론트엔드, Node >=22.23.4 ESM 백엔드(`node:sqlite`, 네이티브 HTTP, JSONL 수집, SSE), 127.0.0.1 바인딩 + Host/Origin 검사 + HttpOnly SameSite=Strict 시작 쿠키, LOCALAPPDATA 저장.

## 1. 결론 요약

1. **지금 당장은 Electron으로 감싸는 방안을 1순위로 권장한다.** React UI와 Node 백엔드(`node:sqlite`, JSONL 수집, SSE, 회계/프라이버시 로직)를 그대로 재사용할 수 있고, 103개 테스트와 Chromium 워크플로 7개의 자산이 보존된다. Electron은 "Node + Chromium"을 번들하므로 Node 백엔드를 같은 프로세스 계열에서 돌릴 수 있다는 점이 구조적으로 가장 잘 맞는다. 단, 이는 구조 적합성에 대한 판단이다.
2. **`node:sqlite` 호환성은 "미지원"이 아니라 "공개 자료상 호환 가능성이 높지만 PoC로 확정해야 하는 게이트"이다.** 아래 3절 참조. 이 게이트는 Electron 선택의 전제이므로 가장 먼저 검증한다.
3. **중간 경로(.NET WebView2 셸 + Node 사이드카)**는 가능하지만, 공개 문서상 이 조합을 위한 1차 가이드는 확인하지 못했다(추론). Node 런타임을 직접 동봉·감독해야 하고, 셸만 C#이 될 뿐 백엔드 재작성 이득은 없다. 설치 용량 절감(공유 WebView2)과 Windows 네이티브 셸 통합이 주된 이유일 때만 고려한다.
4. **C# 재작성(WinUI 3 / WPF)**은 Windows 전용 기능(패키지 ID 필요 기능, 네이티브 UX, 엔터프라이즈 배포 정책 등)이 제품 요구가 되거나 Node 런타임 동봉 자체가 허용되지 않을 때 정당화된다. 지금은 안전·회계 로직과 테스트를 전부 다시 만들어야 하므로 권장하지 않는다.
5. Tauri는 제3의 대안으로만 간략히 언급한다. WebView2를 쓰고 Node 백엔드는 사이드카 실행 파일로 취급되므로 WebView2+Node와 구조적으로 유사하다.

## 2. 옵션 비교표

| 항목               | A. Electron 래핑                                  | B. .NET WebView2 셸 + Node 사이드카                 | C. C# 재작성 (WinUI 3 / WPF)                                                                       | (참고) Tauri                    |
| ------------------ | ------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- |
| React UI 재사용    | 그대로                                            | 그대로(WebView2 안)                                 | 불가(XAML로 재작성)                                                                                | 그대로                          |
| Node 백엔드 재사용 | 번들 Node 사용(3절 PoC 필요)                      | 별도 Node 런타임을 직접 동봉·실행                   | 불가(C#으로 재작성; SQLite/FTS·JSONL·SSE·회계 로직)                                                | 사이드카로 실행 가능(공식 문서) |
| 웹 런타임          | 앱마다 Chromium 동봉                              | 공유 Evergreen WebView2 Runtime(또는 Fixed Version) | 웹 런타임 불필요(XAML UI)                                                                          | WebView2                        |
| 런타임 전제        | 지원 OS는 선택한 Electron 릴리스에서 확인         | WebView2 Runtime 및 .NET/Node 배포 방식 결정        | WinUI 3는 Windows App SDK 배포 방식 결정; WPF는 .NET 배포 방식 결정(Windows App SDK는 선택적 통합) | WebView2 설치 옵션 선택         |
| 보안 모델          | 직접 구성(sandbox, contextIsolation, IPC 검증 등) | WebView2 + 기존 루프백 인증 유지                    | 로컬 HTTP 서버 자체를 없앨 수 있음                                                                 | capability 기반 권한            |
| 업데이트/설치      | Squirrel.Windows·MSI·MSIX 등(Forge/builder)       | 직접 설계(MSIX 또는 설치 프로그램)                  | MSIX(WinUI 3 기본 패키지) 또는 비패키지                                                            | NSIS/MSI                        |
| 재작성 위험        | 가장 낮음                                         | 중간(셸 신규, 백엔드 유지)                          | 가장 높음(회귀 테스트 재구축)                                                                      | 중간(Rust 셸 추가)              |

용량·메모리 수치는 비교하지 않는다. 확인한 것은 구조 차이뿐이다: Electron은 Chromium과 Node를 앱과 함께 배포한다(Electron 보안 문서). Evergreen WebView2 Runtime은 WebView2 앱들이 공유하며 디스크를 절약하고, 해당 시스템에서는 Edge와 하드링크될 수 있다(Microsoft Learn). 실제 차이는 PoC에서 측정해야 한다.

## 3. Electron 번들 Node와 `node:sqlite` 호환성 (핵심 게이트)

확인된 사실:

- 현재 Electron 안정 계열은 Node 24.x를 번들한다. 공식 헤더 인덱스(`electronjs.org/headers/index.json`, 조회일 2026-11-12)에서 45.3.1 → Node 24.22.2 / Chromium 156, 44.11.2 → Node 24.22.2, 43.8.9 → Node 24.22.1이다. 46.0.0-alpha.10 및 main(DEPS)은 Node 26.13.0이다(`electron/electron:DEPS` `node_version`). 따라서 `Node >=22.23.4` 요구를 semver 상으로는 만족하지만, **동일 Node 22 패치 라인은 아니다**(백엔드를 22 LTS 기준으로 검증했다면 24 동작 차이를 확인해야 함).
- Electron 지원 정책은 최신 3개 안정 메이저이며, 주요 릴리스 주기는 8주다(Electron Releases 문서). 즉 보안 패치 추적을 위해 주기적 메이저 업그레이드가 필요하다.
- `node:sqlite`는 Node 22.5.0에서 추가되었고 22.13.0/23.4.0에서 `--experimental-sqlite` 플래그가 필요 없어졌으며, v25.7.0부터 "release candidate"로 표기된다(Node.js sqlite 문서). 현재 Node 24 라인에서의 안정성 표기는 이 문서의 최신 페이지만으로는 확인되지 않았다(미확인).
- Electron에서 `node:sqlite` 회귀 이력이 있었다. Electron 37.2.0에서 `No such binding: sqlite` 오류가 보고되었고(electron/electron#47671), Node의 "sqlite 없이 빌드" 옵션이 GN 빌드 설정에 제대로 반영되지 않은 것이 원인이었다. 수정 PR #47706 "fix: missing SQLite builtin support in Node.js"가 2025-07-15에 병합되었고 릴리스 노트에 "Fixed an issue where `require('node:sqlite')` didn't work."로 적혀 있다.
- Electron 저장소에는 Chromium SQLite와 Node SQLite의 심볼 충돌을 피하기 위한 패치도 있다(`electron/electron:patches/sqlite/fix_rename_sqlite_win32_exports_to_avoid_conflicts_with_node_js.patch`). 이는 Electron 빌드에 Node의 SQLite 내장이 공존함을 시사하지만, 지원을 보증하는 문서는 아니다(추론).

확인하지 못한 것(미확인, "미지원"이 아님):

- Electron 공식 문서에 `node:sqlite` 지원을 명시한 절은 찾지 못했다.
- 현재 Electron 45(Node 24.22.2)에서 `node:sqlite` 동작을 직접 확인한 공개 자료는 찾지 못했다. 이 조사에서는 설치/실행을 하지 않았다.
- Electron 번들 Node의 SQLite 컴파일 옵션(예: FTS5)이 앱이 쓰는 FTS 쿼리와 호환되는지 확인하지 못했다.
- 백엔드 실행 위치(Electron main 프로세스 / `utilityProcess` / `ELECTRON_RUN_AS_NODE` 계열)에 따른 ESM·`node:sqlite` 동작은 문서만으로 단정하지 않는다. `utilityProcess.fork`는 Node.js와 메시지 포트를 가진 자식 프로세스를 Chromium Services API로 실행한다고 설명된다(Electron utilityProcess 문서).

**판정: PoC 게이트.** 통과 조건은 패키징된 Electron 빌드에서 실제 DB 파일로 스키마/FTS/집계 쿼리와 기존 테스트 일부가 통과하는 것이다. 실패 시의 대안은 (a) Electron은 UI 셸로만 쓰고 시스템에 설치한 Node가 아닌 별도 Node 런타임을 사이드카로 동봉(B 경로와 유사), (b) Electron 버전 변경이다.

## 4. 항목별 분석

### 4.1 React 재사용 vs Node 백엔드 재사용

- React는 A, B, Tauri 모두에서 그대로 쓸 수 있고, C에서만 재작성이 필요하다.
- 백엔드 재사용은 Electron이 가장 직접적이다(Node 번들). B는 .NET 셸이 별도 Node 프로세스를 띄워야 하며, 공개 문서에서 이 패턴을 위한 가이드는 확인하지 못했다(추론). Tauri는 사이드카 실행 파일을 공식 지원하며, 인자 허용 목록을 capability로 제한한다(Tauri Sidecar 문서).
- 기존 localhost HTTP + SSE 구조는 그대로 두고 셸이 창만 여는 방식이 재작성이 가장 적다. 이때 셸이 시작 쿠키/토큰을 어떻게 주입할지는 설계 결정 사항이며 PoC 항목이다(추론).

### 4.2 설치·업데이트·서명·SmartScreen

- Electron 공식 업데이트 방식은 Squirrel + `autoUpdater`이며, Windows에서는 RELEASES/`.nupkg` 메타데이터가 필요하다(Electron Updating Applications). Forge는 Squirrel.Windows와 WiX MSI 서명을 지원한다(Electron Code Signing).
- Electron 문서는 Windows 빌드 서명을 권장하며, 2023-06 이후 일반 OV는 서명 없음과 동일한 경고로 취급된다는 취지로 적혀 있다. 반면 Microsoft Learn은 "EV 인증서도 더 이상 SmartScreen을 우회하지 않는다"고 명시한다. **두 자료의 설명이 다르므로 최신 Microsoft 문서를 우선한다.** Electron 문서는 Azure Artifact Signing이 "SmartScreen 경고를 없앤다"고 적지만, Microsoft 문서는 서명되어도 평판이 쌓이기 전에는 경고가 나올 수 있다고 한다(SmartScreen reputation). 서명이 모든 경고를 제거한다고 약속해서는 안 된다.
- Microsoft Learn(SmartScreen reputation / Code signing options) 요약: SmartScreen은 게시자 평판과 파일 해시 평판을 본다. 서명 없음/자체 서명은 경고, OV/EV도 평판이 쌓일 때까지 경고, Microsoft Store 경로는 경고 없음. MSIX를 Store로 게시하면 Microsoft가 재서명한다. Azure Artifact Signing은 비-Store 배포에 권장되며 지역/자격 제한이 있다(조직: 미국·캐나다·EU·영국, 개인: 미국·캐나다).
- **MSIX 패키지 서명, SmartScreen 평판, 엔터프라이즈 배포는 별개 개념이다.** 서명은 게시자 신원을 증명하고, SmartScreen 평판은 다운로드 이력에 의해 쌓이며, 엔터프라이즈는 MDM/정책 배포가 별도 경로다(Microsoft Learn 패키징 개요가 Store·엔터프라이즈·직접 다운로드를 별도 선택지로 구분).
- Windows App SDK(WinUI 3)는 프레임워크 종속(기본)과 자체 포함 배포를 선택할 수 있다. 자체 포함은 비패키지 앱에서 용량·메모리 부담이 있고 서비스 업데이트가 자동 적용되지 않는다(Windows App SDK deployment overview). WinUI 3 앱은 기본적으로 패키지(MSIX)다(Packaging overview).
- Electron의 MSIX 경로: Electron 공식 "Windows Store Guide"는 구형 `electron-windows-store`(appx) 기반 설명이라 최신성은 확인하지 못했다. 최신 MSIX 도구는 이 조사에서 1차 자료로 검증하지 않았다(추가 확인 필요).

### 4.3 Chromium 번들 vs 공유 WebView2 런타임

- Electron: 앱마다 Chromium/Node를 포함하므로 Electron 보안 업데이트를 앱 업데이트로 배포해야 한다(Electron Security: "Use a current version of Electron").
- WebView2: Evergreen은 자동 업데이트와 공유 사본이 장점이고, 앱이 특정 런타임 버전을 요구할 수 없다. Windows 11에는 포함되며 Windows 10 대부분 기기에 이미 설치되어 있으나 일부는 없을 수 있어 존재 확인/설치가 권장된다. Fixed Version은 버전을 고정할 수 있지만 앱이 런타임을 직접 동봉·서비스해야 한다(WebView2 Distribution, Evergreen vs Fixed).
- 기능 호환성 관점: 현재 테스트는 실제 Chromium으로 돌고 있어 Electron(Chromium)과 가장 가깝다. WebView2는 Edge 기반이라 대부분 유사하겠지만, 공유 런타임 버전이 사용자마다 다르다는 점이 변수다.

### 4.4 백그라운드 수집, 트레이, 단일 인스턴스

- Electron은 `app.requestSingleInstanceLock()`과 `second-instance` 이벤트를 제공하고 보통 기존 창을 활성화한다(Electron app API). `app.quit()`/`before-quit`/`will-quit` 수명주기가 있어 수집 루프의 정리(체크포인트 flush, DB 닫기)에 쓸 수 있다.
- 트레이/로그인 시 시작/알림 세부 API는 이번 조사에서 별도 문서를 읽지 않았다(PoC에서 확인). 참고로 Electron Code Signing 문서는 `app.setLoginItemSettings()` 등 일부 API가 macOS에서 서명 상태에 영향을 받는다고 하지만 Windows 동작은 거기서 확인되지 않았다.
- WebView2 경로는 셸이 단일 인스턴스/트레이/Node 사이드카 수명(자식 프로세스 종료, 좀비 방지)을 직접 구현해야 한다. Windows App SDK는 인스턴스 관리와 활성화 API를 제공한다(Windows App SDK 개요의 App lifecycle). WinUI/WPF의 백그라운드 서비스 동작은 패키지 ID 필요 여부를 확인해야 한다(Microsoft Learn: background tasks는 package identity 필요 기능으로 분류).

### 4.5 로컬 앱 보안

- Electron: 렌더러 샌드박스는 Electron 20부터 기본 활성이고 `nodeIntegration: true`가 샌드박스를 끈다(Electron Sandbox). Context isolation은 Electron 12부터 기본값이다(Context Isolation). 보안 체크리스트: 원격 코드에 Node 통합 금지, context isolation, sandbox, 네비게이션·새 창 제한, IPC 발신자(`sender`) 검증, `file://` 대신 커스텀 프로토콜, fuse 검토, CSP, Electron 최신 유지(Electron Security).
- 이 앱은 로컬 콘텐츠만 표시하고 로컬 HTTP 서버가 대화 텍스트를 제공하므로 Electron의 "신뢰할 수 없는 콘텐츠" 위험은 낮지만, **대화 텍스트(프롬프트/응답)는 사용자 데이터이자 잠재적 악성 문자열**이다. Electron 문서가 강조하듯 XSS의 영향이 더 커진다(Electron Security의 secure coding 항목). 기존 렌더링 이스케이프 테스트를 유지하고 CSP를 추가해야 한다.
- 기존 loopback 보호(Host/Origin 검사, HttpOnly SameSite=Strict 쿠키)는 셸이 도입돼도 유지 가능하다. 다만 셸에서 쿠키를 심는 방식(세션 API)과 외부 브라우저 접근 차단은 설계/PoC 항목이다. Electron 문서는 사용자 정의 프로토콜 사용을 권장하지만, 이를 도입하면 기존 HTTP/SSE 구조 변경이 커진다(트레이드오프).
- 파일 접근: Electron 렌더러는 샌드박스에서 파일시스템에 직접 접근하지 못하고 main 프로세스 IPC로 위임한다(Electron Sandbox). 현재 구조에서는 파일 접근을 백엔드가 전담하므로 렌더러에는 별도 IPC를 거의 노출하지 않는 최소 preload가 가능하다(추론).
- **패키지 앱 ≠ UWP/AppContainer.** MSIX 패키지 데스크톱 앱의 trust level과 패키징 동작은 구분해야 한다(Microsoft Learn: MSIX desktop behind the scenes, Packaging overview). 전체 신뢰 데스크톱 앱이라고 해서 패키징에 따른 파일/레지스트리 경로 동작까지 비패키지 앱과 같다고 단정하지 않는다. CLI 기록 읽기, 기존 LOCALAPPDATA 저장소, VS Code JSON 가져오기가 선택한 배포 방식에서 정상 동작하는지 PoC로 확인한다. 이 조사에서는 실제 패키지로 해당 경로를 검증하지 않았다.

### 4.6 .NET WebView2 + Node 사이드카 vs 실제 C# 재작성

- 사이드카: 기존 백엔드 유지, UI 유지. 대신 (1) Node 런타임 동봉과 업데이트, (2) 프로세스 수명 관리, (3) 포트/인증 비밀 전달, (4) .NET·Node·WebView2 구성요소의 서비스 부담이 생긴다. 이 조합을 하나로 다루는 공식 가이드는 이번 조사에서 확인하지 못했다(설계에 대한 판단).
- 재작성: `node:sqlite`, FTS, 증분 JSONL 수집, 체크포인트, SSE, 청구/사용량 집계, 프라이버시 규칙을 전부 C#으로 다시 구현하고 103개 테스트와 브라우저 워크플로를 등가로 재구축해야 한다. Windows App SDK는 WinUI 3뿐 아니라 WPF/WinForms/Win32에도 최신 Windows API를 제공하므로(Windows App SDK 개요) 점진적 이행 경로는 열려 있다.
- C#이 정당한 경우: (a) Node/Chromium 동봉이 정책상 불가, (b) 패키지 ID 기반 Windows 통합이 핵심 요구, (c) 네이티브 UX·접근성·Windows 전용 제품화가 장기 전략, (d) 엔터프라이즈 요구 정책이 .NET 스택을 요구. 현재 입력된 정보에는 이 조건들이 없다.

## 4.7 이 저장소에 대한 적합성 (메인 에이전트의 직접 코드 검사 결과를 그대로 반영, 본 조사에서 소스 미열람)

- 런타임 의존성은 React/react-dom뿐이고 백엔드는 Node 내장 모듈만 쓴다(`package.json`, 엔진 `>=22.23.4`). 서드파티 네이티브 애드온이 없으므로 Electron 재패키징 시 네이티브 모듈 재빌드 문제는 없다. 남는 위험은 번들 Node 24와 `node:sqlite` 동작이다(3절).
- `src/server/data/store.ts:1,75`가 `node:sqlite`의 `DatabaseSync`를 쓰고, `src/server/data/schema.ts:6`(WAL)과 `:23`(FTS5)이 필수다. 따라서 PoC 1번은 WAL과 FTS5를 반드시 포함해야 한다. 이는 3절의 FTS5 미확인 항목을 필수 통과 조건으로 격상시킨다.
- `src/server/main.ts`는 CLI `parseArgs`와 최상위 시작 코드(:14), 루프백 listen(:75), 수집 시작(:81), 시그널 기반 종료(:92-103)가 한 파일에 있다. Electron에 그대로 import하지 말고 **start/stop 수명주기를 함수로 추출**해 셸이 호출하는 편이 낫다. 그래야 단일 인스턴스, 창 닫기, `before-quit` 정리와 연동할 수 있다.
- 프로덕션 `assetDir`(:70-73)는 `import.meta.url` 기준이라 `process.cwd()` 의존 문제는 없다. 단, asar 패키징 시 경로 해석은 PoC에서 한 번 확인한다(일반적 확인 항목이며 결함 주장이 아님).
- 데이터 기본 경로는 고정된 `LOCALAPPDATA\CopilotSessionDashboard`(`main.ts:28`)이다. Electron 기본 `userData` 경로로 조용히 바꾸지 말고, 기존 `dashboard-data\sessions.db`와 Sources 동의 상태를 그대로 유지한다. 설치 제거 시 데이터 보존 정책도 함께 정한다.
- 클라이언트는 same-origin `fetch`/쿠키(`src/client/api.ts:12`)와 상대경로 `EventSource('/api/events')`(:31)를 쓴다. 최소 재사용 단계에서는 `file://` + IPC 재작성이 아니라 **현재 HTTP origin/SSE 전송을 유지**하고 셸 창이 그 origin을 여는 방식을 택한다. 시작 쿠키 인증과 Host/Origin 검사도 그대로 유지된다. 커스텀 프로토콜/IPC 전환은 후속 선택지로 둔다.
- C# 재작성 비용의 사례: 회전된 파일 복구(`src/server/sources/ingestion.ts:80`)와 버전별 재생(:191, :202)은 C# 이식 시 동작 동등성을 따로 증명해야 하는 로직이다. 네이티브 재작성은 실제 Windows 네이티브 UX/용량 목표가 생겼을 때 조건부로 검토한다. 현재 성능 비교 측정이나 일정 추정은 없다.

## 5. 소규모 PoC 체크리스트 (설치/구현은 별도 승인 후)

1. 최소 Electron 앱(현재 안정 버전 고정)에서 `node:sqlite` import, DB 생성, FTS5 가상 테이블 생성 및 질의를 실행한다. 패키징 결과물(asar 포함)에서도 동일하게 확인한다. 이 항목이 실패하면 A 대신 사이드카 방식으로 전환 검토.
2. 기존 백엔드 ESM 코드를 Electron의 선택한 실행 방식(main / utilityProcess)에서 기동하고, 핵심 테스트 일부(회계, FTS, 체크포인트)를 번들 Node 24에서 실행한다. Node 22 대비 동작 차이 확인.
3. 서버 바인딩(127.0.0.1), Host/Origin 검사, 시작 쿠키 주입이 셸 창에서 동작하고 외부 브라우저에서 우회되지 않는지 확인한다.
4. 보안 기본값 확인: `contextIsolation`, sandbox, `nodeIntegration` 비활성, 네비게이션/새 창 차단, preload 노출 API 최소화, CSP.
5. 단일 인스턴스 락, 창 닫기 시 백그라운드 수집 유지 여부(트레이 정책), 종료 시 DB·체크포인트 정리 확인.
6. 설치/삭제 시 LOCALAPPDATA 저장 위치와 데이터 보존 정책(삭제 시 데이터 유지 여부)을 확인한다.
7. 서명 파이프라인(Azure Artifact Signing 또는 OV/EV)과 SmartScreen 첫 다운로드 경고를 실제 배포 채널에서 관찰한다. 경고가 사라진다고 가정하지 않는다.
8. (선택) 같은 UI를 WebView2 + Node 사이드카로 띄워 프로세스/수명/설치 복잡도를 비교한다. 수치는 측정값만 사용한다.

## 6. 미해결 질문

- Electron 45(Node 24.22.2)에서 번들 `node:sqlite`의 FTS5 및 전체 API 호환성은? (PoC 게이트)
- 백엔드를 Node 24(또는 향후 26) 기준으로 계속 검증할 것인가, 22 LTS에 고정할 것인가? Electron은 주기적으로 Node 메이저를 올린다.
- Electron 트레이/로그인 시 시작/Windows 알림의 세부 동작과 MSIX 패키징의 최신 공식 도구 상태는 이번에 검증하지 못했다.
- MSIX 전체 신뢰 모드에서 이 앱이 필요한 파일 접근이 모두 정상 동작하는지(검증 안 함).
- 배포 대상이 개인/소규모 직접 다운로드인지 엔터프라이즈 관리 배포인지에 따라 서명·업데이트 선택이 달라진다(요구사항 미확정).

## 7. 참고 자료 (조회일 2026-11-12)

Electron

- 릴리스/지원 정책: https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- 버전별 Node/Chromium: https://electronjs.org/headers/index.json
- main 브랜치 의존성(Node 26.13.0): https://github.com/electron/electron/blob/main/DEPS
- node:sqlite 회귀 이슈: https://github.com/electron/electron/issues/47671
- 수정 PR: https://github.com/electron/electron/pull/47706
- SQLite 심볼 충돌 패치: https://github.com/electron/electron/blob/main/patches/sqlite/fix_rename_sqlite_win32_exports_to_avoid_conflicts_with_node_js.patch
- 보안: https://www.electronjs.org/docs/latest/tutorial/security
- 샌드박스: https://www.electronjs.org/docs/latest/tutorial/sandbox
- Context Isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- 프로세스 모델: https://www.electronjs.org/docs/latest/tutorial/process-model
- utilityProcess: https://www.electronjs.org/docs/latest/api/utility-process
- app API(single instance): https://www.electronjs.org/docs/latest/api/app
- 코드 서명: https://www.electronjs.org/docs/latest/tutorial/code-signing
- 업데이트: https://www.electronjs.org/docs/latest/tutorial/updates
- Windows Store Guide(구형): https://www.electronjs.org/docs/latest/tutorial/windows-store-guide
- 플랫폼 지원(Windows 10+): https://github.com/electron/electron/blob/main/README.md

Node.js

- node:sqlite: https://nodejs.org/api/sqlite.html

Microsoft Learn

- WebView2 배포: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- Evergreen vs Fixed: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version
- WebView2 프로세스 모델: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model
- 패키징/배포 허브: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/
- 패키징 개요: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/packaging/
- Windows App SDK 배포 개요: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/deploy-overview
- 서명 옵션: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- SmartScreen 평판: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- Windows App SDK 개요: https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/
- MSIX 전체 신뢰/AppContainer: https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes

Tauri (참고)

- Sidecar: https://v2.tauri.app/develop/sidecar/
- Windows 설치 프로그램/WebView2 옵션: https://v2.tauri.app/distribute/windows-installer/
