"""Acceptance tests for stock-alert: alert once per drop below the threshold, rearm on recovery, and alerts from orders."""
import unittest

from events import EventBus
from inventory import Inventory
from orders import OrderError, OrderService
from pricing import Pricing
from users import UserStore


def shop(now=None):
    """A wired shop: A 1000원 ×10, B 2500원 ×5, coupon TEN (10%, from 3000원)."""
    now = now if now is not None else ["2026-01-01T00:00:00Z"]
    bus = EventBus()
    users, inv, pricing = UserStore(), Inventory(events=bus), Pricing()
    for sku, price, qty in (("A", 1000, 10), ("B", 2500, 5)):
        pricing.set_price(sku, price)
        inv.restock(sku, qty)
    pricing.add_coupon("TEN", 10, min_total=3000)
    orders = OrderService(users, inv, pricing, bus, clock=lambda: now[0])
    uid = users.create_user("u")["id"]
    return bus, inv, pricing, orders, uid


class StockAlertTest(unittest.TestCase):
    def setUp(self):
        self.bus = EventBus()
        self.inv = Inventory(events=self.bus)
        self.inv.restock("A", 10)

    def alerts(self):
        return [p for t, p in self.bus.published if t == "stock.low"]

    def test_once_per_drop_and_rearm(self):
        self.inv.set_alert("A", 5)
        self.inv.reserve("A", 5)
        self.assertEqual(self.alerts(), [])
        self.inv.reserve("A", 1)
        self.inv.reserve("A", 1)
        self.assertEqual(self.alerts(), [{"sku": "A", "available": 4}])
        self.inv.release("A", 2)
        self.inv.reserve("A", 3)
        self.assertEqual(self.alerts(), [{"sku": "A", "available": 4}, {"sku": "A", "available": 2}])

    def test_restock_rearms(self):
        self.inv.set_alert("A", 5)
        self.inv.reserve("A", 6)
        self.inv.restock("A", 10)
        self.inv.reserve("A", 12)
        self.assertEqual(len(self.alerts()), 2)

    def test_already_low_when_set(self):
        self.inv.reserve("A", 8)
        self.inv.set_alert("A", 5)
        self.assertEqual(self.alerts(), [{"sku": "A", "available": 2}])

    def test_no_bus_no_error(self):
        inv = Inventory()
        inv.restock("A", 1)
        inv.set_alert("A", 5)
        inv.reserve("A", 1)

    def test_order_triggers_alert(self):
        bus, inv, _, orders, uid = shop()
        inv.set_alert("B", 3)
        orders.create_order(uid, [("B", 3)])
        self.assertIn(("stock.low", {"sku": "B", "available": 2}), bus.published)


if __name__ == "__main__":
    unittest.main()
