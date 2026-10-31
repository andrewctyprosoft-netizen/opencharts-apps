# Changelog

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
