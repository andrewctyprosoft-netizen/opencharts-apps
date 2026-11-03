# OpenCharts for Android

The [OpenCharts Desktop](../desktop/README.md) trading-chart app as an Android phone app, with every desktop feature.
Live prices from six crypto exchanges, DEX tokens, forex and gold; real trading through your exchange API keys or a paper account; price alerts that reach the notification shade; portfolio, market overview and alerts & positions dashboards; 80+ TradingView drawing tools.
One APK, sideloaded; no account and no server.

## Install

1. Download `OpenCharts-0.6.2.apk` from the [Releases](../../../releases/latest) page on the phone, or copy it there (USB, Drive, email).
2. Open it. Android asks to allow installs from that app (Files, Chrome …) once: allow, then **Install**.
3. Open **OpenCharts**. It needs Android 7.0 or newer.

Forex and gold work with no setup.
The first start takes a few seconds while the exchanges send their pair lists.

## The Phone Layout

A bottom bar switches between five screens.
The chart stays live underneath all of them, so drawings, indicators, alerts and the paper account keep running.

| Screen | What is on it |
|:-------|:--------------|
| **Chart** | Symbol (tap for the picker), live price and spread, alerts bell, ⋮ chart menu; timeframes 1m–1w, **Indicators**, **Draw**; the chart; big **Sell** and **Buy** buttons with the live bid and ask |
| **Markets** | Every listed pair with live prices: search several words (`okx sol`, `gold`, `eur`), venue chips, ★ starred list, DEX pool search on every chain |
| **Trade** | The order ticket (market, limit, stop; take profit, stop loss; one-click), opened on the side you tapped; depth of market |
| **Orders** | Account balance, equity, margin and P&L; positions, orders, trade history, alerts, journal, calendar and news |
| **More** | Dashboards, exchange API keys, OANDA token, one-click trading, sounds, live prices per exchange or the offline demo, chart templates, notifications, About |

- **Draw** swaps the Buy/Sell bar for the drawing bar: cursor, the six TradingView tool groups (each opens its tools in a sheet), measure, zoom, undo, redo, magnet, stay in drawing mode, lock all, hide all, remove all.
  Tap the chart once per point; path, polyline and ghost feed finish with a double-tap.
  Tap a drawing to select and drag it, double-tap it for its settings.
- The **⋮ chart menu** replaces the desktop right-click: reset view, copy price, **Set alert** at the current price, buy or sell 1 lot at a limit, object tree, chart settings.
- Pinch and drag the chart to zoom and scroll; press and hold for the crosshair.
- The Android **back** button closes the top sheet or panel, then returns to the chart, then leaves the app.

### Where the Desktop Features Are

| Desktop | Android |
|:--------|:--------|
| File › Dashboard › Portfolio, Market overview, Alerts & positions | More › Dashboards (full-screen panels; back closes them) |
| Data › Live prices (switch per exchange), Offline demo | More › Market data |
| Data › Exchange API keys…, OANDA token… | More › Trading, or **Add API key** in the order reminder |
| Right-click the chart › Set alert | Bell on the chart header, or ⋮ › Set alert |
| Left drawing rail | **Draw** on the chart toolbar |
| Right panel: order ticket, depth, watchlist | Trade screen, Markets screen |
| Bottom panel tabs | Orders screen |
| Windows notifications | Android notifications (tap one to chart the pair) |
| Windows DPAPI for keys | Android Keystore |
| Keyboard shortcuts (Alt + T …) | The drawing bar and its sheets |

## Markets

The same sources as the desktop app.

| Market | Source | Key needed | Updates |
|:-------|:-------|:-----------|:--------|
| Crypto: the busiest 120 USD pairs on each of **Binance, OKX, Bybit, KuCoin, Coinbase and MEXC** | Each exchange's public API | No (API key only to trade) | Charted pair every second, the rest every 15 s |
| DEX pools on every chain | GeckoTerminal | No | Price every 15 s |
| Forex (43 pairs) and metals: **XAU/USD**, XAG/USD, XPT/USD, XPD/USD | Swissquote + Yahoo Finance | No | Charted symbol every 2 s, the rest every 30 s |
| Or: forex (~70 pairs) and metals from OANDA v20 | OANDA | OANDA token (optional) | Live stream |

## Real Trading With API Keys

1. Create an API key on the exchange with **read** and **spot trading** permission only. Never enable withdrawals.
2. **More › Exchange API keys**, pick the exchange, paste the key and secret (plus the passphrase for OKX and KuCoin; for Coinbase the CDP key name and private key), **Check and save**.
3. The key is checked by reading your balances, then sealed with AES-256-GCM under a key that the Android Keystore protects, and stored in the app's private storage.
   It is never shown again, never backed up and never moved to a new phone.
4. Place orders as usual. Each real order shows a confirmation with the exchange's own pair, rounded quantity and estimated value first.

Without a key, an order opens a reminder that leads to the keys page, or paper trades that order.
Binance testnet, OKX demo and Bybit testnet keys can be marked as test keys.
If the exchange refuses the key, the keys page lists the usual causes and the public IPv4 address the exchange sees (read from api.ipify.org only at that moment), for keys with an IP restriction.
A Binance testnet key saved without the test box ticked, or the other way round, is found on the other network and saved as such (OKX and Bybit too).
Binance keys are checked for shape first: a system-generated key and secret are 64 letters and digits, so a key cut short in pasting is caught before Binance is asked.

**HTX (Huobi), WhiteBIT, Gate.io, HitBTC and Poloniex** take a key for the portfolio only (balances, open orders, cancel); there is no price feed or order ticket for them. BitMEX is not offered: it closed on 23 September 2026.
Real orders are market or limit spot orders; take profit and stop loss go with OANDA orders only.

## Price Alerts

1. Tap the bell on the chart (or ⋮ › Set alert), check the price, choose **Once** or **Every time**, **Add alert**.
2. The first time, Android asks to allow notifications: allow.
3. When the price crosses, a notification appears (tap it to chart the pair), with a beep and a toast.
   It is posted on the spot, never scheduled, so the app needs no alarm permission and never opens Android's settings.

Alerts are checked while OpenCharts is open, including in the background until Android pauses the app.
A crossing while it was closed fires at the next start.

## Files

| Path | What it is |
|:-----|:-----------|
| `dist/OpenCharts-<version>.apk` | The app to install (built, not committed) |
| `../upstream/` | The OpenCharts terminal shared with the desktop app, with its patches and the phone layout |
| `../upstream/src/mobile/` | The phone layout: tab screens, sheets, symbol list, More screen, start screen |
| `../adapters/` | The market data and order adapters, shared with the desktop app |
| `bridge/` | The Android stand-in for the desktop app's Electron main process: `window.ocDesktop` with the same API |
| `../desktop/electron/` | The desktop app's main-process service modules (exchanges, signing, OANDA, forex, GeckoTerminal, web), bundled into the bridge unchanged |
| `bridge/net.js`, `bridge/secure.js` | Fetch without CORS through the native plugin; Keystore-backed `safeStorage` |
| `bridge/overlay.js` | Full-screen panels for the dashboards and the keys and token pages |
| `bridge/shims/` | `node:crypto` (HMAC, ES256, Ed25519 on @noble) and `Buffer` for the desktop modules |
| `bridge/keys.html`, `bridge/oanda-token.html` | The API keys and OANDA token pages, laid out for a phone |
| `android/` | The Capacitor Android project |
| `android/app/src/main/java/com/thrivelab/opencharts/OcNativePlugin.java` | Native HTTPS (host allowlist), OANDA price stream, Keystore data key, alert notifications, external links |
| `capacitor.config.json` | App id `com.thrivelab.opencharts`, dark system bars and safe-area insets |
| `dev/tests/` | Signing through the Android crypto shim, checked against Node's crypto (the other unit tests are in `../desktop/dev/tests/`) |
| `dev/tools/` | Build scripts (`build-web`, `build-bridge`, `build-apk`), the icon generator, the Vite dev plugin, the on-device smoke test |

## Build From Source

Needs Node.js 22.6+, JDK 21 and the Android SDK (platform 36, build-tools 35).
`build-apk.mjs` finds a JDK in `%LOCALAPPDATA%\Programs\Temurin` and the SDK in `%LOCALAPPDATA%\Android\Sdk`, or uses `JAVA_HOME` and `ANDROID_HOME`.

```bash
npm install
npm test
node dev/tools/build-apk.mjs
```

The first release build creates the signing key `android/release.keystore` and its password file `android/keystore.properties`.
Both are git-ignored. Back them up: Android installs an update only when it is signed with the same key.

`node dev/tools/build-apk.mjs --debug` builds `dist/OpenCharts-<version>-debug.apk`, whose WebView can be inspected from `chrome://inspect`.

### Develop in a Browser

```bash
npm run dev
```

Open `http://localhost:5180` in a phone-sized window (`vite --mode mobile` in `../upstream`).
The Vite plugin serves the bridge and does its requests server-side (`/__oc/net`, allowlisted hosts), so the whole app runs with live data.
Add `&desktop` to the URL for the desktop layout, to compare.

### Tests

- `npm test`: the exchange signing tests, including Binance's published signature vector and Coinbase ES256 and Ed25519 JWTs signed by the Android shim and verified with Node's crypto.
- Inside `../upstream/`: `npx tsc --noEmit`, `npx eslint src/ --max-warnings=0` and `npx vitest run` (286 tests, 8 of them for the phone layout, including the back-button order).
- `node dev/tools/smoke-android.mjs --boot`: boots an emulator (or uses a connected phone), installs the debug APK and drives the real app over the WebView's DevTools socket: every exchange listing, prices moving, the Keystore round trip, sheets and the back button, the drawing tools, the order gate and a paper trade, an alert reaching the notification shade, a DEX pool, gold, the three dashboards, the keys page and an OKX request signed on the phone. Screenshots go to `dev/out/android/`. It also checks that an alert keeps the app in front and that two back presses in a row do not leave it.
- `node dev/tools/cdp-eval.mjs "<expression>"` evaluates JavaScript in the running debug app, for debugging on a device.

## Patches

The terminal in `../upstream/` carries the desktop app's patches (`OpenCharts Desktop patch`), and these (`OpenCharts Mobile patch` / `OpenCharts Mobile addition`):

| File | Change |
|:-----|:-------|
| `index.html` | No pinch-zoom of the page (`build-web.mjs` adds `bridge.js` to the Android copy) |
| `vite.config.ts` | `--mode mobile`: dev plugin with the bridge bundle, keys pages and `/__oc/net` proxy |
| `src/Root.tsx` | Start screen while the exchanges answer |
| `src/terminal/Terminal.tsx` | Phone layout when `window.ocMobile` is present |
| `src/mobile/` (new) | `MobileTradingPage`, `MobileMore`, `SymbolList`, `Sheet`, `MobileSplash`, layout store, styles |
| `src/pages/trading/ChartPanel.tsx` | No left rail on the phone; the ⋮ button opens the chart menu at the current price |
| `src/pages/trading/DrawingToolRail.tsx` | `MobileDrawingBar`: the same tool groups as a bottom bar with sheets |
| `src/pages/trading/OrderPanel.tsx` | `initialSide` (Buy/Sell buttons) |
| `src/pages/trading/BottomPanel.tsx` | `fill`: full-screen with labelled tabs |
| `src/pages/trading/ChartToolbar.tsx`, `chart-plugin-items.ts` | Plugin list in its own module |
| `src/pages/trading/ChartTemplatesMenu.tsx` | Shown in the More screen |
| `src/pages/trading/ChartContextMenu.tsx` | `data-chart-menu` for finger-sized rows |
| `src/desktop/MarketsPage.tsx` | Scrolling tabs; filters and condition fold behind **Filters & sort** |
| `src/desktop/OrderGate.tsx`, `DeskPage.tsx`, `DesktopSync.tsx`, `AlertsPanel.tsx` | Phone wording (More ›, this phone, ⋮ menu) |
| `src/__tests__/mobile-layout.test.tsx` (new) | Symbol list, sheets and back button (order kept across re-renders), drawing bar, Buy/Sell |

Every mobile change is inactive in the desktop app (it checks for `window.ocMobile`).
The terminal, adapters and `../desktop/electron/` modules are shared, so a desktop change reaches the Android app on its next build; run `npm test` and the smoke test after one.

## Limits

- Everything in the desktop app's [Limits](../desktop/README.md#limits) applies, except the Windows-specific items.
- Alerts are checked while the app runs. Android pauses apps in the background after a while, so an alert can fire late, at the next return to the app; there is no server push.
- Paper trading resets when Android closes the app, as it resets when the desktop app closes.
- The OANDA price stream reconnects after the app returns from the background.
- Coinbase's pair list is 1.1 MB; on a slow connection it can miss the first 12 s and join a little later.
- The APK is signed with a key made on the build PC, not distributed through Google Play; Play Protect may ask to scan it on first install.
- Not financial advice.

## Credits and Licences

- [OpenCharts](https://github.com/dylanpersonguy/OpenCharts) by dylanpersonguy, MIT.
- TradingView Lightweight Charts™, Apache 2.0. Copyright (c) 2025 TradingView, Inc. <https://www.tradingview.com/>.
- [Capacitor](https://capacitorjs.com/), MIT. [@noble/hashes, curves, ciphers](https://paulmillr.com/noble/), MIT. [buffer](https://github.com/feross/buffer), MIT.
- Notification icon: Material Icons "notifications", Apache 2.0.
- Data: the exchanges' public APIs, GeckoTerminal, Swissquote, Yahoo Finance, OANDA, CoinGecko.
