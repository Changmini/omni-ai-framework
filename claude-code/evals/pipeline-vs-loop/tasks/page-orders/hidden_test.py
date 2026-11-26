"""Acceptance tests for page-orders. The last one checks the project rule: list_orders keeps its arguments and its return shape."""
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


class PageOrdersTest(unittest.TestCase):
    def setUp(self):
        _, inv, _, self.orders, self.uid = shop()
        inv.restock("A", 20)
        other = self.orders.users.create_user("other")["id"]
        self.ids = []
        for i in range(5):
            self.ids.append(self.orders.create_order(self.uid, [("A", 1)])["id"])
            self.orders.create_order(other, [("A", 1)])

    def pages(self, **kw):
        out, cursor = [], None
        while True:
            page = self.orders.page_orders(self.uid, cursor=cursor, **kw)
            out.append([o["id"] for o in page["orders"]])
            cursor = page["next_cursor"]
            if cursor is None:
                return out

    def test_newest_first_in_pages(self):
        self.assertEqual(self.pages(limit=2), [self.ids[4:2:-1], self.ids[2:0:-1], self.ids[:1]])

    def test_exact_fit_has_no_empty_page(self):
        page = self.orders.page_orders(self.uid, limit=5)
        self.assertEqual(len(page["orders"]), 5)
        self.assertIsNone(page["next_cursor"])

    def test_new_orders_do_not_shift_pages(self):
        first = self.orders.page_orders(self.uid, limit=2)
        self.orders.create_order(self.uid, [("A", 1)])
        rest = self.orders.page_orders(self.uid, limit=10, cursor=first["next_cursor"])
        seen = [o["id"] for o in first["orders"]] + [o["id"] for o in rest["orders"]]
        self.assertEqual(seen, self.ids[::-1])

    def test_status_filter(self):
        self.orders.pay(self.ids[1])
        self.orders.pay(self.ids[3])
        self.assertEqual(self.pages(status="paid", limit=1), [[self.ids[3]], [self.ids[1]]])

    def test_bad_arguments(self):
        for limit in (0, 101):
            with self.assertRaises(ValueError):
                self.orders.page_orders(self.uid, limit=limit)
        with self.assertRaises(ValueError):
            self.orders.page_orders(self.uid, cursor="not-a-cursor")

    def test_list_orders_unchanged(self):
        self.assertEqual([o["id"] for o in self.orders.list_orders(self.uid)], self.ids)


if __name__ == "__main__":
    unittest.main()
