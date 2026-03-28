"""Symbol normalization utility — converts between exchange-specific symbol formats.

Examples:
    BTCUSDT (Binance/Bybit)  →  BTC-USD (Coinbase)
    BTCUSDT                  →  XXBTZUSD (Kraken)
    BTCUSDT                  →  BTC_USDT (Gate.io)
    BTCUSDT                  →  BTC-USDT (OKX)
"""

from __future__ import annotations

from enum import Enum


class Exchange(Enum):
    BINANCE = "binance"
    COINBASE = "coinbase"
    KRAKEN = "kraken"
    BYBIT = "bybit"
    OKX = "okx"
    GATEIO = "gateio"


# Base quote currencies to strip from symbol
_QUOTES = {"USDT", "USD", "USDC", "BUSD", "DAI"}

# Kraken-specific base currency prefixes (merged from both original definitions)
_KRAKEN_BASE_PREFIXES: dict[str, str] = {
    "BTC": "XXBT",
    "ETH": "XETH",
    "SOL": "SOL",
    "XRP": "XXRP",
    "BNB": "BNB",
    "DOGE": "XDG",
    "ADA": "ADA",
    "AVAX": "AVAX",
    "LTC": "XLTC",
    "DOT": "DOT",
    "MATIC": "MATIC",
    "LINK": "LINK",
    "UNI": "UNI",
    "ATOM": "ATOM",
    "XLM": "XXLM",
    "ETC": "XETC",
    "EOS": "EOS",
    "TRX": "TRX",
    "XMR": "XXMR",
    "ZEC": "XZEC",
    "DASH": "DASH",
    "SHIB": "SHIB",
    "APT": "APT",
    "ARB": "ARB",
    "OP": "OP",
    "NEAR": "NEAR",
    "FIL": "FIL",
    "AAVE": "AAVE",
    "LRC": "LRC",
    "MANA": "MANA",
    "AXS": "AXS",
    "SAND": "SAND",
    "CHZ": "CHZ",
    "ENJ": "ENJ",
    "APE": "APE",
    "GALA": "GALA",
    "ILV": "ILV",
    "PYR": "PYR",
}

# Kraken quote replacements: supported quotes → ZUSD; unsupported → None
# Kraken only supports ZUSD stablecoin pairs, so BUSD/DAI return None (unsupported)
_KRAKEN_QUOTE: dict[str, str | None] = {
    "USDT": "ZUSD",
    "USDC": "ZUSD",
    "USD":  "ZUSD",
    "BUSD": None,   # Kraken doesn't support BUSD pairs
    "DAI":  None,   # Kraken doesn't support DAI pairs
}

# Mapping: exchange → (quote_char, separator)
_EXCHANGE_FORMATS: dict[Exchange, tuple[str, str]] = {
    Exchange.BINANCE:  ("",    ""),      # BTCUSDT
    Exchange.COINBASE: ("-",   "-"),     # BTC-USD
    Exchange.BYBIT:    ("",    ""),      # BTCUSDT
    Exchange.OKX:      ("-",   "-"),     # BTC-USDT
    Exchange.GATEIO:  ("_",   "_"),     # BTC_USDT
}


def normalize(symbol: str, to_exchange: Exchange) -> str | None:
    """Convert a base symbol (e.g. BTCUSDT) to the target exchange format.

    Args:
        symbol: Symbol in 'BTCUSDT' format (base + quote, no separator).
        to_exchange: Target exchange.

    Returns:
        Exchange-specific symbol string, or None if the quote currency
        is not supported by the target exchange.

    Examples:
        normalize("BTCUSDT", Exchange.COINBASE) → "BTC-USD"
        normalize("BTCUSDT", Exchange.KRAKEN)     → "XXBTZUSD"
        normalize("ETHUSDT", Exchange.GATEIO)     → "ETH_USDT"
        normalize("BTCUSDT", Exchange.KRAKEN)     → "XXBTZUSD"
        normalize("BTCUSDT", Exchange.KRAKEN)     → "XXBTZUSD"
        normalize("BTCUSDT", Exchange.KRAKEN)     → "XXBTZUSD"
    """
    symbol = symbol.upper()

    # Extract base and quote
    base, quote = _split_base_quote(symbol)
    if base is None or quote is None:
        return None  # Unknown quote currency — reject instead of passing through

    if to_exchange == Exchange.KRAKEN:
        kraken_base = _KRAKEN_BASE_PREFIXES.get(base, base)
        kraken_quote = _KRAKEN_QUOTE.get(quote)
        if kraken_quote is None:
            return None  # Quote not supported by Kraken
        return f"{kraken_base}{kraken_quote}"

    fmt, sep = _EXCHANGE_FORMATS[to_exchange]
    return f"{base}{sep}{quote}"


def _split_base_quote(symbol: str) -> tuple[str | None, str | None]:
    """Split a plain symbol like BTCUSDT into (BTC, USDT).

    Quotes are checked longest-first to avoid "BUSD" being matched as "USD" first.
    """
    for quote in sorted(_QUOTES, key=len, reverse=True):
        if symbol.endswith(quote):
            base = symbol[: -len(quote)]
            if base:
                return base, quote
    return None, None


def to_binance_style(symbol: str) -> str:
    """Convert any exchange symbol back to Binance/Bybit style (BTCUSDT)."""
    upper = symbol.upper()
    for quote in _QUOTES:
        if upper.endswith(quote):
            base = upper[: -len(quote)]
            if base:
                return f"{base}{quote}"
    return upper
