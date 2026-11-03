# Changelog

## Unreleased

- **Refused-key hint, clearer.** A wrong secret (Binance -1022, OKX 50113, Bybit 10004, MEXC 700002, Gate.io INVALID_SIGNATURE) now gets its own short hint ("accepted the key but not the secret"), without the IP address or a test-network retry. For a refused key such as Binance -2015, the hint no longer suggests the secret on exchanges that report a wrong secret separately, says the address can change after a router restart as well as on a phone, and adds that Binance applies a change to a key's restrictions only after Save and its security check.
- Fixed: a regular expression in the HTX error cleanup was saved with raw control bytes, which made git and grep treat `electron/exchanges.js` as a binary file.

## 0.6.3 — 2026-11-03

- **Portfolio: HTX (Huobi), WhiteBIT, Gate.io, HitBTC and Poloniex.** Each takes an API key in **Data › Exchange API keys** and shows its balances and open orders (with **Cancel**) in the portfolio and the alerts & positions dashboard. They are portfolio-only: no price feed or order ticket. BitMEX is not added: it closed its exchange on 23 September 2026.
- **Clearer answer when an exchange refuses a key** (Binance's "Invalid API-key, IP, or permissions for action (-2015)"): the keys window now lists the usual causes (IP restriction, key cut short or deleted, a key from another Binance site or Demo Trading, Enable Reading off) and shows the public IPv4 address the exchange sees, to add to the key's IP whitelist.
- A Binance, OKX or Bybit test key saved without the test box ticked (or a live key with it ticked) is now tried on the other network and saved as what it is, instead of failing.
- Binance key and secret are checked for shape before Binance is asked (64 letters and digits; a self-generated Ed25519/RSA private key is named as such). Zero-width characters some apps paste along are removed from every key field.
- Tests: signing for the five new exchanges, their error, balance and open-order replies, Poloniex's failed-cancel reply; key checks, the network switch and the refused-key hint (90 in total).

## 0.6.2 — 2026-11-01

- **Market overview: one Crypto tab for centralised and decentralised markets.** Crypto, Crypto pairs and DEX are merged. Each of the 1,000 coins shows the exchanges listing it, its DEX liquidity and 24h volume across eleven chains (DexScreener, matched by contract address), and the gap between its DEX and exchange prices. Click a coin's name to see every exchange pair and its most liquid DEX pools, each with a Chart button. Trending GeckoTerminal pools whose token is not among the coins appear as "DEX only" rows, with instant day lines from their reported 24 h, 6 h, 1 h, 30, 15 and 5-minute changes. A DEX pool's Chart button adds the pool to the symbol list and charts it in the main window.
- **Fixed: a blank chart after switching to a slow-loading symbol.** While the new symbol's bars loaded, the chart showed the previous symbol's bars under the new name, then treated the real bars as a refresh and kept the old view, so it stayed blank until the timeframe changed. Now the chart empties on the switch and draws the new symbol as soon as its bars arrive; most visible with DEX pools, whose bars can take half a minute when GeckoTerminal is busy.
- **GeckoTerminal requests pace themselves.** The free API now allows a burst of about five calls, then about five a minute; the request queue widens its gap after each rate limit (up to 12 s), narrows it again as calls succeed, and retries a rate-limited call up to three times before failing. DEX price polls, searches and charts in the main window benefit too.
- **Trade on the DEX's own site.** Each DEX pool in an expanded coin has a **Trade** button that opens that DEX's swap page in the browser with the pair filled in (Uniswap, PancakeSwap, SushiSwap, Aerodrome, Velodrome, LFJ, Jupiter, Raydium, Orca, Meteora, Pump.fun, STON.fi, DeDust, Cetus, SunSwap; the chain's main DEX otherwise). The user connects their wallet and trades there; OpenCharts only opens the link. Addresses are checked against the chain's format before a link is built.
- Tests: coin tokens per chain, DEX pool parsing and totals, venues per coin, DEX-only rows, the instant day line; the GeckoTerminal queue's retry and priority order; swap-page and wallet links per DEX and chain (79 in total); smoke `dash` checks the venue columns, DEX-only rows, a coin's expanded pairs and pools, its Trade links, and that a pool's Chart button charts it. Smoke screenshots that Electron cannot capture no longer fail any scenario.

## 0.6.1 — 2026-11-01

- **Market overview row charts.** The chart icon column is now a real price line per row (140 × 34 px, 92 × 30 on phones), green or red with a fading fill, in every tab. It follows the **Change over** period: Day (15-minute bars), Week (hourly; CoinGecko's 7-day line for coins), Month (4-hour bars), Year and Custom (daily closes). Rows load their line as they scroll into view; Refresh redraws them; a click still opens the pair in the main window.
- Coins not on Binance now get history (and charts) from Bybit or OKX.
- Tests: chart helpers (CoinGecko week line, windows, path geometry; 69 in total); smoke `dash` checks the lines in all four periods and on every tab. Dashboard screenshots that Electron cannot capture no longer fail the run.

## 0.6.0 — 2026-10-31

- **Price alerts.** Right-click a price on the chart › **Set alert** (or add one in the new **Alerts** tab under the chart). Each alert fires **once** or **every time** the price crosses it (at most once a minute), on any symbol, not just the charted one, and is kept between runs. A firing shows a Windows notification (click it to chart the pair), a toast and a beep, and goes into the alert log. Alerts appear on the chart as dashed bell lines; pause, resume, re-arm, edit the price or note, or delete them in the list.
- Alerts are checked from the live prices while the app runs, including crossings between polls and while the app was closed (they fire on the next start). Symbols with an alert are polled faster.
- **File › Dashboard › Alerts & positions** (Ctrl+Shift+A): every alert, every open position (paper account and OANDA trades, with close), every open order (paper, the six exchanges, OANDA, with cancel), exchange holdings per venue, and summary cards. The paper account comes from the terminal window live.
- An exchange that does not answer at start is retried after 15 s, 1 min and 5 min; its pairs join the symbol list when it answers (before, it was missing until a restart).
- Tests: 6 alert unit tests (68 in total); smoke scenario `retry` blocks OKX for the first 20 s and checks its pairs arrive later; smoke scenario `alerts` right-clicks Set alert, fires two alerts on real prices (Windows notifications counted), and closes a paper position from the new dashboard.

## 0.5.2 — 2026-10-31

- Fib retracement and trend-based fib extension are one tool, **Fib retracement & extension** (Alt + F): two clicks draw levels 0, 0.236, 0.382, 0.5, 0.618, 0.786, 1 and the extensions 1.272, 1.618, 2.618, each in its own colour. Levels stay editable in the drawing's settings. Existing fib retracements gain the extension levels; older extension drawings still show.
- The `draw` smoke also places the fib tool and checks every placement saves on the charted symbol.

## 0.5.1 — 2026-10-31

- Fix: dashboard tables wider than the window were hard to scroll sideways (the terminal's 5 px, nearly invisible scrollbars). Dashboard windows now have 12 px scrollbars; the market overview keeps the rank and name columns pinned on the left and the chart button on the right while scrolling, and says Shift + wheel scrolls sideways. Portfolio tables scroll sideways in narrow windows.
- The market overview waits out a CoinGecko rate limit once instead of stopping at 750 coins; dashboard errors no longer show the internal "Error invoking remote method" prefix.
- Smoke `dash` checks sideways scrolling at the minimum window width (scrollbar size, pinned columns, chart button reachable).

## 0.5.0 — 2026-10-31

- Live prices from six exchanges: Binance, OKX, Bybit, KuCoin, Coinbase and MEXC, each listing its busiest 120 USD pairs, named like TradingView (`OKX:BTCUSDT`). **Data › Live prices** is a submenu with a switch per exchange (the old "(Binance)" label is gone).
- The symbol picker and watchlist tag every pair with its venue (exchange, OANDA for forex and metals, DEX), filter by venue chips and search several words (`okx btc`).
- Real trading: **Data › Exchange API keys…** checks each key against the exchange and stores it encrypted (DPAPI); OANDA trades with its existing token. Orders on a keyed venue show a confirmation and go to the exchange (market and limit, rounded to lot and tick, minimum checked; OANDA with take profit and stop loss). Test keys for Binance testnet, OKX demo and Bybit testnet.
- Without a key, placing an order opens a reminder that leads to the keys window, or paper trades that order.
- **File › Dashboard › Portfolio**: balances, USD values and open orders (with cancel) per exchange and OANDA; on-chain wallets by address on seven EVM chains, Solana and Bitcoin; totals and allocation.
- **File › Dashboard › Market overview**: Crypto, Crypto pairs, Forex & metals and Stocks tabs; changes by day, week, month, year or custom dates; min/max volume, market cap and change; sort both ways; a condition language over every column.
- The six old Binance symbols (`BTCUSD` …) become `BINANCE:…USDT`; their drawings, watchlist stars and the remembered symbol move with them.
- Tests: 62 unit tests (signing incl. Binance's published vector and Coinbase JWT verification, every exchange's replies, order rounding, filters, wallets); smoke scenarios `exchanges`, `gate` and `dash` against the real services.

## 0.4.0 — 2026-10-31

- 70 more drawing tools, after TradingView's menus: info line, trend angle, horizontal ray, crossline, regression trend, flat top/bottom, disjoint channel, four pitchforks, eight more Fibonacci tools, four Gann tools, six chart patterns, five Elliott waves, three cycle tools, position forecast, bars pattern, ghost feed, sector, anchored VWAP, fixed range and anchored volume profiles, price/date/date-and-price ranges, brush, highlighter, arrow marker and marks, rotated rectangle, path, circle, polyline, 3-point triangle, arc, curve, double curve, note, price note, pin, table, callout, comment, price label, signpost and flag mark.
- Left rail rebuilt like TradingView's: six groups with sectioned flyouts and shortcuts; each group remembers its last tool; measure, zoom, magnet, stay in drawing mode, lock all, hide all and remove all at the bottom.
- The measure tool shows TradingView's readout: price change, %, ticks, bars, time span and volume.
- New shortcuts: Alt + J horizontal ray, Alt + V vertical line, Alt + C crossline.
- Every extra tool can be selected, dragged by its points or as a whole, copied, pasted, nudged, locked, hidden, restyled and saved as a default style.
- Tests: 76 new upstream tests (278 pass); smoke scenario `draw` places all 70 tools through the rail with real mouse input and checks each is saved; `dev/tools/gallery.mjs` renders them all for review.

## 0.3.0 — 2026-10-31

- Forex and gold with no account: 43 pairs plus spot XAU/USD, XAG/USD, XPT/USD and XPD/USD from Swissquote's public quotes (charted symbol every 2 s, the rest every 30 s) with chart history from Yahoo Finance. Used whenever no OANDA token is set; OANDA stays optional.
- Metal history comes from the front-month futures, scaled to the live spot price by the gap between the newest futures close and spot.
- The charted symbol is reported to the polled feeds (the terminal never called `setSymbolInterest`).
- Paper margin for the free feed is 1:100, matching the engine.
- Smoke scenarios `fx` (real Swissquote + Yahoo, in the default run) and `oanda` (real OANDA with the token saved in the app, never printed; on request only).
- Tests: 31 unit tests.

## 0.2.0 — 2026-10-31

- DEX pools on every chain from GeckoTerminal (no key): search by name, ticker or contract address inside the symbol picker, add and chart any pool, remove it again; USD price polled every 15 s; candles 1m–1w (30m and 1w merged from 15m and 1d bars, weeks from Monday UTC).
- Forex (~70 pairs) and metals including spot XAU/USD and XAG/USD from OANDA v20, live price stream with reconnect and a 20 s stale-stream watchdog; gold and the majors listed first.
- **Data › OANDA token…** window: checks the token with OANDA, stores it encrypted with Windows DPAPI; the token never reaches the page.
- Paper engine trades every listed instrument: forex lots 100,000 units, gold 100 oz, silver 5,000 oz, DEX lots about $100–$1,000; P&L on non-USD-quoted pairs converted to USD with live rates.
- Symbol picker: wider, shows names, filters by name (`gold`), category (`forex`, `dex`) or ticker.
- Remembers the last charted symbol between runs.
- Fix: chart, price badges and order buttons used the wrong number of decimals for tiny tick sizes (DEX tokens); exact decimal count replaces `String(tickSize)` and the order panel's fixed 5.
- GeckoTerminal requests go through a main-process queue (30/min limit, chart requests first) with a path allowlist; OANDA and GeckoTerminal calls only from the app's own pages.
- Tests: 23 unit tests (shell helpers, GeckoTerminal and OANDA mapping); 2 new upstream tests (202 pass); smoke scenarios `live`, `dex` (real GeckoTerminal, picker UI), `forex` (local OANDA stand-in, token window), `demo`, passed from source and from the packaged build.

## 0.1.0 — 2026-10-31

- First version: OpenCharts (commit `d3fc63c`) in an Electron 45 shell, packaged as a single portable Windows exe.
- Live Binance prices by default (REST klines and the book-ticker stream, no key); **Data** menu switches to the offline demo and remembers the choice.
- Terminal served over a private `app://` scheme so lazy chunks and localStorage work as on the web; path traversal refused.
- External links (TradingView, GitHub) open in the default browser; one instance at a time; window size and position remembered.
- Upstream patch: `?adapter=` query parameter in `Root.tsx`.
- Tests: 6 unit tests for the shell helpers; Electron smoke test for live and demo modes (chart canvases, Binance klines and stream, prices moving), passed from source, from `win-unpacked`, and from the portable exe.
