# AgentForgeEventCryptoArbitrage

> Crypto arbitrage opportunity detector — monitors Binance and Coinbase in real time.

## What it does

AgentForge watches live prices on Binance and Coinbase. When a pair is cheaper on one exchange and more expensive on the other, it calculates whether the spread covers trading fees — and flags it as a viable arbitrage opportunity.

## Quick start

### 1. Install dependencies

```bash
# Requires Python 3.11+
poetry install
```

### 2. Configure (optional — public endpoints work without API keys)

```bash
cp .env.example .env
# Edit .env and add your exchange API keys if you want authenticated access
```

### 3. Run

```bash
poetry run python -m agentforge.main --pair BTCUSDT --interval 10
```

## CLI options

| Flag | Description | Default |
|---|---|---|
| `--pair` | Single trading pair (e.g. `BTCUSDT`) | All pairs |
| `--pairs` | Comma-separated pairs (e.g. `BTCUSDT,ETHUSDT`) | Config default |
| `--interval` | Poll interval in seconds | `10` |
| `--min-profit` | Min net profit % to flag as viable | `0.1` |
| `-v` | Enable debug logging | `False` |

## Architecture

```
agentforge/
├── config.py          # Config from environment variables
├── models.py          # ArbitrageOpportunity dataclass
├── exchanges/
│   ├── binance.py     # Binance price fetcher
│   └── coinbase.py    # Coinbase price fetcher
├── core/
│   ├── arbitrage.py   # Opportunity detection + profit calc
│   └── monitor.py     # Polling loop + rich terminal output
└── main.py            # CLI entry point

tests/
├── test_arbitrage.py
└── test_monitor.py
```

## Trading pairs

Uses Binance-style symbols internally:
- `BTCUSDT` → BTC/USDT
- `ETHUSDT` → ETH/USDT
- `SOLUSDT` → SOL/USDT

Set via `--pairs BTCUSDT,ETHUSDT,SOLUSDT` or `TRADING_PAIRS` in `.env`.

## How arbitrage works

```
Buy on Exchange A at lower price
     ↓
Sell on Exchange B at higher price
     ↓
Gross spread % = (sell_price - buy_price) / buy_price * 100
Net profit %   = Gross spread - Binance taker fee (0.1%) - Coinbase taker fee (0.1%)
```

If `net profit % > 0`, it's理论上 profitable. Real trading also needs to account for slippage, withdrawal fees, and API rate limits.

## Disclaimer

This is a proof-of-concept / educational tool. Crypto arbitrage is competitive and fees/slippage can easily erode theoretical profits. Always paper-trade first and do your own research before using any trading bot with real funds.
