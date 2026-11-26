"""Save the shop to one JSON file and load it back."""
import json
import os
import tempfile

from inventory import Inventory
from orders import OrderService
from users import UserStore


def save(path, users, inventory, orders):
    state = {
        "users": {"users": list(users._users.values()), "next_id": users._next_id, "audit": users.audit},
        "inventory": {"available": inventory._available, "reserved": inventory._reserved},
        "orders": {"orders": list(orders._orders.values()), "next_id": orders._next_id},
    }
    text = json.dumps(state, ensure_ascii=False, indent=2)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), prefix=".save-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def load(path, pricing, events):
    with open(path, encoding="utf-8") as f:
        state = json.load(f)
    users = UserStore()
    users._users = {u["id"]: u for u in state["users"]["users"]}
    users._next_id = state["users"]["next_id"]
    users.audit = state["users"]["audit"]
    inventory = Inventory(events=events)
    inventory._available = dict(state["inventory"]["available"])
    inventory._reserved = dict(state["inventory"]["reserved"])
    orders = OrderService(users, inventory, pricing, events)
    orders._orders = {o["id"]: o for o in state["orders"]["orders"]}
    orders._next_id = state["orders"]["next_id"]
    return users, inventory, orders
