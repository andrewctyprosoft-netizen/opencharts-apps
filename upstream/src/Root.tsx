import { lazy, Suspense, useEffect, useState } from "react";
import type { DesktopBridge } from "../../adapters/types.ts";
import { createDemoAdapter } from "./adapter/demo.ts";
import { OpenChartsProvider } from "./adapter/provider.tsx";
import type { OpenChartsAdapter } from "./adapter/types.ts";
import { DesktopSync } from "./desktop/DesktopSync.tsx";
import { OrderGate } from "./desktop/OrderGate.tsx";
import { Terminal } from "./terminal/Terminal.tsx";
import { isMobileApp } from "./mobile/is-mobile.ts";
import { MobileSplash } from "./mobile/MobileSplash.tsx";

/**
 * The hosted demo's root.
 *
 * Deliberately what an integrator would write: install an adapter, render the
 * terminal. Everything else — query cache, market-data stream, notifications,
 * error boundary — comes from `<OpenChartsProvider>`.
 *
 * `VITE_ADAPTER=binance npm run dev` swaps in the live-market-data example from
 * examples/binance-adapter, loaded lazily so none of its code reaches the
 * default bundle.
 */

// OpenCharts Desktop patch: `?adapter=binance|demo` in the page URL overrides
// the build-time choice, so the desktop shell can switch data sources. Inside
// the desktop app (`window.ocDesktop` from its preload) "binance" means the
// combined live adapter: Binance crypto, GeckoTerminal DEX pools, OANDA forex.
const wantsBinance =
  (new URLSearchParams(window.location.search).get("adapter") ??
    import.meta.env.VITE_ADAPTER) === "binance";
const desktopBridge = (window as unknown as { ocDesktop?: DesktopBridge }).ocDesktop;

function loadLiveAdapter(): Promise<OpenChartsAdapter> {
  if (desktopBridge) {
    return import("../../adapters/desktop-adapter.ts").then(({ createDesktopAdapter }) =>
      createDesktopAdapter(desktopBridge),
    );
  }
  return import("../examples/binance-adapter/binance-adapter.ts").then(({ createBinancePaperAdapter }) =>
    createBinancePaperAdapter(),
  );
}

// OpenCharts Desktop patch: `?view=portfolio|markets|desk` renders a dashboard window instead of the terminal.
const dashboardView = new URLSearchParams(window.location.search).get("view");
const Dashboard = lazy(() => import("./desktop/Dashboard.tsx"));

export function Root() {
  if (desktopBridge && (dashboardView === "portfolio" || dashboardView === "markets" || dashboardView === "desk")) {
    return (
      <Suspense fallback={null}>
        <Dashboard view={dashboardView} bridge={desktopBridge} />
      </Suspense>
    );
  }
  return <TerminalRoot />;
}

function TerminalRoot() {
  const [adapter, setAdapter] = useState<OpenChartsAdapter | null>(() =>
    wantsBinance ? null : createDemoAdapter(),
  );

  useEffect(() => {
    if (!wantsBinance) return;
    loadLiveAdapter()
      .then(setAdapter)
      .catch((err: unknown) => {
        console.error("[opencharts] failed to load the live adapter; using the demo", err);
        setAdapter(createDemoAdapter());
      });
  }, []);

  // OpenCharts Mobile patch: the phone shows a start screen while the exchanges answer.
  if (!adapter) return isMobileApp() ? <MobileSplash /> : null;
  return (
    <OpenChartsProvider adapter={adapter}>
      <Terminal />
      <DesktopSync />
      <OrderGate />
    </OpenChartsProvider>
  );
}
