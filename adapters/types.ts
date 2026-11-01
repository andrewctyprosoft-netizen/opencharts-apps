// Shared types for the desktop data sources. Type-only: safe to import anywhere.

import type { MarketDataSource } from "../upstream/src/adapter/types.ts";

/** OANDA instrument as the main process reports it (CURRENCY and METAL types only). */
export interface OandaInstrument {
  name: string;
  type: string;
  displayName: string;
  pipLocation: number;
  displayPrecision: number;
  marginRate: string;
}

export interface OandaStatus {
  configured: boolean;
  env: string;
  accountId?: string;
  error?: string;
}

export interface OandaPrice {
  instrument: string;
  bid: number;
  ask: number;
  time: number;
}

/** Where a real order goes: one of the six exchanges, or OANDA for forex and metals. */
export type VenueId = "binance" | "okx" | "bybit" | "kucoin" | "coinbase" | "mexc" | "oanda";

export interface VenueStatus {
  configured: boolean;
  label: string;
  /** The saved key is a test-network / demo key (or an OANDA practice token). */
  testnet: boolean;
}

/** One asset held on a venue. */
export interface VenueBalance {
  asset: string;
  free: number;
  locked: number;
  /** USD value when the venue reports it (OKX, Bybit, OANDA). */
  usd?: number;
}

/** An open (resting) order on a venue. */
export interface VenueOrder {
  id: string;
  native: string;
  side: "BUY" | "SELL";
  type: string;
  price: number | null;
  qty: number;
  filled: number;
  time: number;
  /** OANDA open trades (type TRADE): unrealized P&L in the account currency. */
  pnl?: number;
}

/** A real order as the main process signs and sends it. Quantities are already rounded strings. */
export interface RealOrder {
  native: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  qty: string;
  price?: string;
  /** OANDA only: protective orders attached on fill. */
  takeProfit?: string;
  stopLoss?: string;
}

export interface RealOrderResult {
  id: string;
  status: string;
}

/** `window.ocDesktop`, exposed by electron/preload.cjs. */
export interface DesktopBridge {
  /** Allowed public hosts only (exchanges, CoinGecko, Yahoo, wallets); see electron/lib.js PUBLIC_GET. */
  web: {
    get(url: string): Promise<{ status: number; body: unknown }>;
    rpc(chain: string, body: unknown): Promise<unknown>;
  };
  /** API keys stay in the main process; the page only learns whether a venue is configured. */
  trade: {
    status(): Promise<Record<VenueId, VenueStatus>>;
    balances(venue: VenueId): Promise<VenueBalance[]>;
    openOrders(venue: VenueId): Promise<VenueOrder[]>;
    place(venue: VenueId, order: RealOrder): Promise<RealOrderResult>;
    cancel(venue: VenueId, native: string, id: string): Promise<void>;
    /** Close an open OANDA trade. */
    closeTrade(venue: VenueId, id: string): Promise<void>;
    openKeys(venue?: VenueId): Promise<void>;
  };
  app: {
    openWindow(view: "portfolio" | "markets" | "desk"): Promise<void>;
    /** A Windows notification; clicking it charts `symbol` in the main window. */
    notify(title: string, body: string, symbol?: string): Promise<void>;
    openChart(symbol: string): Promise<void>;
    onOpenChart(handler: (symbol: string) => void): () => void;
  };
  gecko: { get(path: string, priority?: "high" | "low"): Promise<unknown> };
  /** Keyless forex and metals: Swissquote quotes ("XAU_USD") and Yahoo Finance charts. */
  fx: {
    quotes(instruments: string[]): Promise<OandaPrice[]>;
    chart(symbol: string, query: string): Promise<unknown>;
  };
  oanda: {
    status(): Promise<OandaStatus>;
    instruments(): Promise<OandaInstrument[]>;
    candles(instrument: string, query: string): Promise<unknown>;
    pricing(names: string[]): Promise<unknown>;
    startStream(names: string[]): Promise<void>;
    stopStream(): Promise<void>;
    onPrice(handler: (p: OandaPrice) => void): () => void;
    onState(handler: (state: string) => void): () => void;
  };
}

/** A DEX liquidity pool found on GeckoTerminal. */
export interface DexPool {
  network: string;
  address: string;
  base: string;
  quote: string;
  dex: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
}

/** A pool the user added, with the symbol name it trades under. */
export interface SavedDexPool extends DexPool {
  name: string;
  tickSize: number;
  contractSize: number;
}

/** Extra calls the desktop adapter offers beyond the OpenCharts contract. */
export interface DesktopMarketData extends MarketDataSource {
  searchDex(query: string): Promise<DexPool[]>;
  addDex(pool: DexPool): Promise<string>;
  removeDex(name: string): Promise<void>;
  savedDexName(pool: Pick<DexPool, "network" | "address">): string | null;
  /** The symbol name of a pool, added first when it is not saved yet; null if GeckoTerminal does not know it. */
  openDex(network: string, address: string): Promise<string | null>;
}
