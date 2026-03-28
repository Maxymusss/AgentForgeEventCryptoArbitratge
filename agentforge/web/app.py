"""AgentForge Web Dashboard — FastAPI + WebSocket server for live arbitrage monitoring."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from ..config import CONFIG
from ..exchanges import (
    binance_bid_ask, coinbase_bid_ask, kraken_bid_ask,
    bybit_bid_ask, okx_bid_ask, gateio_bid_ask,
    Exchange,
)
from ..models import ArbitrageOpportunity

logger = logging.getLogger("agentforge.web")

_BASE_DIR = Path(__file__).resolve().parent.parent.parent
_STATIC_DIR = _BASE_DIR / "agentforge" / "web" / "static"
_TEMPLATE_DIR = _BASE_DIR / "agentforge" / "web" / "templates"

app = FastAPI(title="AgentForge Dashboard")
app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

_EXCHANGE_FETCHERS = {
    Exchange.BINANCE:  binance_bid_ask,
    Exchange.COINBASE: coinbase_bid_ask,
    Exchange.KRAKEN:   kraken_bid_ask,
    Exchange.BYBIT:    bybit_bid_ask,
    Exchange.OKX:      okx_bid_ask,
    Exchange.GATEIO:  gateio_bid_ask,
}

_ENABLED_EXCHANGES = [
    e for e in Exchange
    if CONFIG.exchanges.get(e.value) and CONFIG.exchanges[e.value].enabled
]

_FALLBACK_PAIRS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT",
    "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "MATICUSDT",
    "LINKUSDT", "LTCUSDT", "UNIUSDT", "ATOMUSDT", "XLMUSDT",
    "ETCUSDT", "FILUSDT", "NEARUSDT", "TRXUSDT", "MANAUSDT",
    "AXSUSDT", "SANDUSDT", "CHZUSDT", "AAVEUSDT", "LRCUSDT",
    "ENJUSDT", "GALAUSDT", "APEUSDT", "SHIBUSDT", "KAVAUSDT",
    "ZECUSDT", "XMRUSDT", "XTZUSDT", "EOSUSDT", "ALGOUSDT",
    "VETUSDT", "THETAUSDT", "FTMUSDT", "MKRUSDT", "COMPUSDT",
    "SNXUSDT", "YFIUSDT", "SUSHIUSDT", "CRVUSDT", "LDOUSDT",
    "GMXUSDT", "RUNEUSDT", "INCHUSDT", "BTCUSDC",
]

# ─── WebSocket manager ────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, msg: str):
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = ConnectionManager()


# ─── Price fetch ────────────────────────────────────────────────────────────

async def fetch_bid_asks(pair: str) -> dict[str, dict[str, float | None]]:
    """Fetch bid/ask from all enabled exchanges concurrently."""

    async def fetch_one(exchange: Exchange, fetcher) -> tuple[str, dict[str, float | None]]:
        loop = asyncio.get_running_loop()
        bid, ask = await loop.run_in_executor(None, fetcher, pair)
        return exchange.value, {"bid": bid, "ask": ask}

    tasks = [fetch_one(ex, _EXCHANGE_FETCHERS[ex]) for ex in _ENABLED_EXCHANGES]
    results = await asyncio.gather(*tasks)
    return dict(results)


async def price_fetch_loop():
    """Continuously fetch bid/ask from all exchanges and broadcast to WebSocket clients."""
    from ..api.coingecko import get_top_coins, get_binance_symbol

    loop = asyncio.get_running_loop()

    # Try CoinGecko first for dynamic top-50
    coins = []
    for attempt in range(3):
        coins = await loop.run_in_executor(None, lambda: get_top_coins(limit=50))
        if len(coins) >= 10:
            break
        logger.warning("CoinGecko returned only %d coins, retrying (%d/3)", len(coins), attempt + 2)
        await asyncio.sleep(2)

    STABLECOINS = {"USDT", "USDC", "BUSD", "DAI", "FDUSD", "PAX", "TUSD", "USDP"}
    coins = [c for c in coins if c.symbol not in STABLECOINS]

    if len(coins) >= 10:
        pairs = [get_binance_symbol(c) for c in coins]
        logger.info("Monitoring %d pairs from CoinGecko top 50", len(pairs))
    else:
        pairs = _FALLBACK_PAIRS
        logger.info("Using fallback list of %d pairs", len(pairs))

    # Import arbitrage engine here to avoid circular import
    from ..core.arbitrage import find_arbitrage_opportunities as find_opps

    while True:
        try:
            for pair in pairs:
                bid_asks = await fetch_bid_asks(pair)

                # Build exchange enum → (bid, ask) for arbitrage engine
                bid_ask_enums: dict[Exchange, tuple[float | None, float | None]] = {}
                for ex_name, prices in bid_asks.items():
                    for ex in _ENABLED_EXCHANGES:
                        if ex.value == ex_name:
                            bid_ask_enums[ex] = (prices.get("bid"), prices.get("ask"))
                            break

                opps: list[ArbitrageOpportunity] = find_opps(bid_ask_enums, pair)

                arb_opps = []
                for o in opps:
                    try:
                        profit = getattr(o, "profit_pct", None)
                        if profit is not None and profit > 0:
                            arb_opps.append({
                                "buy_exchange": getattr(o, "buy_exchange", ""),
                                "sell_exchange": getattr(o, "sell_exchange", ""),
                                "pair": getattr(o, "pair", pair),
                                "buy_price": getattr(o, "buy_price", 0),
                                "sell_price": getattr(o, "sell_price", 0),
                                "raw_spread_pct": getattr(o, "raw_spread_pct", 0),
                                "profit_pct": profit,
                            })
                    except Exception:
                        pass

                payload = {
                    "type": "tick",
                    "pair": pair,
                    "prices": bid_asks,
                    "opportunities": arb_opps,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                await manager.broadcast(json.dumps(payload))

            await asyncio.sleep(CONFIG.poll_interval)

        except Exception as exc:
            logger.warning("Price fetch error: %s", exc)
            await asyncio.sleep(5)


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    asyncio.create_task(price_fetch_loop())


@app.get("/")
async def root():
    with open(_TEMPLATE_DIR / "dashboard.html") as f:
        return HTMLResponse(content=f.read())


@app.websocket("/ws/prices")
async def websocket_prices(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
