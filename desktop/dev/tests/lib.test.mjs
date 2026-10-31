import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DATA_SOURCES,
  DEFAULT_SETTINGS,
  geckoUrl,
  isExternalUrl,
  normalizeSettings,
  pageUrl,
  parseOandaPriceLine,
  parseSwissquote,
  publicGetUrl,
  publicRpcUrl,
  resolveWebPath,
  splitStreamLines,
  swissquoteUrl,
  yahooChartUrl,
} from "../../electron/lib.js";

test("normalizeSettings keeps a valid OANDA block and drops a bad env", () => {
  assert.deepEqual(normalizeSettings({ oanda: { env: "live", tokenEnc: "abc" } }).oanda, { env: "live", tokenEnc: "abc" });
  assert.deepEqual(normalizeSettings({ oanda: { env: "prod", tokenEnc: 5 } }).oanda, { env: "practice", tokenEnc: "" });
});

test("splitStreamLines keeps the unfinished tail for the next chunk", () => {
  assert.deepEqual(splitStreamLines('{"a":1}\n\n{"b":'), { lines: ['{"a":1}'], rest: '{"b":' });
  assert.deepEqual(splitStreamLines('{"b":2}\r\n'), { lines: ['{"b":2}'], rest: "" });
});

test("parseOandaPriceLine reads prices and skips heartbeats", () => {
  const line = JSON.stringify({
    type: "PRICE", instrument: "XAU_USD", time: "1793397300.208000000",
    bids: [{ price: "3876.394", liquidity: 1 }], asks: [{ price: "3877.056", liquidity: 1 }],
  });
  assert.deepEqual(parseOandaPriceLine(line), { instrument: "XAU_USD", bid: 3876.394, ask: 3877.056, time: 1793397300208 });
  assert.equal(parseOandaPriceLine('{"type":"HEARTBEAT","time":"1793397300.0"}'), null);
  assert.equal(parseOandaPriceLine("not json"), null);
  assert.equal(parseOandaPriceLine('{"type":"PRICE","instrument":"X","bids":[],"asks":[]}'), null);
});

test("geckoUrl only allows GeckoTerminal pool and search paths", () => {
  assert.equal(geckoUrl("/search/pools?query=pepe"), "https://api.geckoterminal.com/api/v2/search/pools?query=pepe");
  assert.ok(geckoUrl("/networks/polygon_pos/pools/multi/0x1,0x2"));
  assert.ok(geckoUrl("/networks/eth/pools/0xabc/ohlcv/minute?aggregate=1"));
  assert.equal(geckoUrl("https://evil.example/"), null);
  assert.equal(geckoUrl("//evil.example/search/pools"), null);
  assert.equal(geckoUrl("/networks/eth/pools/../../x"), null);
  assert.equal(geckoUrl("/simple/networks/eth/token_price/0x1"), null);
  assert.equal(geckoUrl(42), null);
});

test("normalizeSettings falls back to defaults on junk", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings("x"), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ dataSource: "nope", bounds: { width: 10, height: 10 } }), DEFAULT_SETTINGS);
});

test("normalizeSettings keeps valid values", () => {
  const s = normalizeSettings({ dataSource: "demo", bounds: { x: 5.4, y: 7, width: 1000, height: 700 }, maximized: true });
  assert.deepEqual(s, {
    dataSource: "demo",
    bounds: { x: 5, y: 7, width: 1000, height: 700 },
    maximized: true,
    oanda: { env: "practice", tokenEnc: "" },
    exchanges: { binance: true, okx: true, bybit: true, kucoin: true, coinbase: true, mexc: true },
    keys: {},
  });
});

test("normalizeSettings does not mutate the defaults", () => {
  normalizeSettings({ bounds: { width: 2000, height: 1000 } }).bounds.width = 1;
  assert.equal(DEFAULT_SETTINGS.bounds.width, 1440);
});

test("pageUrl maps data sources to the terminal's adapter param", () => {
  const all = "binance,okx,bybit,kucoin,coinbase,mexc";
  assert.equal(pageUrl("live"), `app://opencharts/index.html?adapter=binance&ex=${all}`);
  assert.equal(pageUrl("demo"), `app://opencharts/index.html?adapter=demo&ex=${all}`);
  assert.equal(pageUrl("bogus", ["okx", "nope", "mexc"]), "app://opencharts/index.html?adapter=binance&ex=okx,mexc");
});

test("resolveWebPath stays inside the web root", () => {
  assert.equal(resolveWebPath("/"), "index.html");
  assert.equal(resolveWebPath("/assets/index-1.js"), "assets/index-1.js");
  assert.equal(resolveWebPath("/icons/icon%20a.png"), "icons/icon a.png");
  assert.equal(resolveWebPath("/../secret"), null);
  assert.equal(resolveWebPath("/a/%2e%2e/%2e%2e/x"), null);
  assert.equal(resolveWebPath("/a/..%5c..%5cx"), null);
  assert.equal(resolveWebPath("/C:/Windows/win.ini"), null);
  assert.equal(resolveWebPath("/%E0%A4%A"), null);
});

test("isExternalUrl only matches web and mail links", () => {
  assert.ok(isExternalUrl("https://www.tradingview.com/"));
  assert.ok(isExternalUrl("mailto:a@b.c"));
  assert.ok(!isExternalUrl("app://opencharts/index.html"));
  assert.ok(!isExternalUrl("file:///C:/x"));
});

test("swissquoteUrl and yahooChartUrl only build the allowed feed URLs", () => {
  assert.equal(swissquoteUrl("XAU_USD"), "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD");
  assert.equal(swissquoteUrl("XAU/USD"), null);
  assert.equal(swissquoteUrl("../x_USD"), null);
  assert.equal(yahooChartUrl("GC=F", "interval=1h&period1=1&period2=2"), "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1h&period1=1&period2=2");
  assert.equal(yahooChartUrl("EURUSD=X", "interval=1d"), "https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=1d");
  assert.equal(yahooChartUrl("AAPL", "interval=1d"), null);
  assert.equal(yahooChartUrl("EURUSD=X", "a=../b"), null);
  assert.equal(yahooChartUrl("EURUSD=X", "a=b c"), null);
});

test("parseSwissquote takes the tightest spread of the first platform", () => {
  const json = [
    {
      spreadProfilePrices: [
        { bid: 3876.394, ask: 3877.056 },
        { bid: 3876.473, ask: 3876.977 },
        { bid: 0, ask: 1 },
      ],
      ts: 1793397300208,
    },
    { spreadProfilePrices: [{ bid: 3876.5, ask: 3876.6 }], ts: 1 },
  ];
  assert.deepEqual(parseSwissquote(json), { bid: 3876.473, ask: 3876.977, time: 1793397300208 });
  assert.equal(parseSwissquote([]), null);
  assert.equal(parseSwissquote({ error: "x" }), null);
});

test("normalizeSettings keeps exchange switches and encrypted keys for known exchanges only", () => {
  const s = normalizeSettings({ exchanges: { okx: false, nope: false, bybit: "no" }, keys: { mexc: "enc", evil: "x", okx: 5 } });
  assert.equal(s.exchanges.okx, false);
  assert.equal(s.exchanges.bybit, true);
  assert.equal("nope" in s.exchanges, false);
  assert.deepEqual(s.keys, { mexc: "enc" });
  assert.equal(DATA_SOURCES.live.label, "Live prices");
});

test("publicGetUrl allows listed hosts and paths only", () => {
  assert.ok(publicGetUrl("https://www.okx.com/api/v5/market/tickers?instType=SPOT"));
  assert.ok(publicGetUrl("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd"));
  assert.equal(publicGetUrl("https://api.binance.com/api/v3/account"), null);
  assert.equal(publicGetUrl("https://api.coinbase.com/api/v3/brokerage/accounts"), null);
  assert.equal(publicGetUrl("http://api.binance.com/api/v3/klines"), null);
  assert.equal(publicGetUrl("https://evil.example/api/v3/klines"), null);
  assert.equal(publicGetUrl("https://user:pw@api.binance.com/api/v3/klines"), null);
  assert.equal(publicGetUrl("https://api.binance.com/api/v3/klines/../account"), null);
});

test("publicRpcUrl allows read-only calls on known chains", () => {
  assert.equal(publicRpcUrl("bsc", { method: "eth_getBalance" }), "https://bsc-rpc.publicnode.com");
  assert.ok(publicRpcUrl("solana", [{ method: "getBalance" }, { method: "getTokenAccountsByOwner" }]));
  assert.equal(publicRpcUrl("ethereum", { method: "eth_sendRawTransaction" }), null);
  assert.equal(publicRpcUrl("ethereum", [{ method: "eth_call" }, { method: "eth_sendTransaction" }]), null);
  assert.equal(publicRpcUrl("toString", { method: "eth_call" }), null);
});
