// Live prices from the centralised exchanges the user enabled (Data › Live prices). Each lists
// its busiest USD-quoted spot pairs; charted pairs refresh every second, the rest every 15 s.
// All requests go through the main process (window.ocDesktop.web), which limits the hosts.

import type { Candle, CandleRequest, ConnectionState, MarketEvent, Quote, Symbol } from "../upstream/src/adapter/types.ts";
import {
  EXCHANGE_INFO,
  type CexMarket,
  type ExchangeId,
  allTickersUrl,
  applyExchangeInfo,
  cexSymbol,
  exchangeInfoUrl,
  exchangeOf,
  klineUrl,
  marketListUrls,
  parseKlines,
  parseMarkets,
  parseSingleTicker,
  parseTickers,
  tickerUrl,
} from "./cex-map.ts";
import type { DesktopBridge } from "./types.ts";

const FAST_MS = 1_000;
const SLOW_MS = 15_000;
const LOAD_TIMEOUT_MS = 12_000;
/** Background retries for an exchange that failed at start: after 15 s, 1 min and 5 min. */
const RETRY_MS = [15_000, 60_000, 300_000];

interface Store {
  get(): string | null;
  set(value: string): void;
}

export function createCexSource(bridge: DesktopBridge, enabled: ExchangeId[], cache: Store) {
  const markets = new Map<string, CexMarket>(); // by symbol name
  const byNative = new Map<string, CexMarket>(); // by "exchange|native"
  const handlers = new Set<(e: MarketEvent) => void>();
  const stateListeners = new Set<(s: ConnectionState) => void>();
  const last = new Map<string, { bid: number; ask: number }>();
  const failed: string[] = [];
  let state: ConnectionState = "disconnected";
  let interest: string[] = [];
  let fastTimer: ReturnType<typeof setTimeout> | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let lastOk = 0;

  const setState = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    for (const l of [...stateListeners]) l(next);
  };

  async function getJson(url: string): Promise<unknown> {
    const { status, body } = await bridge.web.get(url);
    if (status >= 400) throw new Error(`${new URL(url).hostname} ${status}`);
    return body;
  }

  const withTimeout = <T,>(p: Promise<T>, ms: number) =>
    Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);

  async function loadExchange(ex: ExchangeId): Promise<CexMarket[]> {
    const replies = await Promise.all(marketListUrls(ex).map(getJson));
    let list = parseMarkets(ex, replies);
    const infoUrl = exchangeInfoUrl(ex, list.map((m) => m.native));
    if (infoUrl) list = applyExchangeInfo(ex, list, await getJson(infoUrl));
    if (!list.length) throw new Error("no pairs");
    return list;
  }

  function index(list: CexMarket[]) {
    for (const m of list) {
      markets.set(m.name, m);
      byNative.set(`${m.exchange}|${m.native}`, m);
    }
  }

  // An exchange that did not answer at start is retried in the background; its pairs are added when
  // it does, and listeners reload the symbol list.
  const addedListeners = new Set<() => void>();
  function retryLater(ex: ExchangeId, attempt: number) {
    if (attempt >= RETRY_MS.length) return;
    setTimeout(async () => {
      try {
        const list = await withTimeout(loadExchange(ex), LOAD_TIMEOUT_MS * 2);
        for (const m of [...markets.values()]) {
          if (m.exchange === ex) {
            markets.delete(m.name);
            byNative.delete(`${m.exchange}|${m.native}`);
          }
        }
        index(list);
        const i = failed.indexOf(EXCHANGE_INFO[ex].label);
        if (i >= 0) failed.splice(i, 1);
        try {
          const cached = JSON.parse(cache.get() ?? "{}") as Record<string, CexMarket[]>;
          cache.set(JSON.stringify({ ...cached, [ex]: list }));
        } catch {
          // The cache is only a fallback.
        }
        if (running) for (const m of list) if (m.bid > 0) emit(m, { bid: m.bid, ask: m.ask });
        for (const l of [...addedListeners]) l();
      } catch {
        retryLater(ex, attempt + 1);
      }
    }, RETRY_MS[attempt]);
  }

  /** Load every enabled exchange's pairs; an exchange that fails falls back to the last good list. */
  async function load(): Promise<void> {
    let cached: Record<string, CexMarket[]> = {};
    try {
      cached = JSON.parse(cache.get() ?? "{}") as Record<string, CexMarket[]>;
    } catch {
      cached = {};
    }
    const fresh: Record<string, CexMarket[]> = {};
    await Promise.all(
      enabled.map(async (ex) => {
        try {
          fresh[ex] = await withTimeout(loadExchange(ex), LOAD_TIMEOUT_MS);
        } catch (err) {
          console.warn(`[cex] ${ex} pair list failed`, err);
          failed.push(EXCHANGE_INFO[ex].label);
          if (Array.isArray(cached[ex])) fresh[ex] = cached[ex]!;
          retryLater(ex, 0);
        }
      }),
    );
    for (const ex of enabled) if (fresh[ex]) index(fresh[ex]!);
    try {
      cache.set(JSON.stringify({ ...cached, ...fresh }));
    } catch {
      // A full store only costs the fallback list.
    }
  }

  function emit(m: CexMarket, q: { bid: number; ask: number }) {
    const prev = last.get(m.name);
    last.set(m.name, q);
    if (prev && prev.bid === q.bid && prev.ask === q.ask) return;
    const event: MarketEvent = { type: "tick", symbol: m.name, bid: q.bid, ask: q.ask, timestamp: Date.now() };
    for (const h of [...handlers]) h(event);
  }

  async function pollOne(m: CexMarket) {
    const body = await getJson(tickerUrl(m.exchange, m.native));
    const q = parseSingleTicker(m.exchange, body) ?? parseTickers(m.exchange, body).get(m.native);
    if (q) emit(m, q);
  }

  async function pollAll(ex: ExchangeId) {
    const quotes = parseTickers(ex, await getJson(allTickersUrl(ex)));
    for (const [native, q] of quotes) {
      const m = byNative.get(`${ex}|${native}`);
      if (m && !interest.includes(m.name)) emit(m, q);
    }
  }

  const health = (ok: boolean) => {
    if (ok) lastOk = Date.now();
    setState(Date.now() - lastOk < 10_000 ? "connected" : lastOk ? "reconnecting" : "connecting");
  };

  async function fast() {
    fastTimer = null;
    if (!running) return;
    const watched = interest.map((n) => markets.get(n)).filter((m): m is CexMarket => Boolean(m));
    if (watched.length) {
      const results = await Promise.allSettled(watched.map(pollOne));
      health(results.some((r) => r.status === "fulfilled"));
    }
    if (running) fastTimer = setTimeout(fast, FAST_MS);
  }

  async function slow() {
    slowTimer = null;
    if (!running) return;
    const live = enabled.filter((ex) => [...markets.values()].some((m) => m.exchange === ex));
    const results = await Promise.allSettled(live.map(pollAll));
    health(results.some((r) => r.status === "fulfilled"));
    if (running) slowTimer = setTimeout(slow, SLOW_MS);
  }

  return {
    load,
    /** Fires when a retried exchange's pairs arrive after start. */
    onMarketsAdded(listener: () => void) {
      addedListeners.add(listener);
      return () => void addedListeners.delete(listener);
    },
    /** Labels of exchanges whose pair list could not be fetched this start. */
    failed: () => [...failed],
    symbols: (): Symbol[] => [...markets.values()].map(cexSymbol),
    owns: (symbol: string) => markets.has(symbol),
    market: (symbol: string) => markets.get(symbol) ?? null,
    markets: () => [...markets.values()],
    /** Last mid price per base asset on any exchange, for valuing balances. */
    priceOf(asset: string): number | null {
      for (const m of markets.values()) {
        if (m.base !== asset) continue;
        const q = last.get(m.name);
        return q ? (q.bid + q.ask) / 2 : m.last;
      }
      return null;
    },

    async getCandles(request: CandleRequest): Promise<Candle[]> {
      const m = markets.get(request.symbol);
      if (!m) return [];
      const url = klineUrl(m.exchange, m.native, request, Date.now());
      if (!url) return [];
      return parseKlines(m.exchange, await getJson(url), request);
    },

    async getQuote(symbol: string): Promise<Quote | null> {
      const m = markets.get(symbol);
      if (!m) return null;
      const q = last.get(symbol) ?? (m.bid > 0 ? { bid: m.bid, ask: m.ask } : null);
      return q ? { symbol, bid: q.bid, ask: q.ask, timestamp: Date.now() } : null;
    },

    subscribe(handler: (e: MarketEvent) => void) {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
    connect() {
      if (running) return;
      running = true;
      setState("connecting");
      // Prime every pair from the list prices so the watchlist is not empty for 15 s.
      for (const m of markets.values()) if (m.bid > 0) emit(m, { bid: m.bid, ask: m.ask });
      void fast();
      slowTimer = setTimeout(slow, 3_000);
    },
    disconnect() {
      running = false;
      if (fastTimer) clearTimeout(fastTimer);
      if (slowTimer) clearTimeout(slowTimer);
      fastTimer = slowTimer = null;
      setState("disconnected");
    },
    onConnectionChange(listener: (s: ConnectionState) => void) {
      stateListeners.add(listener);
      listener(state);
      return () => void stateListeners.delete(listener);
    },
    setInterest(symbols: string[]) {
      interest = symbols.filter((s) => exchangeOf(s) !== null && markets.has(s));
    },
  };
}

export type CexSource = ReturnType<typeof createCexSource>;
