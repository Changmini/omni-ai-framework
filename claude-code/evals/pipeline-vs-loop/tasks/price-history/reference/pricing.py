"""Prices and coupons. Money is whole won (int)."""


class UnknownSku(KeyError):
    """No price for that SKU."""


class Pricing:
    def __init__(self):
        self._prices = {}  # sku -> [(effective_at, price), ...] sorted; "" = from the start
        self._coupons = {}

    def set_price(self, sku, price, effective_at=None):
        if not isinstance(price, int) or price < 0:
            raise ValueError("price must be a non-negative integer")
        start = effective_at or ""
        history = [h for h in self._prices.get(sku, []) if h[0] != start] + [(start, price)]
        self._prices[sku] = sorted(history)

    def price(self, sku, at=None):
        history = [h for h in self._prices.get(sku, []) if at is None or h[0] <= at]
        if not history:
            raise UnknownSku(sku)
        return history[-1][1]

    def add_coupon(self, code, percent, min_total=0):
        if not 0 < percent <= 100:
            raise ValueError("percent must be 1..100")
        self._coupons[code] = {"percent": percent, "min_total": min_total}

    def coupon(self, code):
        return dict(self._coupons[code])

    def discount(self, subtotal, code):
        """The coupon's discount on `subtotal`: 0 below its minimum, else rounded down."""
        if code is None:
            return 0
        c = self._coupons[code]
        if subtotal < c["min_total"]:
            return 0
        return subtotal * c["percent"] // 100
