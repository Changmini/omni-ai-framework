# 아키텍처와 근거

이 문서는 프레임워크의 각 결정이 Anthropic 공식 문서의 어느 내용에 근거하는지 정리합니다.
(조사 시점: 2026-10, Claude Code v2.1.296 기준. `claude plugin validate --strict` 통과 확인.)

## 1. 핵심 원칙: 컨텍스트가 가장 중요한 자원

> "Claude's context window fills up fast, and performance degrades as it fills." — [Best practices](https://code.claude.com/docs/en/best-practices)

그래서 구성요소를 **언제 컨텍스트에 로드되는가**로 나눕니다.

| 구성요소 | 로드 시점 | 이 프레임워크에서의 용도 | 근거 |
| --- | --- | --- | --- |
| `CLAUDE.md` | 매 세션 전체 | 추측 불가능한 명령어·규칙만, 200줄 이하 | [Memory](https://code.claude.com/docs/en/memory) |
| `.claude/rules/*.md` + `paths` | 일치하는 파일을 읽을 때 | 코드 일부에만 해당하는 규칙 | [Memory › rules](https://code.claude.com/docs/en/memory) |
| Skills | 설명만 항상, 본문은 호출 시 | 가끔 필요한 지식·워크플로 | [Skills](https://code.claude.com/docs/en/skills) |
| Subagents | 별도 컨텍스트 | 조사·리뷰처럼 파일을 많이 읽는 작업 | [Sub-agents](https://code.claude.com/docs/en/sub-agents) |
| Hooks | 컨텍스트 비용 없음, 결정적 실행 | "매번 예외 없이" 일어나야 하는 것 | [Hooks](https://code.claude.com/docs/en/hooks) |
| Plugins | — | 위 요소들을 묶어 여러 프로젝트에 배포 | [Plugins reference](https://code.claude.com/docs/en/plugins-reference) |

> "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens." — Best practices

→ 위험한 명령 차단은 CLAUDE.md 문장이 아니라 `omni-guardrails`의 PreToolUse 훅으로 구현했습니다.

## 2. 2계층 배포: 플러그인 + 프로젝트 템플릿

**범용(모든 프로젝트 동일)** 부분과 **프로젝트별** 부분을 분리합니다.

- 범용 → 플러그인(`plugins/`)으로 만들어 마켓플레이스(`.claude-plugin/marketplace.json`)로 배포
  - "A plugin marketplace is a directory or repository with a `.claude-plugin/marketplace.json` file" — [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
- 프로젝트별 → `template/`을 복사해 각 프로젝트가 채움 (`CLAUDE.md`, rules, 권한)

플러그인 구성요소는 네임스페이스(`/omni-core:verifying-changes`)가 붙으므로 프로젝트 자체 스킬과 충돌하지 않습니다.

## 3. 플러그인 레이아웃

공식 표준 레이아웃을 그대로 사용합니다([Plugins reference › Standard layout](https://code.claude.com/docs/en/plugins-reference)).

- 매니페스트는 `.claude-plugin/plugin.json`에만, 나머지(`skills/`, `agents/`, `hooks/hooks.json`)는 플러그인 루트에
- 훅 명령은 `"${CLAUDE_PLUGIN_ROOT}"`를 큰따옴표로 감싸 공백 경로에서도 안전하게
- 플러그인 이름은 kebab-case, `claude-`/`anthropic-` 접두어 금지(예약어) → `omni-*`
- 마켓플레이스 항목 `name` = `plugin.json`의 `name` (불일치 시 설치 실패)
- `version`을 명시 → 사용자는 버전이 바뀔 때까지 고정됨. 변경 시 반드시 올림
- 플러그인 루트의 `CLAUDE.md`는 로드되지 않음 → 지침은 스킬로

## 4. 스킬 작성 규칙

[Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) 기준이며 `scripts/validate.py`가 자동 검사합니다.

- `name`: 64자 이하, 소문자·숫자·하이픈, `anthropic`/`claude` 금지, 동명사형 권장 (`planning-changes`, `verifying-changes`)
- `description`: 1,024자 이하, 3인칭, **무엇을 하는지 + 언제 쓰는지**
- 본문 500줄 이하, 참조 파일은 SKILL.md에서 한 단계만 (`authoring-skills/template.md`, `checklist.md`)
- 복잡한 작업은 복사 가능한 체크리스트 + 검증 → 수정 → 반복 루프 (`planning-changes`, `verifying-changes`)
- 부수효과가 있거나 사용자 주도여야 하는 워크플로는 `disable-model-invocation: true` (`writing-specs`)

## 5. 워크플로 스킬의 근거

| 스킬/에이전트 | 공식 권장 사항 |
| --- | --- |
| `planning-changes` | "Explore first, then plan, then code" — 탐색·계획·구현·커밋 4단계 |
| `verifying-changes` | "Give Claude a way to verify its work", "Have Claude show evidence rather than asserting success" |
| `writing-specs` | "Let Claude interview you" — AskUserQuestion으로 인터뷰 후 SPEC.md, 새 세션에서 구현 |
| `adversarial-reviewer` | "Add an adversarial review step" — 새 컨텍스트 서브에이전트가 diff만 보고 검토, 정확성·요구사항 관련 지적만 |
| `authoring-skills` | Skill authoring best practices 체크리스트 |

출처: [Best practices](https://code.claude.com/docs/en/best-practices)

서브에이전트는 "Grant the fewest tools needed" 원칙에 따라 `Write`, `Edit`를 막은 읽기 전용입니다.

## 6. 설정 계층과 템플릿 설정

우선순위(높음 → 낮음): Managed → CLI 인자 → `.claude/settings.local.json` → `.claude/settings.json` → `~/.claude/settings.json` ([Settings](https://code.claude.com/docs/en/settings)).

`template/.claude/settings.json`:

- `$schema`: 편집기 자동완성/검증
- `permissions.deny`: `Read(./.env)`, `Read(./secrets/**)` 등 — "`.claudeignore` has no effect, so move its entries into `Read` deny rules" ([Permissions](https://code.claude.com/docs/en/permissions)). 평가 순서는 deny → ask → allow
- `permissions.ask`: `Bash(git push *)`
- `extraKnownMarketplaces` + `enabledPlugins`: 저장소 단위로 플러그인을 요구하는 공식 방법. 단, 마켓플레이스 등록은 사용자가 폴더를 신뢰한 뒤에만 적용 ([Manage plugins for your organization](https://code.claude.com/docs/en/plugins/org))

개인 설정(`CLAUDE.local.md`, `.claude/settings.local.json`)은 커밋하지 않습니다.

## 7. 클라우드 세션 대응 (vendoring)

[Cloud environments › What carries over](https://code.claude.com/docs/en/cloud-environments):

| 항목 | 클라우드 세션에서 로드 |
| --- | --- |
| 저장소 `CLAUDE.md` | 예 |
| 저장소 `.claude/skills/`, `.claude/agents/` | 예 |
| 저장소 `.claude/settings.json` 훅·권한 | 예 (단일 저장소 세션) |
| 저장소 `.claude/settings.json`의 플러그인/마켓플레이스 | **아니오** |
| `~/.claude/` 사용자 설정·스킬 | 아니오 |

→ `scripts/vendor-plugins.py`가 플러그인의 스킬·에이전트·훅 스크립트를 `.claude/`로 복사하고, 훅 경로를 `${CLAUDE_PLUGIN_ROOT}`에서 `${CLAUDE_PROJECT_DIR}/.claude/hooks/<plugin>/`로 바꿔 `settings.json`에 병합합니다. 중복 실행을 막기 위해 해당 `enabledPlugins` 항목은 제거합니다.

## 8. 훅 동작 규약

[Hooks reference](https://code.claude.com/docs/en/hooks):

- exit 0 + 출력 없음 → 결정 없음, 일반 권한 흐름
- exit 0 + JSON `hookSpecificOutput.permissionDecision` (`deny`/`ask`) → 차단 또는 확인 요청
- exit 2 → 차단, exit 1 등 기타 → 비차단 오류(차단 아님)
- SessionStart의 일반 텍스트 stdout → Claude 컨텍스트에 추가

`guard-bash.sh`는 파괴적 명령(`rm -rf /`, `mkfs`, 디스크 `dd`, fork bomb)은 `deny`, 작업 손실 위험(`git push --force`, `reset --hard`, `clean -f`, `curl | sh`)은 `ask`로 처리합니다. `--force-with-lease`는 허용합니다. jq 또는 python3이 필요하며, 둘 다 없으면 경고 후 통과합니다.

## 9. AGENTS.md와의 관계

Claude Code는 `CLAUDE.md`가 없으면 `AGENTS.md`를 읽습니다. 둘 다 써야 하면 `CLAUDE.md`에 `@AGENTS.md`를 import하고 Claude 전용 내용을 아래에 추가합니다([Memory › AGENTS.md](https://code.claude.com/docs/en/memory)). 템플릿 `CLAUDE.md` 주석에 안내되어 있습니다.

## 10. 검증

- `scripts/validate.py`: 스킬 frontmatter 규칙, 링크된 참조 파일 존재, 에이전트 필수 필드, JSON 문법, CLAUDE.md 길이, 마켓플레이스-매니페스트 이름 일치, 그리고 `claude plugin validate --strict`
- `tests/test-hooks.sh`: 가드레일 deny/ask/통과 22개 케이스 + SessionStart 훅
- CI(`.github/workflows/validate.yml`)에서 위 두 가지를 실행

스킬의 실제 효과는 공식 권장대로 "with and without the skill"을 새 세션에서 비교해 평가합니다.
