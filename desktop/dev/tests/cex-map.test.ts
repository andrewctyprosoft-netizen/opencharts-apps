import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyExchangeInfo,
  cexSymbol,
  exchangeOf,
  klineUrl,
  parseKlines,
  parseMarkets,
  parseSingleTicker,
  parseTickers,
  roundDown,
  roundTick,
  splitPair,
  stepDecimals,
} from "../../../adapters/cex-map.ts";
import { buildCexOrder, buildOandaOrder, oandaInstrument } from "../../../adapters/order-map.ts";
import { venueGroup, venueOf } from "../../../adapters/venues.ts";

const NOW = 1_793_440_000_000;

test("symbol names carry the exchange like TradingView", () => {
  assert.equal(exchangeOf("OKX:BTCUSDT"), "okx");
  assert.equal(exchangeOf("COINBASE:ETHUSD"), "coinbase");
  assert.equal(exchangeOf("XAUUSD"), null);
  assert.equal(exchangeOf("FOO:BAR"), null);
  assert.deepEqual(splitPair("PEPEUSDT"), { base: "PEPE", quote: "USDT" });
  assert.deepEqual(splitPair("BTCUSD"), { base: "BTC", quote: "USD" });
  assert.equal(splitPair("ETHBTC"), null);
  assert.deepEqual(splitPair("BTCFDUSD"), { base: "BTC", quote: "FDUSD" });
});

test("venues: exchanges, OANDA for forex and metals, DEX names", () => {
  assert.equal(venueOf({ name: "BYBIT:SOLUSDT", category: "CRYPTO" }).label, "Bybit");
  assert.equal(venueOf({ name: "XAUUSD", category: "METAL" }).id, "oanda");
  assert.equal(venueOf({ name: "EURUSD", category: "FOREX" }).label, "OANDA");
  const dex = venueOf({ name: "PEPEWETH", category: "DEX", displayName: "PEPE / WETH · uniswap_v3 · eth" });
  assert.deepEqual([dex.id, dex.label], [null, "DEX · uniswap_v3"]);
  assert.equal(venueGroup({ name: "PEPEWETH", category: "DEX" }), "DEX");
});

test("rounding to lot steps and ticks", () => {
  assert.equal(stepDecimals(0.00001), 5);
  assert.equal(stepDecimals(1e-8), 8);
  assert.equal(stepDecimals(1), 0);
  assert.equal(stepDecimals(0.5), 1);
  assert.equal(roundDown(0.123456789, 0.00001), "0.12345");
  assert.equal(roundDown(1234.9, 1), "1234");
  assert.equal(roundDown(0.3, 0.1), "0.3");
  assert.equal(roundTick(77123.456, 0.1), "77123.5");
  assert.equal(roundDown(0.001, 1e-8), "0.001");
  assert.equal(roundTick(77123.04, 0.1), "77123");
  assert.equal(roundTick(0.00001234567, 1e-8), "0.00001235");
});

test("parseMarkets: OKX joins tickers with instrument rules and keeps USD quotes", () => {
  const tickers = {
    data: [
      { instId: "BTC-USDT", last: "100", open24h: "80", bidPx: "99.9", askPx: "100.1", volCcy24h: "5000000" },
      { instId: "ETH-BTC", last: "0.03", open24h: "0.03", bidPx: "0.03", askPx: "0.03", volCcy24h: "9999999" },
      { instId: "DEAD-USDT", last: "1", open24h: "1", bidPx: "1", askPx: "1", volCcy24h: "1" },
    ],
  };
  const inst = {
    data: [
      { instId: "BTC-USDT", baseCcy: "BTC", quoteCcy: "USDT", tickSz: "0.1", lotSz: "0.00000001", minSz: "0.00001", state: "live" },
      { instId: "ETH-BTC", baseCcy: "ETH", quoteCcy: "BTC", tickSz: "0.00001", lotSz: "0.0001", minSz: "0.001", state: "live" },
      { instId: "DEAD-USDT", baseCcy: "DEAD", quoteCcy: "USDT", tickSz: "0.1", lotSz: "1", minSz: "1", state: "suspend" },
    ],
  };
  const list = parseMarkets("okx", [tickers, inst]);
  assert.equal(list.length, 1);
  assert.deepEqual([list[0]!.name, list[0]!.native, list[0]!.tickSize, list[0]!.change24h], ["OKX:BTCUSDT", "BTC-USDT", 0.1, 25]);
  const sym = cexSymbol(list[0]!);
  assert.deepEqual([sym.contractSize, sym.tickSize, sym.category], [1, 0.1, "CRYPTO"]);
  assert.equal(sym.displayName, "BTC / USDT · OKX");
});

test("parseMarkets: Binance by quote volume, then exchangeInfo filters; MEXC percent is a fraction", () => {
  const t = [
    { symbol: "BTCUSDT", lastPrice: "100", bidPrice: "99", askPrice: "101", priceChangePercent: "2.5", quoteVolume: "900" },
    { symbol: "ETHUSDT", lastPrice: "10", bidPrice: "9", askPrice: "11", priceChangePercent: "-1", quoteVolume: "1000" },
    { symbol: "BTCUPUSDT", lastPrice: "1", bidPrice: "1", askPrice: "1", priceChangePercent: "0", quoteVolume: "5000" },
  ];
  const list = parseMarkets("binance", [t]);
  assert.deepEqual(list.map((m) => m.name), ["BINANCE:ETHUSDT", "BINANCE:BTCUSDT"]);
  const info = {
    symbols: [
      { symbol: "BTCUSDT", status: "TRADING", filters: [{ filterType: "PRICE_FILTER", tickSize: "0.01" }, { filterType: "LOT_SIZE", stepSize: "0.00001", minQty: "0.00001" }, { filterType: "NOTIONAL", minNotional: "5" }] },
      { symbol: "ETHUSDT", status: "BREAK", filters: [] },
    ],
  };
  const ruled = applyExchangeInfo("binance", list, info);
  assert.equal(ruled.length, 1);
  assert.deepEqual([ruled[0]!.tickSize, ruled[0]!.stepSize, ruled[0]!.minNotional], [0.01, 0.00001, 5]);
  const mexc = parseMarkets("mexc", [[{ symbol: "PEPEUSDT", lastPrice: "0.00001", bidPrice: "0.00001", askPrice: "0.00001", priceChangePercent: "0.114", quoteVolume: "10" }]]);
  assert.ok(Math.abs(mexc[0]!.change24h - 11.4) < 1e-9);
  const ruledMexc = applyExchangeInfo("mexc", mexc, { symbols: [{ symbol: "PEPEUSDT", status: "1", quotePrecision: 9, baseSizePrecision: "0", baseAssetPrecision: 0, quoteAmountPrecision: "1" }] });
  assert.deepEqual([ruledMexc[0]!.stepSize, ruledMexc[0]!.minNotional], [1, 1]);
  assert.ok(Math.abs(ruledMexc[0]!.tickSize - 1e-9) < 1e-20);
});

test("parseMarkets: Bybit, KuCoin and Coinbase", () => {
  const bybit = parseMarkets("bybit", [
    { result: { list: [{ symbol: "BTCUSDT", bid1Price: "1", ask1Price: "2", lastPrice: "1.5", price24hPcnt: "-0.003", turnover24h: "100" }] } },
    { result: { list: [{ symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT", status: "Trading", lotSizeFilter: { basePrecision: "0.000001", minOrderQty: "0.000001", minOrderAmt: "5" }, priceFilter: { tickSize: "0.1" } }] } },
  ]);
  assert.deepEqual([bybit[0]!.name, bybit[0]!.minNotional, bybit[0]!.change24h], ["BYBIT:BTCUSDT", 5, -0.3]);
  const ku = parseMarkets("kucoin", [
    { data: { ticker: [{ symbol: "BTC-USDT", buy: "1", sell: "2", last: "1.5", changeRate: "0.01", volValue: "100" }] } },
    { data: [{ symbol: "BTC-USDT", baseCurrency: "BTC", quoteCurrency: "USDT", priceIncrement: "0.1", baseIncrement: "0.00000001", baseMinSize: "0.00001", minFunds: "0.1", enableTrading: true }] },
  ]);
  assert.deepEqual([ku[0]!.name, ku[0]!.native, ku[0]!.change24h], ["KUCOIN:BTCUSDT", "BTC-USDT", 1]);
  const cb = parseMarkets("coinbase", [
    {
      products: [
        { product_id: "BTC-USD", base_currency_id: "BTC", quote_currency_id: "USD", price: "77000", price_percentage_change_24h: "-0.26", approximate_quote_24h_volume: "648079486", price_increment: "0.01", base_increment: "0.00000001", base_min_size: "0.00000001", quote_min_size: "1", status: "online" },
        { product_id: "OLD-USD", base_currency_id: "OLD", quote_currency_id: "USD", price: "1", approximate_quote_24h_volume: "5", status: "delisted" },
      ],
    },
  ]);
  assert.deepEqual(cb.map((m) => m.name), ["COINBASE:BTCUSD"]);
});

test("tickers: all-pairs and single-pair replies", () => {
  assert.deepEqual(parseTickers("binance", [{ symbol: "BTCUSDT", bidPrice: "1", askPrice: "2" }]).get("BTCUSDT"), { bid: 1, ask: 2 });
  assert.deepEqual(parseTickers("binance", { symbol: "BTCUSDT", bidPrice: "1", askPrice: "2" }).get("BTCUSDT"), { bid: 1, ask: 2 });
  assert.deepEqual(parseTickers("okx", { data: [{ instId: "BTC-USDT", bidPx: "", askPx: "", last: "5" }] }).get("BTC-USDT"), { bid: 5, ask: 5 });
  assert.deepEqual(parseSingleTicker("kucoin", { data: { bestBid: "1.1", bestAsk: "1.2", price: "1.15" } }), { bid: 1.1, ask: 1.2 });
  assert.deepEqual(parseSingleTicker("coinbase", { bid: "77293.54", ask: "77293.55", price: "77293.54" }), { bid: 77293.54, ask: 77293.55 });
});

test("klines: URLs per exchange honour the window, rows parse oldest first", () => {
  const req = { symbol: "x", timeframe: "1h", limit: 3, toMs: NOW };
  assert.equal(klineUrl("binance", "BTCUSDT", req, NOW), `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3&endTime=${NOW - 1}`);
  assert.ok(klineUrl("mexc", "BTCUSDT", req, NOW)!.includes("interval=60m"));
  assert.ok(klineUrl("okx", "BTC-USDT", req, NOW)!.includes(`history-candles?instId=BTC-USDT&bar=1H&limit=3&after=${NOW}`));
  assert.ok(klineUrl("bybit", "BTCUSDT", req, NOW)!.includes("interval=60&limit=3"));
  assert.ok(klineUrl("kucoin", "BTC-USDT", req, NOW)!.includes(`type=1hour&symbol=BTC-USDT&startAt=${NOW / 1000 - 1 - 3 * 3600}&endAt=${NOW / 1000 - 1}`));
  assert.ok(klineUrl("coinbase", "BTC-USD", { ...req, timeframe: "4h" }, NOW)!.includes("granularity=3600"));
  assert.equal(klineUrl("binance", "BTCUSDT", { symbol: "x", timeframe: "2h" }, NOW), null);

  const t0 = 1_793_433_600;
  const okx = parseKlines("okx", { data: [[`${(t0 + 3600) * 1000}`, "2", "3", "1", "2.5", "10"], [`${t0 * 1000}`, "1", "2", "0.5", "2", "5"]] }, { symbol: "x", timeframe: "1h" });
  assert.deepEqual(okx.map((c) => c.time), [t0, t0 + 3600]);
  const ku = parseKlines("kucoin", { data: [[`${t0}`, "1", "2", "3", "0.5", "7", "9"]] }, { symbol: "x", timeframe: "1h" });
  assert.deepEqual(ku[0], { time: t0, open: 1, high: 3, low: 0.5, close: 2, volume: 7 });
  // Coinbase rows are [time, low, high, open, close, volume]; 4h merges four hours.
  const hours = [0, 1, 2, 3].map((k) => [t0 - 7200 + 3600 * k + 14_400 * 0, 1, 5 + k, 2, 3 + k, 1]);
  const cb = parseKlines("coinbase", [...hours].reverse(), { symbol: "x", timeframe: "4h" });
  assert.ok(cb.length >= 1);
  assert.equal(cb.reduce((s, c) => s + c.volume, 0), 4);
  const windowed = parseKlines("bybit", { result: { list: [[`${(t0 + 3600) * 1000}`, "1", "1", "1", "1", "1"], [`${t0 * 1000}`, "1", "1", "1", "1", "1"]] } }, { symbol: "x", timeframe: "1h", toMs: (t0 + 3600) * 1000 });
  assert.deepEqual(windowed.map((c) => c.time), [t0]);
});

test("order mapping: rounding, minimums, unsupported types", () => {
  const m = {
    exchange: "binance" as const, name: "BINANCE:BTCUSDT", native: "BTCUSDT", base: "BTC", quote: "USDT",
    tickSize: 0.01, stepSize: 0.00001, minQty: 0.00001, minNotional: 5, last: 77000, bid: 77000, ask: 77000.01, change24h: 0, volume24h: 1,
  };
  const base = { accountId: "a", symbol: "BINANCE:BTCUSDT", side: "BUY" as const, type: "MARKET" as const, quantity: 0.0012345 };
  const built = buildCexOrder(base, m, 77000);
  assert.deepEqual(built.order, { native: "BTCUSDT", side: "BUY", type: "MARKET", qty: "0.00123" });
  assert.equal(buildCexOrder({ ...base, type: "LIMIT", price: 76543.219 }, m, 77000).order.price, "76543.22");
  assert.throws(() => buildCexOrder({ ...base, quantity: 0.00005 }, m, 77000), /below the pair's minimum of 5 USDT/);
  assert.throws(() => buildCexOrder({ ...base, quantity: 0.000001 }, m, 77000), /smallest step/);
  assert.throws(() => buildCexOrder({ ...base, type: "STOP", stopPrice: 70000 }, m, 77000), /Stop orders/);
  assert.throws(() => buildCexOrder({ ...base, stopLoss: 70000 }, m, 77000), /stop loss/);
  const fx = buildOandaOrder({ ...base, symbol: "XAUUSD", side: "SELL", quantity: 0.05, takeProfit: 3800.1234 }, "XAU_USD", 100, 0.001, 3876);
  assert.deepEqual(fx.order, { native: "XAU_USD", side: "SELL", type: "MARKET", qty: "5", takeProfit: "3800.123" });
  assert.throws(() => buildOandaOrder({ ...base, quantity: 0.001 }, "XAU_USD", 100, 0.001, 1), /less than one/);
  assert.equal(oandaInstrument("EURUSD"), "EUR_USD");
  assert.equal(oandaInstrument("OKX:BTCUSDT"), null);
});
