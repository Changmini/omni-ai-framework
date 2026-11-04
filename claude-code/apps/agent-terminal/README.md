# Omni Agent Terminal

일반 터미널처럼 쓰면서 여러 Claude Code 세션을 **한 창**에서 오가는 Electron 데스크톱 앱입니다.
왼쪽은 직접 만든 UI(터미널 목록, Claude 상태, 서브에이전트와 팀원 트리)이고, 오른쪽은 실제 터미널입니다. 터미널 화면은 xterm.js가 그리고, 실제 PowerShell 프로세스는 node-pty가 연결합니다.

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
| 터미널 목록 | 이름은 현재 폴더 이름, 둘째 줄은 git 브랜치(`⎇`)입니다. `cd`하면 따라 바뀝니다 |
| Claude 상태 | 그 터미널에서 `claude`가 실행 중이면 셋째 줄에 `작업 중`, `Bash 실행 중`, `승인 대기`, `대기`, `오류`가 표시됩니다 |
| 서브에이전트와 팀원 | Claude가 띄운 서브에이전트(`Explore` 등)와 에이전트 팀 팀원이 목록 아래 트리로 표시되고, 각각 LED와 지금 쓰는 도구가 보입니다 |
| 작업 진행률 | 작업 목록이 있으면 `작업 1/4 · beta: 로그인 API 테스트 작성`처럼 표시됩니다(팀이면 `팀 작업`) |
| 상단 배너 | 🟠 승인 대기 메시지, 🔴 API 오류, 또는 셸 출력의 오류 줄을 표시합니다 |
| 새 터미널 / 닫기 | `＋ 새 터미널` 또는 `Ctrl+Shift+T` / `✕` 또는 `Ctrl+Shift+W`. 마지막 터미널을 닫으면 창도 닫힙니다 |
| 글자 크기 | 모든 터미널에 적용되고, 설정이 기억됩니다 |

LED: 🟡 작업 중 · 🟠 승인 대기 · 🟢 대기 · 🔴 오류 · ⚫ 종료 · ○ Claude 없이 셸만 실행 중

## Claude 상태는 어떻게 알아내나

Claude Code의 [HTTP 훅](https://code.claude.com/docs/en/hooks)을 씁니다. **앱에서 연 터미널에만** 적용되고, 사용자 설정 파일(`~/.claude/settings.json`)은 건드리지 않습니다.

1. 앱이 켜질 때 `127.0.0.1`의 임의 포트에 신호 수신기를 열고, 그 주소를 담은 훅 설정 파일을 앱 데이터 폴더에 씁니다(`claude-hooks.json`).
2. 앱 터미널의 셸에는 `claude` 함수가 정의됩니다. 사용자가 `claude`를 입력하면 실제 `claude`에 `--settings <훅 설정 파일>`이 붙어 실행됩니다(`src/shell-init/`). 앱 밖의 터미널에는 아무 영향이 없습니다.
3. Claude가 프롬프트 처리, 도구 실행, 승인 요청, 응답 완료 같은 이벤트마다 수신기로 POST합니다. 헤더의 터미널 번호(`OMNI_TERMINAL_ID`)로 어느 탭인지, 본문의 `agent_id`와 `agent_type`으로 어느 서브에이전트나 팀원인지 구분합니다. 요청마다 실행 시 생성한 토큰을 확인합니다.
4. 팀원 목록은 `~/.claude/teams/session-<세션 앞 8자리>/config.json`, 작업 진행률은 `~/.claude/tasks/`를 2초마다 읽어 합칩니다.

검증한 범위(Linux, Claude Code 2.1.318):
- **확인함:** `--settings`로 넘긴 HTTP 훅 실행, 헤더의 환경 변수 치환, 서브에이전트 신호, 대화형 세션의 에이전트 팀(`alpha`, `beta` 2명) 표시와 해산 후 정리
- **확인 못 함:** Windows PowerShell 연동(`omni.ps1`), 팀 작업 진행률(실험에서 Claude가 작업 목록을 만들지 않았음)
- **문서화되지 않은 형식:** 팀 설정과 작업 파일 형식은 공식 문서에 없어서 실제 파일을 보고 맞췄습니다. 버전이 바뀌면 달라질 수 있습니다

## 구조

```text
src/
├── main.js            # Electron 메인: 창, IPC, 훅 수신기 시작, 단일 인스턴스
├── preload.js         # contextBridge로 window.agentApi만 노출
├── sessions.js        # SessionManager: 터미널당 PTY 하나 + 그 안의 Claude 상태
├── agent-state.js     # 순수 로직: 훅 이벤트 → 상태 (메인, 서브에이전트, 팀원)
├── hook-server.js     # 127.0.0.1 HTTP 훅 수신기 (토큰 확인)
├── claude-settings.js # --settings로 넘길 훅 설정 생성
├── shell.js           # 셸 실행 방법(PowerShell/bash/zsh) + 현재 폴더 보고 파싱
├── shell-init/        # 앱 터미널 전용 셸 연동: claude 래퍼, 프롬프트마다 현재 폴더 보고
├── git.js             # .git/HEAD로 브랜치 읽기 (git 프로세스 없음)
├── teams.js           # ~/.claude/teams, ~/.claude/tasks 읽기
├── status.js          # 셸 출력의 오류 줄 감지
└── renderer/          # index.html · styles.css · renderer.js (xterm.js 화면, 사이드바 트리, 단축키)
test/                  # node --test
```

- 보안: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP `script-src 'self'`를 적용했습니다. 터미널에 출력된 링크는 앱 안이 아니라 시스템 브라우저에서 열립니다.
- 디자인: 사이드바, 터미널, 창 배경을 같은 색(`#14161c`)으로 맞추고, 같은 코딩 폰트(D2Coding → Cascadia Code → Fira Code → Consolas 순)를 씁니다. 이 색을 바꿀 때는 `styles.css`의 `--bg`, `renderer.js`의 `TERMINAL_THEME.background`, `main.js`의 `backgroundColor` 세 곳을 함께 수정하세요.

## 테스트

```bash
npm test
```

node-pty가 현재 Node 버전용으로 빌드돼 있지 않으면 실제 PTY 통합 테스트는 건너뜁니다.

## 한계와 다음 단계

- 셸 연동은 PowerShell, bash, zsh만 지원합니다. 다른 셸에서는 Claude 상태와 현재 폴더가 표시되지 않습니다.
- 에이전트 팀은 Claude Code의 실험 기능입니다(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).
- 화면을 새로고침하면 실행 중인 세션은 다시 연결되지만, 그 전에 출력된 내용(스크롤백)은 사라집니다.
- 다음 단계 후보: 백그라운드 탭 알림(Windows 알림, 작업 표시줄 깜빡임), 프로젝트 바로가기, 세션 복원, 화면 분할, 설치 파일(.exe) 패키징.
