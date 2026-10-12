# omni-ai-framework

어떤 프로젝트에든 동일하게 적용할 수 있는 **Claude Code 범용 AI 아키텍처**입니다.
Anthropic 공식 문서(code.claude.com/docs, platform.claude.com/docs)의 구조와 규칙을 그대로 따릅니다.
각 설계 결정의 근거 문서는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)에 정리되어 있습니다.

이 저장소는 두 가지 역할을 합니다.

1. **플러그인 마켓플레이스** — 모든 프로젝트가 공유하는 스킬·서브에이전트·훅을 플러그인으로 배포
2. **프로젝트 템플릿** — 각 프로젝트에 넣을 `CLAUDE.md`, `.claude/settings.json`, `.claude/rules/` 뼈대

## 구조

```text
omni-ai-framework/
├── .claude-plugin/
│   └── marketplace.json          # 마켓플레이스 카탈로그
├── plugins/
│   ├── omni-core/                # 범용 워크플로 플러그인
│   │   ├── .claude-plugin/plugin.json
│   │   ├── skills/
│   │   │   ├── planning-changes/     # 탐색 → 계획 → 구현 → 검증 → 리뷰
│   │   │   ├── verifying-changes/    # 프로젝트 자체 테스트/린트/빌드 탐색·실행, 증거 보고
│   │   │   ├── writing-specs/        # 인터뷰 후 SPEC.md 작성 (수동 실행 전용)
│   │   │   └── authoring-skills/     # 공식 규칙에 맞는 새 스킬 작성 (template.md, checklist.md)
│   │   ├── agents/
│   │   │   └── adversarial-reviewer.md   # 새 컨텍스트에서 diff를 반박 검토 (읽기 전용)
│   │   ├── hooks/hooks.json          # SessionStart: git 상태를 컨텍스트에 주입
│   │   └── scripts/session-context.sh
│   └── omni-guardrails/          # 안전장치 플러그인
│       ├── .claude-plugin/plugin.json
│       ├── hooks/hooks.json          # PreToolUse(Bash)
│       └── scripts/guard-bash.sh     # rm -rf / 등 차단(deny), force push·reset --hard 등 확인(ask)
├── template/                     # 각 프로젝트에 복사되는 파일
│   ├── CLAUDE.md                     # 200줄 이하 프로젝트 지침 뼈대
│   ├── .claude/settings.json         # 비밀파일 읽기 차단 + 마켓플레이스/플러그인 자동 등록
│   ├── .claude/rules/testing.md      # paths 범위 지정 규칙 예시
│   ├── .claude/skills/  .claude/agents/   # 프로젝트 전용 확장 위치
│   ├── .mcp.json                     # 프로젝트 공유 MCP 서버
│   └── gitignore.claude              # CLAUDE.local.md, settings.local.json
├── scripts/
│   ├── bootstrap-project.sh      # template/ → 대상 프로젝트 (덮어쓰기 없음)
│   ├── vendor-plugins.py         # 플러그인 구성요소를 대상 프로젝트 .claude/에 복사 (클라우드 세션용)
│   └── validate.py               # 공식 규칙 검사 + `claude plugin validate --strict`
├── tests/test-hooks.sh           # 가드레일 훅 회귀 테스트
├── .github/workflows/validate.yml
└── CLAUDE.md                     # 이 저장소를 개발할 때의 지침
```

## 적용 방법

목적에 맞는 경로를 고르세요. 함께 써도 됩니다.

### A. 프로젝트 단위 (팀 공유, 권장)

```bash
git clone https://github.com/changmini/omni-ai-framework
omni-ai-framework/scripts/bootstrap-project.sh /path/to/your-project
```

대상 프로젝트에 `CLAUDE.md`, `.claude/settings.json` 등이 추가되고(기존 파일은 건드리지 않음) `.gitignore`에 개인 파일이 등록됩니다.
`CLAUDE.md`를 채우고 커밋하면, 팀원이 그 폴더를 **신뢰(trust)** 하는 순간 `extraKnownMarketplaces`와 `enabledPlugins`에 따라 플러그인이 자동 설치됩니다.

### B. 개인 단위 (내 컴퓨터의 모든 프로젝트)

```bash
claude plugin marketplace add changmini/omni-ai-framework
claude plugin install omni-core@omni-ai-framework
claude plugin install omni-guardrails@omni-ai-framework
```

### C. 클라우드 세션 (claude.ai/code 등)

클라우드 세션은 저장소 설정의 `enabledPlugins`로 플러그인을 **설치하지 않지만**, 저장소에 커밋된 `.claude/skills/`, `.claude/agents/`, `.claude/settings.json` 훅은 로드합니다.
그래서 구성요소를 프로젝트에 직접 복사(vendoring)합니다.

```bash
omni-ai-framework/scripts/vendor-plugins.py /path/to/your-project           # 전체
omni-ai-framework/scripts/vendor-plugins.py /path/to/your-project omni-core # 일부만
```

복사본이 플러그인을 대체하므로 해당 `enabledPlugins` 항목은 자동으로 제거됩니다(중복 실행 방지). 업데이트는 다시 실행하면 됩니다.

### D. 조직 전체 강제 적용

관리자가 managed settings(claude.ai 관리 콘솔, MDM, `managed-settings.json`)에 A와 같은 `extraKnownMarketplaces` + `enabledPlugins`를 넣으면 모든 머신에 강제 적용됩니다.

## 사용

| 무엇 | 호출 |
| --- | --- |
| 큰 변경 작업 흐름 | `/omni-core:planning-changes <작업>` (관련 요청 시 Claude가 자동 사용하기도 함) |
| 검증 | `/omni-core:verifying-changes` (작업 후 자동 사용) |
| 스펙 인터뷰 | `/omni-core:writing-specs <기능>` (수동 전용) |
| 새 스킬 만들기 | `/omni-core:authoring-skills <설명>` |
| 반박 리뷰 | "adversarial-reviewer 서브에이전트로 리뷰해줘" |

vendoring한 경우 네임스페이스 없이 `/planning-changes`처럼 호출합니다.

## 확장

- **모든 프로젝트 공통** 스킬 → `plugins/omni-core/skills/<gerund-name>/SKILL.md` 추가 후 `plugin.json`의 `version` 올리기
- **특정 프로젝트 전용** 스킬 → 그 프로젝트의 `.claude/skills/`
- 새 영역(예: 프런트엔드 전용)이 커지면 `plugins/omni-<domain>/`로 플러그인을 분리하고 `marketplace.json`에 항목 추가

변경 후 반드시:

```bash
python3 scripts/validate.py   # 스킬/에이전트 규칙 + claude plugin validate --strict
tests/test-hooks.sh           # 가드레일 회귀 테스트
```

## 라이선스

MIT
