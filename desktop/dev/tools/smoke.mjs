// Launches the real Electron app per scenario and checks the chart renders and prices move.
// Live mode also requires a pair list from every enabled exchange. Screenshots land in dev/out/.
//   live   crypto from all six exchanges
//   retry  live with OKX unreachable for the first 20 s: its pairs must arrive later through the retry
//   exchanges  live + one BTC pair charted per exchange (Binance, OKX, Bybit, KuCoin, Coinbase, MEXC)
//   gate   live + orders through the order router: key reminder, paper trade, cancel, keys window,
//          and a made-up OKX key that must reach a confirmation and a readable OKX rejection
//   alerts live + right-click › Set alert, the Alerts tab, an alert firing (log, Windows notification),
//          and File › Dashboard › Alerts & positions with a paper position closed from there
//   dash   live + File › Dashboard: portfolio with a public wallet address, market overview tabs
//   dex    live + search, add and chart a GeckoTerminal pool (real API)
//   fx     live + XAUUSD, EURUSD, USDJPY from the keyless feed (real Swissquote quotes, Yahoo history)
//   forex  live + XAUUSD, EURUSD, USDJPY from a local fake OANDA server (dev/tools/fake-oanda.mjs)
//   demo   offline demo
//   draw   live + picks every extra drawing tool from the left rail and places it with
//          real mouse input (clicks, double-click, press-drag), then checks each was saved
//   oanda  live + gold, silver and forex from the REAL OANDA service, using the token saved in the
//          installed app (%APPDATA%OpenChartssettings.json). Not in the default run. At the
//          weekend forex is closed, so candles are required but live prices are not.
// Run all: npm run smoke. One or more: npm run smoke -- forex dex

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import electron from "electron";
import { FAKE_TOKEN, startFakeOanda } from "./fake-oanda.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = path.join(root, "dev", "out");
const all = ["live", "retry", "exchanges", "gate", "alerts", "dash", "dex", "fx", "forex", "demo", "draw"];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : all;

/** Forex trades from Sunday ~22:00 to Friday ~21:00 UTC. */
function forexClosed(now = new Date()) {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  return day === 6 || (day === 5 && hour >= 21) || (day === 0 && hour < 22);
}

/** Every extra drawing tool except the throwaway zoom, from the terminal's tool catalog. */
async function drawTools() {
  const catalog = path.join(root, "..", "upstream", "src", "lib", "chart-plugins", "drawing-tools", "pro", "catalog.ts");
  const { PRO_TOOLS } = await import(pathToFileURL(catalog).href);
  // The built-in fib tool too: retracement and extension share one rail entry since 0.5.2.
  return [
    { tool: "fibonacci", label: "Fib retracement & extension", points: 2 },
    ...Object.entries(PRO_TOOLS)
      .filter(([tool]) => tool !== "zoom")
      .map(([tool, def]) => ({ tool, label: def.label, points: def.points })),
  ];
}

function runApp(env, timeoutMs = 150_000) {
  return new Promise((resolve) => {
    const child = spawn(electron, ["."], { cwd: root, env: { ...process.env, OC_SMOKE: out, ...env } });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, text });
    });
  });
}

let failed = 0;
for (const scenario of wanted) {
  const env = { OC_SMOKE_SOURCE: scenario === "demo" ? "demo" : "live" };
  if (scenario === "draw") env.OC_SMOKE_DRAW = JSON.stringify(await drawTools());
  let fake = null;
  if (scenario === "dex") env.OC_SMOKE_DEX = "pepe";
  if (scenario === "fx") env.OC_SMOKE_SYMBOLS = "XAUUSD,XAGUSD,EURUSD,USDJPY";
  if (scenario === "exchanges") env.OC_SMOKE_SYMBOLS = "BINANCE:BTCUSDT,OKX:BTCUSDT,BYBIT:ETHUSDT,KUCOIN:BTCUSDT,COINBASE:BTCUSD,MEXC:BTCUSDT";
  if (scenario === "gate") env.OC_SMOKE_GATE = "1";
  if (scenario === "dash") env.OC_SMOKE_DASH = "1";
  if (scenario === "alerts") env.OC_SMOKE_ALERTS = "1";
  if (scenario === "retry") env.OC_SMOKE_BLOCK_HOST = "www.okx.com:20000";
  if (scenario === "forex") {
    fake = await startFakeOanda();
    Object.assign(env, {
      OC_OANDA_REST: fake.url,
      OC_OANDA_STREAM: fake.url,
      OC_OANDA_TOKEN: FAKE_TOKEN,
      OC_SMOKE_SYMBOLS: "XAUUSD,EURUSD,USDJPY",
      OC_SMOKE_TOKEN: FAKE_TOKEN,
    });
  }
  if (scenario === "oanda") {
    const saved = path.join(process.env.APPDATA ?? "", "OpenCharts", "settings.json");
    const hasToken = fs.existsSync(saved) && Boolean(JSON.parse(fs.readFileSync(saved, "utf8")).oanda?.tokenEnc);
    if (!hasToken) {
      console.log(`[oanda] no saved token in ${saved}: add one in the app (Data › OANDA token…) first`);
      failed += 1;
      continue;
    }
    Object.assign(env, {
      OC_SMOKE_OANDA_FROM: saved,
      OC_SMOKE_SYMBOLS: "XAUUSD,XAGUSD,EURUSD,USDJPY",
      OC_SMOKE_TICKS_OPTIONAL: forexClosed() ? "1" : "0",
    });
  }
  const { code, text } = await runApp(env, ["draw", "dash"].includes(scenario) ? 640_000 : 150_000);
  fake?.close();
  const line = text.split(/\r?\n/).find((l) => l.startsWith("SMOKE "));
  console.log(`[${scenario}] ${line ?? `no result (exit ${code}) ${text.slice(-800)}`}`);
  if (fake) console.log(`[${scenario}] fake OANDA hits ${JSON.stringify(fake.hits)}`);
  if (code !== 0) failed += 1;
}
process.exit(failed ? 1 : 0);
