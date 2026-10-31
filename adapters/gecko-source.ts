// DEX pools from GeckoTerminal (every chain, no key) as an OpenCharts market-data source.
// Pools the user adds are saved; their USD price is polled, since the free API has no stream.

import type { Candle, CandleRequest, MarketEvent, Quote, Symbol } from "../upstream/src/adapter/types.ts";
import { dexSizing, dexSymbol, dexSymbolName, ohlcvPath, parseOhlcv, parsePools } from "./gecko-map.ts";
import type { DesktopBridge, DexPool, SavedDexPool } from "./types.ts";

const POLL_MS = 15_000;
const MULTI_MAX = 30;

export interface KeyValueStore {
  get(): string | null;
  set(value: string): void;
}

export function createGeckoSource(bridge: DesktopBridge, store: KeyValueStore, takenNames: () => Set<string>) {
  let saved: SavedDexPool[] = load();
  const handlers = new Set<(e: MarketEvent) => void>();
  const lastPrice = new Map<string, number>();
  let interest: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  function load(): SavedDexPool[] {
    try {
      const list = JSON.parse(store.get() ?? "[]");
      return Array.isArray(list) ? list.filter((p) => p?.name && p?.network && p?.address) : [];
    } catch {
      return [];
    }
  }
  const persist = () => store.set(JSON.stringify(saved));
  const byName = (name: string) => saved.find((p) => p.name === name);

  function emitPrice(name: string, price: number) {
    lastPrice.set(name, price);
    const event: MarketEvent = { type: "tick", symbol: name, bid: price, ask: price, timestamp: Date.now() };
    for (const h of [...handlers]) h(event);
  }

  async function poll() {
    const watched = interest.length ? saved.filter((p) => interest.includes(p.name)) : saved;
    const byNetwork = new Map<string, SavedDexPool[]>();
    for (const p of watched) byNetwork.set(p.network, [...(byNetwork.get(p.network) ?? []), p]);
    for (const [network, pools] of byNetwork) {
      for (let i = 0; i < pools.length; i += MULTI_MAX) {
        const chunk = pools.slice(i, i + MULTI_MAX);
        try {
          const json = await bridge.gecko.get(
            `/networks/${network}/pools/multi/${chunk.map((p) => p.address).join(",")}`,
            "low",
          );
          for (const fresh of parsePools(json)) {
            const mine = chunk.find((p) => p.address.toLowerCase() === fresh.address.toLowerCase());
            if (mine) emitPrice(mine.name, fresh.priceUsd);
          }
        } catch (err) {
          console.warn("[dex] price poll failed", err);
        }
      }
    }
  }

  function schedule(delay: number) {
    if (!running) return;
    timer = setTimeout(async () => {
      await poll();
      schedule(POLL_MS);
    }, delay);
  }

  return {
    owns: (name: string) => byName(name) != null,

    symbols: (): Symbol[] => saved.map(dexSymbol),

    getCandles: async (request: CandleRequest): Promise<Candle[]> => {
      const pool = byName(request.symbol);
      if (!pool) return [];
      const path = ohlcvPath(pool, request);
      if (!path) return [];
      return parseOhlcv(await bridge.gecko.get(path, "high"), request);
    },

    getQuote: async (name: string): Promise<Quote | null> => {
      const pool = byName(name);
      if (!pool) return null;
      const price = lastPrice.get(name) ?? pool.priceUsd;
      return { symbol: name, bid: price, ask: price, timestamp: Date.now() };
    },

    subscribe: (handler: (e: MarketEvent) => void) => {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },

    connect: () => {
      if (running) return;
      running = true;
      schedule(0);
    },

    disconnect: () => {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },

    setInterest: (names: string[]) => {
      interest = names.filter((n) => byName(n));
    },

    search: async (query: string): Promise<DexPool[]> => {
      const q = query.trim();
      if (q.length < 2) return [];
      const json = await bridge.gecko.get(
        `/search/pools?query=${encodeURIComponent(q)}&include=base_token,quote_token,dex`,
        "high",
      );
      return parsePools(json).sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    },

    savedName: (pool: Pick<DexPool, "network" | "address">) =>
      saved.find((p) => p.network === pool.network && p.address.toLowerCase() === pool.address.toLowerCase())?.name ??
      null,

    add: (pool: DexPool): string => {
      const existing = saved.find((p) => p.network === pool.network && p.address === pool.address);
      if (existing) return existing.name;
      const name = dexSymbolName(pool, takenNames());
      saved = [...saved, { ...pool, name, ...dexSizing(pool.priceUsd) }];
      persist();
      emitPrice(name, pool.priceUsd);
      return name;
    },

    remove: (name: string) => {
      saved = saved.filter((p) => p.name !== name);
      lastPrice.delete(name);
      persist();
    },
  };
}
