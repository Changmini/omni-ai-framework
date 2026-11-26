import unittest

from events import EventBus
from inventory import Inventory, OutOfStock
from orders import OrderError, OrderService
from pricing import Pricing
from users import UserStore


def shop():
    bus = EventBus()
    users, inv, pricing = UserStore(), Inventory(events=bus), Pricing()
    for sku, price, qty in (("A", 1000, 10), ("B", 2500, 5)):
        pricing.set_price(sku, price)
        inv.restock(sku, qty)
    pricing.add_coupon("TEN", 10, min_total=3000)
    orders = OrderService(users, inv, pricing, bus, clock=lambda: "2026-01-01T00:00:00Z")
    uid = users.create_user("u")["id"]
    return bus, inv, pricing, orders, uid


class ShopTest(unittest.TestCase):
    def test_order_reserves_and_totals(self):
        bus, inv, _, orders, uid = shop()
        o = orders.create_order(uid, [("A", 2), ("B", 1)], coupon="TEN")
        self.assertEqual((o["subtotal"], o["discount"], o["total"]), (4500, 450, 4050))
        self.assertEqual((inv.available("A"), inv.reserved("A")), (8, 2))
        self.assertEqual(bus.published[-1], ("order.open", {"order_id": o["id"]}))

    def test_coupon_minimum(self):
        _, _, _, orders, uid = shop()
        self.assertEqual(orders.create_order(uid, [("A", 1)], coupon="TEN")["discount"], 0)

    def test_out_of_stock_reserves_nothing(self):
        _, inv, _, orders, uid = shop()
        with self.assertRaises(OutOfStock):
            orders.create_order(uid, [("A", 1), ("B", 9)])
        self.assertEqual(inv.reserved("A"), 0)

    def test_pay_and_cancel(self):
        bus, inv, _, orders, uid = shop()
        a = orders.create_order(uid, [("A", 1)])
        b = orders.create_order(uid, [("A", 1)])
        orders.pay(a["id"])
        orders.cancel(b["id"])
        self.assertEqual((inv.available("A"), inv.reserved("A")), (9, 0))
        self.assertEqual([t for t, _ in bus.published], ["order.open", "order.open", "order.paid", "order.cancelled"])
        with self.assertRaises(OrderError):
            orders.cancel(a["id"])


if __name__ == "__main__":
    unittest.main()
