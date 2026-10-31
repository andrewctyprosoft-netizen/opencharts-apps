import { venueOf } from "../../../adapters/venues.ts";

/**
 * OpenCharts Desktop addition: a small coloured tag naming where a symbol
 * trades (Binance, OKX …, OANDA, a DEX). Orders on CEX and OANDA symbols can
 * go to that venue once its API key is saved.
 */
export function VenueBadge({ symbol }: { symbol: { name: string; category?: string | null; displayName?: string | null } }) {
  const v = venueOf(symbol);
  return (
    <span
      data-venue={v.label}
      title={v.id ? `Trades on ${v.label}. Orders go there once its API key is saved.` : `${v.label}: paper trading only`}
      className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide border"
      style={{ color: v.color, borderColor: `${v.color}55`, background: `${v.color}14` }}
    >
      {v.label}
    </span>
  );
}
