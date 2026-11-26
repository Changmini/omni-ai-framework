"""In-memory user store for the sample app."""
from datetime import datetime, timezone


class NotFound(Exception):
    """No user with that id."""


class UserStore:
    def __init__(self):
        self._users = {}
        self._next_id = 1
        self.audit = []

    def create_user(self, name, email=None):
        name = (name or "").strip()
        if not name:
            raise ValueError("name is required")
        email = self._free_email(email, None)
        user = {"id": self._next_id, "name": name, "email": email, "created_at": _now()}
        self._users[user["id"]] = user
        self._next_id += 1
        self.audit.append({"action": "create", "user_id": user["id"], "at": user["created_at"]})
        return dict(user)

    def get_user(self, user_id):
        user = self._users.get(user_id)
        if user is None:
            raise NotFound(user_id)
        return dict(user)

    def update_email(self, user_id, email):
        user = self._users.get(user_id)
        if user is None:
            raise NotFound(user_id)
        user["email"] = self._free_email(email, user_id)
        self.audit.append({"action": "update", "user_id": user_id, "at": _now()})
        return dict(user)

    def find_by_email(self, email):
        email = _norm(email)
        for user in self._users.values():
            if email and user.get("email") == email:
                return dict(user)
        raise NotFound(email)

    def _free_email(self, email, user_id):
        if email is None:
            return None
        email = _norm(email)
        if any(u["id"] != user_id and u.get("email") == email for u in self._users.values()):
            raise ValueError("email in use")
        return email

    def list_users(self):
        return [dict(u) for u in sorted(self._users.values(), key=lambda u: u["id"])]


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _norm(email):
    return (email or "").strip().lower()
