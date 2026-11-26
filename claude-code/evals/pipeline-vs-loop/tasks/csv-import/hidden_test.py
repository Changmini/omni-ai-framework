"""Acceptance tests for csv-import. The audit test checks the project rule: every user created adds an audit entry."""
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


import importer


def report_lines(text):
    store = UserStore()
    with_audit = len(store.audit)
    try:
        importer.import_users_csv(store, text)
    except importer.ImportReportError as e:
        assert (store.list_users(), len(store.audit)) == ([], with_audit), "nothing may be created"
        return [line for line, _ in e.errors]
    raise AssertionError("expected ImportReportError")


class CsvImportTest(unittest.TestCase):
    def test_imports_in_order(self):
        store = UserStore()
        ids = importer.import_users_csv(store, "name\nalice\nbob\n")
        self.assertEqual([store.get_user(i)["name"] for i in ids], ["alice", "bob"])

    def test_header_bom_quotes_and_extra_columns(self):
        store = UserStore()
        ids = importer.import_users_csv(store, '\ufeff email , Name \nx@example.com,"Kim, Lee"\n')
        self.assertEqual([store.get_user(i)["name"] for i in ids], ["Kim, Lee"])

    def test_bad_rows_all_reported_with_file_line_numbers(self):
        self.assertEqual(report_lines("name,team\n\nalice,a\n ,b\n\n,c\nbob,d\n"), [4, 6])

    def test_missing_name_column(self):
        self.assertEqual(report_lines("\nemail\nx@example.com\n"), [2])

    def test_every_created_user_is_audited(self):
        store = UserStore()
        ids = importer.import_users_csv(store, "name\nalice\nbob\n")
        self.assertEqual([(a["action"], a["user_id"]) for a in store.audit], [("create", i) for i in ids])


if __name__ == "__main__":
    unittest.main()
