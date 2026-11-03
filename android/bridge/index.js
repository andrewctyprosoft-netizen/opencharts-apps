// OpenCharts Android bridge: the Android stand-in for the desktop app's Electron main process
// and preload. It builds the same services (the desktop app's ../../desktop/electron/ modules,
// bundled unchanged) on a CORS-free native fetch and Keystore-backed secret storage, and exposes
// them as `window.ocDesktop` with the preload's exact shape, so the terminal runs as on desktop.
// `window.ocMobile` adds what the desktop menus did (data source, exchanges, dashboards, keys)
// plus Android glue: back button, notifications, external links.
//
// Loaded as a classic script before the terminal's module script. Inside a panel iframe it
// reuses the parent's services instead of starting a second set.

import { EXCHANGES, KEY_EXCHANGES, DATA_SOURCES, normalizeSettings } from "../../desktop/electron/lib.js";
import { createFx } from "../../desktop/electron/fx.js";
import { createGecko } from "../../desktop/electron/gecko.js";
import { createOanda } from "../../desktop/electron/oanda.js";
import { createTrade } from "../../desktop/electron/trade.js";
import { createWeb } from "../../desktop/electron/web.js";
import { App, OcNative, isNative } from "./native.js";
import { netFetch } from "./net.js";
import { closeOverlay, closeTopOverlay, openOverlay, overlayCount, overlayOf } from "./overlay.js";
import { initSecure, safeStorage } from "./secure.js";

const VERSION = "0.6.0";
const SETTINGS_KEY = "oc-settings";

const DASHBOARDS = {
  portfolio: "Portfolio",
  markets: "Market overview",
  desk: "Alerts & positions",
};

function inFrame() {
  try {
    return window.parent !== window && typeof window.parent.ocBridgeFor === "function";
  } catch {
    return false;
  }
}

if (inFrame()) {
  // A panel (dashboard, keys, token): share the terminal window's services.
  window.ocDesktop = window.parent.ocBridgeFor(window);
  window.ocMobile = window.parent.ocMobile;
  installLinkHandler();
  document.documentElement.classList.add("oc-mobile", "oc-panel");
} else {
  startBridge();
}

/** Links to the web open in the phone's browser, never inside the app. */
function installLinkHandler() {
  const external = (url) => /^https?:\/\//i.test(url) && new URL(url, location.href).origin !== location.origin;
  const open = (url) => (window.ocMobile ? window.ocMobile.openExternal(url) : window.open(url, "_blank"));
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!a || !external(a.href)) return;
      e.preventDefault();
      open(a.href);
    },
    true,
  );
  const nativeOpen = window.open.bind(window);
  window.open = (url, ...rest) => {
    if (url && external(String(url))) {
      open(String(url));
      return null;
    }
    return nativeOpen(url, ...rest);
  };
}

function startBridge() {
  // ── Settings (non-secret values plus Keystore-sealed secrets), kept in app-private storage ──
  const loadSettings = () => {
    try {
      return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"));
    } catch {
      return normalizeSettings(null);
    }
  };
  let settings = loadSettings();
  const saveSettings = (s) => {
    settings = s;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (err) {
      console.error("[bridge] could not save settings", err);
    }
  };
  const getSettings = () => settings;

  const enabledExchanges = () => Object.keys(EXCHANGES).filter((id) => settings.exchanges[id]);
  const pageQuery = () =>
    `adapter=${(DATA_SOURCES[settings.dataSource] ?? DATA_SOURCES.live).adapter}&ex=${enabledExchanges().join(",")}`;

  // The terminal reads its data source from the URL, as on desktop.
  const params = new URLSearchParams(location.search);
  if (!params.has("adapter") && !params.has("view")) {
    history.replaceState(null, "", `${location.pathname}?${pageQuery()}${location.hash}`);
  }
  const reloadTerminal = () => location.replace(`${location.pathname}?${pageQuery()}`);

  // ── Services (the desktop main process's modules) ──
  const net = { fetch: netFetch };
  const listeners = { "oanda:price": new Set(), "oanda:state": new Set(), "app:open-chart": new Set() };
  const emit = (channel, payload) => {
    for (const l of [...listeners[channel]]) {
      if (l.win && l.win.closed) {
        listeners[channel].delete(l);
        continue;
      }
      try {
        l.handler(payload);
      } catch (err) {
        console.error(`[bridge] ${channel} listener`, err);
      }
    }
  };
  const oanda = createOanda({
    net,
    safeStorage,
    getSettings,
    saveSettings,
    onPrice: (p) => emit("oanda:price", p),
    onState: (s) => emit("oanda:state", s),
  });
  const gecko = createGecko({ net });
  const fx = createFx({ net });
  const web = createWeb({ net });
  const trade = createTrade({ net, safeStorage, getSettings, saveSettings, oanda });

  const ready = initSecure().catch((err) => {
    console.error("[bridge] secure storage unavailable", err);
  });
  /** Every call waits for the Keystore data key, so secrets can be read synchronously inside. */
  const after = (fn) => async (...args) => {
    await ready;
    return fn(...args);
  };

  // ── Panels (the desktop app's extra windows) ──
  function openDashboard(view) {
    if (!Object.hasOwn(DASHBOARDS, view)) return;
    openOverlay(view, `index.html?view=${view}&ex=${enabledExchanges().join(",")}`, DASHBOARDS[view]);
  }
  function openKeys(venue = "binance") {
    const v = Object.hasOwn(KEY_EXCHANGES, venue) || venue === "oanda" ? venue : "binance";
    openOverlay("keys", `keys.html?venue=${v}`, "Exchange API keys");
  }
  function openToken() {
    openOverlay(
      "oanda",
      `oanda-token.html?env=${settings.oanda.env}&configured=${settings.oanda.tokenEnc ? "1" : "0"}`,
      "OANDA token",
      () => reloadTerminal(), // pick up a new or removed token, as the desktop app does
    );
  }
  let pendingChart = null; // a notification tapped before the terminal was listening
  function openChart(symbol) {
    // A symbol name, or a market overview DEX pool (`dex:<network>:<address>`, up to ~110 characters).
    if (typeof symbol !== "string" || symbol.length > 160) return;
    for (const view of Object.keys(DASHBOARDS)) closeOverlay(view);
    if (!listeners["app:open-chart"].size) pendingChart = symbol;
    else emit("app:open-chart", symbol);
  }

  // ── Notifications ──
  let noteId = 1;
  let notePermission = null;
  async function ensureNotifications() {
    if (!isNative) {
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
      return "Notification" in window && Notification.permission === "granted";
    }
    if (notePermission === "granted") return true;
    const { state } = await OcNative.notificationPermission({ request: true });
    notePermission = state;
    return state === "granted";
  }
  async function notify(title, body, symbol) {
    const text = (v, n) => String(v ?? "").slice(0, n);
    const t = text(title, 120);
    const b = text(body, 300);
    const s = typeof symbol === "string" && symbol.length <= 60 ? symbol : "";
    if (!isNative) {
      if ("Notification" in window && Notification.permission === "granted") {
        const n = new Notification(t, { body: b });
        n.onclick = () => s && openChart(s);
      }
      return;
    }
    if (!(await ensureNotifications())) return;
    noteId = (noteId % 2_000_000_000) + 1;
    // Posted at once by the app's plugin: nothing is scheduled, so no exact-alarm permission
    // (scheduling through @capacitor/local-notifications opened Android's alarm settings).
    await OcNative.notify({ id: noteId, title: t, body: b, symbol: s }).catch(() => {});
  }

  // ── The preload API, per window (the terminal, or a panel iframe) ──
  function apiFor(win) {
    const listen = (channel, handler) => {
      const entry = { handler, win: win === window ? null : win };
      listeners[channel].add(entry);
      if (channel === "app:open-chart" && pendingChart) {
        const symbol = pendingChart;
        pendingChart = null;
        setTimeout(() => emit("app:open-chart", symbol), 0);
      }
      return () => listeners[channel].delete(entry);
    };
    const closeMine = (kind) => {
      const o = overlayOf(win);
      closeOverlay(o ? o.kind : kind);
    };
    return {
      web: {
        get: after((url) => web.get(url)),
        rpc: after((chain, body) => web.rpc(chain, body)),
      },
      trade: {
        status: after(() => trade.status()),
        balances: after((venue) => trade.balances(venue)),
        openOrders: after((venue) => trade.openOrders(venue)),
        place: after((venue, order) => trade.place(venue, order)),
        cancel: after((venue, native, id) => trade.cancel(venue, native, id)),
        closeTrade: after((venue, id) => trade.closeTrade(venue, id)),
        openKeys: async (venue) => (venue === "oanda" ? openToken() : openKeys(venue)),
      },
      app: {
        openWindow: async (view) => openDashboard(view),
        openChart: async (symbol) => openChart(symbol),
        notify: async (title, body, symbol) => notify(title, body, symbol),
        onOpenChart: (handler) => listen("app:open-chart", handler),
      },
      gecko: {
        get: (path, priority) => gecko.get(path, priority),
      },
      fx: {
        quotes: (instruments) => fx.quotes(instruments),
        chart: (symbol, query) => fx.chart(symbol, query),
      },
      oanda: {
        status: after(() => oanda.status()),
        instruments: after(() => oanda.instruments()),
        candles: after((instrument, query) => oanda.candles(instrument, query)),
        pricing: after((names) => oanda.pricing(Array.isArray(names) ? names : [])),
        startStream: after((names) => void oanda.startStream(Array.isArray(names) ? names : [])),
        stopStream: async () => oanda.stopStream(),
        onPrice: (handler) => listen("oanda:price", handler),
        onState: (handler) => listen("oanda:state", handler),
      },
      settings: {
        saveOandaToken: after((token, env) => oanda.saveToken(token, env)),
        clearOandaToken: after(() => oanda.clearToken()),
        close: async () => closeMine("oanda"),
      },
      keys: {
        status: after(async () => {
          const st = await trade.status();
          return Object.fromEntries(Object.entries(st).map(([id, s]) => [id, s.configured]));
        }),
        save: after((venue, fields) => trade.saveKeys(venue, fields)),
        clear: after((venue) => trade.clearKeys(venue)),
        openOanda: async () => openToken(),
        close: async () => closeMine("keys"),
      },
    };
  }

  window.ocDesktop = apiFor(window);
  window.ocBridgeFor = (win) => apiFor(win);

  // ── Back button: panels first, then the mobile UI (sheets, tabs), then leave the app ──
  const backHandlers = [];
  async function onBack() {
    if (closeTopOverlay()) return;
    for (let i = backHandlers.length - 1; i >= 0; i--) {
      if (backHandlers[i]()) return;
    }
    if (isNative) await App.minimizeApp();
  }

  // Dev only: `?desktop` keeps the desktop layout in the browser, for comparing the two.
  if (!isNative && params.has("desktop")) {
    installLinkHandler();
    return;
  }

  window.ocMobile = {
    platform: isNative ? "android" : "web",
    version: VERSION,
    exchanges: Object.fromEntries(Object.entries(EXCHANGES).map(([id, e]) => [id, e.label])),
    /** Data source, exchange switches and which venues have keys. */
    async state() {
      await ready;
      const st = await trade.status().catch(() => ({}));
      return {
        dataSource: settings.dataSource,
        exchanges: { ...settings.exchanges },
        oanda: { env: settings.oanda.env, configured: Boolean(settings.oanda.tokenEnc) },
        keys: Object.fromEntries(Object.entries(st).map(([id, s]) => [id, Boolean(s.configured)])),
      };
    },
    setDataSource(key) {
      if (!Object.hasOwn(DATA_SOURCES, key) || settings.dataSource === key) return;
      saveSettings({ ...settings, dataSource: key });
      reloadTerminal();
    },
    /** Switch one exchange on or off (and switch to live prices if the demo was on). */
    setExchange(id, on) {
      if (!Object.hasOwn(EXCHANGES, id)) return;
      saveSettings({ ...settings, dataSource: "live", exchanges: { ...settings.exchanges, [id]: Boolean(on) } });
      reloadTerminal();
    },
    openDashboard,
    openKeys,
    openOanda: openToken,
    reload: reloadTerminal,
    ensureNotifications,
    openExternal(url) {
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
      if (isNative) void OcNative.openExternal({ url });
      else window.open(url, "_blank", "noopener");
    },
    /** Register a back handler; it returns true when it handled the press. */
    onBack(handler) {
      backHandlers.push(handler);
      return () => {
        const i = backHandlers.indexOf(handler);
        if (i >= 0) backHandlers.splice(i, 1);
      };
    },
    panelsOpen: () => overlayCount(),
    /** Dev and smoke tests: the same back press the hardware button sends. */
    back: onBack,
    /** Smoke tests: seal and open a random secret with the Keystore-backed key. */
    async selfTest() {
      await ready;
      const secret = Math.random().toString(36).slice(2) + Date.now();
      const sealed = safeStorage.encryptString(secret);
      return {
        native: isNative,
        sealed: sealed.length > secret.length && !sealed.toString("utf8").includes(secret),
        roundTrip: safeStorage.decryptString(sealed) === secret,
      };
    },
  };

  document.documentElement.classList.add("oc-mobile");
  installLinkHandler();

  if (isNative) {
    void App.addListener("backButton", () => void onBack());
    void OcNative.addListener("notificationTap", ({ symbol }) => openChart(symbol));
  }
}
