---
name: implementing-specs
description: Hands an approved SPEC to the implementer agent so the work starts in a fresh context from the SPEC alone, in its own git worktree, and comes back as commits and a diff. Use when a SPEC in this repository is approved and ready to build, or the user asks to implement a SPEC file.
argument-hint: "[SPEC 경로]"
---

# SPEC 구현 맡기기

계획 대화로 무거워진 컨텍스트보다, SPEC 하나로 시작하는 깨끗한 컨텍스트가 낫다. 언제 멈출지는 SPEC 의 「완료 기준」이 정한다.

1. 넘길 것을 준비한다.
   - 승인된 SPEC 의 절대 경로.
   - 구현자마다 worktree 하나를 지금 HEAD 에서 만든다: `git worktree add <저장소 옆 경로> -b <브랜치>`. 서브에이전트의 `isolation: worktree` 는 지금 브랜치가 아니라 기본 브랜치에서 갈라지므로 쓰지 않는다.
   - 구현자가 여럿이면 같은 파일을 건드리지 않게 SPEC 을 나눠 맡긴다(요구 번호로).
   - 수정 차례라면, 고칠 차이 목록 파일.
2. `omni-pipeline:implementer` 에이전트를 띄운다(Agent, `subagent_type: omni-pipeline:implementer`). 프롬프트에는 위 경로들만 넣는다. 대화나 팀장의 메모는 넣지 않는다. 정의에 model 이 있으므로 Agent 호출에 model 을 넘기지 않는다.
3. 보고를 확인한다.
   - 「완료 기준」 항목마다 충족 근거, 또는 미충족 이유가 있는가.
   - 「SPEC 문제」는 코드로 덮지 말고 팀장이 판단한다(`leading-changes` 8단계 「차이 처리」).
4. 브랜치를 `reviewing-changes` 로 넘긴다. 리뷰가 끝나 받아들이면 브랜치 병합과 `git worktree remove` 는 사용자 지시에 따라 한다.
