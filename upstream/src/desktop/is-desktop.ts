import type { DesktopAdapter } from "../../../adapters/desktop-adapter.ts";

/** OpenCharts Desktop addition: true when the desktop app's combined live adapter is installed. */
export function isDesktopAdapter(adapter: unknown): adapter is DesktopAdapter {
  return typeof (adapter as DesktopAdapter | null)?.onSymbolsChanged === "function";
}
