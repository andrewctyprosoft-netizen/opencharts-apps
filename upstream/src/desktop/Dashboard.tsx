import type { DesktopBridge } from "../../../adapters/types.ts";
import { ToastViewport } from "../components/ToastViewport.tsx";
import { DeskPage } from "./DeskPage.tsx";
import { MarketsPage } from "./MarketsPage.tsx";
import { PortfolioPage } from "./PortfolioPage.tsx";

/**
 * OpenCharts Desktop addition: the File › Dashboard windows. Rendered by Root
 * for `?view=portfolio|markets|desk`, inside the `.opencharts` scope so the
 * terminal's theme applies, but without the terminal or its adapter.
 */
export default function Dashboard({ view, bridge }: { view: "portfolio" | "markets" | "desk"; bridge: DesktopBridge }) {
  return (
    <div className="opencharts h-full w-full bg-background text-foreground text-sm" style={{ height: "100%" }}>
      {/* .dash-window (inside the .opencharts scope) gives these windows larger scrollbars. */}
      <div className="dash-window h-full w-full min-w-0">
        {view === "portfolio" ? <PortfolioPage bridge={bridge} /> : view === "desk" ? <DeskPage bridge={bridge} /> : <MarketsPage bridge={bridge} />}
      </div>
      <ToastViewport />
    </div>
  );
}
