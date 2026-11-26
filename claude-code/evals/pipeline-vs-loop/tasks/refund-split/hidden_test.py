"""Acceptance tests for refund-split. The type check follows the project rule: money is whole won (int), never float."""
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


class RefundSplitTest(unittest.TestCase):
    def paid(self, prices, coupon_percent):
        _, inv, pricing, orders, uid = shop()
        items = []
        for i, price in enumerate(prices):
            sku = f"S{i}"
            pricing.set_price(sku, price)
            inv.restock(sku, 1)
            items.append((sku, 1))
        pricing.add_coupon("C", coupon_percent, min_total=0)
        o = orders.create_order(uid, items, coupon="C")
        orders.pay(o["id"])
        return orders, orders.get_order(o["id"])

    def refunds(self, prices, percent):
        orders, o = self.paid(prices, percent)
        out = orders.refund_breakdown(o["id"])
        self.assertEqual([r["sku"] for r in out], [l["sku"] for l in o["lines"]])
        self.assertTrue(all(type(r["refund"]) is int for r in out))
        self.assertEqual(sum(r["refund"] for r in out), o["total"])
        return [r["refund"] for r in out]

    def test_largest_remainder(self):
        self.assertEqual(self.refunds([333, 333, 334], 10), [300, 300, 300])

    def test_ties_go_to_the_earlier_line(self):
        self.assertEqual(self.refunds([1, 1, 1], 50), [0, 1, 1])

    def test_sums_match_for_many_orders(self):
        for prices, pct in (([999, 1, 7], 33), ([5000, 2500, 1250, 625], 15), ([10, 20, 30], 100), ([3, 3], 1)):
            self.refunds(prices, pct)

    def test_no_coupon(self):
        _, inv, _, orders, uid = shop()
        o = orders.create_order(uid, [("A", 2), ("B", 1)])
        orders.pay(o["id"])
        self.assertEqual(orders.refund_breakdown(o["id"]), [{"sku": "A", "refund": 2000}, {"sku": "B", "refund": 2500}])

    def test_only_paid(self):
        _, _, _, orders, uid = shop()
        o = orders.create_order(uid, [("A", 1)])
        with self.assertRaises(OrderError):
            orders.refund_breakdown(o["id"])


if __name__ == "__main__":
    unittest.main()
