"""Acceptance tests for save-load: round trip, continuing ids, live reservations, and a failed save that leaves the old file intact."""
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


import json
import os
import tempfile

import storage


class SaveLoadTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "shop.json")
        self.bus, self.inv, self.pricing, self.orders, self.uid = shop()
        self.users = self.orders.users
        self.users.create_user("v")
        self.paid = self.orders.create_order(self.uid, [("A", 2)])["id"]
        self.orders.pay(self.paid)
        self.open = self.orders.create_order(self.uid, [("B", 1)], coupon=None)["id"]
        storage.save(self.path, self.users, self.inv, self.orders)

    def load(self):
        return storage.load(self.path, self.pricing, EventBus())

    def test_round_trip(self):
        users, inv, orders = self.load()
        self.assertEqual(users.list_users(), self.users.list_users())
        self.assertEqual(users.audit, self.users.audit)
        for sku in ("A", "B"):
            self.assertEqual((inv.available(sku), inv.reserved(sku)), (self.inv.available(sku), self.inv.reserved(sku)))
        self.assertEqual(orders.list_orders(self.uid), self.orders.list_orders(self.uid))

    def test_ids_continue(self):
        users, _, orders = self.load()
        self.assertEqual(users.create_user("w")["id"], self.users.create_user("w")["id"])
        self.assertEqual(orders.create_order(self.uid, [("A", 1)])["id"], self.orders.create_order(self.uid, [("A", 1)])["id"])

    def test_loaded_parts_work_together(self):
        users, inv, orders = self.load()
        orders.cancel(self.open)
        self.assertEqual((inv.available("B"), inv.reserved("B")), (5, 0))
        self.assertEqual(orders.create_order(self.uid, [("A", 1)])["user_id"], self.uid)

    def test_failed_save_keeps_old_file(self):
        with open(self.path, encoding="utf-8") as f:
            before = f.read()
        self.users._users[self.uid]["bad"] = object()  # cannot be written as JSON
        with self.assertRaises(Exception):
            storage.save(self.path, self.users, self.inv, self.orders)
        with open(self.path, encoding="utf-8") as f:
            self.assertEqual(f.read(), before)
        json.loads(before)


if __name__ == "__main__":
    unittest.main()
