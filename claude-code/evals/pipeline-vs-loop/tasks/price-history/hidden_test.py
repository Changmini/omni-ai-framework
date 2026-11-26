"""Acceptance tests for price-history: lookup by time, overwrite, and orders priced at their creation time."""
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


from pricing import UnknownSku


class PriceHistoryTest(unittest.TestCase):
    def test_lookup_by_time(self):
        p = Pricing()
        p.set_price("A", 1000)
        p.set_price("A", 1500, effective_at="2026-06-01T00:00:00Z")
        self.assertEqual(p.price("A", at="2026-05-31T23:59:59Z"), 1000)
        self.assertEqual(p.price("A", at="2026-06-01T00:00:00Z"), 1500)
        self.assertEqual(p.price("A"), 1500)

    def test_overwrite_same_start(self):
        p = Pricing()
        p.set_price("A", 1000, effective_at="2026-06-01T00:00:00Z")
        p.set_price("A", 1200, effective_at="2026-06-01T00:00:00Z")
        self.assertEqual(p.price("A", at="2026-07-01T00:00:00Z"), 1200)

    def test_nothing_yet(self):
        p = Pricing()
        p.set_price("A", 1000, effective_at="2026-06-01T00:00:00Z")
        with self.assertRaises(UnknownSku):
            p.price("A", at="2026-01-01T00:00:00Z")
        with self.assertRaises(UnknownSku):
            p.price("Z")

    def test_order_uses_price_at_creation(self):
        now = ["2026-03-01T00:00:00Z"]
        _, _, pricing, orders, uid = shop(now)
        pricing.set_price("A", 1500, effective_at="2026-06-01T00:00:00Z")
        early = orders.create_order(uid, [("A", 1)])
        now[0] = "2026-07-01T00:00:00Z"
        late = orders.create_order(uid, [("A", 1)])
        self.assertEqual((early["lines"][0]["unit_price"], late["lines"][0]["unit_price"]), (1000, 1500))
        self.assertEqual((early["total"], late["total"]), (1000, 1500))


if __name__ == "__main__":
    unittest.main()
