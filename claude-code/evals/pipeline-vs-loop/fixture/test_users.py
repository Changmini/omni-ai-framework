import unittest

from users import NotFound, UserStore


class UserStoreTest(unittest.TestCase):
    def test_create_and_get(self):
        store = UserStore()
        user = store.create_user(" alice ")
        self.assertEqual(store.get_user(user["id"])["name"], "alice")

    def test_create_requires_name(self):
        with self.assertRaises(ValueError):
            UserStore().create_user("  ")

    def test_get_missing(self):
        with self.assertRaises(NotFound):
            UserStore().get_user(99)

    def test_list_in_id_order(self):
        store = UserStore()
        store.create_user("b")
        store.create_user("a")
        self.assertEqual([u["name"] for u in store.list_users()], ["b", "a"])


if __name__ == "__main__":
    unittest.main()
