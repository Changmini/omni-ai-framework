# universal/ — 도구·모델 중립 AI 프레임워크

> 상태: **설계 단계**. 아직 구현 코드는 없습니다. [docs/DESIGN.md](docs/DESIGN.md)부터 읽으세요.

어떤 AI 코딩 에이전트와 모델을 쓰든 같은 규칙·지식·안전장치·검증 절차가 적용되는 프로젝트 구조입니다.
특정 벤더 기능 대신 **공개 표준**(AGENTS.md, Agent Skills, MCP)과 **도구와 무관한 강제 장치**(git hooks, CI)를 기반으로 합니다.

| 문서 | 내용 |
| --- | --- |
| [docs/DESIGN.md](docs/DESIGN.md) | 원칙, 계층 모델, 설치 구조, 구성요소 명세, 어댑터 계약, 로드맵, 결정 필요 사항 |
| [docs/STANDARDS.md](docs/STANDARDS.md) | 표준 조사 결과와 출처, 확인/미확인 표시 |

| 폴더 | 역할 |
| --- | --- |
| `core/` | 프로젝트에 설치되는 정본 콘텐츠 (AGENTS 템플릿, 스킬, 정책, MCP 정본) |
| `adapters/` | 정본을 도구별 파일로 렌더하는 어댑터 |
| `tools/` | `omni` CLI (init · sync · check · validate · eval) |

Claude Code 전용 구현은 [`../claude-code/`](../claude-code/)에 있으며, 이 설계에서 Claude Code 어댑터의 참조 구현 역할을 합니다.
