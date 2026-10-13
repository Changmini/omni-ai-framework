# universal/ — 도구·모델 중립 AI 프레임워크

어떤 AI 코딩 에이전트와 모델을 쓰든 같은 규칙·스킬·역할·문서 체계가 적용되게 하는 프로젝트 구조입니다.
루트 문서 `AGENTS.md` 하나가 진입점이고, 에이전트는 그 안의 절차에 따라 스킬·역할·문서 규칙을 **파일 경로로 찾아 읽습니다.**
그래서 스킬 자동 탐색 기능이 없는 도구에서도 동작합니다.

## 무엇이 설치되나

`omni.py init`을 실행하면 `core/`의 내용이 프로젝트 루트에 그대로 복사됩니다.

```text
<project>/
├── AGENTS.md                         # 진입점 (CLAUDE.md와 같은 역할, 공개 형식)
│   ├─ [관리 블록] 1. 작업 절차  2. 스킬 목록  3. 역할 목록  4. 문서 규칙  5. 안전 규칙
│   └─ [Project]  명령어 · 코드 스타일 · 아키텍처 · 주의사항   ← 프로젝트가 채움
└── .agents/
    ├── skills/                       # Agent Skills 공개 표준
    │   ├── planning-changes/         # 탐색 → 계획 → 구현 → 검증 → 리뷰
    │   ├── verifying-changes/        # 프로젝트 검사 실행, 증거 보고
    │   ├── reviewing-changes/        # reviewer 역할로 독립 리뷰
    │   ├── writing-specs/            # 인터뷰 후 스펙 작성 (수동 호출 전용)
    │   ├── writing-documents/        # 템플릿·스타일로 문서 작성
    │   └── authoring-skills/         # 새 스킬·역할 작성 (체크리스트, 템플릿)
    │       (각 스킬에 evals/evals.json 3건)
    ├── agents/                       # 서브 에이전트 역할 정의 (자체 완결 프롬프트)
    │   ├── explorer.md               # 범위가 정해진 코드 조사
    │   ├── planner.md                # 구현 계획 작성
    │   └── reviewer.md               # 새 컨텍스트에서 반박 리뷰
    ├── docs/                         # 문서 디자인
    │   ├── STYLE.md                  # 구조·근거 표시·날짜·링크 규칙
    │   └── templates/                # spec · plan · decision · review
    ├── policies/
    │   ├── command/guard-command.sh  # 위험 명령 판정 (중립 JSON 입출력)
    │   └── change/check-secrets.sh   # 커밋 전 비밀 유출 검사
    └── githooks/pre-commit           # change 정책 실행
```

## AI가 읽는 방식

```text
AGENTS.md (매 작업 시작 시 읽음)
  ├─ 작업이 스킬 목록의 "Use when"에 맞으면 → .agents/skills/<name>/SKILL.md 를 읽고 따름
  │                                          └─ 필요한 단계에서만 references/, assets/ 를 읽음
  ├─ 독립 컨텍스트가 필요하면 → .agents/agents/<role>.md
  │     · 서브 에이전트를 띄울 수 있으면: 파일 본문을 지시문으로 전달
  │     · 없으면: 역할을 선언하고 별도 패스로 직접 수행 (fallback)
  ├─ 문서를 쓰면 → .agents/docs/STYLE.md + templates/
  └─ 끝내기 전에 → Project의 verify 명령 실행, 결과를 근거로 보고
```

### 여러 AI가 읽을 수 있게 한 프롬프트 설계

| 규칙 | 이유 |
| --- | --- |
| 프롬프트는 영어, 번호 매긴 절차, MUST급 규칙은 짧은 명령문 | 모델 간 지시 준수 편차를 줄임. 응답 언어는 "사용자 언어로" 규칙으로 별도 지정 |
| 스킬·역할 목록을 AGENTS.md 표에 직접 포함 | 스킬 자동 탐색이 없는 도구도 설명을 보고 고를 수 있음 |
| 모든 참조는 저장소 루트 기준 상대경로 | 도구별 import 문법(`@path` 등)에 의존하지 않음 |
| 능력마다 대체 경로 명시 (서브 에이전트, 질문 도구, 훅) | 기능이 없는 도구에서도 같은 결과 |
| 역할 파일은 자체 완결 ("호출자 대화를 볼 수 없다", 입력·출력 형식 고정) | 어떤 런타임의 서브 에이전트에 넘겨도 동작 |
| 정본에 도구명·모델명 금지 (`omni.py validate`가 검사) | 특정 벤더에 묶이지 않음 |
| 관리 블록 마커 `<!-- omni:… -->` | 프로젝트 내용과 프레임워크 내용을 분리해 안전하게 업데이트 |

## 도구별 호환성

| 도구 | AGENTS.md | `.agents/skills/` 자동 탐색 | 근거 |
| --- | --- | --- | --- |
| Kimi CLI | ✅ 루트부터 작업 폴더까지 병합해 읽음 | ✅ 프로젝트 `.agents/skills/` 스캔 | 소스 `src/kimi_cli/soul/agent.py`, `src/kimi_cli/skill/__init__.py`, 문서 `docs/en/customization/skills.md` (확인일 2026-10-13) |
| Claude Code | ✅ `CLAUDE.md`가 없으면 읽음 (v2.1.277+) | ❌ (`.claude/skills/`만) → AGENTS.md 목록으로 접근 | 공식 문서 + **실제 세션 실행으로 확인** |
| Codex, Cursor, Gemini CLI 등 | ✅ AGENTS.md 호환 목록에 있음 (Gemini CLI는 `context.fileName` 설정 필요) | 도구별 미확인 | agents.md 공식 저장소 |

**실측 결과 (Claude Code, `CLAUDE.md` 없이 `AGENTS.md`만 둔 프로젝트):**
- "PostgreSQL 결정을 기록해줘" → `writing-documents` 스킬 → `decision.md` 템플릿 → `STYLE.md` 순서로 읽었습니다. 그다음 `docs/decisions/0001-…md`에 템플릿 형식으로 저장하고, 외부 사실은 unverified로 표시했습니다.
- "스테이징된 변경 리뷰해줘" → `reviewing-changes` 스킬 → `reviewer.md` 역할 순서로 읽었습니다. 서브 에이전트 대신 fallback(별도 패스)으로 리뷰해 `average([])`의 0 나누기 결함을 지정된 출력 형식으로 보고했습니다.

Kimi는 이 환경에 계정이 없어 실행하지 못했고, 소스 코드와 공식 문서로만 확인했습니다.

## 사용법

```bash
git clone https://github.com/changmini/omni-ai-framework ~/omni-ai-framework
OMNI=~/omni-ai-framework/universal/tools/omni.py

python3 $OMNI init /path/to/project --hooks   # 설치 (기존 파일은 덮어쓰지 않음, --hooks: pre-commit 활성화)
# → AGENTS.md의 "Project" 섹션을 채움 (verify 명령이 가장 중요)
python3 $OMNI validate /path/to/project       # 규칙 검사
```

| 명령 | 동작 |
| --- | --- |
| `init <project> [--hooks]` | `core/` 설치. 이미 `AGENTS.md`가 있으면 기존 내용은 두고, 관리 블록을 위에 추가 |
| `update <project>` | 프레임워크 파일과 관리 블록을 새 버전으로 교체. 교체한 파일 목록 출력. 프로젝트가 추가한 스킬·역할은 유지 |
| `index <project>` | 스킬·역할을 추가하거나 고친 뒤 AGENTS.md 목록 재생성 |
| `validate <project>` | Agent Skills 규칙, 역할 형식, 목록 최신 여부, 경로 존재, 도구명 미포함, 정책 실행권한 검사 |

Python 3.9+ 표준 라이브러리만 사용합니다. 정책 스크립트는 bash와 `jq` 또는 `python3`가 필요합니다.

## 확장

- **프로젝트 전용 스킬**: `.agents/skills/<동명사-이름>/SKILL.md` 추가 → `omni.py index` → `omni.py validate`. 작성 규칙은 `authoring-skills` 스킬에 있습니다.
- **역할 추가**: `.agents/agents/<name>.md` (frontmatter: `name`, `description`, `access`).
- **하위 폴더 규칙**: 해당 폴더에 `AGENTS.md` 추가. 편집하는 파일에서 가장 가까운 파일이 우선합니다.
- **명령 정책 연결**: 훅을 지원하는 도구는 `guard-command.sh`를 호출하는 얇은 shim을 두면 됩니다. 입력은 `{"command": "..."}`, 출력은 `{"decision": "deny"|"ask", "reason": "..."}`입니다. 훅이 없는 도구에서는 AGENTS.md 5절의 규칙과 git pre-commit, CI가 대신합니다.

## 검사

```bash
universal/tools/tests/run.sh          # 정책 25건 + CLI 11건
python3 universal/tools/omni.py validate universal/core
```

설계 근거: [docs/DESIGN.md](docs/DESIGN.md) · 표준 조사: [docs/STANDARDS.md](docs/STANDARDS.md)
