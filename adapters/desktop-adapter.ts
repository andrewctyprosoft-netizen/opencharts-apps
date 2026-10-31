// The desktop app's adapter: the centralised exchanges the user enabled (Binance, OKX, Bybit,
// KuCoin, Coinbase, MEXC), GeckoTerminal DEX pools and forex/metals behind one OpenCharts
// market-data source. Forex and metals come from OANDA when a token is set, otherwise from the
// keyless Swissquote + Yahoo feed. Orders go through the order router: real on a venue with a
// saved key, otherwise the bundled paper engine.

import type {
  ConnectionState,
  MarketEvent,
  OpenChartsAdapter,
  Symbol,
} from "../upstream/src/adapter/types.ts";
import { createDemoAdapter } from "../upstream/src/adapter/demo.ts";
import { safeStorage } from "../upstream/src/lib/safe-storage.ts";
import { mark } from "../upstream/src/services/demo/engine.ts";
import { registerSymbols, setQuoteToUsd } from "../upstream/src/services/demo/instruments.ts";
import { toast } from "../upstream/src/services/toast.ts";
import { EXCHANGE_IDS, LEGACY_BINANCE, type ExchangeId } from "./cex-map.ts";
import { createCexSource } from "./cex-source.ts";
import { createFxSource } from "./fx-source.ts";
import { createGeckoSource } from "./gecko-source.ts";
import { createOandaSource } from "./oanda-source.ts";
import { createOrderRouter } from "./order-router.ts";
import type { DesktopBridge, DesktopMarketData, DexPool } from "./types.ts";

const DEX_KEY = "ocd_dex_pools";
const STATE_RANK: Record<ConnectionState, number> = { connected: 3, reconnecting: 2, connecting: 1, disconnected: 0 };

export interface DesktopAdapter extends OpenChartsAdapter {
  marketData: DesktopMarketData;
  /** Ticks seen per symbol since start (diagnostics and the smoke test). */
  tickCount(symbol: string): number;
  /** Fires after DEX pools are added or removed, so the UI can reload the symbol list. */
  onSymbolsChanged(listener: () => void): () => void;
}

/** Exchanges switched on in Data › Live prices, passed by the shell as `?ex=binance,okx,…`. */
export function enabledExchanges(search = window.location.search): ExchangeId[] {
  const raw = new URLSearchParams(search).get("ex");
  if (raw === null) return [...EXCHANGE_IDS];
  return raw.split(",").filter((id): id is ExchangeId => (EXCHANGE_IDS as string[]).includes(id));
}

/**
 * 0.1–0.4 named the six Binance pairs "BTCUSD" etc. Move their drawings, the remembered symbol
 * and watchlist stars to the new names once.
 */
function migrateLegacyNames() {
  if (safeStorage.getItem("ocd_names_v2")) return;
  for (const [old, next] of Object.entries(LEGACY_BINANCE)) {
    const drawings = safeStorage.getItem(`oc_drawings_${old}`);
    if (drawings && !safeStorage.getItem(`oc_drawings_${next}`)) safeStorage.setItem(`oc_drawings_${next}`, drawings);
  }
  const last = safeStorage.getItem("ocd_last_symbol");
  if (last && LEGACY_BINANCE[last]) safeStorage.setItem("ocd_last_symbol", LEGACY_BINANCE[last]!);
  try {
    const stars = JSON.parse(safeStorage.getItem("watchlist_favorites") ?? "[]") as string[];
    if (Array.isArray(stars) && stars.some((s) => LEGACY_BINANCE[s])) {
      safeStorage.setItem("watchlist_favorites", JSON.stringify(stars.map((s) => LEGACY_BINANCE[s] ?? s)));
    }
  } catch {
    // Unreadable stars are left alone.
  }
  safeStorage.setItem("ocd_names_v2", "1");
}

export async function createDesktopAdapter(bridge: DesktopBridge): Promise<DesktopAdapter> {
  migrateLegacyNames();
  const cex = createCexSource(bridge, enabledExchanges(), {
    get: () => safeStorage.getItem("ocd_cex_markets_v1"),
    set: (v) => safeStorage.setItem("ocd_cex_markets_v1", v),
  });
  const [oandaResult] = await Promise.all([createOandaSource(bridge), cex.load()]);
  const fx = oandaResult.ok ? oandaResult.source : createFxSource(bridge);
  if (!oandaResult.ok && oandaResult.reason) {
    toast.warning("OANDA unavailable", `${oandaResult.reason} Using the free forex & gold feed instead.`);
  }
  if (cex.failed().length) {
    toast.warning("Some exchanges did not answer", `${cex.failed().join(", ")}: using the last saved pair list, if any, and retrying in the background.`);
  }

  let allNames = new Set<string>();
  const gecko = createGeckoSource(
    bridge,
    { get: () => safeStorage.getItem(DEX_KEY), set: (v) => safeStorage.setItem(DEX_KEY, v) },
    () => allNames,
  );

  let byName = new Map<string, Symbol>();
  const collectSymbols = (): Symbol[] => {
    const list = [...cex.symbols(), ...fx.symbols(), ...gecko.symbols()];
    allNames = new Set(list.map((s) => s.name));
    byName = new Map(list.map((s) => [s.name, s]));
    registerSymbols(list);
    return list;
  };
  collectSymbols();
  setQuoteToUsd(fx.usdPerQuote);

  const sourceFor = (symbol: string) => {
    if (cex.owns(symbol)) return cex;
    if (fx.owns(symbol)) return fx;
    if (gecko.owns(symbol)) return gecko;
    return null;
  };

  // ── Events: one fan-out, every tick also marks the paper engine ──
  const handlers = new Set<(e: MarketEvent) => void>();
  const ticks = new Map<string, number>();
  const mids = new Map<string, number>();
  const forward = (event: MarketEvent) => {
    if (event.type === "tick") {
      ticks.set(event.symbol, (ticks.get(event.symbol) ?? 0) + 1);
      const m = (event.bid + event.ask) / 2;
      mids.set(event.symbol, m);
      mark(event.symbol, m);
    }
    for (const h of [...handlers]) {
      try {
        h(event);
      } catch (err) {
        console.error("[desktop] subscriber threw", err);
      }
    }
  };
  cex.subscribe(forward);
  gecko.subscribe(forward);
  fx.subscribe(forward);

  // ── Connection: report the healthiest feed ──
  const states = new Map<string, ConnectionState>([["cex", "disconnected"]]);
  const stateListeners = new Set<(s: ConnectionState) => void>();
  const combined = (): ConnectionState =>
    [...states.values()].reduce((best, s) => (STATE_RANK[s] > STATE_RANK[best] ? s : best), "disconnected");
  let lastState = combined();
  const setState = (source: string, state: ConnectionState) => {
    states.set(source, state);
    const next = combined();
    if (next === lastState) return;
    lastState = next;
    for (const l of [...stateListeners]) l(next);
  };
  cex.onConnectionChange((s) => setState("cex", s));
  fx.onConnectionChange((s) => setState("fx", s));

  const symbolListeners = new Set<() => void>();
  const symbolsChanged = () => {
    collectSymbols();
    for (const l of [...symbolListeners]) l();
  };
  cex.onMarketsAdded(() => {
    symbolsChanged();
    toast.success("Exchange back", "Its pairs are in the symbol list now.");
  });

  const marketData: DesktopMarketData = {
    getSymbols: async () => collectSymbols(),
    getCandles: async (request) => (await sourceFor(request.symbol)?.getCandles(request)) ?? [],
    getQuote: async (symbol) => (await sourceFor(symbol)?.getQuote?.(symbol)) ?? null,
    subscribe: (handler) => {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
    connect: () => {
      cex.connect();
      gecko.connect();
      fx.connect();
    },
    disconnect: () => {
      cex.disconnect();
      gecko.disconnect();
      fx.disconnect();
    },
    getConnectionState: () => lastState,
    onConnectionChange: (listener) => {
      stateListeners.add(listener);
      listener(lastState);
      return () => void stateListeners.delete(listener);
    },
    setSymbolInterest: (symbols) => {
      cex.setInterest(symbols);
      gecko.setInterest(symbols);
      fx.setInterest(symbols);
    },

    searchDex: (query) => gecko.search(query),
    addDex: async (pool: DexPool) => {
      const name = gecko.add(pool);
      symbolsChanged();
      return name;
    },
    removeDex: async (name) => {
      gecko.remove(name);
      symbolsChanged();
    },
    savedDexName: (pool) => gecko.savedName(pool),
  };

  const paper = createDemoAdapter();
  const trading = createOrderRouter({
    paper: paper.trading!,
    bridge,
    market: (symbol) => cex.market(symbol),
    symbol: (name) => byName.get(name),
    mid: (symbol) => mids.get(symbol) ?? null,
  });
  return {
    name: "desktop-live",
    marketData,
    trading,
    storage: paper.storage,
    tickCount: (symbol) => ticks.get(symbol) ?? 0,
    onSymbolsChanged: (listener) => {
      symbolListeners.add(listener);
      return () => void symbolListeners.delete(listener);
    },
  };
}
