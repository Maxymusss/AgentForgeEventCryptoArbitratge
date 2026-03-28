// ─── AgentForge — bid/ask per exchange per pair ─────────────────────────────────

const WS_URL = `ws://${location.host}/ws/prices`;
const EXCHANGES = ['binance', 'coinbase', 'kraken', 'bybit', 'okx', 'gateio'];

const state = {};
const pairs = new Set();
let bestSpread = null;
let lastUpdate = null;

const $ = (id) => document.getElementById(id);

// ─── WebSocket ──────────────────────────────────────────────────────────────

function connect() {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => { updateStatus(true); };
    ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        try { handleTick(JSON.parse(e.data)); } catch(err) { console.error(err); }
    };
    ws.onclose = () => { updateStatus(false); setTimeout(connect, 3000); };
    ws.onerror = (err) => { console.error(err); ws.close(); };
}

function handleTick(msg) {
    const { pair, prices, opportunities, timestamp } = msg;
    pairs.add(pair);
    state[pair] = { prices, opportunities, timestamp };
    lastUpdate = new Date();
    renderPriceGrid();
    renderArbList();
    updateStats();
    updateClock();
}

function updateStatus(connected) {
    const dot = document.querySelector('.dot');
    const label = document.querySelector('.dot-label');
    if (connected) {
        dot.classList.add('connected');
        label.textContent = 'CONNECTED';
    } else {
        dot.classList.remove('connected');
        label.textContent = 'DISCONNECTED';
    }
}

// ─── Price Grid: bid/ask per exchange ─────────────────────────────────────────────
// Layout per row:
//   PAIR | BINANCE BID | BINANCE ASK | COINBASE BID | COINBASE ASK | ...
//   Cell highlighting:
//   - GREEN = lowest ASK across all exchanges (best to buy)
//   - RED   = highest BID across all exchanges (best to sell)

function renderPriceGrid() {
    const rows = $('price-rows');
    rows.innerHTML = '';

    const sortedPairs = Array.from(pairs).sort();

    for (const pair of sortedPairs) {
        const data = state[pair];
        if (!data || !data.prices) continue;

        const { prices } = data;

        // Gather bids and asks across all exchanges
        const allAsks = [];
        const allBids = [];
        for (const ex of EXCHANGES) {
            const p = prices[ex];
            if (!p) continue;
            if (p.ask != null && p.ask !== 0 && !Number.isNaN(p.ask)) allAsks.push({ ex, ask: p.ask });
            if (p.bid != null && p.bid !== 0 && !Number.isNaN(p.bid)) allBids.push({ ex, bid: p.bid });
        }

        const cheapestAsk = allAsks.length ? allAsks.reduce((a, b) => a.ask < b.ask ? a : b) : null;
        const highestBid = allBids.length ? allBids.reduce((a, b) => a.bid > b.bid ? a : b) : null;

        // Spread = highest_bid - lowest_ask (executable arb spread)
        let spread = null;
        if (highestBid && cheapestAsk) {
            const gross = highestBid.bid - cheapestAsk.ask;
            spread = (gross / cheapestAsk.ask) * 100;
        }

        const row = document.createElement('div');
        row.className = 'price-row';

        // Pair symbol
        let cells = `<span class="pair-symbol">${pair}</span>`;

        // Per-exchange: BID then ASK
        for (const ex of EXCHANGES) {
            const p = prices[ex];
            if (!p) {
                cells += '<span class="price-cell na">—</span><span class="price-cell na">—</span>';
                continue;
            }

            const { bid, ask } = p;

            // BID cell — skip 0 / NaN
            const validBid = bid != null && bid !== 0 && !Number.isNaN(bid);
            if (validBid) {
                const isHighestBid = highestBid && highestBid.ex === ex;
                const cls = 'price-cell' + (isHighestBid ? ' highest-bid' : '');
                cells += `<span class="${cls}" title="${ex.toUpperCase()} BID">${fmt(bid)}</span>`;
            } else {
                cells += '<span class="price-cell na">—</span>';
            }

            // ASK cell — skip 0 / NaN
            const validAsk = ask != null && ask !== 0 && !Number.isNaN(ask);
            if (validAsk) {
                const isCheapestAsk = cheapestAsk && cheapestAsk.ex === ex;
                const cls = 'price-cell' + (isCheapestAsk ? ' cheapest-ask' : '');
                cells += `<span class="${cls}" title="${ex.toUpperCase()} ASK">${fmt(ask)}</span>`;
            } else {
                cells += '<span class="price-cell na">—</span>';
            }
        }

        // Spread cell
        if (spread !== null) {
            const cls = spread > 0 ? 'spread-cell positive' : 'spread-cell';
            cells += `<span class="${cls}">${spread >= 0 ? '+' : ''}${spread.toFixed(4)}%</span>`;
        } else {
            cells += '<span class="spread-cell">—</span>';
        }

        row.innerHTML = cells;
        rows.appendChild(row);
    }
}

// ─── Arbitrage list: top 10 by spread ───────────────────────────────────────────
// Buy at lowest ASK → sell at highest BID (executable)

function renderArbList() {
    const list = $('arb-list');
    const noOpps = $('no-opps');
    const countBadge = $('opp-count');

    const rows = [];

    for (const pair of Object.keys(state)) {
        const data = state[pair];
        if (!data || !data.prices) continue;

        const { prices } = data;

        const allAsks = EXCHANGES.map(ex => ({ ex, ask: prices[ex]?.ask })).filter(x => x.ask != null && x.ask !== 0 && !Number.isNaN(x.ask));
        const allBids = EXCHANGES.map(ex => ({ ex, bid: prices[ex]?.bid })).filter(x => x.bid != null && x.bid !== 0 && !Number.isNaN(x.bid));

        if (!allAsks.length || !allBids.length) continue;

        const lowestAsk = allAsks.reduce((a, b) => a.ask < b.ask ? a : b);
        const highestBid = allBids.reduce((a, b) => a.bid > b.bid ? a : b);
        if (lowestAsk.ex === highestBid.ex) continue;

        const gross = highestBid.bid - lowestAsk.ask;
        const grossPct = (gross / lowestAsk.ask) * 100;
        const netPct = grossPct - 0.20; // ~0.1% + 0.1% in fees

        rows.push({
            pair,
            buy_ex: lowestAsk.ex,
            sell_ex: highestBid.ex,
            buy_price: lowestAsk.ask,
            sell_price: highestBid.bid,
            grossPct,
            netPct,
        });
    }

    rows.sort((a, b) => b.grossPct - a.grossPct);
    const top10 = rows.slice(0, 10);

    countBadge.textContent = top10.length;

    if (!top10.length) {
        list.innerHTML = '';
        noOpps.style.display = 'flex';
        return;
    }

    noOpps.style.display = 'none';
    list.innerHTML = '';

    for (const opp of top10) {
        const card = document.createElement('div');
        card.className = 'arb-card' + (opp.grossPct > 0.05 ? ' high' : '');
        card.innerHTML = `
            <div class="arb-pair">${opp.pair}</div>
            <div class="arb-flow">
                <a class="arb-exchange" style="background:${exColor(opp.buy_ex)}" href="${exTradeUrl(opp.buy_ex, opp.pair)}" target="_blank" rel="noopener">${exLabel(opp.buy_ex)} ASK ↗</a>
                <span class="arb-arrow">→</span>
                <a class="arb-exchange" style="background:${exColor(opp.sell_ex)}" href="${exTradeUrl(opp.sell_ex, opp.pair)}" target="_blank" rel="noopener">${exLabel(opp.sell_ex)} BID ↗</a>
            </div>
            <div class="arb-prices">
                <span class="ask-price">${fmt(opp.buy_price)} ASK</span>
                <span class="bid-price">${fmt(opp.sell_price)} BID</span>
            </div>
            <div class="arb-metrics">
                <div class="metric">
                    <span class="metric-label">SPREAD</span>
                    <span class="metric-value spread">+${opp.grossPct.toFixed(4)}%</span>
                </div>
                <div class="metric">
                    <span class="metric-label">NET PROFIT</span>
                    <span class="metric-value profit">${opp.netPct >= 0 ? '+' : ''}${opp.netPct.toFixed(4)}%</span>
                </div>
            </div>
        `;
        list.appendChild(card);
    }

    if (top10.length) bestSpread = top10[0].grossPct;
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function updateStats() {
    $('stat-pairs').textContent = pairs.size;
    $('stat-best-spread').textContent =
        bestSpread != null ? `${bestSpread >= 0 ? '+' : ''}${bestSpread.toFixed(4)}%` : '—';
    $('stat-best-profit').textContent =
        bestSpread != null ? `${bestSpread - 0.2 >= 0 ? '+' : ''}${(bestSpread - 0.2).toFixed(4)}%` : '—';
    if (lastUpdate) $('stat-last').textContent = lastUpdate.toLocaleTimeString();
}

function updateClock() {
    $('clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function exColor(ex) {
    const c = { binance:'#f0b90b', coinbase:'#0052ff', kraken:'#5741d9', bybit:'#f7a800', okx:'#ffffff', gateio:'#17e78c' };
    return c[ex] || '#333';
}

function exLabel(ex) {
    return { binance:'Binance', coinbase:'Coinbase', kraken:'Kraken', bybit:'Bybit', okx:'OKX', gateio:'Gate.io' }[ex] || ex;
}

function exTradeUrl(exchange, pair) {
    // Split BTCUSDT → base=BNB quote=USDT
    const quotes = ['USDT','USDC','BUSD','BTC','ETH','USD','EUR','GBP'];
    let base = pair, quote = 'USDT';
    for (const q of quotes) {
        if (pair.endsWith(q)) {
            base = pair.slice(0, -q.length);
            quote = q;
            break;
        }
    }
    // Coinbase uses USD not USDT
    if (quote === 'USDT') quote = 'USD';
    // Gate.io uses underscore
    const qGate = quote === 'USD' ? 'USDT' : quote;

    const urls = {
        binance:  `https://www.binance.com/en/trade/${base}/${quote}`,
        coinbase: `https://www.coinbase.com/trade/${base}-${quote}`,
        kraken:   `https://www.kraken.com/en-gb/prices/${base.toLowerCase()}`,
        bybit:    `https://www.bybit.com/trade/spot/${base}/${quote}`,
        okx:      `https://www.okx.com/trade/spot/${base}-${quote}`,
        gateio:   `https://www.gate.io/trade/${base.toLowerCase()}_${qGate.toLowerCase()}`,
    };
    return urls[exchange] || '#';
}

function fmt(v) {
    if (v == null || v === 0 || Number.isNaN(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 6 : 4 });
}

// ─── Boot ──────────────────────────────────────────────────────────────────

setInterval(updateClock, 1000);
updateClock();
connect();
