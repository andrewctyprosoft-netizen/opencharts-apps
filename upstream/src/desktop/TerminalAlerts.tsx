import { useCallback, useMemo } from "react";
import { useTradingStore } from "../services/store.tsx";
import { AlertsPanel } from "./AlertsPanel.tsx";

/** OpenCharts Desktop addition: the Alerts tab under the chart, fed by the terminal's own prices. */
export function TerminalAlerts() {
  const selected = useTradingStore((s) => s.selectedSymbol);
  const symbolList = useTradingStore((s) => s.symbols);
  const ticks = useTradingStore((s) => s.ticks);
  const setSelected = useTradingStore((s) => s.setSelectedSymbol);
  const symbols = useMemo(() => symbolList.map((s) => s.name), [symbolList]);
  const midOf = useCallback(
    (symbol: string) => {
      const t = ticks[symbol];
      return t ? (t.bid + t.ask) / 2 : null;
    },
    [ticks],
  );
  return <AlertsPanel compact defaultSymbol={selected} midOf={midOf} symbols={symbols} onChart={setSelected} />;
}
