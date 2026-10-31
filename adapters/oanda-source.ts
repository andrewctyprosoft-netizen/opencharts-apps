// Forex and metals (spot XAU/USD, XAG/USD, ~70 currency pairs) from OANDA through the main process.

import type { Candle, CandleRequest, ConnectionState, MarketEvent, Quote, Symbol } from "../upstream/src/adapter/types.ts";
import {
  candleQuery,
  instrumentToSymbol,
  parseCandles,
  sortInstruments,
  toSymbolName,
  usdPerQuoteCurrency,
} from "./oanda-map.ts";
import type { DesktopBridge, OandaInstrument } from "./types.ts";

export async function createOandaSource(bridge: DesktopBridge) {
  const status = await bridge.oanda.status();
  if (!status.configured) return { ok: false as const, reason: "" };
  if (status.error) return { ok: false as const, reason: status.error };

  let instruments: OandaInstrument[];
  try {
    instruments = sortInstruments(await bridge.oanda.instruments());
  } catch (err) {
    return { ok: false as const, reason: String((err as Error).message ?? err) };
  }

  const byName = new Map(instruments.map((i) => [toSymbolName(i.name), i]));
  const symbols: Symbol[] = instruments.map(instrumentToSymbol);
  const mid = new Map<string, number>(); // keyed by OANDA instrument name
  const handlers = new Set<(e: MarketEvent) => void>();
  let unPrice: (() => void) | null = null;

  /** USD per unit of the symbol's quote currency, from the live prices of the USD crosses. */
  const usdPerQuote = (name: string) => usdPerQuoteCurrency(byName.get(name)?.name.split("_")[1], mid);

  const source = {
    owns: (name: string) => byName.has(name),
    symbols: () => symbols,
    usdPerQuote,

    getCandles: async (request: CandleRequest): Promise<Candle[]> => {
      const inst = byName.get(request.symbol);
      const query = candleQuery(request);
      if (!inst || !query) return [];
      return parseCandles(await bridge.oanda.candles(inst.name, query), request);
    },

    getQuote: async (name: string): Promise<Quote | null> => {
      const inst = byName.get(name);
      if (!inst) return null;
      const json = (await bridge.oanda.pricing([inst.name])) as {
        prices?: Array<{ bids?: Array<{ price: string }>; asks?: Array<{ price: string }> }>;
      };
      const p = json.prices?.[0];
      const bid = Number(p?.bids?.[0]?.price);
      const ask = Number(p?.asks?.[0]?.price);
      if (!(bid > 0 && ask > 0)) return null;
      return { symbol: name, bid, ask, timestamp: Date.now() };
    },

    subscribe: (handler: (e: MarketEvent) => void) => {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },

    connect: () => {
      unPrice?.();
      unPrice = bridge.oanda.onPrice((p) => {
        mid.set(p.instrument, (p.bid + p.ask) / 2);
        const event: MarketEvent = {
          type: "tick",
          symbol: toSymbolName(p.instrument),
          bid: p.bid,
          ask: p.ask,
          timestamp: p.time,
        };
        for (const h of [...handlers]) h(event);
      });
      void bridge.oanda.startStream(instruments.map((i) => i.name));
    },

    disconnect: () => {
      unPrice?.();
      unPrice = null;
      void bridge.oanda.stopStream();
    },

    onConnectionChange: (listener: (state: ConnectionState) => void) =>
      bridge.oanda.onState((s) => listener(s as ConnectionState)),

    /** The stream already carries every instrument. */
    setInterest: (_names: string[]) => {},
  };
  return { ok: true as const, source };
}
