# Changelog

## Unreleased

- **Portfolio: HTX (Huobi), WhiteBIT, Gate.io, HitBTC and Poloniex** (from OpenCharts Desktop): API keys on the keys page, balances and open orders with cancel in the portfolio. Portfolio-only; BitMEX closed on 23 September 2026 and is not added.
- **Fixed the dead end after Binance's "Invalid API-key, IP, or permissions for action (-2015)"**: the keys page now lists what to check and the phone's public IPv4 address as the exchange sees it (it changes between Wi-Fi and mobile data, so an IP-restricted key fails on the other network). A test-network key saved without the box ticked is found and saved as a test key. Binance keys are checked for their 64-character shape first; invisible characters pasted from chat apps are removed.
- The bridge's crypto shim adds SHA-512 hashes and HMACs (Gate.io and WhiteBIT sign with them); a test checks every new exchange signs identically through the shim and Node's crypto.

## 0.6.2 — 2026-11-01

- **Market overview: one Crypto tab** (from OpenCharts Desktop): each coin with the exchanges listing it, its DEX liquidity, volume and CEX/DEX price gap; tap a coin's name for its exchange pairs and DEX pools; trending DEX-only tokens as extra rows. Tapping a pool's Chart adds it and opens it on the Chart tab.
- **Trade on the DEX's own site.** Each DEX pool in an expanded coin has a **Trade** button: open the DEX's swap page with the pair filled in, either in the phone's browser or inside a wallet app's browser (MetaMask, Phantom, Trust Wallet, Coinbase Wallet, OKX Wallet, Tonkeeper or Slush, as fits the chain). The user connects and trades there; OpenCharts only opens the link.
- Fixed: an opened coin's exchange and DEX tables were cut off at the screen edge (Spread, Chart and Trade out of reach); each now swipes sideways on its own.
- Fixed: the chart could stay blank after switching to a slow-loading symbol (a DEX pool) until the timeframe changed; it now empties on the switch and draws once the bars arrive.
- GeckoTerminal requests pace themselves under the free API's limit and retry after a rate limit.
- Smoke: opens the first coin's venues, checks a pool's Trade list (browser plus wallets, all https) and that tapping a DEX pool charts it.

## 0.6.1 — 2026-11-01

- **Launcher icon fixed.** A leftover Capacitor template icon (`drawable-v24`) overrode the OpenCharts icon on every Android 7+ phone; it is removed, and `dev/tools/make-icons.py` now deletes it if Capacitor puts it back.
- **Market overview row charts** (from OpenCharts Desktop): each row shows its price line for the chosen period, green or red, sized for a phone (92 × 30).
- Smoke: checks the row charts (day and month) and saves a launcher screenshot.

## 0.6.0 — 2026-10-31

First Android release, with every feature of OpenCharts Desktop 0.6.0.

- **Phone layout**: Chart, Markets, Trade, Orders and More screens on a bottom bar; the chart stays live under all of them.
- Chart screen: symbol picker sheet, live price and spread, timeframe chips, indicators and chart plugins sheet, big Sell/Buy buttons with the live bid and ask, the ⋮ chart menu (Set alert, one-lot orders, object tree, chart settings) in place of right-click.
- **Drawing bar**: all 80+ tools in the six TradingView groups, each in a bottom sheet, plus measure, zoom, undo, redo, magnet, stay in drawing mode, lock, hide and remove all.
- Markets screen: multi-word search, venue chips, starred list, live prices, DEX pool search.
- Trade screen: the desktop order ticket opened on the tapped side, depth of market; the order gate (key reminder, real-order confirmation) as on desktop.
- More screen: Portfolio, Market overview and Alerts & positions as full-screen panels; exchange API keys and OANDA token pages laid out for a phone; live prices per exchange or the offline demo; one-click trading, sounds, chart templates, notifications, About.
- **Android bridge**: the desktop app's main-process modules (exchange signing, OANDA, forex, GeckoTerminal, public web requests) run unchanged in the WebView on a native HTTPS plugin, `node:crypto` on @noble and a Keystore-backed `safeStorage`.
- API keys and the OANDA token are sealed with AES-256-GCM under an Android Keystore key; app data is excluded from backups and device transfer.
- Price alerts raise Android notifications on their own channel, posted at once by the app's plugin (no alarm permission; scheduling through `@capacitor/local-notifications` opened Android's alarm settings and sent the app to the background); tapping one charts the pair, also from a cold start.
- The Android back button closes the top sheet first even while prices re-render the screen underneath.
- Android back button: closes sheets and panels, returns to the chart, then leaves.
- Edge-to-edge with safe-area insets, dark start screen, new adaptive icon (candles and trend line).
- Tests: 68 unit tests (signing through the Android shim checked against Node's crypto), 8 phone-layout tests (286 upstream tests in total), and an on-device smoke test driving the real APK over the WebView's DevTools socket.
