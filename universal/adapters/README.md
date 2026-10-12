# adapters/

정본(`AGENTS.md`, `.agents/`)을 각 도구가 읽는 파일로 렌더합니다. 도구마다 폴더 하나를 둡니다(`claude-code/`, `gemini-cli/`, `codex/`, `copilot/`, `cursor/`).

계약 (DESIGN.md §4.6):
- 멱등이어야 하며 정본 외 파일은 수정하지 않음
- 생성물은 헤더 또는 manifest로 표시
- 지원하지 않는 기능은 실패가 아니라 경고 목록으로 보고
- `--check` 모드: 파일을 쓰지 않고 drift만 보고 (CI용)
- 도구별 경로·형식은 구현 시점에 해당 도구의 **공식 문서**로 확인하고, 출처를 어댑터 README에 기록
