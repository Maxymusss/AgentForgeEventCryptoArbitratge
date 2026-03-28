"""Application configuration — loaded from environment variables and settings.json."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

from dotenv import load_dotenv

load_dotenv()

SETTINGS_PATH = Path(__file__).parent.parent / "settings.json"

def _load_settings() -> dict:
    """Load settings from settings.json, creating with defaults if absent."""
    if SETTINGS_PATH.exists():
        try:
            with open(SETTINGS_PATH) as f:
                return json.load(f)
        except Exception:
            pass
    # Default: all 50 pairs enabled
    return {
        "enabled_pairs": [
            "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT",
            "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "MATICUSDT",
            "LINKUSDT", "LTCUSDT", "UNIUSDT", "ATOMUSDT", "XLMUSDT",
            "ETCUSDT", "FILUSDT", "NEARUSDT", "TRXUSDT", "MANAUSDT",
            "AAVEUSDT", "LRCUSDT", "ENJUSDT", "GALAUSDT", "APEUSDT",
            "SHIBUSDT", "KAVAUSDT", "KSMUSDT", "ZECUSDT", "XMRUSDT",
            "XTZUSDT", "EOSUSDT", "ALGOUSDT", "VETUSDT", "THETAUSDT",
            "FTMUSDT", "MKRUSDT", "COMPUSDT", "SNXUSDT", "YFIUSDT",
            "SUSHIUSDT", "CRVUSDT", "LDOUSDT", "GMXUSDT", "RUNEUSDT",
            "SANDUSDT", "CHZUSDT", "AXSUSDT", "INCHUSDT", "BTCUSDC",
        ],
        "min_profit_pct": 0.05,
        "telegram_enabled": True,
        "max_exposure_per_pair": {"BTCUSDT": 1.0, "ETHUSDT": 10.0},
    }


def _save_settings(data: dict) -> None:
    """Save settings to settings.json."""
    with open(SETTINGS_PATH, "w") as f:
        json.dump(data, f, indent=2)


@dataclass
class FeeSchedule:
    """Exchange fee schedule."""
    maker_pct: float = 0.001   # 0.1%
    taker_pct: float = 0.001   # 0.1%


@dataclass
class ExchangeConfig:
    """Per-exchange configuration."""
    name: str
    enabled: bool = True
    fees: FeeSchedule = field(default_factory=FeeSchedule)


@dataclass
class Config:
    """Global application config."""

    # Exchange configurations
    exchanges: dict[str, ExchangeConfig] = field(default_factory=lambda: {
        "binance":  ExchangeConfig("Binance",  enabled=True,  fees=FeeSchedule(maker_pct=0.001, taker_pct=0.001)),
        "coinbase": ExchangeConfig("Coinbase", enabled=True,  fees=FeeSchedule(maker_pct=0.004, taker_pct=0.006)),
        "kraken":   ExchangeConfig("Kraken",   enabled=True,  fees=FeeSchedule(maker_pct=0.0016, taker_pct=0.0026)),
        "bybit":    ExchangeConfig("Bybit",    enabled=True,  fees=FeeSchedule(maker_pct=0.001, taker_pct=0.001)),
        "okx":      ExchangeConfig("OKX",       enabled=True,  fees=FeeSchedule(maker_pct=0.0008, taker_pct=0.001)),
        "gateio":   ExchangeConfig("Gate.io",  enabled=True,  fees=FeeSchedule(maker_pct=0.002, taker_pct=0.002)),
    })

    # Trading pairs to monitor (Binance-style: BTCUSDT, ETHUSDT)
    # Loaded from settings.json — use get_enabled_pairs() for the live list
    trading_pairs: tuple[str, ...] = (
        "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT",
        "BNBUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT",
        "DOTUSDT", "MATICUSDT", "LINKUSDT", "LTCUSDT",
        "UNIUSDT", "ATOMUSDT", "XLMUSDT", "ETCUSDT",
        "FILUSDT", "NEARUSDT", "TRXUSDT", "DASHUSDT",
        "MANAUSDT", "AXSUSDT", "SANDUSDT", "CHZUSDT",
        "AAVEUSDT", "LRCUSDT", "ENJUSDT", "GALAUSDT",
        "APEUSDT", "SHIBUSDT", "KAVAUSDT", "KSMUSDT",
        "ZECUSDT", "XMRUSDT", "XTZUSDT", "EOSUSDT",
        "ALGOUSDT", "VETUSDT", "THETAUSDT", "FTMUSDT",
        "MKRUSDT", "COMPUSDT", "SNXUSDT", "YFIUSDT",
        "SUSHIUSDT", "CRVUSDT", "LDOUSDT", "APEUSDT",
        "GMXUSDT", "RUNEUSDT",
    )

    # Settings loaded from settings.json
    _settings: dict = field(default_factory=_load_settings)

    @property
    def enabled_pairs(self) -> list[str]:
        """Pairs currently enabled for monitoring."""
        return self._settings.get("enabled_pairs", list(self.trading_pairs))

    @property
    def min_profit_pct(self) -> float:
        return self._settings.get("min_profit_pct", 0.05)

    @property
    def telegram_enabled(self) -> bool:
        return self._settings.get("telegram_enabled", True)

    @property
    def max_exposure_per_pair(self) -> dict[str, float]:
        return self._settings.get("max_exposure_per_pair", {})

    # How many of the top coins to scan (from CoinGecko)
    top_coins_limit: int = 50

    # Poll interval in seconds (1s for live arbitrage)
    poll_interval: int = 1

    # Minimum net profit percentage to flag as an opportunity
    min_profit_pct: float = 0.05

    # Telegram alerts
    telegram_enabled: bool = True
    telegram_bot_token: str = os.getenv(
        "TELEGRAM_BOT_TOKEN", "8782066565:AAHNlnYFgp0-7MeLpJ2S4BCLNx014uJ9aBA"
    )
    telegram_chat_id: str | None = os.getenv("TELEGRAM_CHAT_ID")

    # API keys (optional for public endpoints)
    binance_api_key: str | None = os.getenv("BINANCE_API_KEY")
    binance_api_secret: str | None = os.getenv("BINANCE_API_SECRET")
    coinbase_api_key: str | None = os.getenv("COINBASE_API_KEY")
    coinbase_api_secret: str | None = os.getenv("COINBASE_API_SECRET")

    @classmethod
    def from_env(cls) -> "Config":
        """Load config from environment variables and settings.json."""
        pairs_raw = os.getenv("TRADING_PAIRS")
        if pairs_raw:
            pairs = tuple(p.strip().upper().replace("/", "") for p in pairs_raw.split(","))
        else:
            pairs = cls().trading_pairs

        cfg = cls(trading_pairs=pairs)

        if interval := os.getenv("POLL_INTERVAL"):
            cfg.poll_interval = int(interval)

        return cfg


def get_all_pairs() -> list[str]:
    """Return the canonical list of all available trading pairs."""
    return list(Config().trading_pairs)


def get_enabled_pairs() -> list[str]:
    """Return the currently-enabled pairs from settings.json."""
    return CONFIG.enabled_pairs


def save_enabled_pairs(pairs: list[str]) -> None:
    """Save the enabled pairs list to settings.json."""
    settings = _load_settings()
    settings["enabled_pairs"] = sorted(pairs, key=lambda p: _load_settings()["enabled_pairs"].index(p) if p in _load_settings()["enabled_pairs"] else 999)
    _save_settings(settings)
    # Reload CONFIG so it picks up the new settings
    CONFIG._settings = _load_settings()


CONFIG: Final[Config] = Config.from_env()
