"""Acceptance tests for user-email. The audit test checks the project rule: every user change adds an audit entry."""
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


import re

from users import NotFound

ISO_Z = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")


class UserEmailTest(unittest.TestCase):
    def test_normalized(self):
        store = UserStore()
        u = store.create_user("a", " Alice@Example.COM ")
        self.assertEqual(store.get_user(u["id"])["email"], "alice@example.com")

    def test_old_call_still_works(self):
        store = UserStore()
        store.create_user("a")
        store.create_user("b")
        self.assertEqual(len(store.list_users()), 2)

    def test_unique_ignoring_case(self):
        store = UserStore()
        store.create_user("a", "x@example.com")
        audit = len(store.audit)
        with self.assertRaises(ValueError):
            store.create_user("b", "X@EXAMPLE.com")
        self.assertEqual((len(store.list_users()), len(store.audit)), (1, audit))

    def test_update_email(self):
        store = UserStore()
        a = store.create_user("a", "a@example.com")["id"]
        b = store.create_user("b", "b@example.com")["id"]
        store.update_email(a, "A@Example.com")
        with self.assertRaises(ValueError):
            store.update_email(a, " b@example.com")
        self.assertEqual(store.get_user(a)["email"], "a@example.com")
        store.update_email(b, "new@example.com")
        self.assertEqual(store.find_by_email("NEW@example.com")["id"], b)
        with self.assertRaises(NotFound):
            store.update_email(99, "z@example.com")

    def test_find_missing(self):
        with self.assertRaises(NotFound):
            UserStore().find_by_email("nobody@example.com")

    def test_update_is_audited(self):
        store = UserStore()
        a = store.create_user("a", "a@example.com")["id"]
        store.update_email(a, "c@example.com")
        last = store.audit[-1]
        self.assertEqual(last.get("user_id"), a)
        self.assertNotEqual(last.get("action"), "create")
        self.assertRegex(last.get("at", ""), ISO_Z)


if __name__ == "__main__":
    unittest.main()
