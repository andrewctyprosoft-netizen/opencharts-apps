import { create } from "zustand";

/**
 * OpenCharts Mobile addition: layout state of the phone UI (which tab is open,
 * which sheet is up, whether the drawing rail shows). Kept in a store so the
 * chart panel, the header and the Android back button all see the same state.
 */

export type MobileTab = "chart" | "markets" | "trade" | "orders" | "more";
export type MobileSheet = null | "symbols" | "indicators" | "alerts" | "chart-menu";
export type OrdersTab = "positions" | "orders" | "history" | "alerts" | "journal" | "calendar" | "news";

interface MobileState {
  tab: MobileTab;
  sheet: MobileSheet;
  /** The drawing rail over the chart. */
  drawOpen: boolean;
  /** Side the order ticket opens on, and a counter that remounts it when Buy/Sell is tapped. */
  ticketSide: "BUY" | "SELL";
  ticketNonce: number;
  ordersTab: OrdersTab;
  /** Bumped to ask the chart for its menu (reset view, object tree, settings …). */
  chartMenuNonce: number;
  setTab: (tab: MobileTab) => void;
  setSheet: (sheet: MobileSheet) => void;
  setDrawOpen: (open: boolean) => void;
  openTicket: (side: "BUY" | "SELL") => void;
  setOrdersTab: (tab: OrdersTab) => void;
  openChartMenu: () => void;
}

export const useMobileStore = create<MobileState>((set) => ({
  tab: "chart",
  sheet: null,
  drawOpen: false,
  ticketSide: "BUY",
  ticketNonce: 0,
  ordersTab: "positions",
  chartMenuNonce: 0,
  setTab: (tab) => set({ tab, sheet: null }),
  setSheet: (sheet) => set({ sheet }),
  setDrawOpen: (drawOpen) => set({ drawOpen }),
  openTicket: (side) => set((s) => ({ tab: "trade", sheet: null, ticketSide: side, ticketNonce: s.ticketNonce + 1 })),
  setOrdersTab: (ordersTab) => set({ ordersTab }),
  openChartMenu: () => set((s) => ({ sheet: null, chartMenuNonce: s.chartMenuNonce + 1 })),
}));
