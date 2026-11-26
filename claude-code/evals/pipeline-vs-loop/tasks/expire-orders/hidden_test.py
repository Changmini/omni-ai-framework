"""Acceptance tests for expire-orders. The event test checks the project rule: a status change publishes order.<status> once."""
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


class ExpireOrdersTest(unittest.TestCase):
    def setUp(self):
        self.now = ["2026-01-01T00:00:00Z"]
        self.bus, self.inv, _, self.orders, uid = shop(self.now)
        self.first = self.orders.create_order(uid, [("A", 2)])["id"]
        self.now[0] = "2026-01-01T00:20:00Z"
        self.second = self.orders.create_order(uid, [("A", 3)])["id"]

    def test_expires_old_open_orders_including_the_boundary(self):
        self.assertEqual(self.orders.expire_orders("2026-01-01T00:30:00Z"), [self.first])
        self.assertEqual(self.orders.get_order(self.first)["status"], "expired")
        self.assertEqual(self.orders.get_order(self.second)["status"], "open")
        self.assertEqual((self.inv.available("A"), self.inv.reserved("A")), (7, 3))

    def test_minutes_argument(self):
        self.assertEqual(self.orders.expire_orders("2026-01-01T00:30:00Z", minutes=10), [self.first, self.second])

    def test_runs_once_per_order(self):
        self.orders.expire_orders("2026-01-01T00:30:00Z")
        self.assertEqual(self.orders.expire_orders("2026-01-01T00:31:00Z"), [])
        self.assertEqual(self.inv.available("A"), 7)

    def test_paid_and_cancelled_untouched(self):
        self.orders.pay(self.first)
        self.orders.cancel(self.second)
        self.assertEqual(self.orders.expire_orders("2026-02-01T00:00:00Z"), [])
        self.assertEqual(self.orders.get_order(self.first)["status"], "paid")

    def test_expired_order_cannot_be_paid(self):
        self.orders.expire_orders("2026-01-01T00:30:00Z")
        with self.assertRaises(OrderError):
            self.orders.pay(self.first)

    def test_expiry_publishes_one_event(self):
        before = len(self.bus.published)
        self.orders.expire_orders("2026-01-01T00:30:00Z")
        self.orders.expire_orders("2026-01-01T00:40:00Z")
        self.assertEqual([e for e in self.bus.published[before:] if e[0] == "order.expired"],
                         [("order.expired", {"order_id": self.first})])


if __name__ == "__main__":
    unittest.main()
