/** OpenCharts Desktop addition: number formats shared by the dashboard windows. */

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

export function fmtUsd(v: number | null | undefined, compactAbove = 1e6): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= compactAbove) return `$${compact.format(v)}`;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const digits = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 10;
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return Math.abs(v) >= 1e5 ? compact.format(v) : v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export const pctClass = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) || v === 0 ? "text-muted-foreground" : v > 0 ? "text-buy" : "text-sell";
