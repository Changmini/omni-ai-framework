"""Orders: created open (stock reserved), then paid (stock sold) or cancelled (stock released)."""
import copy

from users import _now


class OrderError(Exception):
    """The order cannot do that in its current status."""


class OrderService:
    def __init__(self, users, inventory, pricing, events, clock=_now):
        self.users = users
        self.inventory = inventory
        self.pricing = pricing
        self.events = events
        self._clock = clock
        self._orders = {}
        self._next_id = 1

    def create_order(self, user_id, items, coupon=None):
        """`items`: [(sku, qty), ...]. Reserves the stock; all or nothing."""
        self.users.get_user(user_id)
        if not items:
            raise ValueError("an order needs at least one item")
        if coupon is not None:
            self.pricing.coupon(coupon)
        lines = [{"sku": sku, "qty": qty, "unit_price": self.pricing.price(sku)} for sku, qty in items]
        done = []
        try:
            for line in lines:
                self.inventory.reserve(line["sku"], line["qty"])
                done.append(line)
        except Exception:
            for line in done:
                self.inventory.release(line["sku"], line["qty"])
            raise
        order = {"id": self._next_id, "user_id": user_id, "lines": lines, "coupon": coupon,
                 "status": "open", "created_at": self._clock()}
        self._set_totals(order)
        self._orders[order["id"]] = order
        self._next_id += 1
        self.events.publish("order.open", {"order_id": order["id"]})
        return copy.deepcopy(order)

    def get_order(self, order_id):
        if order_id not in self._orders:
            raise KeyError(order_id)
        return copy.deepcopy(self._orders[order_id])

    def list_orders(self, user_id):
        return [copy.deepcopy(o) for o in sorted(self._orders.values(), key=lambda o: o["id"])
                if o["user_id"] == user_id]

    def pay(self, order_id):
        order = self._open(order_id)
        for line in order["lines"]:
            self.inventory.sell(line["sku"], line["qty"])
        order["status"] = "paid"
        self.events.publish("order.paid", {"order_id": order_id})

    def cancel(self, order_id):
        order = self._open(order_id)
        for line in order["lines"]:
            self.inventory.release(line["sku"], line["qty"])
        order["status"] = "cancelled"
        self.events.publish("order.cancelled", {"order_id": order_id})

    def cancel_items(self, order_id, sku, qty):
        order = self._open(order_id)
        line = next((l for l in order["lines"] if l["sku"] == sku), None)
        if line is None:
            raise ValueError(f"no {sku} in order {order_id}")
        if not isinstance(qty, int) or isinstance(qty, bool) or not 0 < qty <= line["qty"]:
            raise ValueError("qty must be 1..line qty")
        self.inventory.release(sku, qty)
        line["qty"] -= qty
        if line["qty"] == 0:
            order["lines"].remove(line)
        self._set_totals(order)
        if not order["lines"]:
            order["status"] = "cancelled"
            self.events.publish("order.cancelled", {"order_id": order_id})
        return copy.deepcopy(order)

    def _open(self, order_id):
        order = self._orders.get(order_id)
        if order is None:
            raise KeyError(order_id)
        if order["status"] != "open":
            raise OrderError(f"order {order_id} is {order['status']}")
        return order

    def _set_totals(self, order):
        order["subtotal"] = sum(line["unit_price"] * line["qty"] for line in order["lines"])
        order["discount"] = self.pricing.discount(order["subtotal"], order["coupon"])
        order["total"] = order["subtotal"] - order["discount"]
