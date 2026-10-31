import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateCandles,
  dexSizing,
  dexSymbol,
  dexSymbolName,
  networkOf,
  ohlcvPath,
  parseOhlcv,
  parsePools,
} from "../../../adapters/gecko-map.ts";

const bar = (time: number, o: number, h: number, l: number, c: number, v = 1) => ({ time, open: o, high: h, low: l, close: c, volume: v });

test("aggregateCandles merges 15m bars into 30m buckets", () => {
  const out = aggregateCandles([bar(0, 1, 2, 0.5, 1.5), bar(900, 1.5, 3, 1, 2), bar(1800, 2, 2.5, 1.8, 2.2)], 1800);
  assert.deepEqual(out, [bar(0, 1, 3, 0.5, 2, 2), bar(1800, 2, 2.5, 1.8, 2.2, 1)]);
});

test("aggregateCandles starts weeks on Monday 00:00 UTC", () => {
  const monday = Date.UTC(2026, 9, 26) / 1000; // Mon 26 Oct 2026
  const days = Array.from({ length: 8 }, (_, i) => bar(monday + i * 86_400, 10 + i, 11 + i, 9 + i, 10.5 + i));
  const weeks = aggregateCandles(days, 604_800, 345_600);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0]!.time, monday);
  assert.equal(weeks[0]!.close, 16.5);
  assert.equal(weeks[1]!.time, monday + 7 * 86_400);
});

test("ohlcvPath maps timeframes, caps the limit and steps toMs back a second", () => {
  const pool = { network: "eth", address: "0xabc" };
  assert.equal(
    ohlcvPath(pool, { symbol: "X", timeframe: "4h", limit: 200 }),
    "/networks/eth/pools/0xabc/ohlcv/hour?aggregate=4&limit=200&currency=usd&token=base",
  );
  const p30 = ohlcvPath(pool, { symbol: "X", timeframe: "30m", limit: 800, toMs: 1_700_000_000_000 })!;
  assert.match(p30, /ohlcv\/minute\?aggregate=15&limit=1000&/);
  assert.match(p30, /before_timestamp=1699999999/);
  assert.equal(ohlcvPath(pool, { symbol: "X", timeframe: "3m" }), null);
});

test("parseOhlcv sorts oldest first, drops duplicates and junk, honours the window", () => {
  const json = {
    data: {
      attributes: {
        ohlcv_list: [
          [180, 3, 3, 3, 3, 1],
          [120, 2, 2, 2, 2, 1],
          [120, 2, 2, 2, 2, 1],
          [60, 1, 1, 1, 1, 1],
          [0, 0, 0, 0, 0, 0],
          ["x"],
        ],
      },
    },
  };
  const all = parseOhlcv(json, { symbol: "X", timeframe: "1m" });
  assert.deepEqual(all.map((c) => c.time), [60, 120, 180]);
  const windowed = parseOhlcv(json, { symbol: "X", timeframe: "1m", fromMs: 120_000, toMs: 180_000 });
  assert.deepEqual(windowed.map((c) => c.time), [120]);
  assert.deepEqual(parseOhlcv({}, { symbol: "X", timeframe: "1m" }), []);
});

test("networkOf handles network ids with underscores", () => {
  assert.equal(networkOf("polygon_pos_0xabc", "0xabc"), "polygon_pos");
  assert.equal(networkOf("solana_7xKX", "7xKX"), "solana");
  assert.equal(networkOf("eth_0xabc", "0xdef"), null);
});

test("parsePools reads tickers and dex names from the included records", () => {
  const json = {
    data: [
      {
        id: "eth_0xa43f",
        type: "pool",
        attributes: {
          address: "0xa43f",
          name: "PEPE / WETH",
          base_token_price_usd: "0.00000497",
          reserve_in_usd: "12000000",
          volume_usd: { h24: "345000" },
        },
        relationships: {
          base_token: { data: { id: "eth_0x6982", type: "token" } },
          quote_token: { data: { id: "eth_0xc02a", type: "token" } },
          dex: { data: { id: "uniswap_v2", type: "dex" } },
        },
      },
      { id: "bsc_0x1", type: "pool", attributes: { address: "0x1", name: "A / B", base_token_price_usd: "0" } },
    ],
    included: [
      { id: "eth_0x6982", type: "token", attributes: { symbol: "PEPE" } },
      { id: "eth_0xc02a", type: "token", attributes: { symbol: "WETH" } },
      { id: "uniswap_v2", type: "dex", attributes: { name: "Uniswap V2" } },
    ],
  };
  assert.deepEqual(parsePools(json), [
    {
      network: "eth",
      address: "0xa43f",
      base: "PEPE",
      quote: "WETH",
      dex: "Uniswap V2",
      priceUsd: 0.00000497,
      liquidityUsd: 12_000_000,
      volume24hUsd: 345_000,
    },
  ]);
  // Multi-pool responses have no included records: fall back to the pool name.
  const bare = parsePools({ data: [{ ...json.data[0], relationships: {} }] });
  assert.equal(bare[0]!.base, "PEPE");
  assert.equal(bare[0]!.quote, "WETH");
});

test("dexSymbolName avoids names already taken", () => {
  const pool = { network: "polygon_pos", address: "0xa43fe169", base: "pepe", quote: "WETH", dex: "", priceUsd: 1, liquidityUsd: 0, volume24hUsd: 0 };
  assert.equal(dexSymbolName(pool, new Set()), "PEPE/WETH");
  assert.equal(dexSymbolName(pool, new Set(["PEPE/WETH"])), "PEPE/WETH.POLYGO");
  assert.equal(dexSymbolName(pool, new Set(["PEPE/WETH", "PEPE/WETH.POLYGO"])), "PEPE/WETH#A43F");
  assert.equal(
    dexSymbolName({ ...pool, base: "🐸" }, new Set()),
    "A43FE1/WETH",
  );
});

test("dexSizing keeps ~6 significant digits and a $100–$1,000 lot", () => {
  assert.deepEqual(dexSizing(0.00000497), { tickSize: 1e-10, contractSize: 1e8 });
  assert.deepEqual(dexSizing(0.5), { tickSize: 0.000001, contractSize: 1000 });
  assert.deepEqual(dexSizing(150), { tickSize: 0.001, contractSize: 1 });
  assert.deepEqual(dexSizing(2237), { tickSize: 0.01, contractSize: 1 });
  for (const p of [0.00000497, 0.5, 150, 0.0123]) {
    const { contractSize } = dexSizing(p);
    assert.ok(p * contractSize >= 1 && p * contractSize < 1000 * 10, `lot value for ${p}`);
  }
});

test("dexSymbol is a DEX-category symbol with the saved sizing", () => {
  const s = dexSymbol({
    network: "eth", address: "0xa43f", base: "PEPE", quote: "WETH", dex: "Uniswap V2",
    priceUsd: 0.00000497, liquidityUsd: 0, volume24hUsd: 0, name: "PEPE/WETH", tickSize: 1e-10, contractSize: 1e8,
  });
  assert.equal(s.category, "DEX");
  assert.equal(s.name, "PEPE/WETH");
  assert.equal(s.contractSize, 1e8);
  assert.equal(s.displayName, "PEPE / WETH · Uniswap V2 · eth");
});
