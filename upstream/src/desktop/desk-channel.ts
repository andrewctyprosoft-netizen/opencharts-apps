import type { Account, Order, Position } from "../services/schemas.ts";

/**
 * OpenCharts Desktop addition: how the terminal window and the Alerts &
 * positions window talk. The paper account lives in the terminal's memory, so
 * the terminal broadcasts a snapshot every couple of seconds and carries out
 * the commands the dashboard sends back. Same-origin windows share a
 * BroadcastChannel.
 */

export const DESK_CHANNEL = "ocd-desk";

export interface DeskSnapshot {
  type: "snapshot";
  at: number;
  account: Pick<Account, "balance" | "equity" | "margin" | "freeMargin"> | null;
  positions: Position[];
  orders: Order[];
  /** Every symbol the terminal lists, for the dashboard's alert form. */
  symbols: string[];
  /** Last mid price per symbol with a position, order or alert. */
  mids: Record<string, number>;
  selected: string;
}

export type DeskCommand =
  | { type: "close-position"; id: string }
  | { type: "cancel-order"; id: string }
  | { type: "chart"; symbol: string }
  | { type: "hello" };

export type DeskMessage = DeskSnapshot | DeskCommand | { type: "result"; ok: boolean; message: string };

export function openDeskChannel(onMessage: (m: DeskMessage) => void): { post: (m: DeskMessage) => void; close: () => void } {
  if (typeof BroadcastChannel === "undefined") return { post: () => {}, close: () => {} };
  const ch = new BroadcastChannel(DESK_CHANNEL);
  ch.onmessage = (e: MessageEvent<DeskMessage>) => onMessage(e.data);
  return { post: (m) => ch.postMessage(m), close: () => ch.close() };
}
