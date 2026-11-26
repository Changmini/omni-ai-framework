가게 상태를 JSON 파일로 저장하고 불러오는 `storage.py`를 새로 만들어줘.

- `save(path, users, inventory, orders)`: 사용자(감사 기록 포함), 재고(남은 수량·예약 수량), 주문을 파일 하나에 저장한다.
- `load(path, pricing, events)`: `(users, inventory, orders)`를 돌려준다. 불러온 것끼리, 그리고 받은 `pricing`·`events`와 이어져 그대로 쓸 수 있어야 한다.
- 불러온 뒤 새로 만드는 사용자·주문의 id는 저장 전에 이어서 붙는다.
- 저장은 안전해야 한다: 저장 중에 실패해도 원래 파일은 그대로 남는다.
- 시험도 추가할 것.
