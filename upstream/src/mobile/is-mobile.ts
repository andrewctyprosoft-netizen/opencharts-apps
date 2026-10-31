/**
 * OpenCharts Mobile addition: the Android app's bridge (bridge/index.js) sets
 * `window.ocMobile`; when it is there the terminal uses the phone layout.
 */

export interface MobileState {
  dataSource: string;
  exchanges: Record<string, boolean>;
  oanda: { env: string; configured: boolean };
  keys: Record<string, boolean>;
}

export interface MobileBridge {
  platform: "android" | "web";
  version: string;
  /** Exchange id → label, in menu order. */
  exchanges: Record<string, string>;
  state(): Promise<MobileState>;
  setDataSource(key: "live" | "demo"): void;
  setExchange(id: string, on: boolean): void;
  openDashboard(view: "portfolio" | "markets" | "desk"): void;
  openKeys(venue?: string): void;
  openOanda(): void;
  reload(): void;
  ensureNotifications(): Promise<boolean>;
  openExternal(url: string): void;
  onBack(handler: () => boolean): () => void;
}

export function mobileBridge(): MobileBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ocMobile?: MobileBridge }).ocMobile ?? null;
}

export const isMobileApp = (): boolean => mobileBridge() !== null;
