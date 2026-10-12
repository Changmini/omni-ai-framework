# omni-ai-framework

여러 프로젝트에 같은 AI 작업 규칙·지식·안전장치를 적용하기 위한 프레임워크입니다.

| 폴더 | 성격 | 상태 |
| --- | --- | --- |
| [`universal/`](universal/) | **도구·모델 중립** 프레임워크. AGENTS.md · Agent Skills · MCP 공개 표준과 git hooks · CI 기반 | 설계 단계 → [설계 문서](universal/docs/DESIGN.md) |
| [`claude-code/`](claude-code/) | **Claude Code 전용** 플러그인 마켓플레이스 + 프로젝트 템플릿 | 동작함 (`claude plugin validate --strict` 통과) |

`universal/`이 기준 설계이고, `claude-code/`는 그 설계 중 Claude Code 어댑터의 참조 구현입니다.

루트의 `.claude-plugin/marketplace.json`은 Claude Code가 `claude plugin marketplace add changmini/omni-ai-framework`를 실행할 때 저장소 루트에서만 찾는 진입점 파일입니다. 내용은 모두 `claude-code/`를 가리킵니다.

## 라이선스

MIT
