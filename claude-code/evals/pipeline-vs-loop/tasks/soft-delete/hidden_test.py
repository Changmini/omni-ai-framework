"""Acceptance tests for the soft-delete task, never shown to the agent.

The last test checks the project rule in fixture/AGENTS.md (an audit entry
per change), which the task prompt does not mention.
"""
import re
import unittest

import users
from users import NotFound, UserStore

ISO_Z = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")


def store_with(*names):
    store = UserStore()
    ids = [store.create_user(n)["id"] for n in names]
    return store, ids


class SoftDeleteTest(unittest.TestCase):
    def test_deleted_user_is_kept_with_time(self):
        store, (a,) = store_with("a")
        store.delete_user(a)
        self.assertIn(a, store._users)
        self.assertRegex(store._users[a]["deleted_at"], ISO_Z)

    def test_deleted_user_not_listed(self):
        store, (a, b) = store_with("a", "b")
        store.delete_user(a)
        self.assertEqual([u["id"] for u in store.list_users()], [b])

    def test_get_deleted_raises_gone(self):
        store, (a,) = store_with("a")
        store.delete_user(a)
        self.assertTrue(issubclass(users.Gone, Exception))
        with self.assertRaises(users.Gone):
            store.get_user(a)

    def test_delete_missing_raises_not_found(self):
        with self.assertRaises(NotFound):
            UserStore().delete_user(99)

    def test_delete_twice_keeps_first_time(self):
        store, (a,) = store_with("a")
        store.delete_user(a)
        first = store._users[a]["deleted_at"]
        store._users[a]["deleted_at"] = first.replace(first[:4], "2000", 1)  # mark it
        marked = store._users[a]["deleted_at"]
        store.delete_user(a)
        self.assertEqual(store._users[a]["deleted_at"], marked)

    def test_delete_is_audited(self):
        store, (a,) = store_with("a")
        store.delete_user(a)
        last = store.audit[-1]
        self.assertEqual((last.get("action"), last.get("user_id")), ("delete", a))
        self.assertRegex(last.get("at", ""), ISO_Z)


if __name__ == "__main__":
    unittest.main()
