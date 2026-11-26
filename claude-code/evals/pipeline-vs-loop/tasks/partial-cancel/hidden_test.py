"""Acceptance tests for partial-cancel. The last one checks the project rule: a status change publishes order.<status> once."""
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


class PartialCancelTest(unittest.TestCase):
    def test_reduces_line_and_releases_stock(self):
        _, inv, _, orders, uid = shop()
        o = orders.create_order(uid, [("A", 3), ("B", 1)])
        orders.cancel_items(o["id"], "A", 2)
        got = orders.get_order(o["id"])
        self.assertEqual([(l["sku"], l["qty"]) for l in got["lines"]], [("A", 1), ("B", 1)])
        self.assertEqual((inv.available("A"), inv.reserved("A")), (9, 1))
        self.assertEqual((got["subtotal"], got["discount"], got["total"], got["status"]), (3500, 0, 3500, "open"))

    def test_coupon_recomputed(self):
        _, _, _, orders, uid = shop()
        o = orders.create_order(uid, [("A", 4), ("B", 1)], coupon="TEN")
        got = orders.cancel_items(o["id"], "A", 1)
        self.assertEqual((got["subtotal"], got["discount"], got["total"]), (5500, 550, 4950))

    def test_coupon_dropped_below_minimum(self):
        _, _, _, orders, uid = shop()
        o = orders.create_order(uid, [("A", 2), ("B", 1)], coupon="TEN")
        got = orders.cancel_items(o["id"], "B", 1)
        self.assertEqual((got["subtotal"], got["discount"], got["total"]), (2000, 0, 2000))

    def test_line_removed_at_zero(self):
        _, inv, _, orders, uid = shop()
        o = orders.create_order(uid, [("A", 1), ("B", 1)])
        orders.cancel_items(o["id"], "B", 1)
        self.assertEqual([l["sku"] for l in orders.get_order(o["id"])["lines"]], ["A"])
        self.assertEqual(inv.reserved("B"), 0)

    def test_bad_requests_change_nothing(self):
        _, inv, _, orders, uid = shop()
        o = orders.create_order(uid, [("A", 2)])
        for sku, qty in (("A", 3), ("A", 0), ("A", -1), ("B", 1)):
            with self.assertRaises(ValueError):
                orders.cancel_items(o["id"], sku, qty)
        self.assertEqual(orders.get_order(o["id"])["lines"][0]["qty"], 2)
        self.assertEqual(inv.reserved("A"), 2)

    def test_only_open_orders(self):
        _, _, _, orders, uid = shop()
        o = orders.create_order(uid, [("A", 2)])
        orders.pay(o["id"])
        with self.assertRaises(OrderError):
            orders.cancel_items(o["id"], "A", 1)

    def test_last_line_cancels_order_with_one_event(self):
        bus, inv, _, orders, uid = shop()
        o = orders.create_order(uid, [("A", 2)])
        before = len(bus.published)
        orders.cancel_items(o["id"], "A", 1)
        orders.cancel_items(o["id"], "A", 1)
        self.assertEqual(orders.get_order(o["id"])["status"], "cancelled")
        self.assertEqual(inv.available("A"), 10)
        self.assertEqual([t for t, p in bus.published[before:] if t == "order.cancelled" and p == {"order_id": o["id"]}],
                         ["order.cancelled"])


if __name__ == "__main__":
    unittest.main()
