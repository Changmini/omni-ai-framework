# tools/

`omni` CLI 위치입니다. 구현 언어는 미정입니다(DESIGN.md §8).

| 명령 | 동작 |
| --- | --- |
| `omni init <project>` | core 설치, `omni.json`·`omni.lock` 생성. 기존 파일은 덮어쓰지 않음 |
| `omni sync [--check]` | 활성 어댑터 실행 / drift 검사 |
| `omni update` | core 새 버전 반영, lock 해시로 로컬 수정 보존 |
| `omni validate` | 스킬 표준·이름 규칙, 중립 서술 린트, mcp.json 스키마, AGENTS.md 길이 |
| `omni eval <skill> --agent <cmd>` | evals를 스킬 있음/없음으로 실행해 비교 |
