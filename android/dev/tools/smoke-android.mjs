// On-device smoke test: installs the debug APK on an emulator (or a connected phone), starts the
// app and drives its WebView over the Chrome DevTools protocol (adb forward to the WebView's
// devtools socket). Checks the real app end to end and saves screenshots to dev/out/android/.
//
//   node dev/tools/smoke-android.mjs            build nothing, use dist/OpenCharts-<v>-debug.apk
//   node dev/tools/smoke-android.mjs --boot     also create and boot the "oc_pixel" emulator
//
// Scenarios: live prices from every exchange, native HTTPS (no CORS), Keystore round trip,
// the phone layout (tabs, sheets, drawing bar), the order gate and a paper trade, a price alert
// that must reach Android's notification shade, a DEX pool, gold, the three dashboards,
// the keys page, and the hardware back button.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = path.join(root, "dev", "out", "android");
fs.mkdirSync(out, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const apk = path.join(root, "dist", `OpenCharts-${version}-debug.apk`);
const PKG = "com.thrivelab.opencharts";
const SDK = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Android", "Sdk");
const exe = process.platform === "win32" ? ".exe" : "";
const ADB = process.env.OC_ADB || path.join(SDK, "platform-tools", `adb${exe}`);
const PORT = 9333;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const adb = (...args) => execFileSync(ADB, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const shot = (name) => fs.writeFileSync(path.join(out, `${name}.png`), execFileSync(ADB, ["exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 }));

async function boot() {
  const devices = adb("devices").split("\n").slice(1).filter((l) => /\tdevice$/.test(l));
  if (devices.length) return;
  if (!process.argv.includes("--boot")) throw new Error("No device. Connect a phone with USB debugging or pass --boot.");
  const jdk = process.env.JAVA_HOME || path.join(process.env.LOCALAPPDATA, "Programs", "Temurin", fs.readdirSync(path.join(process.env.LOCALAPPDATA, "Programs", "Temurin")).find((d) => d.startsWith("jdk-21")));
  const avds = execFileSync(path.join(SDK, "emulator", `emulator${exe}`), ["-list-avds"], { encoding: "utf8" });
  if (!avds.split(/\r?\n/).includes("oc_pixel")) {
    const avdmanager = path.join(SDK, "cmdline-tools", "19.0", "bin", process.platform === "win32" ? "avdmanager.bat" : "avdmanager");
    execFileSync(avdmanager, ["create", "avd", "-n", "oc_pixel", "-k", "system-images;android-35;google_apis;x86_64", "-d", "pixel_7", "--force"], {
      input: "no\n",
      env: { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: SDK },
      shell: process.platform === "win32",
      stdio: ["pipe", "inherit", "inherit"],
    });
  }
  // Its output goes to a log: with stdio ignored the Windows emulator exited at once.
  const log = fs.openSync(path.join(out, "emulator.log"), "w");
  const emu = spawn(path.join(SDK, "emulator", `emulator${exe}`), ["-avd", "oc_pixel", "-no-snapshot-save", "-no-boot-anim", "-no-audio", "-gpu", "swiftshader_indirect"], {
    detached: true,
    stdio: ["ignore", log, log],
  });
  emu.unref();
  adb("wait-for-device");
  for (let t = 0; t < 300; t++) {
    if (adb("shell", "getprop", "sys.boot_completed") === "1") break;
    await wait(2000);
  }
  await wait(5000);
}

// ── Minimal CDP client ──
async function connect() {
  let sock = "";
  for (let t = 0; t < 40 && !sock; t++) {
    // The socket of the app's current process (a restarted app leaves the old one listed).
    const pid = adb("shell", "pidof", PKG).split(/\s+/)[0];
    const unix = adb("shell", "cat", "/proc/net/unix");
    if (pid && unix.includes(`@webview_devtools_remote_${pid}`)) sock = `webview_devtools_remote_${pid}`;
    if (!sock) await wait(500);
  }
  if (!sock) throw new Error("No WebView devtools socket (is this a debug build?)");
  adb("forward", `tcp:${PORT}`, `localabstract:${sock}`);
  let page = null;
  for (let t = 0; t < 40 && !page; t++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      page = list.find((p) => p.type === "page" && /localhost/.test(p.url));
    } catch {
      // not up yet
    }
    if (!page) await wait(500);
  }
  if (!page) throw new Error("WebView page not found");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "evaluate failed");
    return r.result?.result?.value;
  };
  return { js, close: () => ws.close() };
}

async function until(js, expr, ms) {
  for (let t = 0; t < ms; t += 500) {
    if (await js(expr).catch(() => false)) return true;
    await wait(500);
  }
  return false;
}

async function main() {
  await boot();
  if (!fs.existsSync(apk)) throw new Error(`Build the debug APK first: node dev/tools/build-apk.mjs --debug (${apk})`);
  const model = adb("shell", "getprop", "ro.product.model");
  const sdk = adb("shell", "getprop", "ro.build.version.sdk");
  console.log(`device: ${model} (API ${sdk})`);
  // A fresh install: a release build signed with another key cannot be replaced by the debug one.
  try {
    adb("uninstall", PKG);
  } catch {
    // not installed
  }
  adb("install", "-g", apk);
  adb("shell", "pm", "grant", PKG, "android.permission.POST_NOTIFICATIONS");
  adb("shell", "am", "start", "-W", "-n", `${PKG}/.MainActivity`);
  await wait(1500);
  shot("01-splash");
  const { js, close } = await connect();
  const r = {};

  // 1. Live prices from every exchange, through native HTTPS.
  r.rendered = await until(js, `!!document.querySelector('[data-testid="mobile-root"]')`, 45_000);
  await wait(8000);
  r.listed = await js(`window.__ocDesktop.symbols().reduce((m, n) => { const p = n.includes(":") ? n.split(":")[0] : "other"; m[p] = (m[p] || 0) + 1; return m; }, {})`);
  // Live: the terminal's BTC mid matches a fresh quote from Binance (quiet markets can sit still
  // for a while, so "the price moved" is not a fair check).
  await js(`window.__ocDesktop.smokeChart("BINANCE:BTCUSDT")`);
  await wait(4000);
  r.price = await js(`(async () => {
    const q = (await window.ocDesktop.web.get("https://api.binance.com/api/v3/ticker/bookTicker?symbol=BTCUSDT")).body;
    const fresh = (Number(q.bidPrice) + Number(q.askPrice)) / 2;
    await new Promise((r) => setTimeout(r, 3000));
    // The price on screen (an unchanged market sends no tick, so internal mids can still be empty).
    const header = document.querySelector('[data-testid="mobile-price"]').textContent;
    const shown = Number(header.replace(/,/g, ""));
    return { fresh, shown, header, live: Math.abs(shown - fresh) / fresh < 0.0005 };
  })()`);
  r.insets = await js(`({ top: getComputedStyle(document.documentElement).getPropertyValue("--safe-area-inset-top"), bottom: getComputedStyle(document.documentElement).getPropertyValue("--safe-area-inset-bottom") })`);
  shot("02-chart");

  // 2. Keystore-sealed secrets.
  r.keystore = await js("window.ocMobile.selfTest()");

  // 3. Symbol sheet, indicators sheet, drawing bar.
  await js(`document.querySelector('[data-testid="mobile-symbol"]').click()`);
  await wait(800);
  shot("03-symbols");
  r.symbolSheet = await js(`document.querySelectorAll('[data-testid="symbol-list"] button').length`);
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await wait(600);
  r.backClosedSheet = await js(`!document.querySelector('[data-testid="sheet-symbols"]')`);
  await js(`document.querySelector('[data-testid="mobile-draw"]').click()`);
  await wait(500);
  await js(`document.querySelector('[data-testid="draw-group-fib"]').click()`);
  await wait(600);
  shot("04-draw-tools");
  r.drawSheet = await js(`document.querySelectorAll('[data-testid="sheet-draw-tools"] button').length`);
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await wait(400);
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await wait(400);
  r.drawClosed = await js(`!document.querySelector('[data-testid="mobile-drawing-bar"]')`);
  // Two backs (tool sheet, then drawing bar) must not leave the app.
  r.inAppAfterBacks = /topResumedActivity=.*com\.thrivelab\.opencharts/.test(adb("shell", "dumpsys", "activity", "activities"));

  // 4. Order gate: no key → reminder → paper trade.
  const symbol = await js("window.__ocDesktop.selected()");
  await js(`window.__gate = window.__ocDesktop.smokeOrder(${JSON.stringify(symbol)}, 0.001); true`);
  await wait(1200);
  r.gate = await js(`(() => { const d = document.querySelector('[data-testid^="order-gate-"]'); return d ? { kind: d.dataset.testid, text: d.innerText.slice(0, 160) } : null; })()`);
  shot("05-order-gate");
  await js(`[...document.querySelectorAll('[data-testid^="order-gate-"] button')].find((b) => b.textContent.trim() === "Paper trade")?.click()`);
  r.paper = await js("window.__gate");
  await js(`document.querySelector('[data-tab="orders"]').click()`);
  await wait(1200);
  shot("06-orders");
  r.positionsShown = await js(`document.querySelector('[data-testid="pane-orders"]').innerText.includes(${JSON.stringify(symbol)})`);
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await wait(500);
  r.backToChart = await js(`!document.querySelector('[data-testid="pane-orders"]')`);

  // 5. A price alert that must reach the notification shade.
  await until(js, `window.__ocDesktop.mid(${JSON.stringify(symbol)}) !== null`, 20_000);
  const mid = await js(`window.__ocDesktop.mid(${JSON.stringify(symbol)})`);
  adb("shell", "cmd", "notification", "list"); // warm up
  await js(`window.__ocDesktop.smokeAlert(${JSON.stringify(symbol)}, ${mid * 0.999}, ${mid * 0.99}, "once")`);
  r.alertFired = await until(js, `window.__ocDesktop.alerts().log.length >= 1`, 120_000);
  await wait(2000);
  const notes = adb("shell", "dumpsys", "notification", "--noredact");
  r.notification = notes.includes(`pkg=${PKG}`) && notes.includes("Price alert");
  // The alert must not take the user out of the app (an exact-alarm settings page once did).
  r.stayedInApp = /topResumedActivity=.*com\.thrivelab\.opencharts/.test(adb("shell", "dumpsys", "activity", "activities"));
  adb("shell", "cmd", "statusbar", "expand-notifications");
  await wait(1200);
  shot("07-notification");
  adb("shell", "cmd", "statusbar", "collapse");
  await wait(600);

  // 6. A DEX pool and spot gold.
  // GeckoTerminal's free API allows 30 calls a minute; after a rate limit, try once more.
  let dex = await js(`window.__ocDesktop.smokeAddDex("pepe").catch((e) => null)`);
  if (!dex) {
    await wait(20_000);
    dex = await js(`window.__ocDesktop.smokeAddDex("pepe").catch((e) => null)`);
  }
  r.dex = dex ? await js(`window.__ocDesktop.smokeChart(${JSON.stringify(dex)})`) : { error: "no pool" };
  await wait(5000);
  shot("08-dex");
  r.gold = await js(`window.__ocDesktop.smokeChart("XAUUSD")`);
  await wait(5000);
  shot("09-gold");

  // 7. Dashboards and the keys page (panels over the terminal); back closes each.
  const panel = (expr) => js(`(() => { const d = document.querySelector('.oc-ovl:last-of-type iframe')?.contentDocument; return d ? (${expr}) : null; })()`);
  await js(`window.ocMobile.openDashboard("markets")`);
  await until(js, `(document.querySelector('.oc-ovl iframe')?.contentDocument?.querySelectorAll('[data-testid="market-table"] tbody tr').length ?? 0) > 20`, 60_000);
  r.markets = await panel(`d.querySelectorAll('[data-testid="market-table"] tbody tr').length`);
  // Row charts: drawn for the rows on screen, then redrawn for the month view.
  const drawn = `(document.querySelector('.oc-ovl iframe')?.contentDocument?.querySelectorAll('[data-testid="market-spark"]').length ?? 0)`;
  await until(js, `${drawn} >= 8`, 45_000);
  r.marketCharts = { day: await js(drawn) };
  shot("10-markets");
  await panel(`d.querySelector('[data-period="1m"]').click()`);
  await until(js, `document.querySelector('.oc-ovl iframe')?.contentDocument?.querySelector('[data-testid="market-table"] thead th:last-child')?.textContent.includes("Month") && ${drawn} >= 8`, 45_000);
  r.marketCharts.month = await js(drawn);
  shot("10b-markets-month");
  // The first coin opens into its exchange pairs and DEX pools; tapping a pool's chart closes the
  // panel and charts the pool in the terminal.
  await panel(`d.querySelector('[data-period="1d"]').click()`);
  await panel(`d.querySelector('[data-testid="market-table"] tbody tr [data-testid="market-expand"]').click()`);
  const venues = (kind) => `(document.querySelector('.oc-ovl iframe')?.contentDocument?.querySelectorAll('[data-testid="market-venues"] [data-venue="${kind}"]').length ?? 0)`;
  await until(js, `${venues("cex")} >= 3 && ${venues("dex")} >= 1`, 45_000);
  r.marketVenues = { cex: await js(venues("cex")), dex: await js(venues("dex")) };
  await panel(`d.querySelector('[data-testid="market-venues"]').scrollIntoView()`);
  await wait(800);
  shot("10c-markets-venues");
  // A pool's Trade button lists its swap page and the wallets that can open it; nothing is opened.
  // The button must be reachable on screen: the pool table scrolls sideways inside the panel.
  const onScreen = await panel(
    `(() => { const b = d.querySelector('[data-testid="market-venues"] [data-testid="venue-trade"]'); b.scrollIntoView({ block: "center", inline: "center" }); const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= d.documentElement.clientWidth; })()`,
  );
  await panel(`d.querySelector('[data-testid="market-venues"] [data-testid="venue-trade"]').click()`);
  await wait(500);
  r.trade = await panel(
    `(() => { const a = [...d.querySelectorAll('[data-testid="trade-chooser"] a[data-wallet]')]; a[0]?.scrollIntoView({ block: "center" }); return { wallets: a.map((x) => x.dataset.wallet), https: a.length > 0 && a.every((x) => x.href.startsWith("https://")) }; })()`,
  );
  r.trade.onScreen = onScreen;
  await wait(400);
  shot("10d-markets-trade");
  const before = await js("window.__ocDesktop.selected()");
  // The chart's legend (open price of the last bar) changes once the pool's own bars are drawn.
  const legend = `document.body.innerText.match(/\\d+m\\s+O\\s+([\\d.,]+)/)?.[1] ?? ""`;
  const legendBefore = await js(legend);
  r.dexOpened = { pair: await panel(`(() => { const b = d.querySelector('[data-testid="market-venues"] [data-venue="dex"] [data-testid="venue-chart"]'); b.click(); return b.closest("tr").children[2].textContent; })()`) };
  await until(js, `window.__ocDesktop.selected() !== ${JSON.stringify(before)}`, 60_000);
  const after = await js("window.__ocDesktop.selected()");
  // The pool's candles come through the same GeckoTerminal queue as the overview's row charts.
  const chart = await js(`window.__ocDesktop.smokeChart(${JSON.stringify(after)})`);
  // GeckoTerminal paces its calls, so the chart can take half a minute after the overview's requests.
  // The legend empties on the switch, then shows the pool's own price (not a reformatted old one).
  const away = `((v) => v > 0 && Math.abs(v - ${Number(legendBefore.replace(/,/g, "")) || 0}) > ${(Number(legendBefore.replace(/,/g, "")) || 0) * 0.01})(Number((${legend}).replace(/,/g, "")))`;
  const drew = await until(js, away, 90_000);
  await wait(1500);
  Object.assign(r.dexOpened, { before, after, panels: await js("window.ocMobile.panelsOpen()"), candles: chart?.candles ?? 0, error: chart?.error, legendBefore, legend: await js(legend), drew });
  shot("10d-dex-pool-chart");
  await js(`window.ocMobile.openDashboard("portfolio")`);
  await until(js, `(document.querySelector('.oc-ovl iframe')?.contentDocument?.querySelectorAll('[data-testid="portfolio-not-connected"] button').length ?? 0) >= 5`, 30_000);
  r.portfolio = await panel(`[...d.querySelectorAll('[data-testid="portfolio-not-connected"] button')].length`);
  shot("11-portfolio");
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await wait(600);
  await js(`window.ocMobile.openDashboard("desk")`);
  await until(js, `document.querySelector('.oc-ovl iframe')?.contentDocument?.querySelector('[data-testid="desk-terminal"]')?.textContent.startsWith("Terminal running")`, 20_000);
  r.desk = await panel(`({ live: d.querySelector('[data-testid="desk-terminal"]')?.textContent.slice(0, 40), positions: d.querySelectorAll('[data-testid="desk-positions"] tbody tr').length })`);
  shot("12-desk");
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await wait(600);
  await js(`window.ocMobile.openKeys("okx")`);
  await wait(2500);
  r.keysPage = await panel(`({ tabs: d.querySelectorAll("nav button").length, active: d.querySelector("nav button.active span")?.textContent })`);
  // A made-up OKX key must reach OKX (signed natively) and come back rejected.
  r.okxCheck = await js(`window.ocDesktop.keys.save("okx", { apiKey: "00000000-0000-0000-0000-000000000000", secret: "${"C".repeat(32)}", passphrase: "smoke" })`);
  shot("13-keys");
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await wait(600);
  r.panelsClosed = (await js("window.ocMobile.panelsOpen()")) === 0;
  await js(`document.querySelector('[data-tab="more"]').click()`);
  await wait(800);
  shot("14-more");
  close();
  // The launcher icon, for the record: home screen, then the app list.
  adb("shell", "input", "keyevent", "KEYCODE_HOME");
  await wait(1200);
  adb("shell", "input", "swipe", "540", "1800", "540", "400", "300");
  await wait(1500);
  shot("15-launcher");

  const live = ["BINANCE", "OKX", "BYBIT", "KUCOIN", "COINBASE", "MEXC"].filter((p) => (r.listed?.[p] ?? 0) > 50);
  const checks = {
    rendered: r.rendered,
    exchanges: live.length >= 5,
    forexListed: (r.listed?.other ?? 0) > 20,
    livePrice: r.price?.live,
    keystore: r.keystore?.native && r.keystore.sealed && r.keystore.roundTrip,
    symbolSheet: r.symbolSheet > 20,
    backClosesSheet: r.backClosedSheet,
    drawTools: r.drawSheet > 5 && r.drawClosed && r.inAppAfterBacks,
    gate: r.gate?.kind === "order-gate-missing-key" && r.paper?.ok === true,
    positions: r.positionsShown && r.backToChart,
    alert: r.alertFired && r.notification && r.stayedInApp,
    dex: (r.dex?.candles ?? 0) > 0,
    gold: (r.gold?.candles ?? 0) > 0,
    markets: (r.markets ?? 0) > 20,
    marketCharts: (r.marketCharts?.day ?? 0) >= 8 && (r.marketCharts?.month ?? 0) >= 8,
    marketDex: r.marketVenues?.cex >= 3 && r.marketVenues.dex >= 1 && r.dexOpened?.panels === 0 && r.dexOpened.candles > 0 && r.dexOpened.drew && r.dexOpened.after !== r.dexOpened.before && /^[^:]+\/[^:]+$/.test(r.dexOpened.after ?? ""),
    marketTrade: Boolean(r.trade?.https && r.trade.onScreen && r.trade.wallets[0] === "browser" && r.trade.wallets.length >= 3),
    portfolio: (r.portfolio ?? 0) >= 5,
    desk: Boolean(r.desk?.live?.startsWith("Terminal running")),
    keysPage: r.keysPage?.tabs === 7 && r.keysPage.active === "OKX",
    okxSigned: /OKX/.test(r.okxCheck?.error ?? "") && r.okxCheck?.ok === false,
    panelsClosed: r.panelsClosed,
  };
  const ok = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({ device: `${model} API ${sdk}`, checks, details: r }, null, 2));
  console.log(`SMOKE ${ok ? "PASS" : "FAIL"} — screenshots in ${out}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("SMOKE FAIL", err);
  process.exit(1);
});
