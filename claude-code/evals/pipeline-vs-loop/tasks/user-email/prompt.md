사용자에 이메일을 추가해줘.

- `create_user(name, email=None)`: 지금처럼 `create_user(name)`도 그대로 동작해야 한다.
- 이메일은 앞뒤 공백을 지우고 소문자로 바꿔 저장한다.
- 이메일은 사용자끼리 겹칠 수 없다(대소문자 무시). 겹치면 `ValueError`이고 아무것도 바뀌지 않는다. 이메일이 없는 사용자는 여럿이어도 된다.
- `update_email(user_id, email)`: 같은 규칙으로 이메일을 바꾼다. 자기 이메일을 대소문자만 바꿔 다시 넣는 것은 된다. 없는 사용자면 `NotFound`.
- `find_by_email(email)`: 대소문자 무시로 찾아 사용자를 돌려준다. 없으면 `NotFound`.
- 시험도 추가할 것.
