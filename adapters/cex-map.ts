// Pure mapping for the six centralised exchanges: which pairs to list, tickers, candles and
// symbol names ("OKX:BTCUSDT"). Every exchange is read from its public REST API through the main
// process. No I/O here; tested in dev/tests/cex-map.test.ts.

import type { Candle, CandleRequest, Symbol } from "../upstream/src/adapter/types.ts";
import { aggregateCandles } from "./gecko-map.ts";

export type ExchangeId = "binance" | "okx" | "bybit" | "kucoin" | "coinbase" | "mexc";

export const EXCHANGE_IDS: ExchangeId[] = ["binance", "okx", "bybit", "kucoin", "coinbase", "mexc"];

/** Display label, symbol prefix and badge colour per exchange. */
export const EXCHANGE_INFO: Record<ExchangeId, { label: string; prefix: string; color: string }> = {
  binance: { label: "Binance", prefix: "BINANCE", color: "#f0b90b" },
  okx: { label: "OKX", prefix: "OKX", color: "#d1d4dc" },
  bybit: { label: "Bybit", prefix: "BYBIT", color: "#f7a600" },
  kucoin: { label: "KuCoin", prefix: "KUCOIN", color: "#23af91" },
  coinbase: { label: "Coinbase", prefix: "COINBASE", color: "#3773f5" },
  mexc: { label: "MEXC", prefix: "MEXC", color: "#2e7cf6" },
};

const PREFIX_TO_ID = new Map(EXCHANGE_IDS.map((id) => [EXCHANGE_INFO[id].prefix, id]));

/** Quotes worth listing: all are USD-valued, so the paper engine books P&L 1:1. */
export const USD_QUOTES = new Set(["USDT", "USDC", "USD"]);
/** Pairs listed per exchange, the busiest first. */
export const PAIRS_PER_EXCHANGE = 120;

/** A spot pair on one exchange, with the order rules needed to round real orders. */
export interface CexMarket {
  exchange: ExchangeId;
  /** Symbol name in the terminal, e.g. "OKX:BTCUSDT". */
  name: string;
  /** The exchange's own id, e.g. "BTC-USDT". */
  native: string;
  base: string;
  quote: string;
  tickSize: number;
  stepSize: number;
  minQty: number;
  minNotional: number;
  last: number;
  bid: number;
  ask: number;
  /** 24h change in percent. */
  change24h: number;
  /** 24h volume in the quote currency. */
  volume24h: number;
}

export interface CexTicker {
  bid: number;
  ask: number;
  last: number;
  change24h: number;
  volume24h: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** "OKX:BTCUSDT" for base BTC, quote USDT on OKX. */
export function cexSymbolName(exchange: ExchangeId, base: string, quote: string): string {
  return `${EXCHANGE_INFO[exchange].prefix}:${base}${quote}`;
}

/** The exchange a symbol name belongs to, or null for forex, DEX and demo symbols. */
export function exchangeOf(name: string): ExchangeId | null {
  const i = name.indexOf(":");
  return i > 0 ? (PREFIX_TO_ID.get(name.slice(0, i)) ?? null) : null;
}

/** The old six Binance symbols of 0.1–0.4 and their new names. */
export const LEGACY_BINANCE: Record<string, string> = {
  BTCUSD: "BINANCE:BTCUSDT",
  ETHUSD: "BINANCE:ETHUSDT",
  SOLUSD: "BINANCE:SOLUSDT",
  BNBUSD: "BINANCE:BNBUSDT",
  XRPUSD: "BINANCE:XRPUSDT",
  ADAUSD: "BINANCE:ADAUSDT",
};

/** Decimal places of a step such as 0.001 → 3 (works for 1e-8 too). */
export function stepDecimals(step: number): number {
  if (!(step > 0)) return 8;
  for (let d = 0; d < 12; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(Math.round(scaled) - scaled) < 1e-9 * Math.max(1, scaled)) return d;
  }
  return 12;
}

/** Round a quantity down to the step, as a plain decimal string the exchanges accept. */
export function roundDown(value: number, step: number): string {
  if (!(step > 0)) return String(value);
  const d = stepDecimals(step);
  const steps = Math.floor(value / step + 1e-9);
  return trimZeros((steps * step).toFixed(d));
}

/** "0.00100000" → "0.001", "77123.0" → "77123". */
const trimZeros = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

/** Round a price to the nearest tick, as a plain decimal string. */
export function roundTick(value: number, tick: number): string {
  if (!(tick > 0)) return String(value);
  const d = stepDecimals(tick);
  return trimZeros((Math.round(value / tick) * tick).toFixed(d));
}

// ── Market lists ──────────────────────────────────────────

/** URLs whose replies parseMarkets needs, fetched in this order. Binance and MEXC need a second step. */
export function marketListUrls(exchange: ExchangeId): string[] {
  switch (exchange) {
    case "binance":
      return ["https://api.binance.com/api/v3/ticker/24hr"];
    case "okx":
      return ["https://www.okx.com/api/v5/market/tickers?instType=SPOT", "https://www.okx.com/api/v5/public/instruments?instType=SPOT"];
    case "bybit":
      return ["https://api.bybit.com/v5/market/tickers?category=spot", "https://api.bybit.com/v5/market/instruments-info?category=spot"];
    case "kucoin":
      return ["https://api.kucoin.com/api/v1/market/allTickers", "https://api.kucoin.com/api/v2/symbols"];
    case "coinbase":
      return ["https://api.coinbase.com/api/v3/brokerage/market/products?product_type=SPOT"];
    case "mexc":
      return ["https://api.mexc.com/api/v3/ticker/24hr"];
  }
}

/** For Binance and MEXC: the exchangeInfo URL for the chosen pairs (tick and lot sizes). */
export function exchangeInfoUrl(exchange: ExchangeId, natives: string[]): string | null {
  if (exchange === "binance") return `https://api.binance.com/api/v3/exchangeInfo?symbols=${encodeURIComponent(JSON.stringify(natives))}`;
  if (exchange === "mexc") return `https://api.mexc.com/api/v3/exchangeInfo?symbols=${natives.join(",")}`;
  return null;
}

/** Quotes recognised when splitting Binance-style pairs, longest first so "BTCFDUSD" is BTC / FDUSD. */
const SPLIT_QUOTES = ["FDUSD", "TUSD", "BUSD", "USDE", "USDP", "USD1", "USDT", "USDC", "USD"];

/** Split a Binance-style pair ("BTCUSDT") on a known dollar quote; only USD_QUOTES pairs are listed later. */
export function splitPair(pair: string): { base: string; quote: string } | null {
  for (const quote of SPLIT_QUOTES) {
    if (pair.endsWith(quote) && pair.length > quote.length) return { base: pair.slice(0, -quote.length), quote };
  }
  return null;
}

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

function market(exchange: ExchangeId, native: string, base: string, quote: string, t: CexTicker, rules: Partial<CexMarket>): CexMarket {
  return {
    exchange,
    name: cexSymbolName(exchange, base, quote),
    native,
    base,
    quote,
    tickSize: rules.tickSize || 0,
    stepSize: rules.stepSize || 0,
    minQty: rules.minQty || 0,
    minNotional: rules.minNotional || 0,
    ...t,
  };
}

/** Bad or leveraged tokens that would crowd the list (BTCUP, ETH3L …). */
const SKIP_BASE = /^(.*(UP|DOWN|BULL|BEAR)|.*\d+[LS])$/;

function topN(list: CexMarket[], limit: number): CexMarket[] {
  const seen = new Set<string>();
  return list
    .filter((m) => USD_QUOTES.has(m.quote) && m.last > 0 && m.volume24h > 0 && !SKIP_BASE.test(m.base))
    .sort((a, b) => b.volume24h - a.volume24h)
    .filter((m) => (seen.has(m.name) ? false : (seen.add(m.name), true)))
    .slice(0, limit);
}

/**
 * First step for every exchange: the replies of marketListUrls → the busiest USD-quoted pairs.
 * Binance and MEXC rules (tick, step) are filled in afterwards by applyExchangeInfo.
 */
export function parseMarkets(exchange: ExchangeId, replies: unknown[], limit = PAIRS_PER_EXCHANGE): CexMarket[] {
  const [a, b] = replies as [Row | Row[] | null, Row | null];
  const out: CexMarket[] = [];
  switch (exchange) {
    case "binance":
    case "mexc": {
      for (const r of rows(a)) {
        const pair = String(r.symbol ?? "");
        const split = splitPair(pair);
        if (!split) continue;
        // Binance sends percent (1.5 = 1.5 %), MEXC a fraction (0.015).
        const pct = num(r.priceChangePercent) * (exchange === "mexc" ? 100 : 1);
        out.push(
          market(exchange, pair, split.base, split.quote, {
            bid: num(r.bidPrice),
            ask: num(r.askPrice),
            last: num(r.lastPrice),
            change24h: pct,
            volume24h: num(r.quoteVolume),
          }, {}),
        );
      }
      break;
    }
    case "okx": {
      const rules = new Map(rows((b as Row)?.data).map((i) => [String(i.instId), i]));
      for (const t of rows((a as Row)?.data)) {
        const id = String(t.instId ?? "");
        const r = rules.get(id);
        if (!r || r.state !== "live") continue;
        const last = num(t.last);
        const open = num(t.open24h);
        out.push(
          market("okx", id, String(r.baseCcy), String(r.quoteCcy), {
            bid: num(t.bidPx),
            ask: num(t.askPx),
            last,
            change24h: open > 0 ? ((last - open) / open) * 100 : 0,
            volume24h: num(t.volCcy24h),
          }, { tickSize: num(r.tickSz), stepSize: num(r.lotSz), minQty: num(r.minSz) }),
        );
      }
      break;
    }
    case "bybit": {
      const rules = new Map(rows(((b as Row)?.result as Row)?.list).map((i) => [String(i.symbol), i]));
      for (const t of rows(((a as Row)?.result as Row)?.list)) {
        const id = String(t.symbol ?? "");
        const r = rules.get(id);
        if (!r || r.status !== "Trading") continue;
        const lot = (r.lotSizeFilter ?? {}) as Row;
        out.push(
          market("bybit", id, String(r.baseCoin), String(r.quoteCoin), {
            bid: num(t.bid1Price),
            ask: num(t.ask1Price),
            last: num(t.lastPrice),
            change24h: num(t.price24hPcnt) * 100,
            volume24h: num(t.turnover24h),
          }, {
            tickSize: num((r.priceFilter as Row)?.tickSize),
            stepSize: num(lot.basePrecision),
            minQty: num(lot.minOrderQty),
            minNotional: num(lot.minOrderAmt),
          }),
        );
      }
      break;
    }
    case "kucoin": {
      const rules = new Map(rows((b as Row)?.data).map((i) => [String(i.symbol), i]));
      for (const t of rows(((a as Row)?.data as Row)?.ticker)) {
        const id = String(t.symbol ?? "");
        const r = rules.get(id);
        if (!r || r.enableTrading !== true) continue;
        out.push(
          market("kucoin", id, String(r.baseCurrency), String(r.quoteCurrency), {
            bid: num(t.buy),
            ask: num(t.sell),
            last: num(t.last),
            change24h: num(t.changeRate) * 100,
            volume24h: num(t.volValue),
          }, {
            tickSize: num(r.priceIncrement),
            stepSize: num(r.baseIncrement),
            minQty: num(r.baseMinSize),
            minNotional: num(r.minFunds),
          }),
        );
      }
      break;
    }
    case "coinbase": {
      for (const p of rows((a as Row)?.products)) {
        if (p.status !== "online" || p.trading_disabled === true || p.is_disabled === true || p.view_only === true) continue;
        const last = num(p.price);
        out.push(
          market("coinbase", String(p.product_id), String(p.base_currency_id), String(p.quote_currency_id), {
            bid: last,
            ask: last,
            last,
            change24h: num(p.price_percentage_change_24h),
            volume24h: num(p.approximate_quote_24h_volume) || num(p.volume_24h) * last,
          }, {
            tickSize: num(p.price_increment) || num(p.quote_increment),
            stepSize: num(p.base_increment),
            minQty: num(p.base_min_size),
            minNotional: num(p.quote_min_size),
          }),
        );
      }
      break;
    }
  }
  return topN(out, limit);
}

/** Binance and MEXC: fill tick, step and minimums from an exchangeInfo reply. */
export function applyExchangeInfo(exchange: ExchangeId, list: CexMarket[], info: unknown): CexMarket[] {
  const byPair = new Map(rows((info as Row | null)?.symbols).map((s) => [String(s.symbol), s]));
  return list
    .map((m) => {
      const s = byPair.get(m.native);
      if (!s) return null;
      if (exchange === "binance") {
        if (s.status !== "TRADING") return null;
        const f = new Map(rows(s.filters).map((x) => [String(x.filterType), x]));
        return {
          ...m,
          tickSize: num(f.get("PRICE_FILTER")?.tickSize),
          stepSize: num(f.get("LOT_SIZE")?.stepSize),
          minQty: num(f.get("LOT_SIZE")?.minQty),
          minNotional: num(f.get("NOTIONAL")?.minNotional ?? f.get("MIN_NOTIONAL")?.minNotional),
        };
      }
      if (String(s.status) !== "1" || s.isSpotTradingAllowed === false) return null;
      const step = num(s.baseSizePrecision);
      return {
        ...m,
        tickSize: 10 ** -num(s.quotePrecision),
        stepSize: step > 0 ? step : 10 ** -num(s.baseAssetPrecision),
        minQty: 0,
        minNotional: num(s.quoteAmountPrecision),
      };
    })
    .filter((m): m is CexMarket => m !== null);
}

/** A pair's tick size, guessed from its price when the exchange gave none. */
export function tickFor(m: Pick<CexMarket, "tickSize" | "last">): number {
  if (m.tickSize > 0) return m.tickSize;
  const magnitude = m.last > 0 ? Math.floor(Math.log10(m.last)) : 0;
  return 10 ** Math.min(-2, magnitude - 5);
}

/** The terminal symbol for a pair: quantity in base units (contract size 1), 1:10 margin. */
export function cexSymbol(m: CexMarket): Symbol {
  const tickSize = tickFor(m);
  return {
    id: m.name,
    name: m.name,
    displayName: `${m.base} / ${m.quote} · ${EXCHANGE_INFO[m.exchange].label}`,
    category: "CRYPTO",
    contractSize: 1,
    tickSize,
    tickValue: tickSize,
    marginPercent: 10,
    maxLeverage: 10,
    commission: 0,
    swapLong: 0,
    swapShort: 0,
    tradingHoursStart: null,
    tradingHoursEnd: null,
    isActive: true,
  };
}

// ── Tickers ───────────────────────────────────────────────

/** All-pairs ticker URL (bid/ask for every pair in one reply). */
export function allTickersUrl(exchange: ExchangeId): string {
  switch (exchange) {
    case "binance":
      return "https://api.binance.com/api/v3/ticker/bookTicker";
    case "mexc":
      return "https://api.mexc.com/api/v3/ticker/bookTicker";
    case "coinbase":
      return "https://api.coinbase.com/api/v3/brokerage/market/products?product_type=SPOT";
    default:
      return marketListUrls(exchange)[0]!;
  }
}

/** One pair's top of book. */
export function tickerUrl(exchange: ExchangeId, native: string): string {
  const id = encodeURIComponent(native);
  switch (exchange) {
    case "binance":
      return `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${id}`;
    case "okx":
      return `https://www.okx.com/api/v5/market/ticker?instId=${id}`;
    case "bybit":
      return `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${id}`;
    case "kucoin":
      return `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${id}`;
    case "coinbase":
      return `https://api.exchange.coinbase.com/products/${id}/ticker`;
    case "mexc":
      return `https://api.mexc.com/api/v3/ticker/bookTicker?symbol=${id}`;
  }
}

const bidAsk = (bid: unknown, ask: unknown, last?: unknown) => {
  const b = num(bid);
  const a = num(ask);
  const l = num(last);
  if (b > 0 && a > 0) return { bid: b, ask: Math.max(a, b) };
  if (l > 0) return { bid: l, ask: l };
  return null;
};

/** Ticker replies (single or all) → bid/ask per native id. */
export function parseTickers(exchange: ExchangeId, json: unknown): Map<string, { bid: number; ask: number }> {
  const out = new Map<string, { bid: number; ask: number }>();
  const put = (id: unknown, q: { bid: number; ask: number } | null) => {
    if (q && typeof id === "string") out.set(id, q);
  };
  const j = json as Row | Row[] | null;
  switch (exchange) {
    case "binance":
    case "mexc":
      for (const r of Array.isArray(j) ? j : j ? [j] : []) put(r.symbol, bidAsk(r.bidPrice, r.askPrice));
      break;
    case "okx":
      for (const r of rows((j as Row)?.data)) put(r.instId, bidAsk(r.bidPx, r.askPx, r.last));
      break;
    case "bybit":
      for (const r of rows(((j as Row)?.result as Row)?.list)) put(r.symbol, bidAsk(r.bid1Price, r.ask1Price, r.lastPrice));
      break;
    case "kucoin": {
      const data = (j as Row)?.data as Row | undefined;
      if (Array.isArray(data?.ticker)) for (const r of rows(data.ticker)) put(r.symbol, bidAsk(r.buy, r.sell, r.last));
      break;
    }
    case "coinbase":
      for (const p of rows((j as Row)?.products)) put(p.product_id, bidAsk(p.best_bid_price, p.best_ask_price, p.price));
      break;
  }
  return out;
}

/** Single-pair replies whose body has no pair id (KuCoin level1, Coinbase ticker). */
export function parseSingleTicker(exchange: ExchangeId, json: unknown): { bid: number; ask: number } | null {
  const j = json as Row | null;
  if (exchange === "kucoin") {
    const d = j?.data as Row | undefined;
    return d ? bidAsk(d.bestBid, d.bestAsk, d.price) : null;
  }
  if (exchange === "coinbase") return j ? bidAsk(j.bid, j.ask, j.price) : null;
  return null;
}

// ── Candles ───────────────────────────────────────────────

const TF_SEC: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14_400, "1d": 86_400, "1w": 604_800,
};
const WEEK_OFFSET = 345_600; // weeks start Monday 00:00 UTC

const INTERVALS: Record<Exclude<ExchangeId, "coinbase">, Record<string, string>> = {
  binance: { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w" },
  mexc: { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "60m", "4h": "4h", "1d": "1d", "1w": "1W" },
  okx: { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H", "1d": "1Dutc", "1w": "1Wutc" },
  bybit: { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "D", "1w": "W" },
  kucoin: { "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1hour", "4h": "4hour", "1d": "1day", "1w": "1week" },
};

/** Coinbase serves 1m, 5m, 15m, 1h, 6h and 1d; the rest are merged from smaller bars. */
const COINBASE_TF: Record<string, { granularity: number; merge: number }> = {
  "1m": { granularity: 60, merge: 1 },
  "5m": { granularity: 300, merge: 1 },
  "15m": { granularity: 900, merge: 1 },
  "30m": { granularity: 900, merge: 2 },
  "1h": { granularity: 3600, merge: 1 },
  "4h": { granularity: 3600, merge: 4 },
  "1d": { granularity: 86_400, merge: 1 },
  "1w": { granularity: 86_400, merge: 7 },
};

/** Bars per request each exchange allows. */
const MAX_BARS: Record<ExchangeId, number> = { binance: 1000, mexc: 1000, okx: 300, bybit: 1000, kucoin: 1500, coinbase: 300 };

/** The candle URL for a request, or null for an unknown timeframe. */
export function klineUrl(exchange: ExchangeId, native: string, request: CandleRequest, nowMs: number): string | null {
  const sec = TF_SEC[request.timeframe];
  if (!sec) return null;
  const id = encodeURIComponent(native);
  const want = Math.max(1, Math.floor(request.limit ?? 500));
  const endMs = request.toMs ?? nowMs;
  if (exchange === "coinbase") {
    const tf = COINBASE_TF[request.timeframe]!;
    const n = Math.min(MAX_BARS.coinbase, want * tf.merge);
    const endS = Math.floor(endMs / 1000) - 1;
    const startS = request.fromMs != null ? Math.floor(request.fromMs / 1000) : endS - n * tf.granularity;
    const from = Math.max(startS, endS - MAX_BARS.coinbase * tf.granularity + tf.granularity);
    return `https://api.exchange.coinbase.com/products/${id}/candles?granularity=${tf.granularity}&start=${from}&end=${endS}`;
  }
  const interval = INTERVALS[exchange][request.timeframe]!;
  const limit = Math.min(MAX_BARS[exchange], want);
  switch (exchange) {
    case "binance":
    case "mexc": {
      const host = exchange === "binance" ? "https://api.binance.com" : "https://api.mexc.com";
      const p = new URLSearchParams({ symbol: native, interval, limit: String(limit) });
      if (request.fromMs != null) p.set("startTime", String(Math.floor(request.fromMs)));
      // MEXC answers an end time without a start time with nothing, so give it the window's start.
      else if (exchange === "mexc" && request.toMs != null) p.set("startTime", String(Math.floor(request.toMs) - limit * sec * 1000));
      if (request.toMs != null) p.set("endTime", String(Math.floor(request.toMs) - 1));
      return `${host}/api/v3/klines?${p}`;
    }
    case "okx":
      // history-candles reaches far back; `after` returns bars older than the given time.
      return request.toMs != null
        ? `https://www.okx.com/api/v5/market/history-candles?instId=${id}&bar=${interval}&limit=${limit}&after=${Math.floor(request.toMs)}`
        : `https://www.okx.com/api/v5/market/candles?instId=${id}&bar=${interval}&limit=${limit}`;
    case "bybit": {
      const p = new URLSearchParams({ category: "spot", symbol: native, interval, limit: String(limit) });
      if (request.fromMs != null) p.set("start", String(Math.floor(request.fromMs)));
      if (request.toMs != null) p.set("end", String(Math.floor(request.toMs) - 1));
      return `https://api.bybit.com/v5/market/kline?${p}`;
    }
    case "kucoin": {
      // KuCoin weeks start on Thursday; build Monday weeks from days like the other exchanges.
      const weekly = request.timeframe === "1w";
      const step = weekly ? 86_400 : sec;
      const n = Math.min(MAX_BARS.kucoin, weekly ? limit * 7 : limit);
      const endS = Math.floor(endMs / 1000) - 1;
      const startS = request.fromMs != null ? Math.floor(request.fromMs / 1000) : endS - n * step;
      return `https://api.kucoin.com/api/v1/market/candles?type=${weekly ? "1day" : interval}&symbol=${id}&startAt=${startS}&endAt=${endS}`;
    }
  }
}

/** Candle reply → bars oldest first, inside the request window. */
export function parseKlines(exchange: ExchangeId, json: unknown, request: CandleRequest): Candle[] {
  const j = json as Row | unknown[] | null;
  let list: Candle[] = [];
  const bar = (t: number, o: unknown, h: unknown, l: unknown, c: unknown, v: unknown): Candle => ({
    time: t,
    open: num(o),
    high: num(h),
    low: num(l),
    close: num(c),
    volume: num(v),
  });
  switch (exchange) {
    case "binance":
    case "mexc":
      list = (Array.isArray(j) ? (j as unknown[][]) : []).map((k) => bar(Math.floor(num(k[0]) / 1000), k[1], k[2], k[3], k[4], k[5]));
      break;
    case "okx":
      list = (rows((j as Row)?.data) as unknown as unknown[][]).map((k) => bar(Math.floor(num(k[0]) / 1000), k[1], k[2], k[3], k[4], k[5]));
      break;
    case "bybit":
      list = (rows(((j as Row)?.result as Row)?.list) as unknown as unknown[][]).map((k) =>
        bar(Math.floor(num(k[0]) / 1000), k[1], k[2], k[3], k[4], k[5]),
      );
      break;
    case "kucoin":
      // KuCoin rows are [time, open, close, high, low, volume, turnover].
      list = (rows((j as Row)?.data) as unknown as unknown[][]).map((k) => bar(num(k[0]), k[1], k[3], k[4], k[2], k[5]));
      break;
    case "coinbase":
      // Coinbase rows are [time, low, high, open, close, volume].
      list = (Array.isArray(j) ? (j as unknown[][]) : []).map((k) => bar(num(k[0]), k[3], k[2], k[1], k[4], k[5]));
      break;
  }
  list = list.filter((c) => c.time > 0 && c.close > 0).sort((a, b) => a.time - b.time);
  const merged = exchange === "coinbase" ? (COINBASE_TF[request.timeframe]?.merge ?? 1) > 1 : exchange === "kucoin" && request.timeframe === "1w";
  if (merged) list = aggregateCandles(list, TF_SEC[request.timeframe]!, request.timeframe === "1w" ? WEEK_OFFSET : 0);
  const from = request.fromMs != null ? request.fromMs / 1000 : -Infinity;
  const to = request.toMs != null ? request.toMs / 1000 : Infinity;
  const out = list.filter((c, i) => c.time >= from && c.time < to && (i === 0 || c.time !== list[i - 1]!.time));
  return request.limit ? out.slice(-request.limit) : out;
}
