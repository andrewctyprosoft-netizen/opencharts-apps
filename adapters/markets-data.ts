// Pure parsing for the market overview tabs: CoinGecko coins, exchange pairs, forex and metals
// from Yahoo spark closes, and the world's largest companies from Yahoo's screener. Each row's
// `chg_1d`, `chg_1w`, `chg_1m`, `chg_1y` hold percent changes when the source reports them.
// Tested in dev/tests/markets-data.test.ts.

import { EXCHANGE_INFO, type CexMarket } from "./cex-map.ts";
import type { ColumnDef, Row } from "./market-filter.ts";

export type Period = "1d" | "1w" | "1m" | "1y" | "custom";
export const PERIODS: Array<{ id: Period; label: string; days: number }> = [
  { id: "1d", label: "Day", days: 1 },
  { id: "1w", label: "Week", days: 7 },
  { id: "1m", label: "Month", days: 30 },
  { id: "1y", label: "Year", days: 365 },
  { id: "custom", label: "Custom", days: 0 },
];

const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) ? x : null;
};

// ── Crypto coins (CoinGecko /coins/markets) ──

export const COIN_COLUMNS: ColumnDef[] = [
  { key: "rank", label: "#", kind: "num" },
  { key: "name", label: "Coin", kind: "text", aliases: ["coin"] },
  { key: "symbol", label: "Symbol", kind: "text", aliases: ["ticker"] },
  { key: "price", label: "Price", kind: "price" },
  { key: "change", label: "Change", kind: "pct", aliases: ["chg"] },
  { key: "chg_1h", label: "1h", kind: "pct" },
  { key: "chg_1d", label: "24h", kind: "pct", aliases: ["chg_24h", "day"] },
  { key: "chg_1w", label: "7d", kind: "pct", aliases: ["week"] },
  { key: "chg_1m", label: "30d", kind: "pct", aliases: ["month"] },
  { key: "chg_1y", label: "1y", kind: "pct", aliases: ["year"] },
  { key: "mcap", label: "Market cap", kind: "usd", aliases: ["marketcap", "cap"] },
  { key: "volume", label: "Volume 24h", kind: "usd", aliases: ["vol"] },
  { key: "vol_mcap", label: "Vol / Cap", kind: "num", aliases: ["turnover"] },
  { key: "supply", label: "Circulating", kind: "num", aliases: ["circulating"] },
  { key: "fdv", label: "FDV", kind: "usd" },
  { key: "ath_chg", label: "From ATH", kind: "pct", aliases: ["ath"] },
];

export function coingeckoUrl(page: number): string {
  return `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&price_change_percentage=1h,24h,7d,30d,1y&sparkline=true`;
}

export function parseCoins(json: unknown): Row[] {
  return ((Array.isArray(json) ? json : []) as Array<Record<string, unknown>>).map((c) => {
    const mcap = n(c.market_cap);
    const volume = n(c.total_volume);
    return {
      id: String(c.id ?? ""),
      rank: n(c.market_cap_rank),
      name: String(c.name ?? ""),
      symbol: String(c.symbol ?? "").toUpperCase(),
      price: n(c.current_price),
      change: null,
      chg_1h: n(c.price_change_percentage_1h_in_currency),
      chg_1d: n(c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h),
      chg_1w: n(c.price_change_percentage_7d_in_currency),
      chg_1m: n(c.price_change_percentage_30d_in_currency),
      chg_1y: n(c.price_change_percentage_1y_in_currency),
      mcap,
      volume,
      vol_mcap: mcap && volume ? volume / mcap : null,
      supply: n(c.circulating_supply),
      fdv: n(c.fully_diluted_valuation),
      ath_chg: n(c.ath_change_percentage),
      chart: `BINANCE:${String(c.symbol ?? "").toUpperCase()}USDT`,
    };
  });
}

// ── Exchange pairs ──

export const PAIR_COLUMNS: ColumnDef[] = [
  { key: "pair", label: "Pair", kind: "text", aliases: ["symbol"] },
  { key: "exchange", label: "Exchange", kind: "text", aliases: ["venue"] },
  { key: "base", label: "Base", kind: "text", aliases: ["coin"] },
  { key: "quote", label: "Quote", kind: "text" },
  { key: "price", label: "Price", kind: "price" },
  { key: "change", label: "Change", kind: "pct", aliases: ["chg"] },
  { key: "chg_1d", label: "24h", kind: "pct", aliases: ["day"] },
  { key: "volume", label: "Volume 24h", kind: "usd", aliases: ["vol"] },
  { key: "spread", label: "Spread %", kind: "num" },
];

export function pairRows(markets: CexMarket[]): Row[] {
  return markets.map((m) => ({
    id: m.name,
    pair: `${m.base}/${m.quote}`,
    exchange: EXCHANGE_INFO[m.exchange].label,
    base: m.base,
    quote: m.quote,
    price: m.last,
    change: null,
    chg_1d: m.change24h,
    chg_1w: null,
    chg_1m: null,
    chg_1y: null,
    volume: m.volume24h,
    spread: m.bid > 0 && m.ask > m.bid ? ((m.ask - m.bid) / ((m.ask + m.bid) / 2)) * 100 : null,
    chart: m.name,
  }));
}

// ── Forex and metals (Yahoo spark) ──

export const FX_COLUMNS: ColumnDef[] = [
  { key: "symbol", label: "Symbol", kind: "text", aliases: ["pair"] },
  { key: "name", label: "Name", kind: "text" },
  { key: "group", label: "Group", kind: "text", aliases: ["type"] },
  { key: "price", label: "Price", kind: "price" },
  { key: "change", label: "Change", kind: "pct", aliases: ["chg"] },
  { key: "chg_1d", label: "Day", kind: "pct" },
  { key: "chg_1w", label: "Week", kind: "pct" },
  { key: "chg_1m", label: "Month", kind: "pct" },
  { key: "chg_1y", label: "Year", kind: "pct" },
  { key: "high_1y", label: "52w high", kind: "price" },
  { key: "low_1y", label: "52w low", kind: "price" },
];

const MAJORS = new Set(["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"]);

/** Closes [[timeSec, close]] for every symbol in a Yahoo spark reply. */
export function parseSpark(json: unknown): Map<string, Array<[number, number]>> {
  const out = new Map<string, Array<[number, number]>>();
  for (const [sym, v] of Object.entries((json ?? {}) as Record<string, { timestamp?: number[]; close?: Array<number | null> }>)) {
    const ts = v?.timestamp ?? [];
    const closes = v?.close ?? [];
    const list: Array<[number, number]> = [];
    ts.forEach((t, i) => {
      const c = closes[i];
      if (typeof c === "number" && c > 0) list.push([t, c]);
    });
    if (list.length) out.set(sym, list);
  }
  return out;
}

/** Percent change from the close `days` ago (at or before) to the latest close. */
export function changeOverDays(closes: Array<[number, number]>, days: number): number | null {
  const last = closes[closes.length - 1];
  if (!last) return null;
  const target = last[0] - days * 86_400;
  let base: number | null = null;
  for (const [t, c] of closes) {
    if (t <= target) base = c;
    else break;
  }
  if (base === null) return null;
  return ((last[1] - base) / base) * 100;
}

export function fxRows(instruments: Array<{ name: string; displayName: string; type: string }>, spark: Map<string, Array<[number, number]>>, yahoo: (instrument: string) => string): Row[] {
  return instruments.map((i) => {
    const symbol = i.name.replace("_", "");
    const closes = spark.get(yahoo(i.name)) ?? [];
    const year = closes.filter(([t]) => t >= (closes.at(-1)?.[0] ?? 0) - 365 * 86_400).map(([, c]) => c);
    return {
      id: symbol,
      symbol,
      name: i.displayName,
      group: i.type === "METAL" ? "Metals" : MAJORS.has(symbol) ? "Majors" : "Crosses & exotics",
      price: closes.at(-1)?.[1] ?? null,
      change: null,
      chg_1d: changeOverDays(closes, 1),
      chg_1w: changeOverDays(closes, 7),
      chg_1m: changeOverDays(closes, 30),
      chg_1y: changeOverDays(closes, 365),
      high_1y: year.length ? Math.max(...year) : null,
      low_1y: year.length ? Math.min(...year) : null,
      chart: symbol,
    };
  });
}

// ── Stocks (Yahoo screener: largest market cap) ──

export const STOCK_COLUMNS: ColumnDef[] = [
  { key: "rank", label: "#", kind: "num" },
  { key: "symbol", label: "Symbol", kind: "text", aliases: ["ticker"] },
  { key: "name", label: "Company", kind: "text", aliases: ["company"] },
  { key: "price", label: "Price", kind: "price" },
  { key: "change", label: "Change", kind: "pct", aliases: ["chg"] },
  { key: "chg_1d", label: "Day", kind: "pct" },
  { key: "chg_1y", label: "52w", kind: "pct", aliases: ["year"] },
  { key: "mcap", label: "Market cap", kind: "usd", aliases: ["marketcap", "cap"] },
  { key: "volume", label: "Volume", kind: "num", aliases: ["vol"] },
  { key: "rel_volume", label: "Rel volume", kind: "num", aliases: ["relvol"] },
  { key: "pe", label: "P/E", kind: "num" },
  { key: "eps", label: "EPS", kind: "num" },
  { key: "div_yield", label: "Div yield %", kind: "num", aliases: ["dividend", "yield"] },
  { key: "rating", label: "Analysts", kind: "text", aliases: ["analyst"] },
  { key: "exchange", label: "Exchange", kind: "text" },
];

export function stocksUrl(start: number): string {
  return `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=largest_market_cap&count=250&start=${start}`;
}

export function parseStocks(json: unknown, offset = 0): Row[] {
  const quotes = ((json as { finance?: { result?: Array<{ quotes?: unknown[] }> } } | null)?.finance?.result?.[0]?.quotes ?? []) as Array<
    Record<string, unknown>
  >;
  return quotes.map((q, i) => {
    const volume = n(q.regularMarketVolume);
    const avg = n(q.averageDailyVolume3Month);
    return {
      id: String(q.symbol ?? ""),
      rank: offset + i + 1,
      symbol: String(q.symbol ?? ""),
      name: String(q.shortName ?? q.longName ?? q.displayName ?? ""),
      price: n(q.regularMarketPrice),
      change: null,
      chg_1d: n(q.regularMarketChangePercent),
      chg_1w: null,
      chg_1m: null,
      chg_1y: n(q.fiftyTwoWeekChangePercent),
      mcap: n(q.marketCap),
      volume,
      rel_volume: volume !== null && avg ? volume / avg : null,
      pe: n(q.trailingPE),
      eps: n(q.epsTrailingTwelveMonths),
      div_yield: n(q.dividendYield),
      rating: typeof q.averageAnalystRating === "string" ? q.averageAnalystRating : null,
      exchange: String(q.fullExchangeName ?? q.exchange ?? ""),
      chart: null,
    };
  });
}

/** Yahoo spark URL for up to 20 symbols. */
export function sparkUrl(symbols: string[], range = "2y", interval = "1d"): string {
  return `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${symbols.map(encodeURIComponent).join(",")}&range=${range}&interval=${interval}`;
}

// ── Row charts (the sparkline column) ──

/**
 * Intraday series per period: exchange bars for crypto, a Yahoo range for forex and stocks.
 * Year and custom charts use the daily closes the change column already loads.
 */
export const CHART_SPECS: Record<"1d" | "1w" | "1m", { bar: "15m" | "1h" | "4h"; bars: number; range: string; interval: string }> = {
  "1d": { bar: "15m", bars: 96, range: "1d", interval: "5m" },
  "1w": { bar: "1h", bars: 168, range: "5d", interval: "15m" },
  "1m": { bar: "4h", bars: 180, range: "1mo", interval: "1h" },
};

/** CoinGecko's `sparkline_in_7d` (hourly, oldest first) as [timeSec, price] per coin id. */
export function parseCoinSparks(json: unknown): Array<[string, Array<[number, number]>]> {
  return ((Array.isArray(json) ? json : []) as Array<Record<string, unknown>>).map((c) => {
    const prices = ((c.sparkline_in_7d as { price?: unknown[] } | undefined)?.price ?? []).filter(
      (p): p is number => typeof p === "number" && p > 0,
    );
    const updated = Date.parse(String(c.last_updated ?? ""));
    const end = Math.floor((Number.isFinite(updated) ? updated : Date.now()) / 1000);
    return [String(c.id ?? ""), prices.map((p, i): [number, number] => [end - (prices.length - 1 - i) * 3600, p])];
  });
}

/** Closes from `fromSec` to `toSec` (inclusive). */
export function closesBetween(closes: Array<[number, number]>, fromSec: number, toSec: number): Array<[number, number]> {
  return closes.filter(([t]) => t >= fromSec && t <= toSec);
}

/**
 * Line and area paths for a sparkline `width` x `height` (y grows down), at most one point per
 * pixel column. Empty for fewer than two values.
 */
export function sparkPaths(values: number[], width: number, height: number, pad = 2): { line: string; area: string } {
  if (values.length < 2) return { line: "", area: "" };
  const step = Math.max(1, values.length / Math.max(2, width));
  const pts: number[] = [];
  for (let i = 0; i < values.length; i += step) pts.push(values[Math.floor(i)]!);
  if (pts.at(-1) !== values.at(-1)) pts.push(values.at(-1)!);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of pts) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const span = hi - lo || 1;
  const x = (i: number) => (i * width) / (pts.length - 1);
  const y = (v: number) => (hi === lo ? height / 2 : pad + ((hi - v) / span) * (height - 2 * pad));
  const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return { line, area: `${line}L${width},${height}L0,${height}Z` };
}
