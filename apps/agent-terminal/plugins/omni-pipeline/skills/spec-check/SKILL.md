---
name: spec-check
description: Reviews a finished change against its SPEC through the reviewer agent, which only reads (Read, Grep, Glob), does not know how the change was made, and reports only the gaps. Use after implementation and before accepting a change in this repository, or when the user asks for a review against a SPEC.
argument-hint: "[SPEC 경로] [브랜치]"
---

# SPEC 기준으로 리뷰 맡기기

구현 과정을 보지 않은 리뷰어는 그 추론에 끌려가지 않는다. 기준(SPEC)과 결과(diff)만 준다.

1. 넘길 것을 준비한다.
   - SPEC 경로. SPEC 이 없으면 받은 요구를 짧은 파일로 적고, 그 파일 기준 리뷰라고 밝힌다.
   - 변경을 파일로: `git diff <기준>...<구현 브랜치> > <저장소 밖 임시 경로>/<주제>.diff`. 리뷰어는 명령을 돌릴 수 없으므로 diff 를 파일로 준다.
   - 선택: 범위(예: 「스타일은 넘기고 정확성에 영향을 주는 누락만 보고」).
2. `omni-pipeline:reviewer` 에이전트를 띄운다(Agent, `subagent_type: omni-pipeline:reviewer`). 프롬프트에는 위 경로와 범위만 넣는다. 대화·구현자 보고·팀장의 의견은 넣지 않는다.
3. 받은 차이는 팀장이 `develop` 8단계 「차이 처리」로 판단한다. 보고가 길면 파일로 남기고 경로만 넘긴다(전화 게임 방지).
