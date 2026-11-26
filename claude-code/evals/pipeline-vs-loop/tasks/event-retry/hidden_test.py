"""Acceptance tests for event-retry, including an order created while a subscriber keeps failing."""
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


class EventRetryTest(unittest.TestCase):
    def test_others_still_receive(self):
        bus, calls = EventBus(), []
        def broken(p):
            calls.append("broken")
            raise RuntimeError("boom")
        bus.subscribe("t", lambda p: calls.append("first"))
        bus.subscribe("t", broken)
        bus.subscribe("t", lambda p: calls.append("last"))
        bus.publish("t", {"x": 1})
        self.assertEqual([c for c in calls if c != "broken"], ["first", "last"])
        self.assertEqual(calls.count("broken"), 3)
        self.assertEqual(bus.published, [("t", {"x": 1})])

    def test_dead_letter(self):
        bus = EventBus()
        def broken(p):
            raise RuntimeError("boom")
        bus.subscribe("t", broken)
        bus.publish("t", {"x": 1})
        self.assertEqual(len(bus.dead_letters), 1)
        d = bus.dead_letters[0]
        self.assertEqual((d["topic"], d["payload"], d["subscriber"]), ("t", {"x": 1}, broken))
        self.assertIn("boom", d["error"])

    def test_recovers_on_retry(self):
        bus, tries = EventBus(), []
        def flaky(p):
            tries.append(1)
            if len(tries) < 2:
                raise RuntimeError("once")
        bus.subscribe("t", flaky)
        bus.publish("t", {})
        self.assertEqual((len(tries), bus.dead_letters), (2, []))

    def test_order_survives_a_broken_subscriber(self):
        bus, inv, _, orders, uid = shop()
        def broken(p):
            raise RuntimeError("down")
        bus.subscribe("order.open", broken)
        o = orders.create_order(uid, [("A", 1)])
        self.assertEqual(orders.get_order(o["id"])["status"], "open")
        self.assertEqual(inv.reserved("A"), 1)
        self.assertEqual(len(bus.dead_letters), 1)


if __name__ == "__main__":
    unittest.main()
