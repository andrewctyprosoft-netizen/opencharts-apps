import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { eventText, watchedSymbols } from "../../../adapters/alerts.ts";
import { getAdapter } from "../adapter/registry.ts";
import { safeStorage } from "../lib/safe-storage.ts";
import type { DesktopBridge } from "../../../adapters/types.ts";
import { api } from "../services/api.ts";
import { toast } from "../services/toast.ts";
import { queryKeys } from "../services/queries.ts";
import { useTradingStore } from "../services/store.tsx";
import { playAlertBeep } from "../lib/chart-plugins/drawing-tools/line-alerts.ts";
import { alertsStore } from "./alerts-store.ts";
import { type DeskMessage, openDeskChannel } from "./desk-channel.ts";
import { isDesktopAdapter } from "./is-desktop.ts";

/**
 * OpenCharts Desktop addition, mounted inside the provider when the desktop
 * adapter is installed: reloads the symbol list after DEX pools change,
 * remembers the charted symbol between runs, tells the polled feeds which
 * symbol is on screen, checks price alerts on every tick, feeds the Alerts &
 * positions window, and exposes smoke-test hooks.
 */

const LAST_SYMBOL_KEY = "ocd_last_symbol";
/** Symbols with alerts polled fast besides the charted one (the feeds poll each one separately). */
const ALERT_INTEREST = 6;
const SNAPSHOT_MS = 2_000;

export function DesktopSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const adapter = getAdapter();
    if (!isDesktopAdapter(adapter)) return;
    const store = useTradingStore.getState;
    const bridge = (window as unknown as { ocDesktop?: DesktopBridge }).ocDesktop;

    const refresh = async () => {
      await store().loadSymbols();
      await queryClient.invalidateQueries({ queryKey: queryKeys.market.symbols });
      // The charted DEX pool may just have been removed.
      const { symbols, selectedSymbol } = store();
      if (symbols.length && !symbols.some((s) => s.name === selectedSymbol)) store().setSelectedSymbol(symbols[0]!.name);
    };
    const offSymbols = adapter.onSymbolsChanged(() => void refresh());

    const last = safeStorage.getItem(LAST_SYMBOL_KEY);
    const listed = (name: string | null) => Boolean(name) && store().symbols.some((s) => s.name === name);
    if (listed(last)) store().setSelectedSymbol(last!);
    // A fresh profile starts on the terminal's default ("BTCUSD"), which no venue lists: pick a real pair.
    else if (!listed(store().selectedSymbol) && store().symbols.length) {
      const btc = store().symbols.find((s) => /:BTCUSDT?$/.test(s.name));
      store().setSelectedSymbol((btc ?? store().symbols[0]!).name);
    }
    // Polled feeds refresh the charted symbol fastest, then symbols with an active alert.
    const interest = () => {
      const selected = store().selectedSymbol;
      const alerted = watchedSymbols(alertsStore.get().alerts).filter((s) => s !== selected).slice(0, ALERT_INTEREST);
      adapter.marketData.setSymbolInterest?.([selected, ...alerted]);
    };
    interest();
    const offSelected = useTradingStore.subscribe((state, prev) => {
      if (state.selectedSymbol === prev.selectedSymbol) return;
      safeStorage.setItem(LAST_SYMBOL_KEY, state.selectedSymbol);
      interest();
    });

    // ── Price alerts: every tick of every symbol is checked; a hit toasts, beeps and raises a Windows notification ──
    const mids = new Map<string, number>();
    let alertedKey = watchedSymbols(alertsStore.get().alerts).join(",");
    const offAlerts = alertsStore.subscribe(() => {
      const key = watchedSymbols(alertsStore.get().alerts).join(",");
      if (key !== alertedKey) {
        alertedKey = key;
        interest();
      }
    });
    const offTicks = adapter.marketData.subscribe((event) => {
      if (event.type !== "tick") return;
      const mid = (event.bid + event.ask) / 2;
      mids.set(event.symbol, mid);
      for (const e of alertsStore.check(event.symbol, mid)) {
        const text = eventText(e);
        toast.warning(`Alert: ${e.symbol}`, text);
        playAlertBeep();
        void bridge?.app.notify(`Price alert · ${e.symbol}`, text, e.symbol);
      }
    });

    // "Open chart" in the portfolio and market overview windows (and a clicked notification) charts the pair here.
    const offOpenChart = bridge?.app.onOpenChart((symbol) => {
      if (store().symbols.some((s) => s.name === symbol)) store().setSelectedSymbol(symbol);
      else toast.warning("Not in the symbol list", `${symbol} is not listed; switch its exchange on in Data › Live prices.`);
    });

    // ── Alerts & positions window: broadcast the paper account, run its commands ──
    const desk = openDeskChannel((m: DeskMessage) => {
      if (m.type === "hello") void publish();
      else if (m.type === "chart") store().setSelectedSymbol(m.symbol);
      else if (m.type === "close-position" || m.type === "cancel-order") {
        const run = m.type === "close-position" ? api.closePosition(m.id) : api.cancelOrder(m.id);
        void run.then(
          () => {
            desk.post({ type: "result", ok: true, message: m.type === "close-position" ? "Position closed" : "Order cancelled" });
            void queryClient.invalidateQueries();
            void publish();
          },
          (err: unknown) => desk.post({ type: "result", ok: false, message: String((err as Error).message ?? err) }),
        );
      }
    });
    const publish = async () => {
      const trading = adapter.trading;
      const accountId = store().activeAccountId ?? store().accounts[0]?.id;
      if (!trading || !accountId) return;
      try {
        const [accounts, positions, orders] = await Promise.all([
          trading.getAccounts(),
          trading.getPositions(accountId),
          trading.getOrders(accountId),
        ]);
        const account = accounts.find((a) => a.id === accountId) ?? null;
        const wanted = new Set([...positions.map((p) => p.symbolName), ...orders.map((o) => o.symbolName), ...watchedSymbols(alertsStore.get().alerts)]);
        desk.post({
          type: "snapshot",
          at: Date.now(),
          account: account && { balance: account.balance, equity: account.equity, margin: account.margin, freeMargin: account.freeMargin },
          positions,
          orders: orders.filter((o) => o.status === "PENDING" || o.status === "NEW"),
          symbols: store().symbols.map((s) => s.name),
          mids: Object.fromEntries([...mids].filter(([k]) => wanted.has(k))),
          selected: store().selectedSymbol,
        });
      } catch {
        // The next snapshot tries again.
      }
    };
    const snapshotTimer = setInterval(() => void publish(), SNAPSHOT_MS);

    (window as unknown as { __ocDesktop: unknown }).__ocDesktop = {
      // Mid prices seen per symbol (smoke checks alerts with them).
      mid: (symbol: string) => mids.get(symbol) ?? null,
      // An alert armed as if the price were at `armedAt`, so the next real tick crosses it.
      smokeAlert: (symbol: string, price: number, armedAt: number, mode: "once" | "repeat") =>
        alertsStore.add(symbol, price, armedAt, mode, "smoke").id,
      alerts: () => alertsStore.get(),
      tickCount: (symbol: string) => adapter.tickCount(symbol),
      symbols: () => store().symbols.map((s) => s.name),
      selected: () => store().selectedSymbol,
      smokeChart: async (symbol: string) => {
        store().setSelectedSymbol(symbol);
        try {
          const candles = await adapter.marketData.getCandles({ symbol, timeframe: "1h", limit: 100 });
          return { symbol, candles: candles.length, last: candles.at(-1)?.close ?? null };
        } catch (err) {
          return { symbol, candles: 0, error: String((err as Error).message ?? err) };
        }
      },
      drawings: () => api.chartDrawings.list(store().selectedSymbol),
      // Places a small market order through the same path as the order panel (the router and its prompts).
      smokeOrder: async (symbol: string, quantity: number) => {
        const accountId = store().activeAccountId ?? store().accounts[0]?.id;
        if (!accountId) return { ok: false, error: "no account" };
        try {
          const order = await api.placeOrder({ accountId, symbol, side: "BUY", type: "MARKET", quantity });
          return { ok: true, id: order.id, status: order.status };
        } catch (err) {
          return { ok: false, error: String((err as Error).message ?? err) };
        }
      },
      smokeAddDex: async (query: string) => {
        const [top] = await adapter.marketData.searchDex(query);
        return top ? adapter.marketData.addDex(top) : null;
      },
    };

    return () => {
      offSymbols();
      offSelected();
      offOpenChart?.();
      offAlerts();
      offTicks();
      clearInterval(snapshotTimer);
      desk.close();
    };
  }, [queryClient]);

  return null;
}
