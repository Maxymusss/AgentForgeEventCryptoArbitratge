"""Coinbase exchange connector — public REST API v2 for spot prices."""

from __future__ import annotations

import logging
from typing import Any

import requests

logger = logging.getLogger(__name__)

_COINBASE_SPOT_URL = "https://api.coinbase.com/v2/prices/{pair}/{side}"


def fetch_bid_ask(pair: str) -> tuple[float | None, float | None]:
    """Fetch the current bid and ask prices for `pair` on Coinbase.

    Coinbase's public API only exposes a single "spot" price (mid-market).
    We use spot as both bid and ask since no public bid/ask endpoint exists.

    Args:
        pair: Binance-style symbol, e.g. "BTCUSDT" (converted internally to "BTC-USD").

    Returns:
        (bid, ask) — both are the spot price (mid-market).
    """
    coinbase_pair = _to_coinbase_pair(pair)
    url = _COINBASE_SPOT_URL.format(pair=coinbase_pair, side="spot")

    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        price = float(data["data"]["amount"])
        logger.debug("Coinbase %s spot=%s", coinbase_pair, price)
        return price, price
    except requests.RequestException as exc:
        logger.warning("Coinbase spot fetch failed for %s: %s", coinbase_pair, exc)
        return None, None
    except (KeyError, ValueError, TypeError) as exc:
        logger.warning("Coinbase unexpected response for %s: %s", coinbase_pair, exc)
        return None, None


def _to_coinbase_pair(binance_symbol: str) -> str:
    """Convert Binance symbol (BTCUSDT) → Coinbase format (BTC-USD).

    Handles USDT, USD, USDC, and BUSD quote currencies.
    Note: BUSD is passed through as-is (BTCBUSD → BTC-BUSD); Coinbase
    may not list all BUSD pairs, so some conversions may fail at the API level.
    """
    for quote in ("USDT", "USD", "USDC", "BUSD"):
        if binance_symbol.endswith(quote):
            base = binance_symbol[: -len(quote)]
            return f"{base}-{quote.replace('USDT', 'USD')}"
    return binance_symbol
