"""A minimal publish/subscribe bus. A failing subscriber does not stop the others."""

ATTEMPTS = 3


class EventBus:
    def __init__(self):
        self._subscribers = {}
        self.published = []
        self.dead_letters = []

    def subscribe(self, topic, handler):
        self._subscribers.setdefault(topic, []).append(handler)

    def publish(self, topic, payload):
        self.published.append((topic, payload))
        for handler in list(self._subscribers.get(topic, [])):
            error = None
            for _ in range(ATTEMPTS):
                try:
                    handler(payload)
                    break
                except Exception as e:  # noqa: BLE001 - any subscriber failure
                    error = e
            else:
                self.dead_letters.append({"topic": topic, "payload": payload, "subscriber": handler, "error": str(error)})
