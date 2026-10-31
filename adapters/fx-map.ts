// Pure mapping for the keyless forex and metals feed: the instrument list, Yahoo Finance chart
// queries and bars. Live prices come from Swissquote; history from Yahoo (metals from futures).
// No I/O here; tested in dev/tests/fx-map.test.ts.

import type { Candle, CandleRequest } from "../upstream/src/adapter/types.ts";
import { aggregateCandles } from "./gecko-map.ts";
import type { OandaInstrument } from "./types.ts";

const METALS: Array<[string, string, number]> = [
  ["XAU_USD", "Gold", -2],
  ["XAG_USD", "Silver", -4],
  ["XPT_USD", "Platinum", -2],
  ["XPD_USD", "Palladium", -2],
];

const PAIRS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "USD_CAD", "NZD_USD",
  "EUR_GBP", "EUR_JPY", "GBP_JPY", "EUR_CHF", "EUR_AUD", "EUR_CAD", "EUR_NZD",
  "GBP_CHF", "GBP_AUD", "GBP_CAD", "GBP_NZD", "AUD_JPY", "AUD_NZD", "AUD_CAD", "AUD_CHF",
  "CAD_JPY", "CAD_CHF", "CHF_JPY", "NZD_JPY", "NZD_CAD", "NZD_CHF",
  "USD_SGD", "USD_HKD", "USD_CNH", "USD_MXN", "USD_ZAR", "USD_TRY", "USD_SEK", "USD_NOK",
  "USD_DKK", "USD_PLN", "USD_HUF", "USD_CZK", "EUR_SEK", "EUR_NOK", "EUR_PLN",
];

/** Pairs quoted in big numbers: pip at the 2nd decimal, like OANDA. */
const PIP_2 = new Set(["JPY", "HUF"]);

/**
 * Every instrument the keyless feed carries, in OANDA's shape so the OANDA symbol mapping applies.
 * Margin 1% (1:100), the paper engine's leverage.
 */
export const FX_INSTRUMENTS: OandaInstrument[] = [
  ...METALS.map(([name, displayName, pipLocation]) => ({
    name,
    type: "METAL",
    displayName,
    pipLocation,
    displayPrecision: 1 - pipLocation,
    marginRate: "0.01",
  })),
  ...PAIRS.map((name) => {
    const pipLocation = PIP_2.has(name.split("_")[1]!) ? -2 : -4;
    return {
      name,
      type: "CURRENCY",
      displayName: name.replace("_", "/"),
      pipLocation,
      displayPrecision: 1 - pipLocation,
      marginRate: "0.01",
    };
  }),
];

/** Yahoo has no spot metals, so their history comes from the COMEX/NYMEX front-month futures. */
const METAL_FUTURES: Record<string, string> = { XAU_USD: "GC=F", XAG_USD: "SI=F", XPT_USD: "PL=F", XPD_USD: "PA=F" };

/** Yahoo Finance symbol for an instrument: "EUR_USD" → "EURUSD=X", "XAU_USD" → "GC=F". */
export function yahooSymbol(instrument: string): string {
  return METAL_FUTURES[instrument] ?? `${instrument.replace("_", "")}=X`;
}

export const isFuturesBacked = (instrument: string) => instrument in METAL_FUTURES;

/**
 * Yahoo interval per terminal timeframe; 4h is merged from 1h bars. `maxAgeSec` is how far back
 * Yahoo keeps that interval, `maxSpanSec` the longest single request it accepts.
 */
export const YAHOO_TIMEFRAMES: Record<
  string,
  { interval: string; bucketSec: number; offsetSec: number; daily: boolean; maxAgeSec: number | null; maxSpanSec: number | null }
> = {
  "1m": { interval: "1m", bucketSec: 60, offsetSec: 0, daily: false, maxAgeSec: 29 * 86_400, maxSpanSec: 7 * 86_400 },
  "5m": { interval: "5m", bucketSec: 300, offsetSec: 0, daily: false, maxAgeSec: 59 * 86_400, maxSpanSec: null },
  "15m": { interval: "15m", bucketSec: 900, offsetSec: 0, daily: false, maxAgeSec: 59 * 86_400, maxSpanSec: null },
  "30m": { interval: "30m", bucketSec: 1800, offsetSec: 0, daily: false, maxAgeSec: 59 * 86_400, maxSpanSec: null },
  "1h": { interval: "60m", bucketSec: 3600, offsetSec: 0, daily: false, maxAgeSec: 729 * 86_400, maxSpanSec: null },
  "4h": { interval: "60m", bucketSec: 14_400, offsetSec: 0, daily: false, maxAgeSec: 729 * 86_400, maxSpanSec: null },
  "1d": { interval: "1d", bucketSec: 86_400, offsetSec: 0, daily: true, maxAgeSec: null, maxSpanSec: null },
  // Weeks start Monday 00:00 UTC, like the other feeds; 1970-01-05 was a Monday.
  "1w": { interval: "1wk", bucketSec: 604_800, offsetSec: 345_600, daily: true, maxAgeSec: null, maxSpanSec: null },
};

/** Room for a weekend (and a holiday) inside an intraday window, so Monday charts are not empty. */
const WEEKEND_PAD_SEC = 3.5 * 86_400;

/**
 * Query string for /v8/finance/chart/{symbol}, or null when the request is older than Yahoo keeps.
 * Markets close at weekends, so the window is about 1.45× the bars asked for, plus a weekend.
 */
export function yahooQuery(request: CandleRequest, nowSec: number): string | null {
  const tf = YAHOO_TIMEFRAMES[request.timeframe];
  if (!tf) return null;
  const to = request.toMs != null ? Math.floor(request.toMs / 1000) : nowSec;
  let from: number;
  if (request.fromMs != null) {
    from = Math.floor(request.fromMs / 1000);
  } else {
    const bars = Math.max(1, Math.floor(request.limit ?? 500));
    from = to - Math.ceil(bars * tf.bucketSec * 1.45) - (tf.daily ? 0 : WEEKEND_PAD_SEC);
  }
  if (tf.maxAgeSec != null) {
    const oldest = nowSec - tf.maxAgeSec;
    if (to <= oldest) return null;
    from = Math.max(from, oldest);
  }
  if (tf.maxSpanSec != null) from = Math.max(from, to - tf.maxSpanSec);
  if (from >= to) return null;
  return new URLSearchParams({ interval: tf.interval, period1: String(from), period2: String(to) }).toString();
}

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: { gmtoffset?: number; regularMarketPrice?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<Record<"open" | "high" | "low" | "close" | "volume", Array<number | null>>> };
    }> | null;
  };
}

/**
 * The newest close in a chart response (used to scale futures to spot). Yahoo's
 * meta.regularMarketPrice is the futures settlement, not the last trade, so it is only a fallback.
 */
export function yahooLastClose(json: unknown): number | null {
  const result = (json as YahooChart)?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  for (let i = closes.length - 1; i >= 0; i--) {
    const c = Number(closes[i]);
    if (closes[i] != null && Number.isFinite(c) && c > 0) return c;
  }
  const p = Number(result?.meta?.regularMarketPrice);
  return Number.isFinite(p) && p > 0 ? p : null;
}

/**
 * Yahoo chart response → candles oldest first, on UTC buckets, inside the request window.
 * `scale` multiplies prices (futures → spot); `decimals` rounds them afterwards.
 * Daily and weekly bars are stamped at local midnight of the exchange, so the exchange's
 * UTC offset is added before bucketing to keep each bar on its own date.
 */
export function parseYahooChart(json: unknown, request: CandleRequest, scale = 1, decimals = 10): Candle[] {
  const result = (json as YahooChart)?.chart?.result?.[0];
  const tf = YAHOO_TIMEFRAMES[request.timeframe];
  const times = result?.timestamp;
  const q = result?.indicators?.quote?.[0];
  if (!tf || !Array.isArray(times) || !q) return [];
  const shift = tf.daily ? Number(result?.meta?.gmtoffset) || 0 : 0;
  const round = (v: number) => Number((v * scale).toFixed(decimals));

  const rows: Candle[] = [];
  for (let i = 0; i < times.length; i++) {
    const [o, h, l, c] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]].map(Number);
    if (![o, h, l, c].every((v) => Number.isFinite(v) && v! > 0)) continue;
    rows.push({
      time: Number(times[i]) + shift,
      open: round(o!),
      high: round(h!),
      low: round(l!),
      close: round(c!),
      volume: Number(q.volume?.[i]) || 0,
    });
  }
  rows.sort((a, b) => a.time - b.time);
  let candles = aggregateCandles(rows, tf.bucketSec, tf.offsetSec);
  if (request.toMs != null) candles = candles.filter((c) => c.time * 1000 < request.toMs!);
  if (request.fromMs != null) candles = candles.filter((c) => c.time * 1000 >= request.fromMs!);
  if (request.limit != null && candles.length > request.limit) candles = candles.slice(-request.limit);
  return candles;
}
