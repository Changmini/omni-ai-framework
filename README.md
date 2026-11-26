# omni-ai-framework

여러 프로젝트에 같은 AI 작업 규칙·지식·안전장치를 적용하기 위한 도구 모음입니다.
분야별 서브 프로젝트로 나뉘어 있고, **필요한 서브 프로젝트만 가져다 씁니다.** 서브 프로젝트끼리는 서로에게 의존하지 않습니다.

| 서브 프로젝트 | 무엇인가 | 시작하기 |
| --- | --- | --- |
| [`universal/`](universal/) | **도구·모델 중립** 프레임워크. 프로젝트에 설치하면 `AGENTS.md`가 스킬·역할·문서 규칙으로 안내하고, git hooks가 강제 | [사용 안내](universal/README.md) · [설계](universal/docs/DESIGN.md) |
| [`claude-code/`](claude-code/) | **Claude Code 전용** 플러그인 마켓플레이스 + 프로젝트 템플릿 | [설치](claude-code/README.md#설치-claude-code-폴더를-마켓플레이스로-등록) |
| [`apps/agent-terminal/`](apps/agent-terminal/) | **Omni Agent Terminal**: 여러 Claude Code 세션을 한 창에서 지켜보고 오가는 데스크톱 앱(Electron) | [실행](apps/agent-terminal/README.md) |

`claude-code/`는 `universal/` 설계를 Claude Code에 맞춘 구현입니다. 데스크톱 앱은 `claude-code/`의 플러그인 없이도 동작하고, 일부 기능(HTML 미리보기 그림, 권장 개발 보드의 에이전트)만 그 플러그인을 씁니다.

## 구조

```text
omni-ai-framework/
├── README.md            # 이 문서: 서브 프로젝트 안내
├── LICENSE              # MIT (모든 서브 프로젝트에 적용)
├── universal/           # 도구 중립 프레임워크
│   ├── README.md · AGENTS.md
│   ├── core/            #   프로젝트에 복사되는 파일 (AGENTS.md, .agents/)
│   ├── tools/           #   omni.py: 설치·색인·검사
│   ├── docs/            #   설계, 표준
│   └── adapters/        #   도구별 출력 (예정)
├── claude-code/         # Claude Code 마켓플레이스 루트
│   ├── README.md · AGENTS.md · ARCHITECTURE.md
│   ├── .claude-plugin/  #   마켓플레이스 카탈로그
│   ├── plugins/         #   omni-core, omni-guardrails, omni-pipeline, omni-jira
│   ├── template/        #   프로젝트에 복사되는 CLAUDE.md, .claude/
│   └── scripts/ · tests/
├── apps/
│   └── agent-terminal/  # 데스크톱 앱
│       ├── README.md · AGENTS.md
│       └── src/ · test/ · scripts/
└── .github/             # 저장소 전체 CI: 개인정보 검사, universal·claude-code 검사
```

- 각 서브 프로젝트의 `README.md`는 사용법, `AGENTS.md`는 그 서브 프로젝트를 고칠 때의 규칙과 검사 명령입니다. 저장소 루트에는 개발 규칙 파일을 두지 않으니, 작업은 해당 서브 프로젝트 폴더에서 시작하세요.
- 모든 서브 프로젝트에 공통인 규칙(글쓰기, 근거, 보안, 개인정보 등)은 각 `AGENTS.md`에 같은 내용으로 들어 있습니다.

## 서브 프로젝트 하나만 받기

저장소 전체를 받아도 되고, git의 sparse checkout으로 필요한 폴더만 받을 수도 있습니다.

```bash
git clone --filter=blob:none --sparse https://github.com/changmini/omni-ai-framework ~/omni-ai-framework
```

```bash
git -C ~/omni-ai-framework sparse-checkout set claude-code
```

폴더만 따로 복사해 쓸 때는 루트의 `LICENSE`도 함께 가져가세요.

## 라이선스

MIT
