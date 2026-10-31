import type { Symbol } from "../schemas.ts";

/**
 * Demo instruments. These mirror the crypto pairs whose real historical OHLC
 * is bundled under ./data (see scripts/fetch-demo-data.mjs). Quoted in USD.
 */
function crypto(name: string, displayName: string, tickSize: number): Symbol {
  return {
    id: name,
    name,
    displayName,
    category: "CRYPTO",
    contractSize: 1,
    tickSize,
    tickValue: tickSize,
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

export const DEMO_SYMBOLS: Symbol[] = [
  crypto("BTCUSD", "Bitcoin", 0.01),
  crypto("ETHUSD", "Ethereum", 0.01),
  crypto("SOLUSD", "Solana", 0.01),
  crypto("BNBUSD", "BNB", 0.01),
  crypto("XRPUSD", "XRP", 0.0001),
  crypto("ADAUSD", "Cardano", 0.0001),
];

export const DEMO_SYMBOL_NAMES = DEMO_SYMBOLS.map((s) => s.name);

// ── OpenCharts Desktop patch ──────────────────────────────
// Live adapters register the instruments they serve so the paper engine can
// trade them, and a converter so P&L in a non-USD quote currency (USD/JPY,
// EUR/GBP) is booked in USD.

const extraSymbols = new Map<string, Symbol>();
let quoteToUsd: (symbol: string) => number = () => 1;

export function registerSymbols(symbols: Symbol[]): void {
  for (const s of symbols) extraSymbols.set(s.name, s);
}

export function setQuoteToUsd(convert: (symbol: string) => number): void {
  quoteToUsd = convert;
}

/** USD value of one unit of the symbol's quote currency; 1 for USD-quoted symbols. */
export function usdPerQuote(symbol: string): number {
  const rate = quoteToUsd(symbol);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

export function getDemoSymbol(name: string): Symbol | undefined {
  return DEMO_SYMBOLS.find((s) => s.name === name) ?? extraSymbols.get(name);
}
