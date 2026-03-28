# AgentForge — Multi-Exchange Crypto Arbitrage Scanner

> Scans live bid/ask spreads across 6 exchanges, surfaces executable arbitrage opportunities, and links directly to execute trades.

![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

## What it does

AgentForge connects to **Binance, Coinbase, Kraken, Bybit, OKX, and Gate.io** via their public REST APIs. For each trading pair it:

1. Pulls the current **bid** (sell) and **ask** (buy) prices from all exchanges simultaneously
2. Finds the **lowest ask** (where you'd buy) and **highest bid** (where you'd sell)
3. Calculates gross spread % and net profit % after estimated exchange fees
4. Pushes live results via **WebSocket** to the dashboard
5. Each opportunity card links **directly to the exchange trade page** for execution

## Exchanges supported

| Exchange | API Type | Status |
|---|---|---|
| Binance | Public REST (bookTicker) | ✅ |
| Coinbase | Public REST (spot price) | ✅ |
| Kraken | Public REST (Ticker) | ✅ |
| Bybit | Public REST (V5 Tickers) | ✅ |
| OKX | Public REST (V5 Ticker) | ✅ |
| Gate.io | Public REST (V4 Spot Tickers) | ✅ |

## Quick start

### 1. Install

```bash
git clone https://github.com/Maxymusss/AgentForgeCryptoArbitratge.git
cd AgentForgeCryptoArbitratge
poetry install
```

### 2. Run the web dashboard

```bash
poetry run python -m uvicorn agentforge.web.app:app --reload --port 8000
```

Then open **http://localhost:8000** in your browser.

The dashboard streams live bid/ask data via WebSocket and auto-updates every second.

### 3. Run the CLI monitor

```bash
poetry run python -m agentforge.main --pairs BTCUSDT,ETHUSDT,SOLUSDT --interval 5 --min-profit 0.05
```

## CLI options

| Flag | Description | Default |
|---|---|---|
| `--pair` | Single trading pair (e.g. `BTCUSDT`) | All pairs |
| `--pairs` | Comma-separated pairs | Config default |
| `--interval` | Poll interval in seconds | `1` |
| `--min-profit` | Min net profit % to flag as viable | `0.05` |
| `--exchanges` | Comma-separated exchanges to use | All enabled |
| `--telegram` | Enable Telegram alerts | `False` |
| `--max-results` | Max opportunities shown per round | `5` |
| `-v` | Enable debug logging | `False` |

## Architecture

```
agentforge/
├── config.py              # Config from env + settings.json
├── models.py              # ArbitrageOpportunity, Exchange enum
├── main.py                # CLI entry point
├── api/
│   └── coingecko.py       # CoinGecko integration (top-50 coins)
├── exchanges/
│   ├── binance.py         # Binance bid/ask fetcher
│   ├── coinbase.py        # Coinbase bid/ask fetcher
│   ├── kraken.py          # Kraken bid/ask fetcher
│   ├── bybit.py           # Bybit bid/ask fetcher
│   ├── okx.py             # OKX bid/ask fetcher
│   ├── gateio.py         # Gate.io bid/ask fetcher
│   └── symbols.py         # Symbol normalization per exchange
├── core/
│   ├── arbitrage.py       # Opportunity detection + profit calc
│   └── monitor.py         # Async polling loop + Telegram
├── alerts/
│   └── telegram.py        # Telegram bot alert sender
└── web/
    ├── app.py             # FastAPI app + WebSocket broadcast + settings API
    ├── arbitrage_web.py   # Web arbitrage engine helpers
    └── static/
        ├── app.js          # WebSocket client + live grid renderer
        ├── style.css       # Dark futuristic theme
        └── templates/
            └── dashboard.html  # Main dashboard HTML

settings.json               # Persisted settings (pairs, thresholds, Telegram)

tests/
├── test_arbitrage.py
└── test_monitor.py
```

## Dashboard features

- **Live bid/ask matrix** — per-exchange bid/ask per pair, updated every second
- **Best prices highlighted** — green = cheapest ask (best buy), red = highest bid (best sell)
- **Arbitrage opportunity cards** — sorted by gross spread, shows buy/sell exchange + ASK/BID prices
- **Spread + net profit** — gross spread % and fee-adjusted net profit % per opportunity
- **Filter controls** — filter opportunities by ALL / PROFITABLE (>0%) / TOP 5
- **Pair selector** — toggle individual trading pairs on/off in the matrix
- **WebSocket streaming** — no page refresh needed, all clients update simultaneously

### Settings page (`/settings`)

Accessible via the ⚙ gear icon in the dashboard header. Lets you adjust:

| Setting | Description |
|---|---|
| **Min Profit %** | Fire Telegram alert when net profit exceeds this threshold |
| **Poll Interval** | How often to refresh prices (seconds) |
| **Telegram Alerts** | Toggle bot alerts on/off without restarting |

## How arbitrage works

```
Buy  on [lowest ASK exchange]  at price A
Sell on [highest BID exchange] at price B

Gross spread % = (B - A) / A * 100
Net profit %   = Gross spread - maker/taker fees for both exchanges
```

If `net profit % > 0`, the trade is theoretically profitable after fees. Real trading must also account for slippage, withdrawal fees, transfer time, and API rate limits.

## Fees used in net profit calculation

| Exchange | Maker | Taker |
|---|---|---|
| Binance | 0.1% | 0.1% |
| Coinbase | 0.4% | 0.6% |
| Kraken | 0.16% | 0.26% |
| Bybit | 0.1% | 0.1% |
| OKX | 0.08% | 0.1% |
| Gate.io | 0.2% | 0.2% |

## Environment variables

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
BINANCE_API_KEY=your_key        # optional
BINANCE_API_SECRET=your_secret  # optional
COINBASE_API_KEY=your_key       # optional
COINBASE_API_SECRET=your_secret # optional
POLL_INTERVAL=1                # seconds
```

## Disclaimer

This is a proof-of-concept / educational tool. Crypto arbitrage is highly competitive and fees, slippage, withdrawal limits, and transfer delays can easily erode theoretical profits. Always paper-trade first and do your own research before using any trading bot with real funds.
