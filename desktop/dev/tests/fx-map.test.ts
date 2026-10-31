import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FX_INSTRUMENTS,
  parseYahooChart,
  yahooLastClose,
  yahooQuery,
  yahooSymbol,
} from "../../../adapters/fx-map.ts";
import { instrumentToSymbol, usdPerQuoteCurrency } from "../../../adapters/oanda-map.ts";

const NOW = 1_793_400_000; // Friday 2026-10-30 22:40 UTC, just after the forex close

test("FX_INSTRUMENTS: gold and pairs map to terminal symbols with the right decimals", () => {
  const sym = (name: string) => instrumentToSymbol(FX_INSTRUMENTS.find((i) => i.name === name)!);
  assert.deepEqual([sym("XAU_USD").name, sym("XAU_USD").tickSize, sym("XAU_USD").contractSize], ["XAUUSD", 0.001, 100]);
  assert.equal(sym("XAG_USD").tickSize, 0.00001);
  assert.equal(sym("EUR_USD").tickSize, 0.00001);
  assert.equal(sym("USD_JPY").tickSize, 0.001);
  assert.equal(sym("EUR_USD").maxLeverage, 100);
  assert.equal(new Set(FX_INSTRUMENTS.map((i) => i.name)).size, FX_INSTRUMENTS.length);
});

test("yahooSymbol: pairs use =X, metals their futures", () => {
  assert.equal(yahooSymbol("EUR_USD"), "EURUSD=X");
  assert.equal(yahooSymbol("XAU_USD"), "GC=F");
  assert.equal(yahooSymbol("XPD_USD"), "PA=F");
});

test("yahooQuery: window covers a weekend and respects Yahoo's limits", () => {
  const q = new URLSearchParams(yahooQuery({ symbol: "EURUSD", timeframe: "1m", limit: 500 }, NOW)!);
  assert.equal(q.get("interval"), "1m");
  assert.equal(Number(q.get("period2")), NOW);
  const span = NOW - Number(q.get("period1"));
  assert.ok(span > 3 * 86_400 && span <= 7 * 86_400, `span ${span}`);

  const h4 = new URLSearchParams(yahooQuery({ symbol: "EURUSD", timeframe: "4h", limit: 100 }, NOW)!);
  assert.equal(h4.get("interval"), "60m");

  const back = new URLSearchParams(
    yahooQuery({ symbol: "EURUSD", timeframe: "1d", fromMs: 1_000_000_000_000, toMs: 1_100_000_000_000 }, NOW)!,
  );
  assert.deepEqual([back.get("period1"), back.get("period2")], ["1000000000", "1100000000"]);

  // 1m data is only kept 30 days: an older scroll-back asks for nothing.
  assert.equal(yahooQuery({ symbol: "EURUSD", timeframe: "1m", toMs: (NOW - 40 * 86_400) * 1000 }, NOW), null);
  assert.equal(yahooQuery({ symbol: "EURUSD", timeframe: "2h" }, NOW), null);
});

const chart = (timestamp: number[], rows: Array<[number | null, number | null, number | null, number | null]>, meta = {}) => ({
  chart: {
    result: [
      {
        meta: { regularMarketPrice: 3898.9, ...meta },
        timestamp,
        indicators: {
          quote: [
            {
              open: rows.map((r) => r[0]),
              high: rows.map((r) => r[1]),
              low: rows.map((r) => r[2]),
              close: rows.map((r) => r[3]),
              volume: rows.map(() => 0),
            },
          ],
        },
      },
    ],
  },
});

test("parseYahooChart: drops null bars, merges 1h into 4h, scales and rounds", () => {
  const t0 = 1_793_318_400; // 2026-10-30 00:00 UTC
  const json = chart(
    [t0, t0 + 3600, t0 + 7200, t0 + 10_800, t0 + 14_400],
    [
      [10, 12, 9, 11],
      [11, 13, 10, 12],
      [null, null, null, null],
      [12, 14, 11, 13],
      [13, 15, 12, 14],
    ],
  );
  const bars = parseYahooChart(json, { symbol: "XAUUSD", timeframe: "4h" }, 0.5, 3);
  assert.deepEqual(bars, [
    { time: t0, open: 5, high: 7, low: 4.5, close: 6.5, volume: 0 },
    { time: t0 + 14_400, open: 6.5, high: 7.5, low: 6, close: 7, volume: 0 },
  ]);
  assert.equal(yahooLastClose(json), 14);
  assert.equal(yahooLastClose(chart([1], [[null, null, null, null]])), 3898.9);
  assert.deepEqual(parseYahooChart({ chart: { result: null } }, { symbol: "X", timeframe: "1h" }), []);
});

test("parseYahooChart: daily bars stamped at exchange midnight land on their own UTC date", () => {
  // New York midnight is 04:00 UTC in summer (gmtoffset -14400); London's 23:00 UTC the day before (+3600).
  const ny = parseYahooChart(chart([1_793_332_800], [[1, 2, 0.5, 1.5]], { gmtoffset: -14_400 }), { symbol: "XAUUSD", timeframe: "1d" });
  const ldn = parseYahooChart(chart([1_793_318_400 - 3600], [[1, 2, 0.5, 1.5]], { gmtoffset: 3600 }), { symbol: "EURUSD", timeframe: "1d" });
  assert.equal(new Date(ny[0]!.time * 1000).toISOString(), "2026-10-30T00:00:00.000Z");
  assert.equal(new Date(ldn[0]!.time * 1000).toISOString(), "2026-10-30T00:00:00.000Z");
});

test("usdPerQuoteCurrency converts through either USD cross", () => {
  const mid = new Map([["USD_JPY", 150], ["GBP_USD", 1.3]]);
  assert.equal(usdPerQuoteCurrency("USD", mid), 1);
  assert.equal(usdPerQuoteCurrency("JPY", mid), 1 / 150);
  assert.equal(usdPerQuoteCurrency("GBP", mid), 1.3);
  assert.equal(usdPerQuoteCurrency("CHF", mid), 1);
});
