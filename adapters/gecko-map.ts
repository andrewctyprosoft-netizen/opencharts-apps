// Pure GeckoTerminal mapping: search results → pools, OHLCV → candles, pools → tradable symbols.
// No I/O here; tested in dev/tests/gecko-map.test.ts.

import type { Candle, CandleRequest, Symbol } from "../upstream/src/adapter/types.ts";
import type { DexPool, SavedDexPool } from "./types.ts";

/**
 * GeckoTerminal serves minute (1, 5, 15), hour (1, 4, 12) and day (1) bars.
 * 30m and 1w are built by merging `merge` source bars into buckets of `bucketSec`.
 */
export const GECKO_TIMEFRAMES: Record<
  string,
  { period: "minute" | "hour" | "day"; aggregate: number; merge: number; bucketSec: number; offsetSec: number }
> = {
  "1m": { period: "minute", aggregate: 1, merge: 1, bucketSec: 60, offsetSec: 0 },
  "5m": { period: "minute", aggregate: 5, merge: 1, bucketSec: 300, offsetSec: 0 },
  "15m": { period: "minute", aggregate: 15, merge: 1, bucketSec: 900, offsetSec: 0 },
  "30m": { period: "minute", aggregate: 15, merge: 2, bucketSec: 1800, offsetSec: 0 },
  "1h": { period: "hour", aggregate: 1, merge: 1, bucketSec: 3600, offsetSec: 0 },
  "4h": { period: "hour", aggregate: 4, merge: 1, bucketSec: 14_400, offsetSec: 0 },
  "1d": { period: "day", aggregate: 1, merge: 1, bucketSec: 86_400, offsetSec: 0 },
  // Weeks start Monday 00:00 UTC, like Binance's; 1970-01-05 was a Monday.
  "1w": { period: "day", aggregate: 1, merge: 7, bucketSec: 604_800, offsetSec: 345_600 },
};

const MAX_BARS = 1000;

/** Merge candles (oldest first) into fixed buckets. Bars must already be sorted. */
export function aggregateCandles(candles: Candle[], bucketSec: number, offsetSec = 0): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const start = Math.floor((c.time - offsetSec) / bucketSec) * bucketSec + offsetSec;
    const last = out[out.length - 1];
    if (last && last.time === start) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ time: start, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    }
  }
  return out;
}

/** The OHLCV API path for a request, or null for an unsupported timeframe. */
export function ohlcvPath(pool: Pick<DexPool, "network" | "address">, request: CandleRequest): string | null {
  const tf = GECKO_TIMEFRAMES[request.timeframe];
  if (!tf) return null;
  const want = Math.max(1, Math.floor(request.limit ?? 500)) * tf.merge;
  const params = new URLSearchParams({
    aggregate: String(tf.aggregate),
    limit: String(Math.min(MAX_BARS, want)),
    currency: "usd",
    token: "base",
  });
  // before_timestamp is in seconds; the contract's toMs is exclusive, so step back one second.
  if (request.toMs != null) params.set("before_timestamp", String(Math.floor(request.toMs / 1000) - 1));
  return `/networks/${pool.network}/pools/${pool.address}/ohlcv/${tf.period}?${params}`;
}

/** OHLCV response (newest first, `[t, o, h, l, c, v]`) → candles oldest first, inside the request window. */
export function parseOhlcv(json: unknown, request: CandleRequest): Candle[] {
  const rows = (json as { data?: { attributes?: { ohlcv_list?: unknown[] } } })?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(rows)) return [];
  const tf = GECKO_TIMEFRAMES[request.timeframe];
  let candles: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [t, o, h, l, c, v] = row.map(Number) as [number, number, number, number, number, number];
    if (![t, o, h, l, c].every(Number.isFinite) || c <= 0) continue;
    candles.push({ time: t, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 });
  }
  candles.sort((a, b) => a.time - b.time);
  candles = candles.filter((c, i) => i === 0 || c.time !== candles[i - 1]!.time);
  if (tf && tf.merge > 1) candles = aggregateCandles(candles, tf.bucketSec, tf.offsetSec);
  if (request.toMs != null) candles = candles.filter((c) => c.time * 1000 < request.toMs!);
  if (request.fromMs != null) candles = candles.filter((c) => c.time * 1000 >= request.fromMs!);
  if (request.limit != null && candles.length > request.limit) candles = candles.slice(-request.limit);
  return candles;
}

interface JsonApiItem {
  id?: string;
  type?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id?: string } | null }>;
}

/** The network part of a pool id such as "polygon_pos_0xabc…" (networks may contain "_"). */
export function networkOf(poolId: string, address: string): string | null {
  const suffix = `_${address}`;
  if (!poolId.endsWith(suffix)) return null;
  const network = poolId.slice(0, -suffix.length);
  return /^[a-z0-9_-]+$/.test(network) ? network : null;
}

/** Search or multi-pool response (with `include=base_token,quote_token,dex`) → pools. */
export function parsePools(json: unknown): DexPool[] {
  const body = json as { data?: JsonApiItem[] | JsonApiItem; included?: JsonApiItem[] };
  const items = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
  const included = new Map((body?.included ?? []).map((i) => [`${i.type}:${i.id}`, i]));
  const symbolOf = (rel: { data?: { id?: string } | null } | undefined, fallback: string) => {
    const item = included.get(`token:${rel?.data?.id}`);
    return String(item?.attributes?.symbol ?? fallback);
  };

  const pools: DexPool[] = [];
  for (const item of items) {
    const a = item.attributes ?? {};
    const address = String(a.address ?? "");
    const network = item.id ? networkOf(item.id, address) : null;
    const price = Number(a.base_token_price_usd);
    if (!address || !network || !Number.isFinite(price) || price <= 0) continue;
    const [nameBase = "?", nameQuote = "?"] = String(a.name ?? "").split(" / ");
    const dexId = item.relationships?.dex?.data?.id ?? "";
    const dexName = included.get(`dex:${dexId}`)?.attributes?.name;
    pools.push({
      network,
      address,
      base: symbolOf(item.relationships?.base_token, nameBase),
      quote: symbolOf(item.relationships?.quote_token, nameQuote.split(" ")[0] ?? "?"),
      dex: String(dexName ?? dexId),
      priceUsd: price,
      liquidityUsd: Number(a.reserve_in_usd) || 0,
      volume24hUsd: Number((a.volume_usd as Record<string, unknown> | undefined)?.h24) || 0,
    });
  }
  return pools;
}

const cleanTicker = (s: string) => s.toUpperCase().replace(/[^A-Z0-9$]/g, "").slice(0, 10);

/** A short unique symbol name for a pool, e.g. "PEPE/WETH", then "PEPE/WETH.ETH", then "PEPE/WETH#A43F". */
export function dexSymbolName(pool: DexPool, taken: ReadonlySet<string>): string {
  const base = cleanTicker(pool.base) || pool.address.replace(/^0x/, "").slice(0, 6).toUpperCase();
  const quote = cleanTicker(pool.quote) || "USD";
  const plain = `${base}/${quote}`;
  const withNet = `${plain}.${pool.network.split("_")[0]!.toUpperCase().slice(0, 6)}`;
  const withAddr = `${plain}#${pool.address.replace(/^0x/, "").slice(0, 4).toUpperCase()}`;
  for (const name of [plain, withNet, withAddr]) if (!taken.has(name)) return name;
  for (let i = 2; ; i++) if (!taken.has(`${withAddr}${i}`)) return `${withAddr}${i}`;
}

/**
 * Tick size and lot size for a pool, fixed when the pool is added.
 * About six significant digits (at most 10 decimals, the terminal's limit), and
 * a lot worth roughly $100–$1,000 so the order ticket's 0.01–1 presets make sense.
 */
export function dexSizing(priceUsd: number): { tickSize: number; contractSize: number } {
  const magnitude = Math.floor(Math.log10(priceUsd));
  const decimals = Math.min(10, Math.max(2, 5 - magnitude));
  const contractSize = 10 ** Math.max(0, 2 - magnitude);
  return { tickSize: Number((10 ** -decimals).toFixed(decimals)), contractSize };
}

export function dexSymbol(saved: SavedDexPool): Symbol {
  return {
    id: `dex:${saved.network}:${saved.address}`,
    name: saved.name,
    displayName: `${saved.base} / ${saved.quote} · ${saved.dex} · ${saved.network}`,
    category: "DEX",
    contractSize: saved.contractSize,
    tickSize: saved.tickSize,
    tickValue: saved.tickSize * saved.contractSize,
    marginPercent: 1,
    maxLeverage: 100,
    commission: 0,
    swapLong: 0,
    swapShort: 0,
    tradingHoursStart: null,
    tradingHoursEnd: null,
    isActive: true,
  };
}
