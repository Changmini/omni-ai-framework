"""Prices and coupons. Money is whole won (int)."""


class UnknownSku(KeyError):
    """No price for that SKU."""


class Pricing:
    def __init__(self):
        self._prices = {}
        self._coupons = {}

    def set_price(self, sku, price):
        if not isinstance(price, int) or price < 0:
            raise ValueError("price must be a non-negative integer")
        self._prices[sku] = price

    def price(self, sku):
        if sku not in self._prices:
            raise UnknownSku(sku)
        return self._prices[sku]

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
