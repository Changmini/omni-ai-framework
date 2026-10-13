# claude-code/ — Claude Code 전용 배포본

> 이 폴더의 모든 것은 **Claude Code에서만** 동작합니다. 도구 중립적인 범용 프레임워크는 [`../universal/`](../universal/)을 보세요.

Claude Code의 플러그인·스킬·훅 체계로 여러 프로젝트에 같은 설정을 적용합니다.
Anthropic 공식 문서(code.claude.com/docs, platform.claude.com/docs)의 구조와 규칙을 그대로 따릅니다.
각 설계 결정의 근거 문서는 [ARCHITECTURE.md](ARCHITECTURE.md)에 정리되어 있습니다.

이 폴더는 두 가지 역할을 합니다.

1. **플러그인 마켓플레이스** — `claude-code/` 자체가 마켓플레이스 루트입니다(`.claude-plugin/marketplace.json`). 모든 프로젝트가 공유하는 스킬·서브에이전트·훅을 플러그인으로 배포합니다.
2. **프로젝트 템플릿** — 각 프로젝트에 넣을 `CLAUDE.md`, `.claude/settings.json`, `.claude/rules/` 뼈대

## 구조

```text
omni-ai-framework/
└── claude-code/                  # ← 마켓플레이스 루트. Claude 관련 작업은 모두 여기서
    ├── .claude-plugin/
    │   └── marketplace.json      # 마켓플레이스 카탈로그
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
    ├── template/                 # 각 프로젝트에 복사되는 파일
    │   ├── CLAUDE.md                 # 200줄 이하 프로젝트 지침 뼈대
    │   ├── .claude/settings.json     # 비밀파일 읽기 차단 + 이 프로젝트에서 켤 플러그인(enabledPlugins)
    │   ├── .claude/rules/testing.md  # paths 범위 지정 규칙 예시
    │   ├── .claude/skills/  .claude/agents/   # 프로젝트 전용 확장 위치
    │   ├── .mcp.json                 # 프로젝트 공유 MCP 서버
    │   └── gitignore.claude          # CLAUDE.local.md, settings.local.json
    ├── scripts/
    │   ├── bootstrap-project.sh  # template/ → 대상 프로젝트 (덮어쓰기 없음)
    │   ├── vendor-plugins.py     # 플러그인 구성요소를 대상 프로젝트 .claude/에 복사 (클라우드 세션용)
    │   └── validate.py           # 공식 규칙 검사 + `claude plugin validate --strict`
    ├── tests/test-hooks.sh       # 가드레일 훅 회귀 테스트
    ├── ARCHITECTURE.md           # 설계 근거
    └── AGENTS.md                 # 이 폴더 개발 지침
```

## 설치: `claude-code/` 폴더를 마켓플레이스로 등록

마켓플레이스가 저장소 루트가 아닌 `claude-code/`에 있으므로, **저장소를 clone한 뒤 `claude-code/` 폴더 경로로 등록**합니다. 컴퓨터마다 한 번만 하면 됩니다.

```bash
git clone https://github.com/changmini/omni-ai-framework ~/omni-ai-framework
claude plugin marketplace add ~/omni-ai-framework/claude-code
```

`✔ Successfully added marketplace: omni-ai-framework`가 나오면 됩니다. 이후 아래 A·B 중 원하는 방식으로 플러그인을 켭니다.

> **쓸 수 없는 방법**: `claude plugin marketplace add changmini/omni-ai-framework`(GitHub 한 줄 등록)는 저장소 루트의 `.claude-plugin/`만 찾기 때문에 실패합니다. settings의 GitHub 소스에 `"path": "claude-code/.claude-plugin/marketplace.json"`을 지정하는 방법은 공식 문서에 있지만, Claude Code v2.1.296에서 실측한 결과 등록은 되어도 `Marketplace omni-ai-framework failed to load: cache-miss`로 플러그인이 로드되지 않았습니다.

**업데이트**: 로컬 폴더로 등록한 마켓플레이스는 파일을 제자리에서 읽습니다. `git -C ~/omni-ai-framework pull` 후 새 세션을 시작하거나 세션 안에서 `/reload-plugins`를 실행하면 반영됩니다.

### A. 프로젝트 단위로 켜기 (권장)

```bash
~/omni-ai-framework/claude-code/scripts/bootstrap-project.sh /path/to/your-project
```

대상 프로젝트에 `CLAUDE.md`, `.claude/settings.json` 등이 추가되고(기존 파일은 건드리지 않음), `.gitignore`에 개인 파일이 등록됩니다.
템플릿의 `.claude/settings.json`에는 `enabledPlugins`만 들어 있습니다. 그래서 **마켓플레이스를 등록한 컴퓨터에서 이 프로젝트를 열 때만** 플러그인이 켜지고, 다른 프로젝트에는 영향이 없습니다.
팀원도 각자 위의 "설치" 단계(clone + 등록)를 한 번 해야 합니다. 등록하지 않은 팀원에게는 플러그인이 설치되지 않았다는 안내만 나오고, 나머지 설정은 그대로 적용됩니다.

### B. 내 컴퓨터의 모든 프로젝트에서 켜기

```bash
claude plugin install omni-core@omni-ai-framework
claude plugin install omni-guardrails@omni-ai-framework
```

### C. 클라우드 세션 (claude.ai/code 등)

클라우드 세션은 저장소 설정의 `enabledPlugins`로 플러그인을 **설치하지 않습니다**. 대신 저장소에 커밋된 `.claude/skills/`, `.claude/agents/`, `.claude/settings.json` 훅은 로드합니다.
그래서 구성요소를 프로젝트에 직접 복사(vendoring)해 커밋합니다. 마켓플레이스 등록은 필요 없습니다.

```bash
~/omni-ai-framework/claude-code/scripts/vendor-plugins.py /path/to/your-project           # 전체
~/omni-ai-framework/claude-code/scripts/vendor-plugins.py /path/to/your-project omni-core # 일부만
```

복사본이 플러그인을 대체하므로 해당 `enabledPlugins` 항목은 자동으로 제거됩니다(중복 실행 방지). 업데이트는 다시 실행하면 됩니다.

### D. 조직 전체 강제 적용

관리자가 각 머신의 같은 경로에 저장소를 배포하고, managed settings(claude.ai 관리 콘솔, MDM, `managed-settings.json`)에 다음을 넣으면 모든 머신에 강제 적용됩니다.

```json
{
  "extraKnownMarketplaces": {
    "omni-ai-framework": {
      "source": { "source": "directory", "path": "/opt/omni-ai-framework/claude-code" }
    }
  },
  "enabledPlugins": {
    "omni-core@omni-ai-framework": true,
    "omni-guardrails@omni-ai-framework": true
  }
}
```

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
- 새 영역(예: 프런트엔드 전용)이 커지면 `plugins/omni-<domain>/`로 플러그인을 분리하고 `.claude-plugin/marketplace.json`에 항목 추가

변경 후 반드시 (`claude-code/`에서 실행):

```bash
python3 scripts/validate.py   # 스킬/에이전트 규칙 + claude plugin validate --strict
tests/test-hooks.sh           # 가드레일 회귀 테스트
```

## 라이선스

MIT
