# adapters/ 🔜

정본(`AGENTS.md`, `.agents/`)을 각 도구의 고유 형식으로 렌더하는 어댑터 위치입니다. 도구마다 폴더 하나를 둡니다.

**어댑터는 필수가 아닙니다.** AGENTS.md를 읽는 도구라면 지시 기반 탐색(목록 → 파일 경로)으로 스킬·역할·문서 규칙에 이미 접근합니다. 어댑터는 다음을 더합니다.

- 도구 고유의 스킬 자동 탐색 (예: Claude Code의 `.claude/skills/`)
- 역할의 고유 서브 에이전트 형식 (예: `.claude/agents/*.md`, Kimi YAML agent spec)
- command 정책의 결정적 강제 (도구 훅 → `guard-command.sh` shim)
- `metadata.omni.*` 번역 (예: `omni.invocation: manual` → `disable-model-invocation: true`)

계약 (DESIGN.md §4.7):
- 멱등이어야 하며 정본 외 파일은 수정하지 않음
- 생성물은 헤더 또는 manifest로 표시
- 지원하지 않는 기능은 실패가 아니라 경고 목록으로 보고
- `--check` 모드: 파일을 쓰지 않고 drift만 보고 (CI용)
- 도구별 경로·형식은 구현 시점에 해당 도구의 **공식 문서나 소스**로 확인하고, 출처를 어댑터 README에 기록
