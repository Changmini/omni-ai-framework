# sample-app

사용자 목록을 메모리에 두는 예시 앱입니다.

## 규칙

- 사용자 데이터를 바꾸는 동작(생성·수정·삭제)은 모두 `UserStore.audit`에 `{"action": <동작>, "user_id": <id>, "at": <시각>}` 한 항목을 남긴다.
- 시각은 `_now()`로만 만든다(UTC ISO 8601, `Z`로 끝남).
- 시험: `python3 -m unittest`
