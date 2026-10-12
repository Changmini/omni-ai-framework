# core/

프로젝트의 `AGENTS.md`와 `.agents/`로 설치되는 **정본** 콘텐츠입니다. 도구·모델 이름을 쓰지 않습니다(DESIGN.md P6).

- `AGENTS.template.md` — 상시 지침 템플릿 (1단계에서 작성)
- `skills/` — Agent Skills 표준 스킬. 표준 frontmatter 필드만 사용하고, 도구별 확장은 `metadata.omni.*`로 표현
- `policies/command/`, `policies/change/` — 중립 정책 프로토콜(DESIGN.md §4.4)을 따르는 스크립트와 테스트
- `mcp/` — `.agents/mcp.json` 스키마와 예시

명세: [../docs/DESIGN.md §4](../docs/DESIGN.md#4-구성요소-명세)
