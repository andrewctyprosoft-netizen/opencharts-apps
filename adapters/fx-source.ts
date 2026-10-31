// Forex and metals without an account: spot quotes from Swissquote's public feed (polled) and
// chart history from Yahoo Finance, both through the main process. Used when no OANDA token is set.
// Gold, silver, platinum and palladium history comes from futures, scaled to the live spot price.

import type { Candle, CandleRequest, ConnectionState, MarketEvent, Quote, Symbol } from "../upstream/src/adapter/types.ts";
import { FX_INSTRUMENTS, isFuturesBacked, parseYahooChart, yahooLastClose, yahooQuery, yahooSymbol } from "./fx-map.ts";
import { instrumentToSymbol, sortInstruments, toSymbolName, usdPerQuoteCurrency } from "./oanda-map.ts";
import type { DesktopBridge, OandaPrice } from "./types.ts";

/** Charted symbols refresh this often; everything else (watchlist, open positions) every SLOW_EVERY polls. */
const POLL_MS = 2_000;
const SLOW_EVERY = 15;

export function createFxSource(bridge: DesktopBridge) {
  const instruments = sortInstruments(FX_INSTRUMENTS);
  const byName = new Map(instruments.map((i) => [toSymbolName(i.name), i]));
  const symbols: Symbol[] = instruments.map(instrumentToSymbol);
  const mid = new Map<string, number>(); // keyed by instrument name, e.g. "USD_JPY"
  const last = new Map<string, OandaPrice>();
  const futuresLast = new Map<string, number>(); // newest futures close per metal, from the latest chart load
  const handlers = new Set<(e: MarketEvent) => void>();
  const stateListeners = new Set<(s: ConnectionState) => void>();
  let state: ConnectionState = "disconnected";
  let interest: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let polls = 0;

  const setState = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    for (const l of [...stateListeners]) l(next);
  };

  /** Fetch quotes, remember mids, and tick every instrument whose price changed (or is new). */
  async function refresh(names: string[]): Promise<number> {
    const prices = await bridge.fx.quotes(names);
    for (const p of prices) {
      mid.set(p.instrument, (p.bid + p.ask) / 2);
      const prev = last.get(p.instrument);
      last.set(p.instrument, p);
      if (prev && prev.bid === p.bid && prev.ask === p.ask) continue;
      const event: MarketEvent = {
        type: "tick",
        symbol: toSymbolName(p.instrument),
        bid: p.bid,
        ask: p.ask,
        timestamp: Math.min(p.time, Date.now()),
      };
      for (const h of [...handlers]) h(event);
    }
    return prices.length;
  }

  async function poll() {
    timer = null;
    if (!running) return;
    const all = polls % SLOW_EVERY === 0;
    polls += 1;
    const names = all
      ? instruments.map((i) => i.name)
      : interest.map((n) => byName.get(n)?.name).filter((n): n is string => Boolean(n));
    if (names.length) {
      try {
        const got = await refresh(names);
        setState(got ? "connected" : "reconnecting");
      } catch (err) {
        console.warn("[fx] quote poll failed", err);
        setState("reconnecting");
      }
    }
    if (running) timer = setTimeout(poll, POLL_MS);
  }

  async function spotMid(instrument: string): Promise<number | null> {
    if (!mid.has(instrument)) await refresh([instrument]).catch(() => 0);
    return mid.get(instrument) ?? null;
  }

  const source = {
    owns: (name: string) => byName.has(name),
    symbols: () => symbols,
    usdPerQuote: (name: string) => usdPerQuoteCurrency(byName.get(name)?.name.split("_")[1], mid),

    getCandles: async (request: CandleRequest): Promise<Candle[]> => {
      const inst = byName.get(request.symbol);
      const query = inst && yahooQuery(request, Math.floor(Date.now() / 1000));
      if (!inst || !query) return [];
      const json = await bridge.fx.chart(yahooSymbol(inst.name), query);
      let scale = 1;
      if (isFuturesBacked(inst.name)) {
        // Scale futures to spot by today's gap; scroll-back loads reuse the gap from the latest load.
        const latest = request.toMs == null ? yahooLastClose(json) : null;
        if (latest) futuresLast.set(inst.name, latest);
        const future = futuresLast.get(inst.name) ?? yahooLastClose(json);
        const spot = await spotMid(inst.name);
        if (spot && future) scale = spot / future;
      }
      return parseYahooChart(json, request, scale, inst.displayPrecision);
    },

    getQuote: async (name: string): Promise<Quote | null> => {
      const inst = byName.get(name);
      if (!inst) return null;
      const [p] = await bridge.fx.quotes([inst.name]);
      return p ? { symbol: name, bid: p.bid, ask: p.ask, timestamp: p.time } : null;
    },

    subscribe: (handler: (e: MarketEvent) => void) => {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },

    connect: () => {
      if (running) return;
      running = true;
      polls = 0;
      setState("connecting");
      void poll();
    },

    disconnect: () => {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      setState("disconnected");
    },

    onConnectionChange: (listener: (state: ConnectionState) => void) => {
      stateListeners.add(listener);
      return () => void stateListeners.delete(listener);
    },

    /** The terminal's charted symbols: these refresh every 2 s. */
    setInterest: (names: string[]) => {
      interest = names.filter((n) => byName.has(n));
    },
  };
  return source;
}
