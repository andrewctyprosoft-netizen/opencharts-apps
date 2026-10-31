import assert from "node:assert/strict";
import { test } from "node:test";
import { changeBetween, compileCondition, inRange, parseAmount, sortRows, type Row } from "../../../adapters/market-filter.ts";
import { COIN_COLUMNS, changeOverDays, fxRows, pairRows, parseCoins, parseSpark, parseStocks } from "../../../adapters/markets-data.ts";
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
