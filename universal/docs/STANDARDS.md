# 표준 조사: 도구 중립 AI 작업 환경의 기반

조사일: 2026-10-12. 원문은 각 표준의 공식 저장소에서 직접 확인했습니다.
✅ = 1차 출처(표준 저장소·벤더 공식 문서)로 확인 / ⚠️ = 2차 출처만 있거나 출처끼리 충돌 → 어댑터 구현 시 해당 도구 공식 문서로 재확인

## 1. 채택하는 공개 표준

| 영역 | 표준 | 담는 것 | 상태 |
| --- | --- | --- | --- |
| 상시 지침 | **AGENTS.md** | 빌드·테스트 명령, 규칙, 관례 | ✅ 공개 형식, 23개 이상 도구 호환 |
| 절차 지식 | **Agent Skills** (`SKILL.md`) | 필요할 때만 로드되는 워크플로·참조자료·스크립트 | ✅ 공개 표준, 46개 제품 지원 |
| 외부 도구 연결 | **MCP** (Model Context Protocol) | 도구·데이터 서버 | ✅ 프로토콜은 표준. ⚠️ **클라이언트 설정 파일은 표준 아님** |
| 결정적 강제 | (표준 없음) → **git hooks + CI** | 비밀 유출 차단, 검증 게이트 | 모든 도구와 무관하게 동작 |

## 2. AGENTS.md

출처: <https://github.com/agentsmd/agents.md> (README, 사이트 소스 `components/FAQSection.tsx`, `CompatibilitySection.tsx`)

- "a simple, open format for guiding coding agents … a README for agents" ✅
- 필수 필드 없음. 일반 Markdown이며 제목은 자유 ✅
- 충돌 규칙: **"The closest AGENTS.md to the edited file wins; explicit user chat prompts override everything."** → 하위 폴더 AGENTS.md로 범위 규칙 구현 ✅
- "Will the agent run testing commands found in AGENTS.md automatically? Yes—if you list them." → 검증 명령은 AGENTS.md에 반드시 기재 ✅
- 사이트 호환 목록: Codex, Amp, Jules, Cursor, Factory, RooCode, Aider, Gemini CLI, goose, Kilo Code, opencode, Phoenix, Zed, Semgrep, Warp, Coding agent, VS Code, Ona, Devin, Windsurf, Autopilot & Coded Agents, Augment Code, Junie ✅
- Gemini CLI는 `.gemini/settings.json`에 `{"context": {"fileName": "AGENTS.md"}}` 설정 필요 ✅ (같은 FAQ)
- Claude Code: `CLAUDE.md`가 없으면 `AGENTS.md`를 직접 읽음(v2.1.277+), 둘 다 쓰려면 `CLAUDE.md`에 `@AGENTS.md` import ✅ (<https://code.claude.com/docs/en/memory>)

## 3. Agent Skills

출처: <https://github.com/agentskills/agentskills> (`docs/specification.mdx`, `docs/client-implementation/adding-skills-support.mdx`, `docs/skill-creation/*`, `docs/snippets/clients.jsx`)

- Anthropic이 개발해 공개 표준으로 공개, 생태계 기여에 열려 있음. 코드 Apache-2.0, 문서 CC-BY-4.0 ✅
- 구조: `skill-name/SKILL.md` + 선택 `scripts/`, `references/`, `assets/` ✅
- frontmatter (표준 필드는 이것뿐) ✅

  | 필드 | 필수 | 제약 |
  | --- | --- | --- |
  | `name` | 예 | 1–64자, `a-z0-9-`, 하이픈으로 시작·끝 금지, `--` 금지, **부모 폴더명과 일치** |
  | `description` | 예 | 1–1024자, 무엇을 + 언제 |
  | `license` | 아니오 | |
  | `compatibility` | 아니오 | ≤500자, 환경 요구사항 |
  | `metadata` | 아니오 | 문자열→문자열 맵, 클라이언트별 추가 속성 |
  | `allowed-tools` | 아니오 | 실험적, 지원 편차 있음 |

- 점진적 공개: 메타데이터 ~100토큰(항상) → 본문 <5000토큰 권장(활성화 시) → 리소스(필요 시). 본문 500줄 이하, 참조는 한 단계 ✅
- 검증 도구: `skills-ref validate ./my-skill` ✅
- 평가: 스킬 폴더의 `evals/evals.json`(prompt, expected_output, files), 스킬 있음/없음 비교 ✅
- **탐색 위치**: 표준은 위치를 강제하지 않지만 클라이언트 구현 가이드가 `<project>/.agents/skills/`, `~/.agents/skills/`를 "cross-client interoperability" 관례로 제시. 일부 클라이언트는 호환을 위해 `.claude/skills/`도 스캔 ✅
- 지원 제품(46): Junie, Gemini CLI, OpenCode, OpenHands, Cursor, Amp, Letta, Goose, GitHub Copilot, VS Code, Claude Code, Claude, ChatGPT & Codex, Factory, TRAE, Spring AI, Roo Code, Mistral AI Vibe, Kiro, Tabnine, Snowflake Cortex Code, Databricks Genie Code 등 ✅
- 도구별 실제 스캔 경로(Codex `.agents/skills`/`.codex/skills`, Copilot `.github/skills` 등) ⚠️ 2차 출처끼리 불일치

### Anthropic 규칙과의 차이 (둘 다 만족하도록 합집합 적용)

| 규칙 | Agent Skills 표준 | Anthropic 문서 |
| --- | --- | --- |
| `--` 금지, 폴더명 일치 | 있음 | 없음 |
| `anthropic`/`claude` 예약어 금지 | 없음 | 있음 |
| `disable-model-invocation`, `argument-hint`, `context: fork` 등 | 없음 (→ 다른 도구에서 무시됨) | Claude Code 확장 |

## 4. 도구별 확인: Kimi CLI

출처: <https://github.com/MoonshotAI/kimi-cli> (확인 커밋 2026-09-22). 웹 문서 사이트는 이 환경에서 접근할 수 없어 저장소의 소스와 문서로 확인했습니다.

- **AGENTS.md** ✅ — `src/kimi_cli/soul/agent.py`의 `load_agents_md`가 프로젝트 루트부터 작업 폴더까지 `AGENTS.md`(또는 `agents.md`)와 `.kimi/AGENTS.md`를 찾아 병합합니다.
- **스킬** ✅ — `src/kimi_cli/skill/__init__.py`, `docs/en/customization/skills.md`:
  - 프로젝트: generic 그룹 `.agents/skills/`, brand 그룹 `.kimi/skills/` > `.claude/skills/` > `.codex/skills/`
  - 사용자: `~/.config/agents/skills/` > `~/.agents/skills/`, brand 그룹 `~/.kimi/skills/` 등
  - 프로젝트 스킬 탐색은 가장 가까운 `.git` 상위 폴더까지 올라갑니다(CHANGELOG).
- **서브 에이전트** ✅ — 고유 형식은 YAML agent spec(`src/kimi_cli/agents/default/*.yaml`, `subagents:` 맵, `--agent-file`)입니다. 기본 에이전트가 `coder`, `explore`, `plan` 서브 에이전트와 Agent 도구를 가지고 있어, 자유 형식 지시문을 넘길 수 있습니다.
- **실행 검증**: ❌ 이 환경에 Moonshot 계정이 없어 실제 세션은 실행하지 못했습니다.

## 5. 도구별 확인: Claude Code (실제 세션)

- `CLAUDE.md` 없이 `AGENTS.md`만 둔 프로젝트에서 `claude -p`로 두 작업을 실행했습니다(v2.1.296, 2026-10-13). 에이전트가 AGENTS.md 목록을 보고 `.agents/skills/…/SKILL.md`, `.agents/agents/reviewer.md`, `.agents/docs/templates/decision.md`를 직접 읽고 따랐습니다. ✅
- 스킬 자동 탐색은 `.claude/skills/`만 대상이므로 `.agents/skills/`는 AGENTS.md 목록으로만 접근합니다 ✅ (<https://code.claude.com/docs/en/skills>).

## 6. MCP

- 프로토콜 자체는 공개 표준. 그러나 **프로젝트 설정 파일 위치·스키마는 도구마다 다름**:
  - Claude Code: `.mcp.json`, 키 `mcpServers` ✅ (code.claude.com)
  - Cursor `.cursor/mcp.json`, VS Code `.vscode/mcp.json`, Codex `~/.codex/config.toml`(`mcp_servers`), Gemini CLI `.gemini/settings.json` ⚠️ (2차 출처, 일부 충돌)
- 결론: 정본 하나를 두고 어댑터가 도구별 파일을 생성해야 함

## 7. 도구 중립으로 일반화한 Anthropic 권장 사항

Anthropic 문서(<https://code.claude.com/docs/en/best-practices>, <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices>)에서 특정 도구 기능이 아닌 **원리**만 추출:

| 원리 | 도구 중립 구현 |
| --- | --- |
| 컨텍스트 창이 가장 중요한 자원, 채울수록 성능 저하 | 상시 지침 최소화, 스킬로 지연 로드 |
| 검증 수단을 주면 스스로 반복해 완성 | 프로젝트 단일 검증 진입점 + AGENTS.md 기재 |
| 탐색 → 계획 → 구현 → 커밋 분리 | 중립 워크플로 스킬 |
| 새 컨텍스트의 반박 리뷰 | "가능하면 하위 에이전트/새 세션" + 미지원 시 대체 절차 |
| 지침은 권고, 강제는 결정적 장치로 | 정책 스크립트 + git hooks + CI |
| 스킬은 평가로 개발, 여러 모델로 테스트 | `evals/` + 도구·모델 매트릭스 |
