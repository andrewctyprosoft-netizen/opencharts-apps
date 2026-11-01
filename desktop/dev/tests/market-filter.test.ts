import assert from "node:assert/strict";
import { test } from "node:test";
import { changeBetween, compileCondition, inRange, parseAmount, sortRows, type Row } from "../../../adapters/market-filter.ts";
import {
  CHART_SPECS,
  COIN_COLUMNS,
  changeOverDays,
  closesBetween,
  coingeckoUrl,
  coinTokens,
  dexChartId,
  dexDayLine,
  dexOnlyRow,
  dexTotals,
  fxRows,
  pairRows,
  pairsByBase,
  parseCoinSparks,
  parseCoins,
  parseDexChartId,
  parseDexRows,
  parseSpark,
  parseStocks,
  sparkPaths,
  parseTokenPairs,
  sparkUrl,
  tokenPairsUrl,
  trendingPoolsPath,
  withVenues,
} from "../../../adapters/markets-data.ts";
import {
  applyJupiter,
  balanceOfData,
  evmBatch,
  fromHex,
  parseEthplorer,
  parseEvmBatch,
  parseMempool,
  parseSolanaBatch,
  priceFor,
  usdtPrices,
  walletKind,
} from "../../../adapters/wallets.ts";

const rows: Row[] = [
  { id: "btc", name: "Bitcoin", symbol: "BTC", price: 77000, change: 2.5, volume: 30e9, mcap: 1.5e12 },
  { id: "eth", name: "Ethereum", symbol: "ETH", price: 2240, change: -4, volume: 12e9, mcap: 270e9 },
  { id: "usdt", name: "Tether USD", symbol: "USDT", price: 1, change: 0, volume: 60e9, mcap: 180e9 },
  { id: "new", name: "Newcoin", symbol: "NEW", price: 0.5, change: null, volume: null, mcap: null },
];
const ids = (list: Row[]) => list.map((r) => r.id);

test("parseAmount reads suffixes, percent and separators", () => {
  assert.equal(parseAmount("1.5B"), 1.5e9);
  assert.equal(parseAmount("250k"), 250_000);
  assert.equal(parseAmount("-3%"), -3);
  assert.equal(parseAmount("$1,200"), 1200);
  assert.equal(parseAmount("2t"), 2e12);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(""), null);
});

test("inRange: open bounds, and rows without a value fail a set bound", () => {
  assert.deepEqual(ids(rows.filter((r) => inRange(r, "mcap", 200e9, null))), ["btc", "eth"]);
  assert.deepEqual(ids(rows.filter((r) => inRange(r, "change", null, 0))), ["eth", "usdt"]);
  assert.equal(rows.filter((r) => inRange(r, "volume", null, null)).length, 4);
});

test("sortRows sorts numbers and text both ways, empty cells last", () => {
  assert.deepEqual(ids(sortRows(rows, "change", "desc")), ["btc", "usdt", "eth", "new"]);
  assert.deepEqual(ids(sortRows(rows, "change", "asc")), ["eth", "usdt", "btc", "new"]);
  assert.deepEqual(ids(sortRows(rows, "name", "asc")), ["btc", "eth", "new", "usdt"]);
});

test("compileCondition: comparisons, text operators, and/or/not, brackets, aliases", () => {
  const run = (src: string) => ids(rows.filter(compileCondition(src, COIN_COLUMNS)));
  assert.deepEqual(run(""), ["btc", "eth", "usdt", "new"]);
  assert.deepEqual(run("change > 0"), ["btc"]);
  assert.deepEqual(run("vol >= 12B and marketcap < 1T"), ["eth", "usdt"]);
  assert.deepEqual(run('name contains "usd" or symbol = btc'), ["btc", "usdt"]);
  assert.deepEqual(run("not (change < 0) && price between 1 and 100000"), ["btc", "usdt"]);
  assert.deepEqual(run("symbol startswith E || symbol endswith W"), ["eth", "new"]);
  assert.deepEqual(run("change != 0"), ["btc", "eth", "new"]);
  assert.deepEqual(run("chg > -5%"), ["btc", "eth", "usdt"]);
});

test("compileCondition: readable errors", () => {
  assert.throws(() => compileCondition("speed > 5", COIN_COLUMNS), /Unknown column "speed"/);
  assert.throws(() => compileCondition("price >", COIN_COLUMNS), /value is missing/);
  assert.throws(() => compileCondition("price > 5 volume > 1", COIN_COLUMNS), /join conditions with and/);
  assert.throws(() => compileCondition("(price > 5", COIN_COLUMNS), /Missing \)/);
  assert.throws(() => compileCondition('name contains "x', COIN_COLUMNS), /Unclosed quote/);
});

test("period changes from daily closes", () => {
  const d = 86_400;
  const closes: Array<[number, number]> = [[0, 100], [d, 110], [7 * d, 120], [30 * d, 90], [31 * d, 99]];
  assert.ok(Math.abs(changeOverDays(closes, 1)! - 10) < 1e-9);
  // 30 days before day 31 is day 1 (close 110): 99 / 110 − 1.
  assert.ok(Math.abs(changeOverDays(closes, 30)! - -10) < 1e-9);
  assert.equal(changeOverDays(closes, 400), null);
  assert.ok(Math.abs(changeBetween(closes, d, 7 * d)! - (120 / 110 - 1) * 100) < 1e-9);
});

test("overview rows: CoinGecko, pairs, Yahoo spark and screener", () => {
  const [c] = parseCoins([
    { id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 77341, market_cap: 1.55e12, market_cap_rank: 1, total_volume: 3.1e10, price_change_percentage_24h_in_currency: -0.5, price_change_percentage_7d_in_currency: 3, price_change_percentage_1y_in_currency: 12, circulating_supply: 2e7 },
  ]);
  assert.deepEqual([c!.symbol, c!.rank, c!.chg_1d, c!.chg_1w, c!.chart], ["BTC", 1, -0.5, 3, "BINANCE:BTCUSDT"]);
  assert.ok(Math.abs((c!.vol_mcap as number) - 0.02) < 1e-9);

  const [p] = pairRows([{ exchange: "kucoin", name: "KUCOIN:BTCUSDT", native: "BTC-USDT", base: "BTC", quote: "USDT", tickSize: 0.1, stepSize: 1e-8, minQty: 0, minNotional: 0, last: 100, bid: 99, ask: 101, change24h: 1.2, volume24h: 5e8 }]);
  assert.deepEqual([p!.exchange, p!.pair, p!.spread], ["KuCoin", "BTC/USDT", 2]);

  const spark = parseSpark({ "EURUSD=X": { timestamp: [0, 86_400, 2 * 86_400], close: [1.1, null, 1.21] } });
  assert.deepEqual(spark.get("EURUSD=X"), [[0, 1.1], [2 * 86_400, 1.21]]);
  const [fx] = fxRows([{ name: "EUR_USD", displayName: "EUR/USD", type: "CURRENCY" }], spark, () => "EURUSD=X");
  assert.deepEqual([fx!.symbol, fx!.group, fx!.price], ["EURUSD", "Majors", 1.21]);

  const stocks = parseStocks({ finance: { result: [{ quotes: [{ symbol: "AAPL", shortName: "Apple Inc.", regularMarketPrice: 344.63, regularMarketChangePercent: -1.2, fiftyTwoWeekChangePercent: 27.4, marketCap: 5e12, regularMarketVolume: 6e7, averageDailyVolume3Month: 5e7, trailingPE: 40, averageAnalystRating: "2.0 - Buy", fullExchangeName: "NasdaqGS" }] }] } }, 250);
  assert.deepEqual([stocks[0]!.rank, stocks[0]!.chg_1y, stocks[0]!.rating, stocks[0]!.exchange], [251, 27.4, "2.0 - Buy", "NasdaqGS"]);
  assert.ok(Math.abs((stocks[0]!.rel_volume as number) - 1.2) < 1e-9);
});

test("row charts: CoinGecko week line, windows, intraday specs and paths", () => {
  assert.match(coingeckoUrl(1), /sparkline=true/);
  const [[id, closes]] = parseCoinSparks([{ id: "bitcoin", last_updated: "2026-11-01T00:00:00Z", sparkline_in_7d: { price: [1, null, 3] } }]);
  const end = Date.parse("2026-11-01T00:00:00Z") / 1000;
  assert.equal(id, "bitcoin");
  assert.deepEqual(closes, [[end - 3600, 1], [end, 3]]);
  assert.deepEqual(parseCoinSparks([{ id: "x" }]), [["x", []]]);

  assert.deepEqual(closesBetween([[1, 10], [2, 20], [3, 30]], 2, 3), [[2, 20], [3, 30]]);
  assert.match(sparkUrl(["AAPL"], CHART_SPECS["1d"].range, CHART_SPECS["1d"].interval), /range=1d&interval=5m$/);
  assert.deepEqual(Object.keys(CHART_SPECS), ["1d", "1w", "1m"]);

  // Highest value at the top edge (y = pad), lowest at the bottom; the area closes along the floor.
  const { line, area } = sparkPaths([1, 3, 2], 100, 20);
  assert.equal(line, "M0.0,18.0L50.0,2.0L100.0,10.0");
  assert.ok(area.startsWith(line) && area.endsWith("L100,20L0,20Z"));
  assert.deepEqual(sparkPaths([5], 100, 20), { line: "", area: "" });
  // Flat lines sit in the middle; long series keep at most about one point per pixel and their last value.
  assert.equal(sparkPaths([2, 2], 10, 20).line, "M0.0,10.0L10.0,10.0");
  const long = Array.from({ length: 1000 }, (_, i) => i);
  const pts = sparkPaths(long, 100, 20).line.split("L");
  assert.ok(pts.length <= 102);
  assert.equal(pts.at(-1), "100.0,2.0");
});

test("DEX rows: GeckoTerminal trending pools, chart ids", () => {
  const addr = "0x03bfe47801f43332c4f79608e6765ebe15d1e1d80a546833da4569b9f5b1d8f8";
  const reply = {
    data: [
      {
        id: `robinhood_${addr}`,
        type: "pool",
        attributes: {
          address: addr,
          name: "BTC / WETH 0.3%",
          base_token_price_usd: "0.0178",
          pool_created_at: "2026-10-25T00:00:00Z",
          fdv_usd: "17722685.64",
          market_cap_usd: null,
          reserve_in_usd: "397968.45",
          price_change_percentage: { m5: "-2.1", m15: "-5.6", m30: "-3.5", h1: "2.07", h6: "-28.1", h24: "-32.3" },
          transactions: { h24: { buys: 600, sells: 400 } },
          volume_usd: { h24: "4008121.6" },
        },
        relationships: {
          base_token: { data: { id: "robinhood_0xa5b5", type: "token" } },
          quote_token: { data: { id: "robinhood_0x0000", type: "token" } },
          network: { data: { id: "robinhood", type: "network" } },
          dex: { data: { id: "uniswap-v4-robinhood", type: "dex" } },
        },
      },
      { id: "eth_0xbad", type: "pool", attributes: { address: "0xbad", base_token_price_usd: "0" }, relationships: {} },
    ],
    included: [
      { id: "robinhood_0xa5b5", type: "token", attributes: { symbol: "BTC" } },
      { id: "robinhood", type: "network", attributes: { name: "Robinhood" } },
      { id: "uniswap-v4-robinhood", type: "dex", attributes: { name: "Uniswap V4" } },
    ],
  };
  const rows = parseDexRows(reply, 20, Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { ...rows[0] },
    {
      id: `dex:robinhood:${addr}`,
      rank: 21,
      pair: "BTC/WETH",
      base: "BTC",
      quote: "WETH",
      network: "Robinhood",
      dex: "Uniswap V4",
      price: 0.0178,
      change: null,
      chg_5m: -2.1,
      chg_15m: -5.6,
      chg_30m: -3.5,
      chg_1h: 2.07,
      chg_6h: -28.1,
      chg_1d: -32.3,
      chg_1w: null,
      chg_1m: null,
      chg_1y: null,
      volume: 4008121.6,
      liquidity: 397968.45,
      mcap: null,
      fdv: 17722685.64,
      txns: 1000,
      buys: 60,
      age: 7,
      base_addr: "0xa5b5",
      chart: `dex:robinhood:${addr}`,
    },
  );
  assert.deepEqual(parseDexRows(null, 0), []);
  // Day line: 24 h of 15-minute points through the known prices, ending at the price now.
  const day = dexDayLine({ price: 100, chg_1d: 100, chg_6h: 0, chg_1h: null });
  assert.equal(day.length, 97);
  assert.equal(day[0], 50);
  assert.equal(day[36], 50 + (50 * 36) / 72);
  assert.equal(day[72], 100);
  assert.equal(day.at(-1), 100);
  assert.deepEqual(dexDayLine({ price: 100, chg_1d: null }), []);
  assert.deepEqual(dexDayLine({ price: null, chg_1d: 5 }), []);
  assert.deepEqual(parseDexChartId(dexChartId("solana", "So1aNaPoo1Address1111111111111111111111111")), {
    network: "solana",
    address: "So1aNaPoo1Address1111111111111111111111111",
  });
  assert.equal(parseDexChartId("BINANCE:BTCUSDT"), null);
  assert.equal(parseDexChartId("dex:eth:../../x"), null);
  assert.equal(trendingPoolsPath(3), "/networks/trending_pools?include=base_token,quote_token,dex,network&page=3");
});

test("merged crypto: tokens per coin, DEX pools, venues and DEX-only rows", () => {
  const list = [
    { id: "pepe", platforms: { ethereum: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", "arbitrum-one": "0x25d8", celo: "0x1" } },
    { id: "solana", platforms: {} },
    { id: "bitcoin", platforms: {} },
    { id: "nochain", platforms: { celo: "0x2" } },
    { id: "unlisted", platforms: { ethereum: "0x3" } },
  ];
  const tokens = coinTokens(list, new Set(["pepe", "solana", "nochain"]));
  // Supported chains only, in DEX_CHAINS order; natives as their wrapped token.
  assert.deepEqual(tokens.get("pepe"), [
    { chain: "ethereum", address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933" },
    { chain: "arbitrum", address: "0x25d8" },
  ]);
  assert.equal(tokens.get("solana")![0]!.address, "So11111111111111111111111111111111111111112");
  assert.equal(tokens.has("nochain"), false);
  assert.equal(tokens.has("unlisted"), false);
  const pepe = tokens.get("pepe")![0]!;
  assert.equal(tokenPairsUrl(pepe), "https://api.dexscreener.com/token-pairs/v1/ethereum/0x6982508145454Ce325dDbE47a25d4ec3d2311933");

  const reply = [
    { chainId: "ethereum", dexId: "uniswap", labels: ["v3"], pairAddress: "0xP2", baseToken: { address: "0x6982508145454ce325ddbe47a25d4ec3d2311933", symbol: "PEPE" }, quoteToken: { symbol: "USDC" }, priceUsd: "0.0000051", liquidity: { usd: 100 }, volume: { h24: 10 }, priceChange: { h24: 2 } },
    { chainId: "ethereum", dexId: "uniswap", labels: ["v2"], pairAddress: "0xP1", baseToken: { address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", symbol: "PEPE" }, quoteToken: { symbol: "WETH" }, priceUsd: "0.0000050", liquidity: { usd: 900 }, volume: { h24: 90 }, priceChange: { h24: -1 } },
    // PEPE as the quote token, and a pool without a price: left out.
    { chainId: "ethereum", dexId: "uniswap", pairAddress: "0xP3", baseToken: { address: "0xother", symbol: "X" }, quoteToken: { symbol: "PEPE" }, priceUsd: "1", liquidity: { usd: 5000 } },
    { chainId: "ethereum", dexId: "uniswap", pairAddress: "0xP4", baseToken: { address: pepe.address, symbol: "PEPE" }, quoteToken: { symbol: "DAI" }, priceUsd: null },
  ];
  const venues = parseTokenPairs(reply, pepe);
  assert.deepEqual(venues.map((v) => [v.pair, v.dex, v.liquidity, v.chart]), [
    ["PEPE/WETH", "uniswap v2", 900, "dex:eth:0xP1"],
    ["PEPE/USDC", "uniswap v3", 100, "dex:eth:0xP2"],
  ]);
  assert.equal(venues[0]!.chain, "Ethereum");
  assert.deepEqual(dexTotals(venues), { price: 0.000005, liquidity: 1000, volume: 100 });
  assert.deepEqual(dexTotals([]), { price: null, liquidity: null, volume: null });

  const market = (exchange: string, last: number, volume24h: number) => ({ exchange, name: `${exchange.toUpperCase()}:PEPEUSDT`, native: "PEPEUSDT", base: "PEPE", quote: "USDT", tickSize: 1e-9, stepSize: 1, minQty: 0, minNotional: 0, last, bid: last, ask: last, change24h: 0, volume24h });
  const byBase = pairsByBase([market("okx", 0.0000049, 5e6), market("binance", 0.000005, 9e7)] as never);
  assert.deepEqual(byBase.get("PEPE")!.map((m) => m.exchange), ["binance", "okx"]);
  const row = withVenues({ id: "pepe", symbol: "PEPE", chart: "BINANCE:PEPEUSDT" }, byBase.get("PEPE"), venues);
  assert.equal(row.exchanges, "BIN OKX");
  assert.equal(row.dex_liq, 1000);
  assert.equal(row.dex_vol, 100);
  assert.equal(row.gap, 0);
  assert.equal(row.chart, "BINANCE:PEPEUSDT");
  // Not on an exchange: the chart is the most liquid DEX pool.
  const dexOnlyCoin = withVenues({ id: "x", symbol: "X", chart: "BINANCE:XUSDT" }, undefined, venues);
  assert.equal(dexOnlyCoin.exchanges, null);
  assert.equal(dexOnlyCoin.gap, null);
  assert.equal(dexOnlyCoin.chart, "dex:eth:0xP1");

  const only = dexOnlyRow({ id: "dex:solana:abc", base: "FOCO", network: "Solana", liquidity: 5e4, volume: 2e5, price: 1 });
  assert.equal(only.name, "FOCO · Solana");
  assert.equal(only.symbol, "FOCO");
  assert.equal(only.exchanges, "DEX only");
  assert.equal(only.rank, null);
  assert.equal(only.dex_liq, 5e4);
});

test("wallets: address kinds", () => {
  assert.equal(walletKind("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"), "evm");
  assert.equal(walletKind("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"), "bitcoin");
  assert.equal(walletKind("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"), "bitcoin");
  assert.equal(walletKind("5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"), "solana");
  assert.equal(walletKind("hello"), null);
});

test("wallets: EVM batch and parsing", () => {
  const addr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  assert.equal(balanceOfData(addr), "0x70a08231000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045");
  const batch = evmBatch("base", addr) as Array<{ id: number; method: string }>;
  assert.deepEqual(batch.map((b) => b.method), ["eth_getBalance", "eth_call", "eth_call", "eth_call"]);
  assert.equal(fromHex("0x50352604be1a0794", 18).toFixed(6), "5.779567");
  assert.equal(fromHex("0x256063c", 6), 39.192124);
  const held = parseEvmBatch("base", [{ id: 0, result: "0x2b6bcfc58a2e4800" }, { id: 1, result: "0x0" }, { id: 2, result: "0x" }, { id: 3, result: "0x5f5e100" }]);
  assert.deepEqual(held.map((h) => [h.chain, h.asset]), [["Base", "ETH"], ["Base", "cbBTC"]]);
  assert.equal(held[1]!.amount, 1);
});

test("wallets: Ethplorer, Solana, mempool and prices", () => {
  const eth = parseEthplorer({
    tokens: [
      { tokenInfo: { address: "0xa", symbol: "UNI", decimals: "18", price: { rate: 7, volume24h: 2e8, marketCapUsd: 4e9 } }, rawBalance: "2000000000000000000" },
      { tokenInfo: { address: "0xb", symbol: "SPAM", decimals: "18", price: false }, rawBalance: "1" },
      { tokenInfo: { address: "0xc", symbol: "WHITE", decimals: "0", price: { rate: 0.0000325, volume24h: 10, marketCapUsd: 2e7 } }, rawBalance: "10000000000" },
      { tokenInfo: { address: "0xd", symbol: "MOODENG", decimals: "0", price: { rate: 0.0000026, volume24h: 84_646, marketCapUsd: 1_060_148 } }, rawBalance: "30000000000" },
    ],
  });
  assert.deepEqual(eth.map((h) => [h.asset, h.amount, h.price]), [["UNI", 2, 7]]);
  assert.equal(eth.hidden, 2);
  const sol = parseSolanaBatch([
    { id: 0, result: { value: 2_500_000_000 } },
    { id: 1, result: { value: [{ account: { data: { parsed: { info: { mint: "MintAAAA1111", tokenAmount: { uiAmount: 3 } } } } } }] } },
    { id: 2, result: { value: [] } },
  ]);
  assert.deepEqual(sol.map((h) => [h.asset, h.amount]), [["SOL", 2.5], ["Mint…1111", 3]]);
  const named = applyJupiter(sol, { MintAAAA1111: { usdPrice: 0.5 } }, [{ id: "MintAAAA1111", symbol: "BONK" }]);
  assert.deepEqual([named[1]!.asset, named[1]!.price], ["BONK", 0.5]);
  assert.deepEqual(parseMempool({ chain_stats: { funded_txo_sum: 300_000_000, spent_txo_sum: 100_000_000 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } })[0]!.amount, 2);
  const prices = usdtPrices([{ symbol: "ETHUSDT", price: "2240" }, { symbol: "BTCUSDT", price: "77000" }, { symbol: "ETHBTC", price: "0.03" }]);
  assert.equal(priceFor("WETH", prices), 2240);
  assert.equal(priceFor("cbBTC", prices), 77000);
  assert.equal(priceFor("USDC", prices), 1);
  assert.equal(priceFor("XYZ", prices), null);
});
