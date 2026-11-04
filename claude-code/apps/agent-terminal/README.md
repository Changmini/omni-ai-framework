# Omni Agent Terminal

여러 개의 Claude Code CLI 세션을 **한 창**에서 띄우고 관리하는 Electron 데스크톱 앱입니다.
왼쪽은 직접 만든 UI(에이전트 목록, 상태 LED, 빠른 명령 버튼, 프롬프트 입력창)이고, 오른쪽은 실제 터미널입니다. 터미널 화면은 xterm.js가 그리고, 실제 PowerShell 프로세스는 node-pty가 연결합니다.

![screenshot](docs/screenshot.png)

## 실행 (Windows)

Node.js 20 이상이 필요합니다.

```bash
cd claude-code/apps/agent-terminal
npm install
npm start
```

- `claude`가 PATH에 있어야 합니다. 에이전트마다 PowerShell이 하나씩 열리고, 그 안에 `실행 명령`(기본값 `claude`)이 자동으로 입력됩니다.
- Windows에서는 별도 빌드 도구가 필요 없습니다. node-pty 1.1 패키지에 `prebuilds/win32-x64`, `win32-arm64` 바이너리가 들어 있습니다.
- macOS와 Linux에서는 `$SHELL`을 사용합니다. Linux에는 node-pty prebuild가 없으므로 `npm install` 뒤 `cd node_modules/node-pty && npx node-gyp rebuild`로 빌드하세요. Python, make, C++ 컴파일러가 필요합니다.

## 기능

| 영역 | 동작 |
|---|---|
| 새 에이전트 | 이름, 작업 폴더(`…`로 폴더 선택), 실행 명령을 정해 세션을 시작합니다 |
| 에이전트 목록 | 클릭하면 해당 터미널로 전환하고, `✕`를 누르면 프로세스를 종료합니다 |
| 상태 LED | 🟡 작업 중(최근 1.5초 안에 출력) · 🟢 대기 · 🔴 오류 감지 · ⚫ 종료 |
| 제어 | `claude 실행`, `/compact`, `/clear`, `Esc 중단`, `Ctrl+C`를 선택된 터미널에 보냅니다 |
| 프롬프트 | 입력한 내용을 선택된 터미널에 보냅니다(Ctrl+Enter). 텍스트와 Enter는 따로 전송됩니다 |
| 글자 크기 | 모든 터미널에 적용되고, 설정이 기억됩니다 |

**UI → 터미널:** 버튼과 프롬프트 입력은 PTY 입력으로 그대로 들어가므로, 직접 타이핑한 것과 같게 동작합니다.
**터미널 → UI:** 출력에서 `Error: …`, `EADDRINUSE … in use`, `command not found`, `is not recognized as …` 같은 줄을 감지하면 LED가 빨간색으로 바뀌고, 상단에 해당 줄이 배너로 표시됩니다. 다음에 Enter를 입력하면 경고가 해제됩니다. 패턴은 `src/status.js`의 `ERROR_PATTERNS`에서 바꿀 수 있습니다.

## 구조

```text
src/
├── main.js        # Electron 메인: 창, IPC, 보안 설정
├── preload.js     # contextBridge로 window.agentApi만 노출
├── sessions.js    # SessionManager: 에이전트당 PTY 하나 (생성, 입력, 크기 조정, 종료, 상태 알림)
├── status.js      # 순수 로직: ANSI 제거, 오류 패턴, 상태 판정
└── renderer/      # index.html · styles.css · renderer.js (xterm.js 화면과 사이드바)
test/              # node --test (상태 로직, 가짜 PTY, 실제 PTY 통합)
```

- 보안: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP `script-src 'self'`를 적용했습니다. 터미널에 출력된 링크는 앱 안이 아니라 시스템 브라우저에서 열립니다.
- 디자인: 사이드바, 터미널, 창 배경을 같은 색(`#14161c`)으로 맞추고, 같은 코딩 폰트(D2Coding → Cascadia Code → Fira Code → Consolas 순)를 씁니다. 이 색을 바꿀 때는 `styles.css`의 `--bg`, `renderer.js`의 `TERMINAL_THEME.background`, `main.js`의 `backgroundColor` 세 곳을 함께 수정하세요.

## 테스트

```bash
npm test
```

node-pty가 현재 Node 버전용으로 빌드돼 있지 않으면 실제 PTY 통합 테스트는 건너뜁니다.

## 한계와 다음 단계

- 상태는 출력 타이밍과 텍스트 패턴으로만 추정합니다. Claude Code 화면의 세부 상태(권한 확인 대기 등)는 아직 구분하지 못합니다.
- 화면을 새로고침하면 실행 중인 세션은 다시 연결되지만, 그 전에 출력된 내용(스크롤백)은 사라집니다.
- 다음 단계 후보: 설치 파일(.exe) 패키징, 세션 목록 저장과 복원, 에이전트별 오류 패턴과 알림.
