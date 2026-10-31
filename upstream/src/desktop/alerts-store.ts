import { useSyncExternalStore } from "react";
import {
  type AlertEvent,
  type AlertMode,
  LOG_LIMIT,
  type PriceAlert,
  evaluate,
  newAlert,
  parseAlerts,
  rearm,
} from "../../../adapters/alerts.ts";
import { uid } from "../lib/uid.ts";

/**
 * OpenCharts Desktop addition: price alerts kept in localStorage, so the
 * terminal (which checks them on every price) and the Alerts & positions
 * window (which edits them) share one list. A change in one window reaches
 * the other through the `storage` event.
 */

const ALERTS_KEY = "ocd_alerts_v1";
const LOG_KEY = "ocd_alert_log_v1";

interface State {
  alerts: readonly PriceAlert[];
  log: readonly AlertEvent[];
}

function read(): State {
  let log: AlertEvent[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]") as AlertEvent[];
    log = Array.isArray(parsed) ? parsed : [];
  } catch {
    log = [];
  }
  let alerts: PriceAlert[] = [];
  try {
    alerts = parseAlerts(localStorage.getItem(ALERTS_KEY));
  } catch {
    alerts = [];
  }
  return { alerts, log };
}

let state: State = read();
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of [...listeners]) l();
};

function commit(next: Partial<State>) {
  state = { ...state, ...next };
  try {
    if (next.alerts) localStorage.setItem(ALERTS_KEY, JSON.stringify(state.alerts));
    if (next.log) localStorage.setItem(LOG_KEY, JSON.stringify(state.log));
  } catch {
    // A full or blocked store keeps the alerts for this session only.
  }
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== ALERTS_KEY && e.key !== LOG_KEY) return;
    state = read();
    notify();
  });
}

export const alertsStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  add(symbol: string, price: number, mid: number | null, mode: AlertMode = "once", note = ""): PriceAlert {
    const a = newAlert(uid(), symbol, price, mid, Date.now(), mode, note);
    commit({ alerts: [...state.alerts, a] });
    return a;
  },
  update(id: string, patch: Partial<Pick<PriceAlert, "price" | "mode" | "note" | "status">>, mid: number | null = null) {
    commit({
      alerts: state.alerts.map((a) => {
        if (a.id !== id) return a;
        const next = { ...a, ...patch };
        // A new price, or resuming, arms the alert again from where the market is now.
        return patch.price !== undefined || patch.status === "active" ? rearm(next, mid) : next;
      }),
    });
  },
  remove(id: string) {
    commit({ alerts: state.alerts.filter((a) => a.id !== id) });
  },
  clearLog() {
    commit({ log: [] });
  },
  /** Check a symbol's alerts against a new price; returns the alerts that fired. */
  check(symbol: string, mid: number): AlertEvent[] {
    if (!state.alerts.some((a) => a.symbol === symbol && a.status === "active")) return [];
    const { alerts, fired } = evaluate(state.alerts, symbol, mid, Date.now(), uid);
    if (alerts !== state.alerts) {
      commit({ alerts, ...(fired.length && { log: [...[...fired].reverse(), ...state.log].slice(0, LOG_LIMIT) }) });
    }
    return fired;
  },
};

export function useAlerts(): State {
  return useSyncExternalStore(alertsStore.subscribe, alertsStore.get);
}
