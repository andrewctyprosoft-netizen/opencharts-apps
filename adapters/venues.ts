// Which venue a symbol belongs to, for badges in the symbol picker and watchlist and for routing
// real orders. Pure; tested in dev/tests/cex-map.test.ts.

import { EXCHANGE_INFO, exchangeOf } from "./cex-map.ts";
import type { VenueId } from "./types.ts";

export interface Venue {
  /** Order venue, or null when orders can only be paper (DEX pools, the offline demo). */
  id: VenueId | null;
  label: string;
  color: string;
  kind: "cex" | "oanda" | "dex" | "demo";
}

const OANDA: Venue = { id: "oanda", label: "OANDA", color: "#ff5c5c", kind: "oanda" };

/** Venue of a symbol from its name and category ("OKX:BTCUSDT" → OKX, FOREX → OANDA, DEX → its DEX). */
export function venueOf(s: { name: string; category?: string | null; displayName?: string | null }): Venue {
  const ex = exchangeOf(s.name);
  if (ex) return { id: ex, ...EXCHANGE_INFO[ex], kind: "cex" };
  if (s.category === "FOREX" || s.category === "METAL") return OANDA;
  if (s.category === "DEX") {
    // DEX display names end in "· uniswap_v3 · eth"; show the DEX.
    const dex = s.displayName?.split("·")[1]?.trim();
    return { id: null, label: dex ? `DEX · ${dex}` : "DEX", color: "#a78bfa", kind: "dex" };
  }
  return { id: null, label: "Demo", color: "#6b7280", kind: "demo" };
}

/** Group label used for the picker and watchlist chips: the exchange, OANDA, DEX or the category. */
export function venueGroup(s: { name: string; category?: string | null; displayName?: string | null }): string {
  const v = venueOf(s);
  return v.kind === "dex" ? "DEX" : v.kind === "demo" ? (s.category ?? "Other") : v.label;
}

/** IPC errors arrive as "Error invoking remote method 'trade:place': Error: …"; keep the message. */
export const ipcMessage = (err: unknown): string =>
  String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
