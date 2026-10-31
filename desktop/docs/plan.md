# 0.5.0 plan: exchanges, real trading, portfolio, market overview

## Goals

1. Live prices from Binance, OKX, Bybit, KuCoin, Coinbase and MEXC, each switchable in Data › Live prices.
2. API keys per exchange (and the existing OANDA token) so orders go to the real account.
3. Placing an order on a venue without keys opens a reminder that leads to the keys window (or paper trades instead).
4. The symbol picker shows which venue each pair belongs to, with venue filter chips; forex and metals are marked OANDA.
5. Menu text "Live prices (Binance)" becomes "Live prices".
6. File › Dashboard › Portfolio: balances and open orders on every keyed exchange, the OANDA account, and on-chain wallets by address.
7. File › Dashboard › Market overview: Crypto, Crypto pairs, Forex and Stocks tabs with period, range, sort and custom-condition filters.

## Symbol model

- Exchange pairs are named like TradingView: `BINANCE:BTCUSDT`, `OKX:BTCUSDT`, `COINBASE:BTCUSD`.
- Each enabled exchange lists its top 120 spot pairs by 24h volume, quoted in USDT, USDC or USD.
- Forex and metals keep their names (`XAUUSD`) and carry the OANDA badge.
- DEX pools keep their names and show the DEX and network.
- The six old Binance names (`BTCUSD` …) map to `BINANCE:…USDT`; their drawings and the last symbol are migrated once.

## Main process

- `electron/web.js`: public GET/POST through an allowlist of hosts, spaced per host, 429 backoff.
- `electron/exchanges.js`: pure request signing, order bodies and response parsing for the six exchanges (unit-tested).
- `electron/trade.js`: DPAPI-encrypted keys, balances, open orders, place and cancel; OANDA orders via `oanda.js`.
- `electron/keys.html`: the API keys window (one tab per venue, test connection, trade-only advice).
- Dashboards open as their own windows on `app://opencharts/index.html?view=portfolio|markets`.

## Renderer

- `adapters/cex-map.ts` (pure) and `adapters/cex-source.ts` (polling ticks, klines) replace the six-symbol Binance socket.
- `adapters/order-router.ts`: wraps the paper gateway; keyed venues get a confirm dialog and a real order, others the reminder.
- `upstream/src/desktop/`: `OrderGate.tsx`, `PortfolioPage.tsx`, `MarketsPage.tsx`, `market-filter.ts` (safe expression parser), `wallets.ts`.

## Limits accepted

- Real orders: market and limit only; TP/SL only on OANDA. Stop orders stay paper.
- Real orders are not shown in the terminal's positions table; the portfolio window lists balances and open orders with cancel.
- Signing is checked against published vectors and structure, not against live keys.
