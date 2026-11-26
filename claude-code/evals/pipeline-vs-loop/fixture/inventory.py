"""Stock per SKU. An order reserves stock; paying sells it, cancelling releases it."""


class OutOfStock(Exception):
    """Not enough stock available."""


class Inventory:
    def __init__(self, events=None):
        self._available = {}
        self._reserved = {}
        self.events = events

    def restock(self, sku, qty):
        _check_qty(qty)
        self._available[sku] = self._available.get(sku, 0) + qty

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

    def release(self, sku, qty):
        _check_qty(qty)
        if self.reserved(sku) < qty:
            raise ValueError("more than reserved")
        self._reserved[sku] -= qty
        self._available[sku] = self.available(sku) + qty

    def sell(self, sku, qty):
        _check_qty(qty)
        if self.reserved(sku) < qty:
            raise ValueError("more than reserved")
        self._reserved[sku] -= qty


def _check_qty(qty):
    if not isinstance(qty, int) or isinstance(qty, bool) or qty <= 0:
        raise ValueError("qty must be a positive integer")
