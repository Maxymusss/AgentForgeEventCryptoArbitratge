// ─── AgentForge — bid/ask per exchange per pair ─────────────────────────────────

const WS_URL = `ws://${location.host}/ws/prices`;
const EXCHANGES = ['binance', 'coinbase', 'kraken', 'bybit', 'okx', 'gateio'];

const state = {};
const pairs = new Set();
let bestSpread = null;
let lastUpdate = null;
let arbFilter = 'all';  // 'all' | 'profit' | 'top5'

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
// Uses enriched opportunity data from backend WebSocket: volume_score, min_order,
// and per-exchange fee breakdown.

function setArbFilter(f) {
    arbFilter = f;
    document.querySelectorAll('.filter-row .filter-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById('filter-' + f);
    if (btn) btn.classList.add('active');
    renderArbList();
}

function renderArbList() {
    const list = $('arb-list');
    const noOpps = $('no-opps');
    const countBadge = $('opp-count');

    const rows = [];

    for (const pair of Object.keys(state)) {
        const data = state[pair];
        if (!data || !data.opportunities) continue;
        for (const opp of data.opportunities) {
            if (!opp.raw_spread_pct && opp.raw_spread_pct !== 0) continue;
            rows.push(opp);
        }
    }

    // Apply arb filter
    let filtered = rows;
    if (arbFilter === 'profit') {
        filtered = rows.filter(r => (r.profit_pct || 0) > 0);
    } else if (arbFilter === 'top5') {
        filtered = rows.slice(0, 5);
    }

    filtered.sort((a, b) => b.raw_spread_pct - a.raw_spread_pct);
    const top10 = filtered.slice(0, 10);

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
        const isHigh = (opp.profit_pct || 0) > 0.05;
        card.className = 'arb-card' + (isHigh ? ' high' : '');
        const grossPct = opp.raw_spread_pct || 0;
        const buyFee = opp.buy_fee_pct || 0;
        const sellFee = opp.sell_fee_pct || 0;
        const totalFees = buyFee + sellFee;
        const minAmt = opp.min_order_amount != null ? fmt(opp.min_order_amount) : '—';
        const volScore = opp.volume_score != null ? opp.volume_score : 50;

        card.innerHTML = `
            <div class="arb-pair">${opp.pair}</div>
            <div class="arb-flow">
                <a class="arb-exchange" style="background:${exColor(opp.buy_exchange)}" href="${exTradeUrl(opp.buy_exchange, opp.pair)}" target="_blank" rel="noopener">${exLabel(opp.buy_exchange)} ASK ↗</a>
                <span class="arb-arrow">→</span>
                <a class="arb-exchange" style="background:${exColor(opp.sell_exchange)}" href="${exTradeUrl(opp.sell_exchange, opp.pair)}" target="_blank" rel="noopener">${exLabel(opp.sell_exchange)} BID ↗</a>
            </div>
            <div class="arb-prices">
                <span class="ask-price">${fmt(opp.buy_price)} ASK</span>
                <span class="bid-price">${fmt(opp.sell_price)} BID</span>
            </div>
            <div class="arb-metrics">
                <div class="metric">
                    <span class="metric-label">SPREAD</span>
                    <span class="metric-value spread">+${grossPct.toFixed(4)}%</span>
                </div>
                <div class="metric">
                    <span class="metric-label">NET PROFIT</span>
                    <span class="metric-value profit">${(opp.profit_pct || 0) >= 0 ? '+' : ''}${(opp.profit_pct || 0).toFixed(4)}%</span>
                </div>
                <div class="metric">
                    <span class="metric-label">FEES</span>
                    <span class="metric-value" style="color:var(--warn)">−${totalFees.toFixed(4)}%</span>
                </div>
                <div class="metric">
                    <span class="metric-label">MIN ORDER</span>
                    <span class="metric-value">${minAmt}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">VOL SCORE</span>
                    <span class="metric-value">${volScore}/100</span>
                </div>
            </div>
            <div class="fee-detail">Buy fee: ${buyFee.toFixed(4)}% · Sell fee: ${sellFee.toFixed(4)}%</div>
        `;
        list.appendChild(card);
    }

    if (top10.length) bestSpread = top10[0].raw_spread_pct;
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
        okx:      `https://www.okx.com/singapore/trade/spot/${base}-${quote}`,
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
loadBalances();

function loadBalances() {
    fetch('/api/balances')
        .then(r => r.json())
        .then(balances => renderBalances(balances))
        .catch(() => {});
}

function renderBalances(balances) {
    let total = 0;
    for (const ex of EXCHANGES) {
        const val = balances[ex];
        const el = $(`bal-${ex}-val`);
        if (el && val != null) {
            el.textContent = '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
            total += Number(val);
        }
    }
    const totalEl = $('bal-total');
    if (totalEl) {
        totalEl.textContent = '$' + total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
}

function openBalanceEditor() {
    const modal = $('balance-modal');
    modal.style.display = 'flex';

    // Build editor rows
    fetch('/api/balances')
        .then(r => r.json())
        .then(balances => {
            const container = $('balance-editor-rows');
            const EXCHANGES_EDITOR = ['binance','coinbase','kraken','bybit','okx','gateio'];
            container.innerHTML = '';
            for (const ex of EXCHANGES_EDITOR) {
                const row = document.createElement('div');
                row.className = 'balance-editor-row';
                row.innerHTML = `
                    <span class="ex-dot-sm" style="background:${exColor(ex)}"></span>
                    <span class="balance-ex-label">${exLabel(ex)}</span>
                    <span style="color:var(--text-dim); font-size:12px">$</span>
                    <input type="number" class="balance-input" id="be-${ex}"
                        value="${balances[ex] ?? ''}" min="0" step="100"
                        placeholder="0">
                `;
                container.appendChild(row);
            }
        });
}

function closeBalanceEditor() {
    $('balance-modal').style.display = 'none';
    $('bal-save-status').textContent = '';
}

async function saveBalances() {
    const EXCHANGES_EDITOR = ['binance','coinbase','kraken','bybit','okx','gateio'];
    const balances = {};
    for (const ex of EXCHANGES_EDITOR) {
        const input = $(`be-${ex}`);
        if (input) {
            const v = parseFloat(input.value);
            balances[ex] = isNaN(v) ? 0 : Math.max(0, v);
        }
    }
    const r = await fetch('/api/balances', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ balances }),
    });
    const el = $('bal-save-status');
    if (r.ok) {
        el.textContent = '✓ SAVED';
        el.style.color = 'var(--profit)';
        closeBalanceEditor();
        loadBalances();
    } else {
        el.textContent = '✗ FAILED';
        el.style.color = 'var(--loss)';
    }
}

// Close modal on background click
document.addEventListener('click', function(e) {
    const modal = $('balance-modal');
    if (modal && modal.style.display === 'flex' && e.target === modal) {
        closeBalanceEditor();
    }
});
