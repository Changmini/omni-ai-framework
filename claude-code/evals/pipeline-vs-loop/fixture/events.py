"""A minimal publish/subscribe bus."""


class EventBus:
    def __init__(self):
        self._subscribers = {}
        self.published = []

    def subscribe(self, topic, handler):
        self._subscribers.setdefault(topic, []).append(handler)

    def publish(self, topic, payload):
        self.published.append((topic, payload))
        for handler in self._subscribers.get(topic, []):
            handler(payload)
