import assert from "node:assert/strict";
import { test } from "node:test";
import { candleQuery, instrumentToSymbol, parseCandles, sortInstruments } from "../../../adapters/oanda-map.ts";

const inst = (name: string, type: string, displayPrecision: number, marginRate = "0.05") => ({
  name, type, displayName: name.replace("_", "/"), pipLocation: -4, displayPrecision, marginRate,
});

test("instrumentToSymbol: forex lots are 100,000 units, gold 100 oz", () => {
  const eur = instrumentToSymbol(inst("EUR_USD", "CURRENCY", 5, "0.0333"));
  assert.equal(eur.name, "EURUSD");
  assert.equal(eur.category, "FOREX");
  assert.equal(eur.contractSize, 100_000);
  assert.equal(eur.tickSize, 0.00001);
  assert.equal(eur.maxLeverage, 30);

  const gold = instrumentToSymbol(inst("XAU_USD", "METAL", 3));
  assert.equal(gold.name, "XAUUSD");
  assert.equal(gold.category, "METAL");
  assert.equal(gold.contractSize, 100);
  assert.equal(gold.tickSize, 0.001);

  assert.equal(instrumentToSymbol(inst("XAG_USD", "METAL", 5)).contractSize, 5000);
  assert.equal(instrumentToSymbol(inst("USD_JPY", "CURRENCY", 3)).tickSize, 0.001);
});

test("sortInstruments puts gold, silver and the majors first", () => {
  const sorted = sortInstruments([
    inst("AUD_CAD", "CURRENCY", 5), inst("EUR_USD", "CURRENCY", 5), inst("XAG_USD", "METAL", 5),
    inst("XAU_USD", "METAL", 3), inst("AUD_CHF", "CURRENCY", 5),
  ]).map((i) => i.name);
  assert.deepEqual(sorted, ["XAU_USD", "XAG_USD", "EUR_USD", "AUD_CAD", "AUD_CHF"]);
});

test("candleQuery: latest bars, scroll-back, and windows over OANDA's 5000 cap", () => {
  const latest = new URLSearchParams(candleQuery({ symbol: "XAUUSD", timeframe: "1h", limit: 300 })!);
  assert.equal(latest.get("granularity"), "H1");
  assert.equal(latest.get("price"), "M");
  assert.equal(latest.get("count"), "300");
  assert.equal(latest.get("alignmentTimezone"), "UTC");
  assert.equal(latest.get("from"), null);

  const back = new URLSearchParams(candleQuery({ symbol: "X", timeframe: "1m", limit: 9999, toMs: 1_700_000_000_000 })!);
  assert.equal(back.get("to"), "1699999999");
  assert.equal(back.get("count"), "5000");

  const win = new URLSearchParams(candleQuery({ symbol: "X", timeframe: "1d", fromMs: 0, toMs: 86_400_000 * 10 })!);
  assert.equal(win.get("from"), "0");
  assert.equal(win.get("to"), "863999");
  assert.equal(win.get("count"), null);

  const huge = new URLSearchParams(candleQuery({ symbol: "X", timeframe: "1m", fromMs: 0, toMs: 86_400_000 * 10 })!);
  assert.equal(huge.get("from"), null);
  assert.equal(huge.get("count"), "5000");

  assert.equal(candleQuery({ symbol: "X", timeframe: "2h" }), null);
});

test("parseCandles reads UNIX times and mid prices, sorted and windowed", () => {
  const json = {
    candles: [
      { time: "1793397600.000000000", volume: 12, complete: false, mid: { o: "3876.1", h: "3877.0", l: "3875.5", c: "3876.4" } },
      { time: "1793394000.000000000", volume: 30, complete: true, mid: { o: "3870.0", h: "3878.2", l: "3869.1", c: "3876.1" } },
      { time: "1793390400.000000000", volume: 5, complete: true },
    ],
  };
  const all = parseCandles(json, { symbol: "XAUUSD", timeframe: "1h" });
  assert.deepEqual(all, [
    { time: 1793394000, open: 3870, high: 3878.2, low: 3869.1, close: 3876.1, volume: 30 },
    { time: 1793397600, open: 3876.1, high: 3877, low: 3875.5, close: 3876.4, volume: 12 },
  ]);
  assert.equal(parseCandles(json, { symbol: "XAUUSD", timeframe: "1h", toMs: 1793397600_000 }).length, 1);
  assert.deepEqual(parseCandles({ errorMessage: "x" }, { symbol: "X", timeframe: "1h" }), []);
});
