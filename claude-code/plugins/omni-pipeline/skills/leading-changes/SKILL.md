---
name: leading-changes
description: Leads a change as the lead (팀장) from the user's request to an accepted result — decides whether it needs the SPEC → implement → review structure, interviews the user and writes the SPEC, hands it to the implementer and reviewer agents, and decides on each reported gap. Use when a change in this repository touches several files or its requirements are unclear, or the user asks to run the development pipeline. Skip it for a one- or two-file change.
argument-hint: "[요청]"
---

# 팀장으로 변경 이끌기

대화는 팀장(이 세션)에서만 한다. 다른 세션은 파일만 주고받는다. SPEC 이 모두가 읽는 하나뿐인 기준이다.

```
사용자 ↔ 팀장 ──쓴다──▶ SPEC ──▶ 구현자(omni-pipeline:implementer) ──▶ 커밋·diff
                         │                                              │
                         └──────────▶ 리뷰어(omni-pipeline:reviewer) ◀──┘
팀장 ◀── 차이만 ── 리뷰어
```

아래 목록을 답에 옮겨 적고 진행에 맞춰 고친다:

```
진행:
- [ ] 1. 판단: 바로 고칠지, 전체 구조로 갈지
- [ ] 2. SPEC: 인터뷰 → 작성 → 사용자 승인
- [ ] 3. 구현: implementing-specs 로 구현자에게
- [ ] 4. 리뷰: reviewing-changes 로 리뷰어에게
- [ ] 5. 차이마다 판단, 차이가 없을 때까지 3–4 반복
- [ ] 6. 「완료 기준」 항목마다 근거와 함께 보고
```

## 1. 판단

구조는 값을 할 때만 쓴다.

- **한두 파일만 고치는 작은 작업**: 이 세션에서 바로 한다. 새 세션은 맥락을 처음부터 다시 모아야 해서 더 느리다. 검증은 `omni-core:verifying-changes`.
- **구현자가 하나이고 사용자가 단계마다 직접 확인**: 끝에 리뷰어 대신 `/code-review` 한 번이면 충분하다.
- **그 밖**: 2단계로.

## 2. SPEC

1. 질문을 제대로 하려고 필요한 만큼 코드를 읽는다.
2. 요구가 모호하면 SPEC 을 추측 없이 쓸 수 있을 때까지 사용자를 인터뷰한다(AskUserQuestion). 한 번에 몇 개씩, 코드가 이미 답한 것은 묻지 않는다. 동작과 경계 조건, 제약(바꾸면 안 되는 인터페이스·보안·성능), 범위 밖을 다룬다. 대화를 직접 들은 팀장이 SPEC 을 쓰므로 요약 손실이 없다.
3. SPEC 을 쓴다. 프로젝트 규칙이 먼저다.
   - **프로젝트 규칙에 SPEC 자리가 정해져 있으면**(규칙 파일 `AGENTS.override.md`·`AGENTS.md`·`CLAUDE.md`, 특히 「Agent pipeline」 절의 Specs·Spec template 행, 또는 거기서 가리키는 문서): 그 위치·파일 이름 규칙·양식(템플릿, 절 구성)을 그대로 따른다.
   - **정해진 것이 없으면**: `docs/specs/<이름>.md` 를 만들어 아래 틀로 쓴다. `<이름>` 은 이 변경을 가리키는 짧은 kebab-case 이름이다. 그 파일이 다른 작업의 것이면 다른 이름을 고른다.

   양식이 무엇이든 요구·제약·**완료 기준**은 꼭 들어가야 한다. 프로젝트 양식에 들어갈 자리가 없으면 끝에 그 절을 덧붙인다. 핵심은 완료 기준이다 — 구현자는 언제 멈출지, 리뷰어는 무엇으로 판정할지 여기서 안다. 항목마다 명령이나 관찰로 판정할 수 있게 쓴다.

   자체 틀:

   ```markdown
   # <기능> — SPEC
   상태: 초안 | 승인 · 날짜: <YYYY-MM-DD>
   <문제와 이 SPEC 이 약속하는 결과 한 문단>
   ## 요구
   - R1: …
   ## 제약
   - 범위 밖: …
   ## 완료 기준
   - [ ] <명령 또는 관찰>
   ## 설계 메모
   <관련 파일·인터페이스, 사용자와 정한 결정과 이유>
   ## 열린 질문
   - 없음
   ```
4. 사용자에게 SPEC 을 보여 주고 승인받은 뒤 3단계로 간다. 결정이 나중에 바뀌면 그때 바로 SPEC 을 고친다.

## 3. 구현

`implementing-specs` 스킬을 따른다. 대화 요약이 아니라 SPEC 경로를 준다.

## 4. 리뷰

`reviewing-changes` 스킬을 따른다. 리뷰어에게는 대화도 구현자 보고도 주지 않는다.

## 5. 차이마다 판단

| 차이가 말하는 것 | 할 일 |
|---|---|
| 구현이 SPEC 에 못 미침 | 해당 파일·줄을 직접 열어 근거를 확인한 뒤, 고칠 차이만 파일로 적어 SPEC 경로와 함께 구현자에게 (3단계) |
| SPEC 이 틀렸거나 비었음 | 사용자에게 묻고, SPEC 을 고친 뒤 3단계 |
| 지적이 틀림 | 왜 틀렸는지 한 줄로 적고 버린다 |

넘길 때는 파일과 경로를 넘긴다. 말로 옮겨 전하면 한 번 거칠 때마다 내용이 빠진다.

## 6. 보고

「완료 기준」 항목마다 명령·관찰로 확인한 근거를 붙여 보고한다. 하나라도 확인하지 못했으면 「끝」이라 하지 않고 빠진 근거를 적는다. 커밋·푸시는 사용자가 요청할 때만.

## 흔한 실수

- 대화로 정한 결정을 SPEC 에 적지 않아, 구현자·리뷰어가 모른다.
- 구현자에게 SPEC 대신 대화 요약을 넘긴다.
- 리뷰어에게 구현자의 보고나 설명을 같이 넘겨, 리뷰어가 그 논리에 끌려간다.
- 리뷰 차이를 근거 확인 없이 그대로 구현자에게 넘긴다.
- 「완료 기준」을 명령으로 판정할 수 없는 말로 쓴다.
