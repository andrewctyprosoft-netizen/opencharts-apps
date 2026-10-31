// Pure OANDA v20 mapping: instruments → symbols, candle requests → query strings, candles → bars.
// No I/O here; tested in dev/tests/oanda-map.test.ts.

import type { Candle, CandleRequest, Symbol } from "../upstream/src/adapter/types.ts";
import type { OandaInstrument } from "./types.ts";

export const GRANULARITY: Record<string, { code: string; seconds: number }> = {
  "1m": { code: "M1", seconds: 60 },
  "5m": { code: "M5", seconds: 300 },
  "15m": { code: "M15", seconds: 900 },
  "30m": { code: "M30", seconds: 1800 },
  "1h": { code: "H1", seconds: 3600 },
  "4h": { code: "H4", seconds: 14_400 },
  "1d": { code: "D", seconds: 86_400 },
  "1w": { code: "W", seconds: 604_800 },
};

const MAX_COUNT = 5000;

/** "XAU_USD" → "XAUUSD", the naming the terminal's pip and TradingView helpers expect. */
export const toSymbolName = (instrument: string) => instrument.replace("_", "");

/**
 * USD per unit of a quote currency, from mid prices keyed by instrument ("USD_JPY", "GBP_USD").
 * 1 for USD itself, and when neither USD cross has a price yet.
 */
export function usdPerQuoteCurrency(quote: string | undefined, mid: ReadonlyMap<string, number>): number {
  if (!quote || quote === "USD") return 1;
  const usdQuote = mid.get(`USD_${quote}`);
  if (usdQuote) return 1 / usdQuote;
  return mid.get(`${quote}_USD`) ?? 1;
}

/** Ounces (or units) per lot for metals; forex lots are 100,000 units of the base currency. */
const METAL_LOT: Record<string, number> = { XAU: 100, XAG: 5000, XPT: 50, XPD: 100 };

/** Gold and silver first, then USD majors, then everything else A–Z. */
export function sortInstruments(list: OandaInstrument[]): OandaInstrument[] {
  const majors = ["XAU_USD", "XAG_USD", "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "USD_CAD", "NZD_USD"];
  const rank = (n: string) => {
    const i = majors.indexOf(n);
    return i < 0 ? majors.length : i;
  };
  return [...list].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

export function instrumentToSymbol(inst: OandaInstrument): Symbol {
  const [base = ""] = inst.name.split("_");
  const metal = inst.type === "METAL";
  const contractSize = metal ? (METAL_LOT[base] ?? 1) : 100_000;
  const decimals = Math.max(0, Math.min(10, Math.round(inst.displayPrecision)));
  const tickSize = Number((10 ** -decimals).toFixed(decimals));
  const marginRate = Number(inst.marginRate);
  return {
    id: `oanda:${inst.name}`,
    name: toSymbolName(inst.name),
    displayName: inst.displayName,
    category: metal ? "METAL" : "FOREX",
    contractSize,
    tickSize,
    tickValue: tickSize * contractSize,
    marginPercent: Number.isFinite(marginRate) && marginRate > 0 ? marginRate * 100 : 1,
    maxLeverage: Number.isFinite(marginRate) && marginRate > 0 ? Math.round(1 / marginRate) : 100,
    commission: 0,
    swapLong: 0,
    swapShort: 0,
    tradingHoursStart: null,
    tradingHoursEnd: null,
    isActive: true,
  };
}

/**
 * Query string for /v3/instruments/{name}/candles. Mid prices, bars aligned to UTC
 * (days at 00:00, weeks on Monday) like the crypto charts.
 * OANDA rejects `count` together with both `from` and `to`, and caps `count` at 5000.
 */
export function candleQuery(request: CandleRequest): string | null {
  const g = GRANULARITY[request.timeframe];
  if (!g) return null;
  const params = new URLSearchParams({
    price: "M",
    granularity: g.code,
    alignmentTimezone: "UTC",
    dailyAlignment: "0",
    weeklyAlignment: "Monday",
  });
  const limit = Math.min(MAX_COUNT, Math.max(1, Math.floor(request.limit ?? 500)));
  const toSec = request.toMs != null ? Math.floor(request.toMs / 1000) - 1 : null;
  const fromSec = request.fromMs != null ? Math.floor(request.fromMs / 1000) : null;
  if (fromSec != null && toSec != null) {
    const span = Math.ceil((toSec - fromSec) / g.seconds);
    if (span <= MAX_COUNT) {
      params.set("from", String(fromSec));
      params.set("to", String(toSec));
    } else {
      params.set("to", String(toSec));
      params.set("count", String(MAX_COUNT));
    }
  } else if (toSec != null) {
    params.set("to", String(toSec));
    params.set("count", String(limit));
  } else if (fromSec != null) {
    params.set("from", String(fromSec));
    params.set("count", String(limit));
  } else {
    params.set("count", String(limit));
  }
  return params.toString();
}

/** Candles response (UNIX datetime format) → bars oldest first, inside the request window. */
export function parseCandles(json: unknown, request: CandleRequest): Candle[] {
  const rows = (json as { candles?: unknown[] })?.candles;
  if (!Array.isArray(rows)) return [];
  const out: Candle[] = [];
  for (const row of rows as Array<{ time?: string; volume?: number; mid?: Record<string, string> }>) {
    const t = Math.floor(Number(row.time));
    const m = row.mid;
    if (!Number.isFinite(t) || !m) continue;
    const c = { time: t, open: Number(m.o), high: Number(m.h), low: Number(m.l), close: Number(m.c), volume: Number(row.volume) || 0 };
    if (![c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0)) continue;
    if (request.toMs != null && t * 1000 >= request.toMs) continue;
    if (request.fromMs != null && t * 1000 < request.fromMs) continue;
    out.push(c);
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
