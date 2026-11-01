// Pure parsing for the market overview tabs: CoinGecko coins, exchange pairs, GeckoTerminal DEX pools, forex and metals
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

/**
 * The merged Crypto tab: every coin column, plus where it trades. Exchanges come from the six
 * exchanges' tickers (matched by ticker); DEX liquidity, volume and the CEX/DEX gap come from
 * DexScreener for the rows on screen (matched by contract address).
 */
export const CRYPTO_COLUMNS: ColumnDef[] = [
  ...COIN_COLUMNS,
  { key: "exchanges", label: "Exchanges", kind: "text", aliases: ["cex", "listed"] },
  { key: "dex_liq", label: "DEX liquidity", kind: "usd", aliases: ["liquidity", "liq"] },
  { key: "dex_vol", label: "DEX vol 24h", kind: "usd", aliases: ["dex_volume"] },
  { key: "gap", label: "CEX/DEX gap", kind: "pct", aliases: ["spread_dex"] },
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

// ── DEX pools (GeckoTerminal trending pools, every chain) ──

/** GeckoTerminal's trending pools across every network, 20 per page (pages 1–10). */
export function trendingPoolsPath(page: number): string {
  return `/networks/trending_pools?include=base_token,quote_token,dex,network&page=${page}`;
}

/** A pool's chart id for "open chart": `dex:<network>:<address>`. */
export const dexChartId = (network: string, address: string) => `dex:${network}:${address}`;

/** `dex:<network>:<address>` → its parts, or null for anything else. */
export function parseDexChartId(id: string): { network: string; address: string } | null {
  const m = /^dex:([a-z0-9_-]+):([A-Za-z0-9_-]{8,100})$/.exec(id);
  return m ? { network: m[1]!, address: m[2]! } : null;
}

/** Trending pools reply → rows ranked from `offset + 1`. The row id is the chart id. */
export function parseDexRows(json: unknown, offset: number, now = Date.now()): Row[] {
  type Item = { id?: string; type?: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id?: string } | null }> };
  const body = json as { data?: Item[]; included?: Item[] };
  const included = new Map((body?.included ?? []).map((i) => [`${i.type}:${i.id}`, i.attributes ?? {}]));
  const rows: Row[] = [];
  for (const item of Array.isArray(body?.data) ? body.data : []) {
    const a = item.attributes ?? {};
    const rel = item.relationships ?? {};
    const address = String(a.address ?? "");
    const network = String(rel.network?.data?.id ?? "");
    const price = n(a.base_token_price_usd);
    if (!parseDexChartId(dexChartId(network, address)) || price === null || price <= 0) continue;
    const [nameBase = "?", nameQuote = "?"] = String(a.name ?? "").split(" / ");
    const token = (r: { data?: { id?: string } | null } | undefined, fallback: string) =>
      String(included.get(`token:${r?.data?.id}`)?.symbol ?? fallback);
    const base = token(rel.base_token, nameBase);
    const baseId = String(rel.base_token?.data?.id ?? "");
    const quote = token(rel.quote_token, nameQuote.split(" ")[0] ?? "?");
    const chg = (a.price_change_percentage ?? {}) as Record<string, unknown>;
    const tx = ((a.transactions ?? {}) as Record<string, { buys?: unknown; sells?: unknown }>).h24 ?? {};
    const buys = n(tx.buys) ?? 0;
    const sells = n(tx.sells) ?? 0;
    const created = Date.parse(String(a.pool_created_at ?? ""));
    rows.push({
      id: dexChartId(network, address),
      rank: offset + rows.length + 1,
      pair: `${base}/${quote}`,
      base,
      quote,
      network: String(included.get(`network:${network}`)?.name ?? network),
      dex: String(included.get(`dex:${rel.dex?.data?.id}`)?.name ?? rel.dex?.data?.id ?? ""),
      price,
      change: null,
      chg_5m: n(chg.m5),
      chg_15m: n(chg.m15),
      chg_30m: n(chg.m30),
      chg_1h: n(chg.h1),
      chg_6h: n(chg.h6),
      chg_1d: n(chg.h24),
      chg_1w: null,
      chg_1m: null,
      chg_1y: null,
      volume: n((a.volume_usd as Record<string, unknown> | undefined)?.h24),
      liquidity: n(a.reserve_in_usd),
      mcap: n(a.market_cap_usd),
      fdv: n(a.fdv_usd),
      txns: buys + sells || null,
      buys: buys + sells ? Math.round((buys / (buys + sells)) * 1000) / 10 : null,
      age: Number.isFinite(created) ? Math.round(((now - created) / 86_400_000) * 10) / 10 : null,
      base_addr: baseId.startsWith(`${network}_`) ? baseId.slice(network.length + 1) : null,
      chart: dexChartId(network, address),
    });
  }
  return rows;
}

/**
 * A pool's day line before its 15-minute bars load: the prices 24 h, 6 h, 1 h, 30, 15 and 5 minutes
 * ago (from the row's changes) and now, joined in straight lines on a 15-minute grid so the
 * shape keeps its time scale. Empty without at least two known prices.
 */
export function dexDayLine(row: Row): number[] {
  const price = row.price;
  if (typeof price !== "number" || price <= 0) return [];
  const known: Array<[number, number]> = [];
  for (const [key, minutes] of [["chg_1d", 1440], ["chg_6h", 360], ["chg_1h", 60], ["chg_30m", 30], ["chg_15m", 15], ["chg_5m", 5]] as const) {
    const pct = row[key];
    if (typeof pct === "number" && pct > -100) known.push([-minutes, price / (1 + pct / 100)]);
  }
  known.push([0, price]);
  if (known.length < 2) return [];
  const line: number[] = [];
  for (let t = known[0]![0], k = 0; t <= 0; t += 15) {
    while (k < known.length - 2 && known[k + 1]![0] < t) k++;
    const [t0, p0] = known[k]!;
    const [t1, p1] = known[k + 1]!;
    line.push(t1 === t0 ? p1 : p0 + ((p1 - p0) * (t - t0)) / (t1 - t0));
  }
  if (line.at(-1) !== price) line.push(price);
  return line;
}

// ── Merged crypto view: where each coin trades ──

/**
 * Chains with DEX data, in the order a coin's tokens are looked up: CoinGecko platform id →
 * DexScreener chain id, GeckoTerminal network id (for charting a pool) and a label.
 */
export const DEX_CHAINS: Array<{ platform: string; ds: string; gt: string; label: string }> = [
  { platform: "ethereum", ds: "ethereum", gt: "eth", label: "Ethereum" },
  { platform: "solana", ds: "solana", gt: "solana", label: "Solana" },
  { platform: "binance-smart-chain", ds: "bsc", gt: "bsc", label: "BNB Chain" },
  { platform: "base", ds: "base", gt: "base", label: "Base" },
  { platform: "arbitrum-one", ds: "arbitrum", gt: "arbitrum", label: "Arbitrum" },
  { platform: "polygon-pos", ds: "polygon", gt: "polygon_pos", label: "Polygon" },
  { platform: "avalanche", ds: "avalanche", gt: "avax", label: "Avalanche" },
  { platform: "optimistic-ethereum", ds: "optimism", gt: "optimism", label: "Optimism" },
  { platform: "the-open-network", ds: "ton", gt: "ton", label: "TON" },
  { platform: "sui", ds: "sui", gt: "sui-network", label: "Sui" },
  { platform: "tron", ds: "tron", gt: "tron", label: "Tron" },
];

/** Native coins trade on DEXs as their wrapped token. */
const NATIVE_TOKENS: Record<string, Array<{ chain: string; address: string }>> = {
  bitcoin: [{ chain: "ethereum", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" }],
  ethereum: [{ chain: "ethereum", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" }],
  solana: [{ chain: "solana", address: "So11111111111111111111111111111111111111112" }],
  binancecoin: [{ chain: "bsc", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" }],
  "avalanche-2": [{ chain: "avalanche", address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7" }],
};

/** A coin's token on one chain: DexScreener chain id and contract address. */
export interface CoinToken {
  chain: string;
  address: string;
}

export const COINGECKO_LIST_URL = "https://api.coingecko.com/api/v3/coins/list?include_platform=true";

/**
 * CoinGecko's coin list → the tokens of the coins in `ids`, on the supported chains, in
 * DEX_CHAINS order (natives: their wrapped token). Coins on no supported chain are left out.
 */
export function coinTokens(json: unknown, ids: ReadonlySet<string>): Map<string, CoinToken[]> {
  const out = new Map<string, CoinToken[]>();
  for (const c of (Array.isArray(json) ? json : []) as Array<{ id?: unknown; platforms?: Record<string, unknown> }>) {
    const id = String(c.id ?? "");
    if (!ids.has(id)) continue;
    const tokens = NATIVE_TOKENS[id] ?? DEX_CHAINS.flatMap((ch) => {
      const address = c.platforms?.[ch.platform];
      return typeof address === "string" && address ? [{ chain: ch.ds, address }] : [];
    });
    if (tokens.length) out.set(id, tokens);
  }
  return out;
}

/** DexScreener: every pool of one token (up to 30, most liquid first). */
export function tokenPairsUrl(token: CoinToken): string {
  return `https://api.dexscreener.com/token-pairs/v1/${token.chain}/${encodeURIComponent(token.address)}`;
}

/** One DEX pool of a coin, as the expanded row lists it. */
export interface DexVenue {
  chain: string;
  dex: string;
  pair: string;
  price: number;
  liquidity: number;
  volume: number;
  change: number | null;
  /** `dex:<GeckoTerminal network>:<pool address>`, or null on a chain GeckoTerminal is not mapped for. */
  chart: string | null;
}

const sameAddress = (a: string, b: string) => (a.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b);

/** DexScreener token-pairs reply → the pools where the token is the base, most liquid first. */
export function parseTokenPairs(json: unknown, token: CoinToken): DexVenue[] {
  const chain = DEX_CHAINS.find((c) => c.ds === token.chain);
  const out: DexVenue[] = [];
  type Pair = {
    baseToken?: { address?: unknown; symbol?: unknown };
    quoteToken?: { symbol?: unknown };
    priceUsd?: unknown;
    pairAddress?: unknown;
    dexId?: unknown;
    labels?: unknown[];
    liquidity?: { usd?: unknown };
    volume?: { h24?: unknown };
    priceChange?: { h24?: unknown };
  };
  for (const p of (Array.isArray(json) ? json : []) as Pair[]) {
    if (!sameAddress(String(p?.baseToken?.address ?? ""), token.address)) continue;
    const price = n(p.priceUsd);
    if (price === null || price <= 0) continue;
    const pool = String(p.pairAddress ?? "");
    out.push({
      chain: chain?.label ?? token.chain,
      dex: String(p.dexId ?? "") + (Array.isArray(p.labels) && p.labels[0] ? ` ${p.labels[0]}` : ""),
      pair: `${String(p.baseToken?.symbol ?? "?")}/${String(p.quoteToken?.symbol ?? "?")}`,
      price,
      liquidity: n(p.liquidity?.usd) ?? 0,
      volume: n(p.volume?.h24) ?? 0,
      change: n(p.priceChange?.h24),
      chart: chain && pool ? dexChartId(chain.gt, pool) : null,
    });
  }
  return out.sort((a, b) => b.liquidity - a.liquidity);
}

/** A coin's DEX totals: summed liquidity and volume, and the most liquid pool's price. */
export function dexTotals(venues: DexVenue[]): { price: number | null; liquidity: number | null; volume: number | null } {
  if (!venues.length) return { price: null, liquidity: null, volume: null };
  const top = venues.reduce((a, b) => (b.liquidity > a.liquidity ? b : a));
  return {
    price: top.price,
    liquidity: venues.reduce((sum, v) => sum + v.liquidity, 0),
    volume: venues.reduce((sum, v) => sum + v.volume, 0),
  };
}

const EXCHANGE_CODES: Record<string, string> = { binance: "BIN", okx: "OKX", bybit: "BYB", kucoin: "KUC", coinbase: "CB", mexc: "MEXC" };

/** Exchange pairs by base ticker, busiest first. */
export function pairsByBase(markets: CexMarket[]): Map<string, CexMarket[]> {
  const out = new Map<string, CexMarket[]>();
  for (const m of markets) out.set(m.base, [...(out.get(m.base) ?? []), m]);
  for (const list of out.values()) list.sort((a, b) => b.volume24h - a.volume24h);
  return out;
}

/**
 * A coin row with its venues: the exchanges listing it, the busiest pair as its chart, and the
 * DEX totals with the gap between the DEX price and the busiest exchange pair, in percent.
 */
export function withVenues(row: Row, pairs: CexMarket[] | undefined, dex: DexVenue[] | undefined): Row {
  const listed = [...new Set((pairs ?? []).map((m) => m.exchange))];
  const totals = dex ? dexTotals(dex) : null;
  const cex = pairs?.[0]?.last ?? null;
  return {
    ...row,
    exchanges: listed.length ? listed.map((e) => EXCHANGE_CODES[e] ?? e).join(" ") : null,
    dex_liq: totals?.liquidity ?? null,
    dex_vol: totals?.volume ?? null,
    gap: cex && totals?.price ? ((totals.price - cex) / cex) * 100 : null,
    chart: pairs?.[0]?.name ?? dex?.find((v) => v.chart)?.chart ?? row.chart ?? null,
  };
}

/** A trending DEX pool whose token is not among the listed coins, as a coin row ("DEX only"). */
export function dexOnlyRow(pool: Row): Row {
  return {
    ...pool,
    rank: null,
    name: `${String(pool.base)} · ${String(pool.network)}`,
    symbol: pool.base ?? null,
    exchanges: "DEX only",
    dex_liq: pool.liquidity ?? null,
    dex_vol: pool.volume ?? null,
    gap: null,
  };
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
