"""Stock per SKU. An order reserves stock; paying sells it, cancelling releases it."""


class OutOfStock(Exception):
    """Not enough stock available."""


class Inventory:
    def __init__(self, events=None):
        self._available = {}
        self._reserved = {}
        self.events = events
        self._alerts = {}
        self._low = set()

    def restock(self, sku, qty):
        _check_qty(qty)
        self._available[sku] = self._available.get(sku, 0) + qty
        self._check(sku)

    def set_alert(self, sku, threshold):
        self._alerts[sku] = threshold
        self._low.discard(sku)
        self._check(sku)

    def _check(self, sku):
        if sku not in self._alerts:
            return
        if self.available(sku) >= self._alerts[sku]:
            self._low.discard(sku)
        elif sku not in self._low:
            self._low.add(sku)
            if self.events is not None:
                self.events.publish("stock.low", {"sku": sku, "available": self.available(sku)})

    def available(self, sku):
        return self._available.get(sku, 0)

    def reserved(self, sku):
        return self._reserved.get(sku, 0)

    def reserve(self, sku, qty):
        _check_qty(qty)
        if self.available(sku) < qty:
            raise OutOfStock(sku)
        self._available[sku] -= qty
        self._reserved[sku] = self.reserved(sku) + qty
        self._check(sku)

    def release(self, sku, qty):
        _check_qty(qty)
        if self.reserved(sku) < qty:
            raise ValueError("more than reserved")
        self._reserved[sku] -= qty
        self._available[sku] = self.available(sku) + qty
        self._check(sku)

    def sell(self, sku, qty):
        _check_qty(qty)
        if self.reserved(sku) < qty:
            raise ValueError("more than reserved")
        self._reserved[sku] -= qty


def _check_qty(qty):
    if not isinstance(qty, int) or isinstance(qty, bool) or qty <= 0:
        raise ValueError("qty must be a positive integer")
