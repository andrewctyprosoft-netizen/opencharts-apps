import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MobileDrawingBar } from "@/pages/trading/DrawingToolRail";
import { Sheet } from "@/mobile/Sheet";
import { useBackButton } from "@/mobile/use-back-button";
import { SymbolList } from "@/mobile/SymbolList";
import { useMobileStore } from "@/mobile/mobile-store";
import { useTradingStore } from "@/services/store";

/** OpenCharts Mobile: the phone layout's own pieces (the chart itself needs a canvas). */

const SYMBOLS = [
  { name: "BINANCE:BTCUSDT", displayName: "BTC / USDT · Binance", category: "crypto" },
  { name: "OKX:BTCUSDT", displayName: "BTC / USDT · OKX", category: "crypto" },
  { name: "OKX:SOLUSDT", displayName: "SOL / USDT · OKX", category: "crypto" },
  { name: "XAUUSD", displayName: "Gold Spot / U.S. Dollar", category: "metals" },
];

/** A stand-in for the bridge's back-button registry (window.ocMobile.onBack). */
function installBackButton() {
  const handlers: Array<() => boolean> = [];
  (window as unknown as { ocMobile: unknown }).ocMobile = {
    onBack: (h: () => boolean) => {
      handlers.push(h);
      return () => handlers.splice(handlers.indexOf(h), 1);
    },
  };
  return () => {
    for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]!()) return true;
    return false;
  };
}

beforeEach(() => {
  localStorage.clear();
  useTradingStore.setState({ ticks: { "OKX:SOLUSDT": { bid: 95.7, ask: 95.8, bidFmt: "95.70", askFmt: "95.80", timestamp: Date.now() } } });
});
afterEach(() => {
  delete (window as unknown as { ocMobile?: unknown }).ocMobile;
});

describe("phone symbol list", () => {
  it("searches several words across names and venues, and charts the pick", () => {
    const onPick = vi.fn();
    render(<SymbolList symbols={SYMBOLS} selectedSymbol="BINANCE:BTCUSDT" onPick={onPick} />);
    fireEvent.change(screen.getByTestId("symbol-search"), { target: { value: "okx sol" } });
    const rows = screen.getByTestId("symbol-list").querySelectorAll("button[aria-label='Star']");
    expect(rows).toHaveLength(1);
    expect(screen.getByText("95.750")).toBeInTheDocument(); // live mid
    fireEvent.click(screen.getByText("SOLUSDT"));
    expect(onPick).toHaveBeenCalledWith("OKX:SOLUSDT");
  });

  it("filters by venue chip and keeps starred symbols", () => {
    render(<SymbolList symbols={SYMBOLS} selectedSymbol="XAUUSD" onPick={() => {}} />);
    // Nothing starred yet: the list opens on All.
    fireEvent.click(screen.getByText("OKX", { selector: "[data-venue-chip]" }));
    expect(screen.getByTestId("symbol-list").querySelectorAll("button[aria-label='Star']")).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText("Star")[0]!);
    fireEvent.click(screen.getByText("★ Starred"));
    expect(screen.getByTestId("symbol-list").querySelectorAll("button[aria-label='Unstar']")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("opencharts_watchlist_favorites") ?? localStorage.getItem("watchlist_favorites") ?? "[]")).toHaveLength(1);
  });
});

describe("phone sheets and the back button", () => {
  it("closes the top sheet on Android back", () => {
    const back = installBackButton();
    const onClose = vi.fn();
    render(
      <Sheet open title="Indicators" onClose={onClose}>
        <p>body</p>
      </Sheet>,
    );
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(back()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps a sheet above an older handler whose callback changes on every render", () => {
    const back = installBackButton();
    const closeBar = vi.fn();
    const closeSheet = vi.fn();
    // The drawing bar re-renders on every price tick with a new callback.
    function Bar({ tick, sheet }: { tick: number; sheet: boolean }) {
      useBackButton(true, () => closeBar(tick));
      return (
        <Sheet open={sheet} title="Tools" onClose={closeSheet}>
          <p>tools</p>
        </Sheet>
      );
    }
    const { rerender } = render(<Bar tick={1} sheet={false} />);
    rerender(<Bar tick={2} sheet />); // the user opens a tool group
    rerender(<Bar tick={3} sheet />); // a price tick re-renders the bar
    expect(back()).toBe(true);
    expect(closeSheet).toHaveBeenCalledTimes(1);
    expect(closeBar).not.toHaveBeenCalled();
  });

  it("does not hold the back button while closed", () => {
    const back = installBackButton();
    render(
      <Sheet open={false} title="x" onClose={() => {}}>
        <p>body</p>
      </Sheet>,
    );
    expect(back()).toBe(false);
  });
});

describe("phone drawing bar", () => {
  it("opens a group's tools in a sheet and arms the picked tool", () => {
    installBackButton();
    const onDrawingTool = vi.fn();
    render(<MobileDrawingBar drawingTool="none" onDrawingTool={onDrawingTool} onDone={() => {}} />);
    fireEvent.click(screen.getByTestId("draw-group-fib"));
    const sheet = screen.getByTestId("sheet-draw-tools");
    expect(sheet.querySelectorAll("button").length).toBeGreaterThan(10);
    fireEvent.click(screen.getByText("Fib retracement & extension"));
    expect(onDrawingTool).toHaveBeenCalledWith("fibonacci");
    expect(screen.queryByTestId("sheet-draw-tools")).toBeNull();
  });

  it("toggles measure, undoes, and finishes", () => {
    const onDrawingTool = vi.fn();
    const onUndo = vi.fn();
    const onDone = vi.fn();
    render(<MobileDrawingBar drawingTool="measure" onDrawingTool={onDrawingTool} onUndo={onUndo} onDone={onDone} />);
    expect(screen.getByText("Measure: tap two points")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Measure"));
    expect(onDrawingTool).toHaveBeenCalledWith("none");
    fireEvent.click(screen.getByTitle("Undo"));
    expect(onUndo).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("mobile-draw-done"));
    expect(onDone).toHaveBeenCalled();
  });
});

describe("phone layout state", () => {
  it("Buy and Sell open the Trade tab on that side, remounting the ticket", () => {
    const before = useMobileStore.getState().ticketNonce;
    act(() => useMobileStore.getState().openTicket("SELL"));
    const s = useMobileStore.getState();
    expect(s.tab).toBe("trade");
    expect(s.ticketSide).toBe("SELL");
    expect(s.ticketNonce).toBe(before + 1);
    act(() => useMobileStore.getState().setTab("chart"));
  });
});
