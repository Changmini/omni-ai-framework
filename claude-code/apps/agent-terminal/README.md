# Omni Agent Terminal

일반 터미널처럼 쓰면서 여러 Claude Code 세션을 **한 창**에서 오가는 Electron 데스크톱 앱입니다.
왼쪽은 직접 만든 UI(터미널 목록과 상태 LED)이고, 오른쪽은 실제 터미널입니다. 터미널 화면은 xterm.js가 그리고, 실제 PowerShell 프로세스는 node-pty가 연결합니다.

![screenshot](docs/screenshot.png)

## 실행 (Windows)

Node.js 20 이상이 필요합니다.

```bash
cd claude-code/apps/agent-terminal
npm install
npm start
```

- 앱을 켜면 홈 폴더에서 PowerShell이 바로 열립니다. 평소처럼 `cd`로 프로젝트에 가서 `claude`를 실행하면 됩니다.
- 터미널 창 없이 띄우려면 바탕화면 바로가기의 대상에 `"<앱 폴더>\node_modules\electron\dist\electron.exe" "<앱 폴더>"`를 넣으세요. `npm start`는 개발용입니다.
- Windows에서는 별도 빌드 도구가 필요 없습니다. node-pty 1.1 패키지에 `prebuilds/win32-x64`, `win32-arm64` 바이너리가 들어 있습니다.
- macOS와 Linux에서는 `$SHELL`을 사용합니다. Linux에는 node-pty prebuild가 없으므로 `npm install` 뒤 `cd node_modules/node-pty && npx node-gyp rebuild`로 빌드하세요. Python, make, C++ 컴파일러가 필요합니다.

## 기능

| 영역 | 동작 |
|---|---|
| 터미널 목록 | 클릭하면 전환하고, `✕`를 누르면 닫습니다. 마지막 터미널을 닫으면 창도 닫힙니다 |
| 새 터미널 | `＋ 새 터미널` 버튼 또는 `Ctrl+Shift+T` (홈 폴더에서 PowerShell) |
| 현재 터미널 닫기 | `Ctrl+Shift+W` |
| 상태 LED | 🟡 출력 중(최근 1.5초 안에 출력) · 🟢 대기 · 🔴 오류 감지 · ⚫ 종료 |
| 글자 크기 | 모든 터미널에 적용되고, 설정이 기억됩니다 |

**터미널 → UI:** 출력에서 `Error: …`, `EADDRINUSE … in use`, `command not found`, `is not recognized as …` 같은 줄을 감지하면 LED가 빨간색으로 바뀌고, 상단에 해당 줄이 배너로 표시됩니다. 다음에 Enter를 입력하면 경고가 해제됩니다. 패턴은 `src/status.js`의 `ERROR_PATTERNS`에서 바꿀 수 있습니다.

## 구조

```text
src/
├── main.js        # Electron 메인: 창, IPC, 보안 설정
├── preload.js     # contextBridge로 window.agentApi만 노출
├── sessions.js    # SessionManager: 터미널당 PTY 하나 (생성, 입력, 크기 조정, 종료, 상태 알림)
├── status.js      # 순수 로직: ANSI 제거, 오류 패턴, 상태 판정
└── renderer/      # index.html · styles.css · renderer.js (xterm.js 화면, 사이드바, 단축키)
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

- 사이드바의 경로는 터미널을 연 폴더입니다. `cd`로 이동해도 아직 따라가지 않습니다.
- 상태는 출력 타이밍과 텍스트 패턴으로만 추정합니다. Claude Code 화면의 세부 상태(권한 확인 대기 등)는 아직 구분하지 못합니다.
- 화면을 새로고침하면 실행 중인 세션은 다시 연결되지만, 그 전에 출력된 내용(스크롤백)은 사라집니다.
- 다음 단계 후보: 설치 파일(.exe) 패키징, 세션 목록 저장과 복원, 에이전트별 오류 패턴과 알림.
