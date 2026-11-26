"""In-memory user store for the sample app."""
from datetime import datetime, timezone


class NotFound(Exception):
    """No user with that id."""


class Gone(Exception):
    """The user was deleted."""


class UserStore:
    def __init__(self):
        self._users = {}
        self._next_id = 1
        self.audit = []

    def create_user(self, name):
        name = (name or "").strip()
        if not name:
            raise ValueError("name is required")
        user = {"id": self._next_id, "name": name, "created_at": _now()}
        self._users[user["id"]] = user
        self._next_id += 1
        self.audit.append({"action": "create", "user_id": user["id"], "at": user["created_at"]})
        return dict(user)

    def get_user(self, user_id):
        user = self._users.get(user_id)
        if user is None:
            raise NotFound(user_id)
        if user.get("deleted_at"):
            raise Gone(user_id)
        return dict(user)

    def delete_user(self, user_id):
        user = self._users.get(user_id)
        if user is None:
            raise NotFound(user_id)
        if user.get("deleted_at"):
            return
        user["deleted_at"] = _now()
        self.audit.append({"action": "delete", "user_id": user_id, "at": user["deleted_at"]})

    def list_users(self):
        return [dict(u) for u in sorted(self._users.values(), key=lambda u: u["id"]) if not u.get("deleted_at")]


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
