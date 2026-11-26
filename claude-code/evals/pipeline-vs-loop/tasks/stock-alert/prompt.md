재고 부족 알림을 추가해줘: `Inventory.set_alert(sku, threshold)`.

- 남은 수량(`available`)이 `threshold`보다 작아지는 순간 `events.publish("stock.low", {"sku": sku, "available": <그때 남은 수량>})`를 한 번 부른다.
- `threshold`보다 작은 동안에는 더 알리지 않는다. `threshold` 이상으로 돌아온 뒤(재입고, 예약 해제) 다시 작아지면 또 알린다.
- `set_alert`를 부를 때 이미 작으면 바로 한 번 알린다.
- `Inventory`에 `events`가 없으면 알리지 않는다.
- 시험도 추가할 것.
