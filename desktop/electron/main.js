// OpenCharts Desktop: Electron shell around the OpenCharts trading terminal.
// The terminal is a static web build in ../web, served over app:// so ES modules,
// lazy chunks and localStorage behave exactly as on a website.

import { app, BrowserWindow, Menu, Notification, dialog, ipcMain, net, protocol, safeStorage, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFx } from "./fx.js";
import { createGecko } from "./gecko.js";
import { DATA_SOURCES, EXCHANGES, isExternalUrl, normalizeSettings, pageUrl, resolveWebPath } from "./lib.js";
import { createOanda } from "./oanda.js";
import { createTrade } from "./trade.js";
import { createWeb } from "./web.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(here, "..", "web");
const smokeOut = process.env.OC_SMOKE || "";
// Smoke runs keep their own profile so they never touch the user's drawings or settings.
// Each run starts clean, so a symbol remembered from the last run does not change what is tested.
if (smokeOut) {
  fs.rmSync(path.join(smokeOut, "profile"), { recursive: true, force: true });
  app.setPath("userData", path.join(smokeOut, "profile"));
}

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// ── Settings ──────────────────────────────────────────────

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(settingsFile(), "utf8")));
  } catch {
    return normalizeSettings(null);
  }
}

function saveSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), "utf8");
  } catch (err) {
    console.error("[opencharts] could not save settings", err);
  }
}

let settings;
let win = null;

// ── Window ────────────────────────────────────────────────

function createWindow() {
  win = new BrowserWindow({
    ...settings.bounds,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    title: "OpenCharts",
    icon: path.join(webRoot, "icons", "icon-512x512.png"),
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(here, "preload.cjs"),
    },
  });
  if (settings.maximized) win.maximize();

  win.once("ready-to-show", () => win.show());
  win.on("close", () => {
    settings.maximized = win.isMaximized();
    if (!settings.maximized && !win.isMinimized()) settings.bounds = win.getBounds();
    saveSettings(settings);
  });
  win.on("closed", () => (win = null));

  // Links (TradingView embeds, GitHub) open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("app://")) return;
    event.preventDefault();
    if (isExternalUrl(url)) shell.openExternal(url);
  });

  win.loadURL(currentPageUrl());
}

const enabledExchanges = () => Object.keys(EXCHANGES).filter((id) => settings.exchanges[id]);
const currentPageUrl = () => pageUrl(settings.dataSource, enabledExchanges());

function setDataSource(key) {
  if (settings.dataSource === key) return buildMenu();
  settings.dataSource = key;
  saveSettings(settings);
  win?.loadURL(currentPageUrl());
  buildMenu();
}

/** Switch one exchange's live prices on or off (and switch to live prices if the demo was on). */
function toggleExchange(id) {
  settings.exchanges[id] = !settings.exchanges[id];
  settings.dataSource = "live";
  saveSettings(settings);
  win?.loadURL(currentPageUrl());
  buildMenu();
}

// ── Dashboards (portfolio, market overview) ───────────────
// Each opens in its own window on the same app:// origin, so it can sit on a second screen.

const DASHBOARDS = {
  portfolio: { title: "Portfolio", width: 1180, height: 780 },
  markets: { title: "Market overview", width: 1320, height: 860 },
  desk: { title: "Alerts & positions", width: 1280, height: 840 },
};
const dashboards = new Map();

function openDashboard(view) {
  if (!Object.hasOwn(DASHBOARDS, view)) return;
  const open = dashboards.get(view);
  if (open && !open.isDestroyed()) return open.focus();
  const spec = DASHBOARDS[view];
  const w = new BrowserWindow({
    width: spec.width,
    height: spec.height,
    minWidth: 760,
    minHeight: 500,
    title: `OpenCharts — ${spec.title}`,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    icon: path.join(webRoot, "icons", "icon-512x512.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(here, "preload.cjs") },
  });
  w.setMenu(null);
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://")) event.preventDefault();
  });
  w.on("closed", () => dashboards.delete(view));
  dashboards.set(view, w);
  w.loadURL(`app://opencharts/index.html?view=${view}&ex=${enabledExchanges().join(",")}`);
  return w;
}

function buildMenu() {
  const live = settings.dataSource === "live";
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Dashboard",
          submenu: [
            { label: "Portfolio…", accelerator: "CmdOrCtrl+Shift+P", click: () => openDashboard("portfolio") },
            { label: "Market overview…", accelerator: "CmdOrCtrl+Shift+M", click: () => openDashboard("markets") },
            { label: "Alerts && positions…", accelerator: "CmdOrCtrl+Shift+A", click: () => openDashboard("desk") },
          ],
        },
        { type: "separator" },
        { role: "reload", label: "Reload terminal" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Data",
      submenu: [
        {
          label: DATA_SOURCES.live.label,
          submenu: [
            { label: "Use live prices", type: "checkbox", checked: live, click: () => setDataSource("live") },
            { type: "separator" },
            ...Object.entries(EXCHANGES).map(([id, info]) => ({
              label: info.label,
              type: "checkbox",
              checked: live && settings.exchanges[id],
              click: () => toggleExchange(id),
            })),
            { type: "separator" },
            { label: "Forex && metals: OANDA (with token) or free feed", enabled: false },
            { label: "DEX pools: GeckoTerminal", enabled: false },
          ],
        },
        {
          label: DATA_SOURCES.demo.label,
          type: "checkbox",
          checked: !live,
          click: () => setDataSource("demo"),
        },
        { type: "separator" },
        { label: "Exchange API keys…", click: () => openKeysWindow() },
        { label: "OANDA token (forex && gold)…", click: () => openTokenWindow() },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "OpenCharts on GitHub", click: () => shell.openExternal("https://github.com/dylanpersonguy/OpenCharts") },
        { label: "TradingView Lightweight Charts", click: () => shell.openExternal("https://www.tradingview.com/") },
        { type: "separator" },
        {
          label: "About OpenCharts Desktop",
          click: () =>
            dialog.showMessageBox(win, {
              type: "info",
              title: "About OpenCharts Desktop",
              message: `OpenCharts Desktop ${app.getVersion()}`,
              detail:
                "Live crypto, forex and gold charts with drawing tools, indicators, paper and real trading.\n\n" +
                "Market data: Binance, OKX, Bybit, KuCoin, Coinbase and MEXC public APIs (crypto), GeckoTerminal (DEX pools), OANDA or Swissquote and Yahoo Finance (forex and metals), CoinGecko and Yahoo Finance (market overview). " +
                "Orders go to the exchange when you have saved its API key (Data › Exchange API keys), otherwise to a $100,000 paper account that resets when the app closes. Not financial advice.\n\n" +
                "Built on OpenCharts (MIT) and TradingView Lightweight Charts™ (Apache 2.0), Copyright (c) 2025 TradingView, Inc.",
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Data bridges (OANDA, GeckoTerminal) ───────────────────

let oanda;
let gecko;
let fx;
let web;
let trade;
let tokenWin = null;
let keysWin = null;
let oandaState = "disconnected"; // last stream state, reported by the smoke test
let notified = 0; // Windows notifications shown, reported by the smoke test

function openKeysWindow(venue = "binance") {
  if (keysWin) {
    keysWin.focus();
    return keysWin;
  }
  keysWin = new BrowserWindow({
    parent: win ?? undefined,
    width: 720,
    height: 620,
    resizable: true,
    minimizable: false,
    title: "Exchange API keys",
    backgroundColor: "#111318",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(here, "preload.cjs") },
  });
  keysWin.setMenu(null);
  keysWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  keysWin.webContents.on("will-navigate", (event) => event.preventDefault());
  keysWin.on("closed", () => (keysWin = null));
  keysWin.loadFile(path.join(here, "keys.html"), { query: { venue: String(venue) } });
  return keysWin;
}

function openTokenWindow() {
  if (tokenWin) return tokenWin.focus();
  tokenWin = new BrowserWindow({
    parent: win ?? undefined,
    modal: true,
    width: 560,
    height: 520,
    resizable: false,
    minimizable: false,
    title: "OANDA token",
    backgroundColor: "#111318",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(here, "preload.cjs") },
  });
  tokenWin.setMenu(null);
  tokenWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  tokenWin.on("closed", () => {
    tokenWin = null;
    win?.reload(); // pick up a new or removed token
  });
  tokenWin.loadFile(path.join(here, "oanda-token.html"), {
    query: { env: settings.oanda.env, configured: settings.oanda.tokenEnc ? "1" : "0" },
  });
}

/** Only our own pages may call the bridges. */
const fromTerminal = (event) => event.senderFrame?.url.startsWith("app://opencharts/");
const fromTokenWindow = (event) => tokenWin && event.sender === tokenWin.webContents;
const fromKeysWindow = (event) => keysWin && event.sender === keysWin.webContents;

function registerIpc() {
  const send = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  oanda = createOanda({
    net,
    safeStorage,
    getSettings: () => settings,
    saveSettings,
    onPrice: (p) => send("oanda:price", p),
    onState: (s) => {
      oandaState = s;
      send("oanda:state", s);
    },
  });
  gecko = createGecko({ net });
  fx = createFx({ net });
  web = createWeb({ net });
  trade = createTrade({ net, safeStorage, getSettings: () => settings, saveSettings, oanda });

  const terminal = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromTerminal(event)) throw new Error("Not allowed");
      return fn(...args);
    });
  terminal("gecko:get", (p, priority) => gecko.get(p, priority));
  terminal("fx:quotes", (instruments) => fx.quotes(instruments));
  terminal("fx:chart", (symbol, query) => fx.chart(symbol, query));
  terminal("oanda:status", () => oanda.status());
  terminal("oanda:instruments", () => oanda.instruments());
  terminal("oanda:candles", (instrument, query) => oanda.candles(instrument, query));
  terminal("oanda:pricing", (names) => oanda.pricing(Array.isArray(names) ? names : []));
  terminal("oanda:stream-start", (names) => void oanda.startStream(Array.isArray(names) ? names : []));
  terminal("oanda:stream-stop", () => oanda.stopStream());
  terminal("web:get", (url) => web.get(url));
  terminal("web:rpc", (chain, body) => web.rpc(chain, body));
  terminal("trade:status", () => trade.status());
  terminal("trade:balances", (venue) => trade.balances(venue));
  terminal("trade:open-orders", (venue) => trade.openOrders(venue));
  terminal("trade:place", (venue, order) => trade.place(venue, order));
  terminal("trade:cancel", (venue, native, id) => trade.cancel(venue, native, id));
  terminal("trade:close-trade", (venue, id) => trade.closeTrade(venue, id));
  terminal("app:notify", (title, body, symbol) => {
    if (!Notification.isSupported()) return;
    const text = (v, n) => String(v ?? "").slice(0, n);
    const note = new Notification({ title: text(title, 120), body: text(body, 300), icon: path.join(webRoot, "icons", "icon-512x512.png") });
    note.on("click", () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (typeof symbol === "string" && symbol.length <= 60) send("app:open-chart", symbol);
    });
    note.show();
    notified += 1;
  });
  terminal("trade:open-keys", (venue) => {
    if (venue === "oanda") openTokenWindow();
    else openKeysWindow(Object.hasOwn(EXCHANGES, venue) ? venue : "binance");
  });
  terminal("app:open-window", (view) => void openDashboard(view));
  terminal("app:open-chart", (symbol) => {
    // A symbol name, or a market overview DEX pool (`dex:<network>:<address>`, up to ~110 characters).
    if (typeof symbol !== "string" || symbol.length > 160 || !win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    send("app:open-chart", symbol);
  });

  const keysOnly = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromKeysWindow(event)) throw new Error("Not allowed");
      return fn(...args);
    });
  keysOnly("keys:status", async () => {
    const st = await trade.status();
    return Object.fromEntries(Object.entries(st).map(([id, s]) => [id, s.configured]));
  });
  keysOnly("keys:save", (venue, fields) => trade.saveKeys(venue, fields));
  keysOnly("keys:clear", (venue) => trade.clearKeys(venue));
  keysOnly("keys:open-oanda", () => openTokenWindow());
  keysOnly("keys:close", () => keysWin?.close());

  const tokenOnly = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromTokenWindow(event)) throw new Error("Not allowed");
      return fn(...args);
    });
  tokenOnly("oanda:save-token", (token, env) => oanda.saveToken(token, env));
  tokenOnly("oanda:clear-token", () => oanda.clearToken());
  tokenOnly("settings:close", () => tokenWin?.close());
}

// ── Smoke test (OC_SMOKE=<out dir>) ───────────────────────
// Records Binance traffic and price changes, saves a screenshot, then exits 0 or 1.
// OC_SMOKE_SYMBOLS="XAUUSD,EURUSD" also charts each symbol; OC_SMOKE_DEX="pepe" searches,
// adds and charts the top DEX pool. Each needs candles and at least one price
// (OC_SMOKE_TICKS_OPTIONAL=1 drops the price rule, for forex at the weekend).
// OC_SMOKE_OANDA_FROM=<settings.json> reuses the OANDA token saved there, still DPAPI-encrypted,
// so the real service can be checked without the token being typed or printed.
// OC_SMOKE_DRAW='[{"tool":"pitchfork","label":"Pitchfork","points":3},…]' picks each tool from the
// left rail and places it with real mouse input, then checks every tool was saved.

const RAIL_GROUPS = [
  "Trend line tools",
  "Fib & Gann tools",
  "Patterns",
  "Forecasting and measurement tools",
  "Geometric shapes",
  "Annotation tools",
];

/** A smoke screenshot; capturePage can answer UnknownVizError while the display sleeps, so a failure is logged, not fatal. */
async function saveShot(wc, name) {
  try {
    fs.writeFileSync(path.join(smokeOut, name), (await wc.capturePage()).toPNG());
  } catch (err) {
    console.warn(`[smoke] screenshot ${name} skipped: ${err.message || err}`);
  }
}

async function smokeDraw(tools) {
  const wc = win.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rect = await wc.executeJavaScript(`(() => {
    const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  })()`);
  const at = (fx, fy) => ({ x: Math.round(rect.x + rect.w * fx), y: Math.round(rect.y + rect.h * fy) });
  const mouse = async (type, p, extra = {}) => {
    wc.sendInputEvent({ type, x: p.x, y: p.y, button: "left", clickCount: 1, ...extra });
    await wait(30);
  };
  const key = async (keyCode) => {
    wc.sendInputEvent({ type: "keyDown", keyCode });
    wc.sendInputEvent({ type: "keyUp", keyCode });
    await wait(60);
  };
  // Screenshot one open flyout for review.
  const toggleFib = `[...document.querySelectorAll("button")].find((b) => b.title === "Fib & Gann tools")?.click()`;
  await wc.executeJavaScript(toggleFib);
  await wait(300);
  await saveShot(wc, "smoke-rail.png");
  await wc.executeJavaScript(toggleFib);
  await wait(100);
  const problems = [];
  let savedBefore = await wc.executeJavaScript(`window.__ocDesktop.drawings().then((l) => l.length)`);
  for (const t of tools) {
    const armed = await wc.executeJavaScript(`(async () => {
      const tick = () => new Promise((r) => setTimeout(r, 60));
      for (const title of ${JSON.stringify(RAIL_GROUPS)}) {
        const chevron = [...document.querySelectorAll("button")].find((b) => b.title === title);
        if (!chevron) continue;
        chevron.click();
        await tick();
        const item = [...document.querySelectorAll("button")].find(
          (b) => b.querySelector("span")?.textContent === ${JSON.stringify(t.label)},
        );
        if (item) {
          item.click();
          await tick();
          return true;
        }
        chevron.click();
        await tick();
      }
      return false;
    })()`);
    if (!armed) {
      problems.push(`${t.label}: not in the rail`);
      continue;
    }
    if (t.points === "free") {
      await mouse("mouseMove", at(0.4, 0.5));
      await mouse("mouseDown", at(0.4, 0.5));
      for (let k = 1; k <= 10; k++) await mouse("mouseMove", at(0.4 + k * 0.02, 0.5 - k * 0.01), { modifiers: ["leftButtonDown"] });
      await mouse("mouseUp", at(0.6, 0.4));
    } else {
      const n = t.points === "multi" ? 4 : t.points;
      const pts = Array.from({ length: n }, (_, k) => at(0.35 + 0.07 * k, k % 2 ? 0.35 : 0.6));
      for (const p of pts) {
        await mouse("mouseMove", p);
        await mouse("mouseDown", p);
        await mouse("mouseUp", p);
      }
      if (t.points === "multi") {
        const last = pts[pts.length - 1];
        await mouse("mouseDown", last, { clickCount: 2 });
        await mouse("mouseUp", last, { clickCount: 2 });
        await key("Enter");
      }
    }
    await wait(120);
    await key("Escape");
    // Each placement must add one saved drawing on the charted symbol.
    const now = await wc.executeJavaScript(`window.__ocDesktop.drawings().then((l) => ({ n: l.length, symbol: window.__ocDesktop.selected() }))`);
    if (now.n <= savedBefore) problems.push(`${t.label}: not saved (${now.n} on ${now.symbol})`);
    savedBefore = now.n;
  }
  // Double-click the last drawing (on top) to open its settings, for review.
  const last = at(0.35, 0.6);
  await mouse("mouseDown", last, { clickCount: 1 });
  await mouse("mouseUp", last, { clickCount: 1 });
  await mouse("mouseDown", last, { clickCount: 2 });
  await mouse("mouseUp", last, { clickCount: 2 });
  await wait(400);
  await saveShot(wc, "smoke-settings.png");
  await key("Escape");
  await wait(500);
  const saved = await wc.executeJavaScript(`window.__ocDesktop.drawings().then((l) => l.map((d) => d.tool ?? d.type))`);
  const missing = tools.filter((t) => !saved.includes(t.tool)).map((t) => t.label);
  return { tried: tools.length, saved: saved.length, missing, problems };
}

// OC_SMOKE_GATE=1 places orders through the terminal's order path and answers the prompts:
// no key → reminder (paper trade, cancel, "Add API key" opens the keys window); a made-up OKX key
// (stored like a real one) → confirmation, then a send that OKX must reject with a readable error.
async function smokeGate() {
  const wc = win.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const order = (symbol, qty) =>
    wc.executeJavaScript(`window.__gate = window.__ocDesktop.smokeOrder(${JSON.stringify(symbol)}, ${qty}); true`);
  const result = () => wc.executeJavaScript("window.__gate");
  const dialog = () =>
    wc.executeJavaScript(`(() => { const d = document.querySelector('[data-testid^="order-gate-"]'); return d ? { kind: d.dataset.testid, text: d.innerText } : null; })()`);
  const click = (label) =>
    wc.executeJavaScript(`[...document.querySelectorAll('[data-testid^="order-gate-"] button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click() ?? false`);
  const out = {};

  await order("BINANCE:BTCUSDT", 0.001);
  await wait(800);
  const missing = await dialog();
  await saveShot(wc, "smoke-gate-missing.png");
  await click("Paper trade");
  out.paper = { dialog: missing?.kind, mentionsVenue: Boolean(missing?.text.includes("Binance")), result: await result() };

  await order("XAUUSD", 0.01);
  await wait(800);
  const fx = await dialog();
  await click("Cancel");
  out.oanda = { dialog: fx?.kind, mentionsOanda: Boolean(fx?.text.includes("OANDA")), result: await result() };

  await order("BYBIT:BTCUSDT", 0.001);
  await wait(800);
  await click("Add API key");
  const keysResult = await result();
  await wait(1500);
  out.keys = {
    result: keysResult,
    window: Boolean(keysWin),
    tab: keysWin ? await keysWin.webContents.executeJavaScript(`document.querySelector("nav button.active span")?.textContent ?? ""`) : "",
  };
  if (keysWin) {
    await saveShot(keysWin.webContents, "smoke-keys.png");
    keysWin.close();
  }

  await order("OKX:BTCUSDT", 0.001);
  await wait(1500);
  const confirm = await dialog();
  await saveShot(wc, "smoke-gate-confirm.png");
  await click("Cancel");
  out.confirmCancel = { dialog: confirm?.kind, text: confirm?.text.slice(0, 300), result: await result() };

  await order("OKX:BTCUSDT", 0.001);
  await wait(1500);
  await click("Send order");
  await wait(4000);
  out.confirmSend = { result: await result() };
  return out;
}

/**
 * Shrink a dashboard window to its minimum width and check its widest content can still be
 * reached: the nearest scrolling ancestor of `selector` scrolls sideways and nothing is cut off
 * past the window edge.
 */
async function hScroll(w, selector) {
  const [width, height] = w.getSize();
  w.setSize(780, height);
  await new Promise((r) => setTimeout(r, 600));
  const r = await w.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    let box = el;
    while (box && !(box.scrollWidth > box.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(box).overflowX))) box = box.parentElement;
    const content = el.scrollWidth;
    const before = box ? box.scrollLeft : 0;
    if (box) box.scrollLeft = 100000;
    const right = el.getBoundingClientRect().right;
    // Pinned columns: the first body cell should still sit at the scroller's left edge, and the
    // row's last cell (the chart button) inside the window.
    const row = el.querySelector("tbody tr");
    const boxLeft = box ? box.getBoundingClientRect().left : 0;
    const result = {
      content,
      viewport: window.innerWidth,
      scroller: box ? box.className.slice(0, 60) : null,
      scrolled: box ? box.scrollLeft - before : 0,
      rightEdgeVisible: right <= window.innerWidth + 1,
      barHeight: box ? box.offsetHeight - box.clientHeight : 0,
      firstCellLeft: row ? Math.round(row.firstElementChild.getBoundingClientRect().left - boxLeft) : null,
      lastCellVisible: row ? row.lastElementChild.getBoundingClientRect().right <= window.innerWidth + 1 : null,
    };
    window.__hbox = box;
    return result;
  })()`);
  await new Promise((r) => setTimeout(r, 800));
  r.stillScrolled = await w.webContents.executeJavaScript(`window.__hbox ? window.__hbox.scrollLeft : 0`);
  // The screenshot is a record, not a check (capturePage can answer UnknownVizError).
  await w.webContents
    .capturePage()
    .then((img) => fs.writeFileSync(path.join(smokeOut, `smoke-hscroll-${selector.replace(/\W+/g, "")}.png`), img.toPNG()))
    .catch((err) => (r.shotError = String(err.message || err)));
  await w.webContents.executeJavaScript(`document.querySelectorAll("*").forEach((e) => { if (e.scrollLeft) e.scrollLeft = 0; })`);
  w.setSize(width, height);
  const fits = r.content <= r.viewport;
  return { ...r, ok: fits || (r.scrolled > 0 && r.rightEdgeVisible && r.barHeight >= 10) };
}

// OC_SMOKE_ALERTS=1: right-click the chart › Set alert, open the Alerts tab, make an alert fire on the
// next real tick (armed as if the price were on the other side), check the log and the Windows
// notification, then open File › Dashboard › Alerts & positions with a paper position and close it there.
async function smokeAlerts() {
  const wc = win.webContents;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => wc.executeJavaScript(code);
  const until = async (target, expr, ms) => {
    for (let t = 0; t < ms; t += 500) {
      if (await target.executeJavaScript(expr).catch(() => false)) return true;
      await wait(500);
    }
    return false;
  };
  const out = {};
  const symbol = await js("window.__ocDesktop.selected()");

  // 1. Right-click a price on the chart.
  const rect = await js(`(() => {
    const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  })()`);
  const at = { x: Math.round(rect.x + rect.w * 0.5), y: Math.round(rect.y + rect.h * 0.35) };
  wc.sendInputEvent({ type: "mouseMove", ...at });
  wc.sendInputEvent({ type: "mouseDown", ...at, button: "right", clickCount: 1 });
  wc.sendInputEvent({ type: "mouseUp", ...at, button: "right", clickCount: 1 });
  await wait(500);
  out.menuItem = await js(`[...document.querySelectorAll("button")].map((b) => b.textContent.trim()).find((t) => t.startsWith("Set alert on")) ?? null`);
  await saveShot(wc, "smoke-alert-menu.png");
  await js(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Set alert on"))?.click()`);
  await wait(400);
  out.fromMenu = await js(`window.__ocDesktop.alerts().alerts.map((a) => ({ symbol: a.symbol, price: a.price, side: a.side }))`);

  // 2. The Alerts tab under the chart.
  await js(`[...document.querySelectorAll("button")].find((b) => b.querySelector("span")?.textContent === "Alerts")?.click()`);
  await wait(600);
  out.tabRows = await js(`document.querySelectorAll('[data-testid="alerts-table"] tbody tr[data-alert-status]').length`);
  await saveShot(wc, "smoke-alerts-tab.png");

  // 3. Fire: armed "below" a level just under the market, so the next tick crosses up.
  await until(wc, `window.__ocDesktop.mid(${JSON.stringify(symbol)}) !== null`, 20_000);
  const mid = await js(`window.__ocDesktop.mid(${JSON.stringify(symbol)})`);
  const before = notified;
  await js(`window.__ocDesktop.smokeAlert(${JSON.stringify(symbol)}, ${mid * 0.999}, ${mid * 0.99}, "once")`);
  await js(`window.__ocDesktop.smokeAlert(${JSON.stringify(symbol)}, ${mid * 0.998}, ${mid * 0.99}, "repeat")`);
  const firedOk = await until(wc, `window.__ocDesktop.alerts().log.length >= 2`, 30_000);
  await wait(800);
  const state = await js("window.__ocDesktop.alerts()");
  out.fired = {
    ok: firedOk,
    log: state.log.length,
    once: state.alerts.find((a) => a.mode === "once" && a.note === "smoke")?.status,
    repeat: state.alerts.find((a) => a.mode === "repeat")?.status,
    notifications: notified - before,
    toast: await js(`document.body.innerText.includes("Alert: ${symbol}")`),
  };
  await saveShot(wc, "smoke-alerts-fired.png");

  // 4. A paper position (no API key: the reminder's "Paper trade").
  await js(`window.__p = window.__ocDesktop.smokeOrder(${JSON.stringify(symbol)}, 0.001); true`);
  await wait(800);
  await js(`[...document.querySelectorAll('[data-testid^="order-gate-"] button')].find((b) => b.textContent.trim() === "Paper trade")?.click()`);
  out.paper = await js("window.__p");

  // 5. The central dashboard.
  const d = openDashboard("desk").webContents;
  await new Promise((r) => d.once("did-finish-load", r));
  const liveOk = await until(d, `document.querySelector('[data-testid="desk-terminal"]')?.textContent.startsWith("Terminal running")`, 15_000);
  await until(d, `document.querySelectorAll('[data-testid="desk-positions"] tbody tr button').length > 0`, 10_000);
  out.desk = await d.executeJavaScript(`({
    live: ${liveOk},
    alertRows: document.querySelectorAll('[data-testid="alerts-table"] tbody tr[data-alert-status]').length,
    positions: [...document.querySelectorAll('[data-testid="desk-positions"] tbody tr')].map((r) => r.innerText.split("\\t").slice(0, 3).join(" ")),
    summary: document.querySelector('[data-testid="desk-summary"]')?.innerText.replace(/\\n/g, " "),
  })`);
  await saveShot(d, "smoke-desk.png");
  await d.executeJavaScript(`window.confirm = () => true; [...document.querySelectorAll('[data-testid="desk-positions"] tbody tr')].find((r) => r.innerText.startsWith("Paper"))?.querySelectorAll("button")[1]?.click()`);
  out.desk.closed = await until(d, `document.querySelector('[data-testid="desk-positions"]')?.innerText.includes("No open positions")`, 10_000);
  return out;
}

// OC_SMOKE_DASH=1 opens File › Dashboard › Portfolio (adds a public wallet address) and
// Market overview (every tab, a condition, a week change on pairs) and screenshots them.
async function smokeDash() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (wc, expr, ms) => {
    for (let t = 0; t < ms; t += 500) {
      if (await wc.executeJavaScript(expr).catch(() => false)) return true;
      await wait(500);
    }
    return false;
  };
  const setInput = (selector, value) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`;
  const out = {};
  // A screenshot that fails (Electron's capturePage can answer UnknownVizError) is noted, not fatal.
  const shot = async (wc, name) => {
    try {
      fs.writeFileSync(path.join(smokeOut, name), (await wc.capturePage()).toPNG());
    } catch (err) {
      (out.shotErrors ??= []).push(`${name}: ${err.message || err}`);
    }
  };

  const p = openDashboard("portfolio").webContents;
  await new Promise((r) => p.once("did-finish-load", r));
  await until(p, `document.querySelector('[data-testid="wallet-address"]') !== null`, 15_000);
  await p.executeJavaScript(setInput('[data-testid="wallet-address"]', "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"));
  await p.executeJavaScript(`document.querySelector('[data-testid="wallet-add"]').click()`);
  const walletOk = await until(p, `document.querySelectorAll('[data-wallet-card] tbody tr td.font-mono').length > 3`, 45_000);
  await wait(1500);
  out.portfolio = await p.executeJavaScript(`({
    walletRows: document.querySelectorAll('[data-wallet-card] tbody tr').length,
    chains: [...new Set([...document.querySelectorAll('[data-wallet-card] tbody tr td:first-child')].map((t) => t.textContent))],
    summary: document.querySelector('[data-testid="portfolio-summary"]')?.innerText.replace(/\\n/g, " "),
    connect: [...document.querySelectorAll('[data-testid="portfolio-not-connected"] button')].map((b) => b.textContent.trim()),
    venueCards: [...document.querySelectorAll('[data-venue-card]')].map((c) => c.dataset.venueCard + ": " + c.innerText.split("\\n").slice(0, 4).join(" | ")),
  })`);
  out.portfolio.walletOk = walletOk;
  out.portfolio.hscroll = await hScroll(dashboards.get("portfolio"), "[data-wallet-card]");
  await shot(p, "smoke-portfolio.png");

  const m = openDashboard("markets").webContents;
  await new Promise((r) => m.once("did-finish-load", r));
  const count = () => m.executeJavaScript(`document.querySelector('[data-testid="market-count"]')?.textContent ?? ""`);
  const rows = () => m.executeJavaScript(`document.querySelectorAll('[data-testid="market-table"] tbody tr').length`);
  // Row charts among the first 15 rows: how many are drawn, the column header, and the first line.
  const topSparks = `[...document.querySelectorAll('[data-testid="market-table"] tbody tr')].slice(0, 15).map((r) => r.querySelector('[data-testid="market-spark"]')).filter(Boolean)`;
  const sparks = () => m.executeJavaScript(`(() => {
    const s = ${topSparks};
    const cells = [...document.querySelectorAll('[data-testid="market-table"] tbody tr')].slice(0, 15).map((r) => r.lastElementChild);
    return { loading: cells.filter((c) => c?.querySelector(".animate-pulse")).length, empty: cells.filter((c) => c?.textContent === "—").length, drawn: s.length, up: s.filter((x) => x.dataset.trend === "up").length, header: document.querySelector('[data-testid="market-table"] thead th:last-child')?.textContent, first: s[0]?.querySelector("path:last-of-type")?.getAttribute("d")?.length ?? 0 };
  })()`);
  const crypto = await until(m, `document.querySelectorAll('[data-testid="market-table"] tbody tr').length >= 250`, 40_000);
  await wait(8000); // pages 2–4 of CoinGecko
  out.markets = { crypto: { ok: crypto, count: await count() } };
  // Each period redraws the row charts: day and month from exchange bars, week from CoinGecko, year from daily closes.
  out.markets.charts = {};
  for (const period of ["1d", "1w", "1m", "1y"]) {
    await m.executeJavaScript(`document.querySelector('[data-period="${period}"]').click()`);
    await until(m, `${topSparks}.length >= 12`, 45_000);
    out.markets.charts[period] = await sparks();
    await shot(m, `smoke-markets-chart-${period}.png`);
  }
  await m.executeJavaScript(`document.querySelector('[data-period="1d"]').click()`);
  await m.executeJavaScript(setInput('[data-testid="market-condition"]', "change > 0 and volume > 10M"));
  await wait(500);
  out.markets.crypto.filtered = await count();
  out.markets.crypto.error = await m.executeJavaScript(`document.querySelector('[data-testid="market-condition"]').classList.contains("border-sell")`);
  out.markets.crypto.hscroll = await hScroll(dashboards.get("markets"), '[data-testid="market-table"]');
  await shot(m, "smoke-markets-crypto.png");
  await m.executeJavaScript(setInput('[data-testid="market-condition"]', ""));
  // Crypto venues: exchanges listing each coin, DEX liquidity for the rows on screen (DexScreener),
  // trending DEX-only tokens (GeckoTerminal), and a coin opened into its pairs and pools.
  const cellsOf = (label) => `(() => {
    const i = [...document.querySelectorAll('[data-testid="market-table"] thead th')].findIndex((th) => th.textContent.startsWith(${JSON.stringify(label)}));
    return [...document.querySelectorAll('[data-testid="market-table"] tbody tr[data-row-id]')].map((r) => r.children[i]?.textContent ?? "");
  })()`;
  const filled = (label, n) => `${cellsOf(label)}.slice(0, 15).filter((t) => t && t !== "—").length >= ${n}`;
  await until(m, filled("Exchanges", 12), 40_000);
  await until(m, filled("DEX liquidity", 8), 90_000);
  out.markets.venues = await m.executeJavaScript(`(() => {
    const ex = ${cellsOf("Exchanges")}, liq = ${cellsOf("DEX liquidity")}, gap = ${cellsOf("CEX/DEX gap")};
    return { exchanges: ex.slice(0, 15).filter((t) => t && t !== "—").length, first: ex[0], dexLiq: liq.slice(0, 15).filter((t) => t && t !== "—").length, gaps: gap.slice(0, 15).filter((t) => /%$/.test(t)).length };
  })()`);
  // DEX-only tokens (most have no market cap, so they sort last): counted through the condition box.
  await m.executeJavaScript(setInput('[data-testid="market-condition"]', 'exchanges contains "DEX only"'));
  const dexOnly = `Number((document.querySelector('[data-testid="market-count"]')?.textContent ?? "").split(" of ")[0].replace(/,/g, ""))`;
  await until(m, `${dexOnly} >= 10`, 120_000);
  out.markets.venues.dexOnly = await m.executeJavaScript(dexOnly);
  await shot(m, "smoke-markets-dex-only.png");
  await m.executeJavaScript(setInput('[data-testid="market-condition"]', ""));
  await wait(500);
  await m.executeJavaScript(`document.querySelector('[data-testid="market-table"] tbody tr [data-testid="market-expand"]').click()`);
  await until(m, `document.querySelectorAll('[data-testid="market-venues"] [data-venue="cex"]').length >= 3 && document.querySelectorAll('[data-testid="market-venues"] [data-venue="dex"]').length >= 1`, 30_000);
  out.markets.expanded = await m.executeJavaScript(`({
    coin: document.querySelector('[data-testid="market-table"] tbody tr[data-row-id]')?.dataset.rowId,
    cex: document.querySelectorAll('[data-testid="market-venues"] [data-venue="cex"]').length,
    dex: document.querySelectorAll('[data-testid="market-venues"] [data-venue="dex"]').length,
  })`);
  await shot(m, "smoke-markets-venues.png");
  // DEX pools link to the DEX's own swap page; nothing is clicked, so no browser opens.
  out.markets.trade = await m.executeJavaScript(`(() => {
    const links = [...document.querySelectorAll('[data-testid="market-venues"] a[data-testid="venue-trade"]')];
    return {
      links: links.length,
      hosts: [...new Set(links.map((a) => new URL(a.href).host))],
      https: links.length > 0 && links.every((a) => a.href.startsWith("https://") && a.target === "_blank"),
    };
  })()`);
  // A DEX pool's chart button adds the pool to the terminal and charts it there.
  const selected = () => win.webContents.executeJavaScript("window.__ocDesktop.selected()");
  const before = await selected();
  const pair = await m.executeJavaScript(
    `(() => { const b = document.querySelector('[data-testid="market-venues"] [data-venue="dex"] [data-testid="venue-chart"]'); b.click(); return b.closest("tr").children[2].textContent; })()`,
  );
  await until(win.webContents, `window.__ocDesktop.selected() !== ${JSON.stringify(before)}`, 60_000);
  const after = await selected();
  const chart = await win.webContents.executeJavaScript(`window.__ocDesktop.smokeChart(${JSON.stringify(after)})`);
  out.markets.dexOpened = { pair, before, after, candles: chart?.candles ?? 0, error: chart?.error };
  for (const tab of ["forex", "stocks"]) {
    await m.executeJavaScript(`document.querySelector('[data-tab="${tab}"]').click()`);
    const ok = await until(m, `document.querySelectorAll('[data-testid="market-table"] tbody tr').length > 20`, 40_000);
    await until(m, `${topSparks}.length >= 10`, 30_000);
    await wait(1500);
    out.markets[tab] = { ok, count: await count(), rows: await rows(), sparks: await sparks() };
    await shot(m, `smoke-markets-${tab}.png`);
  }
  return out;
}

function runSmoke() {
  const seen = { errors: [] };
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") seen.errors.push(`console: ${event.message} @${event.sourceId}:${event.lineNumber}`);
  });

  const text = () => win.webContents.executeJavaScript("document.body.innerText");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  win.webContents.once("did-finish-load", async () => {
    // The terminal renders once the adapter has its pair lists (up to the 12 s exchange timeout).
    for (let t = 0; t < 30_000; t += 500) {
      if (await win.webContents.executeJavaScript("document.querySelectorAll('canvas').length").catch(() => 0)) break;
      await wait(500);
    }
    await wait(8000);
    const first = await text();
    await wait(6000);
    const second = await text();
    const canvases = await win.webContents.executeJavaScript("document.querySelectorAll('canvas').length");
    fs.mkdirSync(smokeOut, { recursive: true });
    await saveShot(win.webContents, `smoke-${settings.dataSource}.png`);

    const symbols = (process.env.OC_SMOKE_SYMBOLS || "").split(",").filter(Boolean);
    let picker = null;
    let venues = null;
    // Pairs listed per exchange prefix ("OKX" → 120), from the terminal's symbol list. An exchange that
    // missed the start is retried in the background, so give it up to a minute to arrive.
    const countListed = () =>
      win.webContents.executeJavaScript(
        `window.__ocDesktop.symbols().reduce((m, n) => { const p = n.includes(":") ? n.split(":")[0] : "other"; m[p] = (m[p] || 0) + 1; return m; }, {})`,
      );
    const enabledPrefixes = Object.keys(EXCHANGES).filter((id) => settings.exchanges[id]).map((id) => id.toUpperCase());
    let listed = settings.dataSource === "live" ? await countListed() : null;
    let retried = [];
    for (let t = 0; listed && t < 60_000 && enabledPrefixes.some((p) => (listed[p] ?? 0) <= 50); t += 2000) {
      retried = enabledPrefixes.filter((p) => (listed[p] ?? 0) <= 50);
      await wait(2000);
      listed = await countListed();
    }
    if (process.env.OC_SMOKE_DEX) {
      // Type the query into the symbol picker and count the DEX pool rows it shows.
      await win.webContents.executeJavaScript(`(() => {
        const selected = window.__ocDesktop.selected();
        const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === selected);
        btn.click();
      })()`);
      await wait(500);
      await win.webContents.executeJavaScript(`(() => {
        const input = [...document.querySelectorAll("input")].find((i) => i.placeholder.startsWith("Search symbols, forex"));
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        set.call(input, ${JSON.stringify(process.env.OC_SMOKE_DEX)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()`);
      await wait(5000);
      picker = await win.webContents.executeJavaScript(
        `[...document.querySelectorAll("span")].filter((s) => /^liq \\$/.test(s.textContent?.trim() ?? "")).length`,
      );
      await saveShot(win.webContents, "smoke-picker.png");
      // The venue chips and badges, with the search cleared.
      await win.webContents.executeJavaScript(`(() => {
        const input = [...document.querySelectorAll("input")].find((i) => i.placeholder.startsWith("Search symbols, forex"));
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "btc");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()`);
      await new Promise((r) => setTimeout(r, 600));
      await saveShot(win.webContents, "smoke-picker-venues.png");
      venues = await win.webContents.executeJavaScript(`({
        chips: [...document.querySelectorAll("[data-venue-chip]")].map((b) => b.dataset.venueChip),
        badges: [...new Set([...document.querySelectorAll("[data-venue]")].map((b) => b.dataset.venue))],
      })`);
      await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
    }
    if (process.env.OC_SMOKE_DEX) {
      const added = await win.webContents.executeJavaScript(
        `window.__ocDesktop.smokeAddDex(${JSON.stringify(process.env.OC_SMOKE_DEX)})`,
      );
      symbols.push(added || "(dex search found nothing)");
    }
    const charted = [];
    for (const name of symbols) {
      const r = await win.webContents.executeJavaScript(`window.__ocDesktop.smokeChart(${JSON.stringify(name)})`);
      await wait(7000);
      r.ticks = await win.webContents.executeJavaScript(`window.__ocDesktop.tickCount(${JSON.stringify(name)})`);
      await saveShot(win.webContents, `smoke-${name.replace(/[^\w.-]+/g, "_")}.png`);
      charted.push(r);
    }

    let draw = null;
    if (process.env.OC_SMOKE_DRAW) {
      draw = await smokeDraw(JSON.parse(process.env.OC_SMOKE_DRAW)).catch((err) => ({ missing: [], problems: [String(err.message || err)] }));
      await saveShot(win.webContents, "smoke-draw.png");
    }

    const gate = process.env.OC_SMOKE_GATE ? await smokeGate().catch((err) => ({ error: String(err.message || err) })) : null;
    const alertsRun = process.env.OC_SMOKE_ALERTS ? await smokeAlerts().catch((err) => ({ error: String(err.message || err) })) : null;
    const dash = process.env.OC_SMOKE_DASH ? await smokeDash().catch((err) => ({ error: String(err.message || err) })) : null;

    // OC_SMOKE_TOKEN: paste it into the OANDA token window and save, as a user would.
    let tokenWindow = null;
    if (process.env.OC_SMOKE_TOKEN) {
      openTokenWindow();
      await new Promise((r) => tokenWin.webContents.once("did-finish-load", r));
      tokenWindow = await tokenWin.webContents.executeJavaScript(`(async () => {
        document.getElementById("token").value = ${JSON.stringify(process.env.OC_SMOKE_TOKEN)};
        document.getElementById("save").click();
        for (let i = 0; i < 50 && !/Connected|rejected|not|Unknown/.test(document.getElementById("status").textContent); i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return document.getElementById("status").textContent;
      })()`);
      const stored = loadSettings().oanda.tokenEnc;
      tokenWindow = { status: tokenWindow, storedEncrypted: Boolean(stored) && !stored.includes(process.env.OC_SMOKE_TOKEN) };
    }

    let oandaReal = null;
    if (process.env.OC_SMOKE_OANDA_FROM) {
      const st = await oanda.status();
      const list = st.error ? [] : await oanda.instruments().catch(() => []);
      oandaReal = {
        env: st.env,
        account: Boolean(st.accountId),
        error: st.error ?? null,
        instruments: list.length,
        metals: list.filter((i) => i.type === "METAL").map((i) => i.name),
        stream: oandaState,
      };
    }

    const result = {
      dataSource: settings.dataSource,
      listed,
      retried,
      oandaReal,
      draw,
      gate,
      alerts: alertsRun,
      dash,
      tokenWindow,
      canvases,
      pricesMoved: first !== second,
      hasBTC: first.includes("BTCUSD"),
      charted,
      picker,
      venues,
      errors: seen.errors.slice(0, 10),
    };
    // Live mode: every enabled exchange listed pairs.
    const live =
      settings.dataSource !== "live" ||
      Object.keys(EXCHANGES)
        .filter((id) => settings.exchanges[id])
        .every((id) => (listed?.[id.toUpperCase()] ?? 0) > 50);
    const gateOk =
      gate === null ||
      (gate.paper?.dialog === "order-gate-missing-key" &&
        gate.paper.mentionsVenue &&
        gate.paper.result?.ok === true &&
        gate.oanda?.mentionsOanda &&
        gate.oanda.result?.error === "Order cancelled." &&
        gate.keys?.window &&
        gate.keys.tab === "Bybit" &&
        gate.confirmCancel?.dialog === "order-gate-confirm-real" &&
        gate.confirmCancel.result?.error === "Order cancelled." &&
        /OKX: API key doesn't exist/.test(gate.confirmSend?.result?.error ?? ""));
    const dashOk =
      dash === null ||
      (dash.portfolio?.walletOk &&
        dash.portfolio.connect.length >= 5 &&
        dash.markets?.crypto?.ok &&
        ["forex", "stocks"].every((t) => dash.markets[t]?.ok) &&
        ["1d", "1w", "1m", "1y"].every((p) => dash.markets.charts?.[p]?.drawn >= 12) &&
        new Set(["1d", "1w", "1m", "1y"].map((p) => dash.markets.charts[p].first)).size > 1 &&
        ["forex", "stocks"].every((t) => dash.markets[t].sparks?.drawn >= 10) &&
        dash.markets.venues?.exchanges >= 12 &&
        dash.markets.venues.dexLiq >= 8 &&
        dash.markets.venues.gaps >= 5 &&
        dash.markets.venues.dexOnly >= 10 &&
        dash.markets.expanded?.cex >= 3 &&
        dash.markets.expanded.dex >= 1 &&
        dash.markets.trade?.https &&
        dash.markets.dexOpened?.after !== dash.markets.dexOpened?.before &&
        dash.markets.dexOpened.candles > 0 &&
        // DEX pools trade under names like "WBTC/WETH", without an exchange prefix.
        /^[^:]+\/[^:]+$/.test(dash.markets.dexOpened?.after ?? "") &&
        dash.portfolio.hscroll?.ok &&
        dash.markets.crypto.hscroll?.ok &&
        dash.markets.crypto.hscroll.firstCellLeft === 0 &&
        dash.markets.crypto.hscroll.lastCellVisible &&
        dash.markets.crypto.error === false);
    const alertsOk =
      alertsRun === null ||
      (alertsRun.menuItem?.startsWith("Set alert on") &&
        alertsRun.fromMenu?.length === 1 &&
        alertsRun.tabRows === 1 &&
        alertsRun.fired?.ok &&
        alertsRun.fired.once === "triggered" &&
        alertsRun.fired.repeat === "active" &&
        alertsRun.fired.notifications >= 2 &&
        alertsRun.paper?.ok &&
        alertsRun.desk?.live &&
        alertsRun.desk.alertRows === 3 &&
        alertsRun.desk.positions.some((p) => p.startsWith("Paper")) &&
        alertsRun.desk.closed);
    const chartsOk =
      gateOk &&
      alertsOk &&
      dashOk &&
      (venues === null || venues.badges.length > 1) &&
      charted.every((c) => c.candles > 0 && (c.ticks > 0 || process.env.OC_SMOKE_TICKS_OPTIONAL === "1")) &&
      (oandaReal === null || (oandaReal.account && oandaReal.metals.includes("XAU_USD"))) &&
      (draw === null || (draw.missing.length === 0 && draw.problems.length === 0)) &&
      (picker === null || picker > 0) &&
      (tokenWindow === null || (tokenWindow.status.startsWith("Connected") && tokenWindow.storedEncrypted));
    const ok = canvases > 0 && result.hasBTC && result.pricesMoved && live && chartsOk;
    console.log(`SMOKE ${ok ? "PASS" : "FAIL"} ${JSON.stringify(result)}`);
    app.exit(ok ? 0 : 1);
  });
}

// ── Start ─────────────────────────────────────────────────

if (!smokeOut && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // Windows shows toast notifications under this id (the same as the installer's appId).
  app.setAppUserModelId("com.thrivelab.opencharts");

  app.whenReady().then(() => {
    protocol.handle("app", (request) => {
      const rel = resolveWebPath(new URL(request.url).pathname);
      if (!rel) return new Response("Bad path", { status: 400 });
      return net.fetch(pathToFileURL(path.join(webRoot, rel)).toString());
    });

    settings = loadSettings();
    if (smokeOut && process.env.OC_SMOKE_SOURCE in DATA_SOURCES) {
      settings.dataSource = process.env.OC_SMOKE_SOURCE;
    }
    if (smokeOut && process.env.OC_SMOKE_OANDA_FROM) {
      const saved = JSON.parse(fs.readFileSync(process.env.OC_SMOKE_OANDA_FROM, "utf8"));
      settings.oanda = normalizeSettings(saved).oanda;
    }
    // A made-up OKX key, stored encrypted like a real one, so the gate smoke reaches the confirmation
    // and a real (rejected) request. It only lives in the smoke profile.
    if (smokeOut && process.env.OC_SMOKE_GATE && safeStorage.isEncryptionAvailable()) {
      const fake = { apiKey: "00000000-0000-0000-0000-000000000000", secret: "C".repeat(32), passphrase: "smoke", testnet: false };
      settings.keys = { ...settings.keys, okx: safeStorage.encryptString(JSON.stringify(fake)).toString("base64") };
    }
    registerIpc();
    buildMenu();
    createWindow();
    if (smokeOut) runSmoke();
  });

  app.on("window-all-closed", () => app.quit());
}
