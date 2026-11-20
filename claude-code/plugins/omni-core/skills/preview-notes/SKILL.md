---
name: preview-notes
description: Use in this repository whenever something is easier to grasp as a picture than as prose — a flow across several files or steps, branching rules, state changes, before/after of a change, option or provider comparisons, dates and deadlines, worked number examples, or a map of where a feature is used — and whenever the user says 「그림」, 「다이어그램」, 「표로」, 「차트」, 「캔버스」, 「미리보기」, 「한눈에」, 「이해가 안 돼」, 「헷갈려」, 「워크플로우 설명해줘」. Also use it at the start of work on a topic (to check private/index.html and its past editions in private/history/ before re-explaining or re-deriving it), after changing code that a section depicts, and when the work moves to an unrelated topic (start a new edition and move the old one to private/history/). private/index.html is the user's accumulating visual reference — use it instead of publishing an Artifact, even when the user does not mention the file.
---

# 작업 참고 그림 (private/index.html)

## 이 파일이 하는 일

- `private/index.html` 은 사용자가 미리보기(Omni Agent Terminal 의 터미널 옆 화면)로 열어 두고 보는 **참고서의 지금 판**이다. 한 판은 한 개념(지금 다루는 작업 흐름)을 이해하는 데 함께 보는 절 묶음이고, 맨 위 목차에서 찾아간다.
- 완전히 다른 개념으로 넘어가면 지금 판을 `private/history/` 로 옮기고 새 판으로 덮는다. 지난 판은 새 판 머리의 「지난 판」 목록에서 열어 볼 수 있다.
- 글로 설명하면 머릿속에서 그림을 다시 그려야 하는 것(여러 파일을 건너는 흐름, 갈래 조건, 상태 변화, 바꾸기 전·후)을 여기 그려 두면, 다음 대화·다음 세션에서도 같은 그림을 다시 쓸 수 있다.
- 그래서 **아무렇게나 덮어쓰지 않는다.** 같은 판 안에서는 절을 더하거나 그 절만 고치고, 판을 바꿀 때는 지난 판을 `history/` 에 통째로 남긴다.
- `private/` 는 git 밖이다 — 커밋 대상이 아니고, Artifact 로 발행하지도 않는다.

## 언제 쓰나

**사용자가 말할 때** — 그림·다이어그램·표·차트·미리보기·「이해가 안 돼」·「워크플로우 설명해줘」.

**말하지 않아도 그릴 때** — 답을 쓰다가 아래 중 하나에 걸리면, 글 답과 함께 절을 더하거나 고친다.
- 흐름이 **파일·화면·서버를 셋 이상** 건넌다(화면 → API → 서비스 → 표).
- **갈래 조건**이 둘 이상 겹친다(이 상태면 이 칸이 뜨고, 저 상태면 안 뜬다).
- **바꾸기 전 → 바꾼 뒤**를 견줘야 판단이 선다(목표 정의·플랜·고친 결과 보고).
- 대상 **셋 이상을 같은 칸으로 견준다**(공급자·화면·코드표 대조).
- **날짜·기한·순서**가 핵심이다(마감일, 처리 차례, 대기열).
- **숫자를 실제 예로** 풀어야 규칙이 보인다(할인·수수료 계산).

**그리지 않을 때** — 한두 줄로 끝나는 답, 글 목록으로 충분히 읽히는 것, 사용자가 글로만 달라고 한 것. 그림이 답을 빨리 읽히게 하지 않으면 그리지 않는다.

**작업을 시작할 때** — 다룰 주제(기능 이름·화면 이름·티켓)로 지금 판 목차(`toc`)와 지난 판(`history <낱말>`)을 먼저 본다. 같은 주제의 절이 있으면 다시 조사하기 전에 그 절을 읽고, 아래 「낡았는지 보기」를 거친 뒤 출발점으로 쓴다.

**코드를 고친 뒤** — 고친 파일이 어느 절의 「근거」에 있으면 그 절을 새 동작으로 고친다. 그림이 코드와 어긋난 채 남는 것이 그림이 없는 것보다 나쁘다.

## 가볍게

그리는 일이 본 작업보다 커지지 않게 한다. 절 하나에 근거는 핵심 파일 몇 개면 되고, 브라우저 캡처·화면 확인·별도 시험 스크립트는 만들지 않는다. 점검은 `check` 한 번이면 된다.

## 같은 판인가, 새 판인가

새 주제를 그리기 전에 `toc` 로 지금 판 제목과 절을 보고 정한다.

- **같은 판에 더한다** — 지금 판의 절과 기능·화면·티켓·작업이 같거나, 근거 파일이 겹치거나, 지금 판을 읽던 사람이 이어서 볼 내용(후속 질문, 하위 부분, 고친 결과, 같은 작업의 다른 단계)이다.
- **새 판으로 덮는다** — 지금 판의 어느 절과도 기능·근거 파일·작업이 겹치지 않는 **완전히 새로운 개념**이다. 예: 주문 결제 흐름을 보던 판에서 알림 설정 화면으로 넘어감.
- 헷갈리면 이렇게 본다: 새 절을 지금 판 제목 아래 두었을 때, 그 판을 펼친 사람이 「왜 이게 여기 있지」라고 하겠는가. 그렇다면 새 판이다.

새 판은 `edition <판 slug> "<판 제목>"` 한 번이면 된다 — 지금 판을 `private/history/<KST 시각>-<지금 판 slug>.html` 로 옮기고(옮기기 전 백업도 남김), 새 뼈대를 깔고, 「지난 판」 목록을 `history/` 와 맞춘다. 그다음 `template` 으로 첫 절을 넣는다.

- `history/` 의 파일은 **기록이라 고치지 않는다.** 지난 판의 주제가 다시 나오면 `history <낱말>` 로 찾아 그 절을 열고, 아래 「낡았는지 보기」를 거친 뒤 지금 판(관련 없으면 새 판)에 옮겨 고친다.
- `private/.index-backup/` 은 실수 대비 자동 백업(최근 15개)이고, `history/` 는 판 기록(지우지 않음)이다. 둘은 다르다. 미리보기 앱이 파일이 바뀔 때마다 스스로 남기는 `private/.history/`(최근 10개, ◀ ▶ 로 넘겨 봄)와도 다르다 — 그 폴더는 건드리지 않는다.

## 고치는 차례

도구: `python3 <이 스킬 폴더>/scripts/notes.py <명령>` (프로젝트 루트에서; 이 스킬 폴더는 스킬을 불러올 때 보이는 base directory). 다른 파일을 다루려면 `--file <경로>` — 백업·지난 판은 그 파일 옆 `.index-backup/`·`history/` 에 둔다. 뼈대는 `assets/skeleton.html`.

1. `toc` — 지금 판과 절 목록. 같은 주제가 있으면 새로 만들지 않고 그 절을 고친다. 지금 판과 관련 없는 개념이면 위 「같은 판인가, 새 판인가」대로 `edition` 부터.
2. `backup` — 고치기 전에 한 번. `private/.index-backup/` 에 최근 15개를 남긴다.
3. 근거를 모은다 — 파일을 열어 파일:줄을 확인한다. 기억·대화 문장으로 그리지 않는다. 사실과 추정은 따로 표시한다.
4. 새 절이면 `template <id> "<제목>"` 이 목차 한 줄과 절 틀을 찍어 준다. 목차 줄은 `<!-- toc:start -->` 아래 **맨 위**에, 절은 `<!-- sections:start -->` 아래 **맨 위**에 넣는다(최근 것이 위). 고치는 절이면 그 절을 위로 옮기고 `data-updated`·`data-basis`·머리 줄을 갱신한다.
5. Edit 로 **그 절과 목차 한 줄만** 바꾼다. 파일 전체를 Write 로 다시 쓰지 않는다 — 다른 절이 실수로 바뀌거나 사라진다.
6. `check` — 구조·닫히지 않은 태그·목차 일치·지난 판 링크·바깥 자원·넣으면 안 되는 값 꼴을 보고, 마지막 백업과 견줘 「더한 절·고친 절·없어진 절」을 찍는다(판을 바꿨으면 지난 판 절이 `history/` 에 내용 그대로 있는지 본다). 다른 파일과 견주려면 `check --against <파일>`. 문제 0, 그리고 바뀐 절이 의도한 것뿐인지 본다.

## 절의 꼴

```html
<section id="user-create-flow" data-updated="2026-11-20" data-basis="a1b2c3d" data-status="current">
  <h2>사용자 생성 — 요청이 지나는 길과 저장되는 곳</h2>
  <p class="meta">고침 2026-11-20 · 기준 커밋 a1b2c3d(+ 커밋 안 한 변경 있음) · 상태 현재</p>
  <p class="verdict">한 줄 요약 — 이 그림이 답하는 질문과 그 답</p>
  … 그림 …
  <h3>근거</h3>
  <ul class="files"><li><span class="mono">src/api/users.py:12</span> — 이름이 비면 거절하는 조건</li></ul>
</section>
```

- `id` 는 영문 소문자-하이픈, 주제가 같으면 늘 같은 id. 상태는 `current`(현재) · `stale`(낡음 — 다시 확인 전) · `removed`(지운 기능 — 기록용). 목차 딱지는 상태와 맞춘다(`pill st-current` 현재 · `pill st-stale` 낡음 · `pill st-removed` 지움).
- 절 안의 묶음은 `<div class="block">` — 절 안에 절을 두지 않는다.
- 그리는 부품(쓰는 법은 `assets/skeleton.html` 의 `<style>` 맨 위 주석): `.lane`(세로 흐름, 왼쪽에 「누가」, 상자는 `.node`, 사이는 `.down`) · `.flow`(짧은 가로 흐름, 사이는 `.arrow`) · `.branch`(갈래 둘, `.if` 로 조건) · `.two`(나란히 — 전·후 견주기) · `table`(넓으면 `.scroll` 로 감싸기) · `pre`(요청·응답 꼴) · `.pill` · `.verdict`(결론 상자) · `.note-fact`/`.note-guess`(사실·추정). 더 필요하면 인라인 SVG.
- 색은 뜻으로만 쓴다: 초록(`.ok`) = 정상·저장됨, 주황(`.warn`) = 주의·추정, 빨강(`.bad`) = 막힘, 빨강 점선(`.none`) = 없음, 파랑(`.ext`) = 바깥 시스템. 밝은·어두운 화면 모두 뼈대가 맞춘다.
- 바깥 스크립트·폰트·이미지(CDN)를 불러오지 않는다 — 미리보기는 네트워크 없이도 그려져야 한다.
- 말투는 사용자 보고와 같다: 쉬운 말, 짧게, 동그라미 번호(①)·내부 기호·섹션 번호로 설명하지 않는다.

## 낡았는지 보기

절을 믿고 쓰기 전에, 근거 파일이 기준 커밋 뒤에 바뀌었는지 본다.

```bash
git log --oneline <data-basis>..HEAD -- <근거 파일들>; git status --short -- <근거 파일들>
```

- 둘 다 비면 그대로 쓴다.
- 무엇이 나오면 바뀐 곳을 열어 확인하고 절을 고친다. 지금 고칠 수 없으면 `data-status="stale"` 로 바꾸고 목차 딱지도 「낡음」으로 바꿔 둔다.
- 기능을 지웠으면 절을 지우지 말고 `removed` 로 두고 한 줄 요약에 지운 날·까닭을 적는다. 정말 필요 없으면 사용자에게 물은 뒤 지운다(`check --allow-remove`).

## 답에 쓰는 법

- 글 답은 그 자체로 읽혀야 한다 — 사용자가 파일을 안 열어도 결론이 보이게. 흐름은 답에도 짧은 글자 그림으로 싣는다.
- 답 끝에 한 줄로 가리킨다: `그림: private/index.html → 「<절 제목>」(새로 더함 / 고침 / 그대로 / 새 판 — 지난 판은 history/<파일>)`.
- 같은 내용을 답과 파일에 길게 두 번 쓰지 않는다. 답은 결론과 핵심 흐름, 파일은 전체 그림과 근거.
- 대화 기록·목표 문서(`private/conversation.md`·`private/work-goal.md`)에서 그림을 가리킬 때는 절 id 를 적는다(`index.html#user-create-flow`).

## 넣지 않는 것

- 실명·계정 이름·연락처·이메일, 키·토큰·접속 정보, 계좌번호·연동 식별자, 실제 회사·고객 자료 값. 예시는 지어낸 값이나 공개된 값만 쓴다.
- 사용자가 팀원에게 직접 맡긴 개인 업무(인사 서류 등) — 작업 참고서가 아니다.
- `check` 의 「넣으면 안 되는 값 꼴」 경고는 하나씩 보고 지우거나, 문제가 없는 값임을 확인한다.

## 처음 쓸 때

- 파일이 없으면 `init [<판 slug> "<판 제목>"]` 이 뼈대를 만든다.
- 옛 꼴(목차·절 표시가 없는 한 장짜리)이면 그 파일은 지난 판으로 보고 `edition` 으로 `history/` 에 옮긴 뒤 새 판을 연다.
- 뼈대가 바뀌어 지금 판에 「지난 판」 목록 표시가 없다는 경고가 나오면, `assets/skeleton.html` 의 그 부분(`<details class="toc history">`)을 목차 아래에 넣고 `history --sync`.
