---
name: running-plan-pipeline
description: Use when the user asks for a plan document only — design, write and critic-check an implementation plan without implementing — in this repository, especially with an agent team in tmux.
---

## 개요

- 구현하지 않는다. 산출물은 플랜 문서(필요하면 시나리오·설계 문서)뿐이다.
- 팀: 플래너·비판 검증을 이름 붙은 팀원으로 띄우고 서로 직접 메시지를 주고받게 한다. 코디네이터(메인 세션)는 사용자 결정만 중계한다.
- 플랜이 작성되면 비판 검증이 바로 검토해 플래너에게 피드백한다. 리뷰어는 이 단계에 넣지 않는다.
- 각 에이전트의 세부 규칙은 이 플러그인의 `agents/<이름>.md` 가 정본이다(호출 이름은 `omni-pipeline:<이름>`).
- 구현까지 갈 때는 running-dev-pipeline 을 쓴다.

## 시작

1. 착수 확인(첫 시작만). 플랜은 규칙 파일의 「Agent pipeline」 절에 적힌 플랜 위치에 쓴다(기록 집계 명령이 있으면 재생성).
2. 팀원 띄우기 — `Agent` 에 `name` 을 주고 백그라운드로(tmux 패널). 정의에 model 이 있으면 넘기지 않는다.

| 이름 예 | 정의 | 받는 지시 |
|---|---|---|
| `<주제>-planner` | `omni-pipeline:planner` | 플랜 경로·근거 문서·저장소 규칙. 다 쓰면 critic 에 「플랜 준비됨」 직접 통보 |
| `<주제>-critic` | `omni-pipeline:rationale-critic` | 최신본 먼저 읽기 → 근거 등급과 Blocker/High/Nice-to-have 판정 → 수정 목록은 planner 에 직접, 사용자 결정 항목은 team-lead 에만 |

3. planner 에게: critic 피드백을 반영하고, 반영 뒤 critic 에 재검토 요청.

## 사용자 결정 중계

- 남은 결정은 표 하나로 모아 권장안과 함께 한 번에 묻는다.
- 묻기 전에 그 결정이 **구체적으로 무슨 작업인지**(바뀌는 파일·테이블·동작, 예시 시나리오) 먼저 설명한다. 약어(D1·R9) 만으로 묻지 않는다.
- 선택지 설명에 다른 결정을 끼워 넣지 않는다. 딸린 결정은 따로 적는다.
- 결정이 나면 planner·critic 에 「사용자 확정」으로 보낸다.
- **보낸 뒤 반영을 grep 으로 확인한다.** 팀원 보고(「반영함」)만 믿지 않는다. 메시지가 엇갈려 옛 판 기준으로 일하는 일이 잦다 — 줄 번호가 다르면 최신본을 다시 본다.
- 사용자 정정이 앞 결정을 뒤집으면 근거 문서(설계 등)까지 같이 고치게 한다.

## 진행 중

- idle 알림이 앞 보고의 반복이면 사용자에게 「새 내용 없음」 한 줄.
- 실데이터·코드 확인은 코디네이터가 직접 하고 결과만 넘긴다.

## 마무리

- 끝 조건: critic 의 Blocker·High·Nice-to-have 0, 열린 사용자 결정 0.
- 플랜 status 는 사용자 지시 전까지 바꾸지 않는다. 규칙 파일의 「Agent pipeline」 절의 기록 집계 명령이 있으면 실행하고 검사한다.
- 팀원은 닫지 않는다(구현 때 재사용). 커밋하지 않는다.

## 흔한 실수

| 실수 | 대신 |
|---|---|
| 결정을 보냈으니 반영됐다고 보고 | grep 으로 확인 후 보고 |
| 권장안 설명에 컬럼 이동 같은 부수 결정을 섞음 | 별도 항목 |
| 「D8 확정할까요?」만 물음 | 지금 동작·바뀌는 동작·이유를 먼저 설명 |
| 지울 문서를 그대로 삭제 | 플랜이 그 문서를 참조하면 먼저 자립화 |
