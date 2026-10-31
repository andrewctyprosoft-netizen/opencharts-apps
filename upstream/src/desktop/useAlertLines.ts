import type { IPriceLine, ISeriesApi } from "lightweight-charts";
import { type RefObject, useEffect } from "react";
import { alertsStore } from "./alerts-store.ts";

/**
 * OpenCharts Desktop addition: a dashed line with a bell on the price scale
 * for each alert on the charted symbol (amber when active, grey when paused or
 * already fired). Lines follow the alert list as it changes in any window.
 */
export function useAlertLines(seriesRef: RefObject<ISeriesApi<"Candlestick"> | null>, symbol: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let lines: IPriceLine[] = [];
    let drawnOn: ISeriesApi<"Candlestick"> | null = null;
    const clear = () => {
      for (const l of lines) {
        try {
          drawnOn?.removePriceLine(l);
        } catch {
          // The series was replaced; its lines went with it.
        }
      }
      lines = [];
    };
    const draw = () => {
      clear();
      const series = seriesRef.current;
      if (!series) return;
      drawnOn = series;
      lines = alertsStore
        .get()
        .alerts.filter((a) => a.symbol === symbol)
        .map((a) =>
          series.createPriceLine({
            price: a.price,
            color: a.status === "active" ? "#f0b90b" : "#6b7280",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `🔔 ${a.mode === "repeat" ? "every time" : "once"}${a.status === "active" ? "" : ` · ${a.status}`}`,
          }),
        );
    };
    draw();
    const off = alertsStore.subscribe(draw);
    // The chart rebuilds its series when the symbol or timeframe changes; redraw shortly after.
    const timer = setInterval(() => {
      if (seriesRef.current !== drawnOn) draw();
    }, 1000);
    return () => {
      off();
      clearInterval(timer);
      clear();
    };
  }, [seriesRef, symbol, enabled]);
}
