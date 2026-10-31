// Price alerts: the pure rules. An alert remembers which side of its price the market was on
// when it was armed and fires when the price reaches the other side, so a crossing between two
// polls, or while the app was closed, is still caught. Tested in dev/tests/alerts.test.ts.

export type AlertMode = "once" | "repeat";
export type AlertStatus = "active" | "triggered" | "paused";

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  /** "once" stops after firing; "repeat" fires on every crossing (at most once per cooldown). */
  mode: AlertMode;
  status: AlertStatus;
  /** Side of `price` the market was on when armed; null until the first price is seen. */
  side: "above" | "below" | null;
  note: string;
  createdAt: number;
  triggeredAt: number | null;
  count: number;
}

export interface AlertEvent {
  id: string;
  alertId: string;
  symbol: string;
  price: number;
  /** Mid price that fired it. */
  mid: number;
  direction: "up" | "down";
  time: number;
  note: string;
}

/** A repeating alert ignores crossings this soon after it fired (price chopping around the level). */
export const REPEAT_COOLDOWN_MS = 60_000;
/** Log entries kept. */
export const LOG_LIMIT = 200;

const sideOf = (mid: number, price: number): "above" | "below" => (mid >= price ? "above" : "below");

export function newAlert(
  id: string,
  symbol: string,
  price: number,
  mid: number | null,
  now: number,
  mode: AlertMode = "once",
  note = "",
): PriceAlert {
  return {
    id,
    symbol,
    price,
    mode,
    status: "active",
    side: mid !== null && Number.isFinite(mid) ? sideOf(mid, price) : null,
    note,
    createdAt: now,
    triggeredAt: null,
    count: 0,
  };
}

/** Arm (or re-arm) an alert from the current price, e.g. after resuming or editing its price. */
export function rearm(a: PriceAlert, mid: number | null): PriceAlert {
  return { ...a, status: "active", side: mid !== null && Number.isFinite(mid) ? sideOf(mid, a.price) : null };
}

/**
 * Check one symbol's alerts against a new mid price.
 * Returns the updated list (same array when nothing changed) and the alerts that fired.
 */
export function evaluate(
  alerts: readonly PriceAlert[],
  symbol: string,
  mid: number,
  now: number,
  newId: () => string,
): { alerts: readonly PriceAlert[]; fired: AlertEvent[] } {
  if (!Number.isFinite(mid) || mid <= 0) return { alerts, fired: [] };
  let changed = false;
  const fired: AlertEvent[] = [];
  const next = alerts.map((a): PriceAlert => {
    if (a.symbol !== symbol || a.status !== "active") return a;
    if (a.side === null) {
      changed = true;
      return { ...a, side: sideOf(mid, a.price) };
    }
    const crossed = a.side === "below" ? mid >= a.price : mid <= a.price;
    if (!crossed) return a;
    changed = true;
    const flipped: PriceAlert["side"] = a.side === "below" ? "above" : "below";
    if (a.mode === "repeat" && a.triggeredAt !== null && now - a.triggeredAt < REPEAT_COOLDOWN_MS) {
      return { ...a, side: flipped };
    }
    fired.push({
      id: newId(),
      alertId: a.id,
      symbol,
      price: a.price,
      mid,
      direction: a.side === "below" ? "up" : "down",
      time: now,
      note: a.note,
    });
    return {
      ...a,
      side: flipped,
      status: a.mode === "once" ? ("triggered" as const) : ("active" as const),
      triggeredAt: now,
      count: a.count + 1,
    };
  });
  return { alerts: changed ? next : alerts, fired };
}

/** "BINANCE:BTCUSDT crossed up 77,500 (now 77,512.3)". */
export function eventText(e: AlertEvent, digits = 8): string {
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: digits });
  return `${e.symbol} crossed ${e.direction} ${fmt(e.price)} (now ${fmt(e.mid)})${e.note ? ` · ${e.note}` : ""}`;
}

/** Symbols with an active alert, for the feeds to poll more often. */
export function watchedSymbols(alerts: readonly PriceAlert[]): string[] {
  return [...new Set(alerts.filter((a) => a.status === "active").map((a) => a.symbol))];
}

/** Parse stored alerts, dropping malformed entries. */
export function parseAlerts(raw: string | null): PriceAlert[] {
  try {
    const list = JSON.parse(raw ?? "[]") as PriceAlert[];
    return Array.isArray(list)
      ? list.filter((a) => a && typeof a.id === "string" && typeof a.symbol === "string" && Number.isFinite(a.price))
      : [];
  } catch {
    return [];
  }
}
