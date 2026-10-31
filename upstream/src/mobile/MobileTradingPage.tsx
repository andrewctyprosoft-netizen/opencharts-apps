import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  CandlestickChart,
  ChevronDown,
  ClipboardList,
  Menu,
  MoreVertical,
  PenTool,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAlerts } from "../desktop/alerts-store.ts";
import { AlertsPanel } from "../desktop/AlertsPanel.tsx";
import { VenueBadge } from "../desktop/VenueBadge.tsx";
import { INDICATOR_REGISTRY } from "../lib/indicators.ts";
import { cn, formatNumber } from "../lib/utils.ts";
import { BottomPanel } from "../pages/trading/BottomPanel.tsx";
import { ChartPanel } from "../pages/trading/ChartPanel.tsx";
import { CHART_PLUGIN_ITEMS } from "../pages/trading/chart-plugin-items.ts";
import { REPLAY_ENABLED, TIMEFRAMES } from "../pages/trading/constants.ts";
import { DOMPanel } from "../pages/trading/DOMPanel.tsx";
import { MobileDrawingBar } from "../pages/trading/DrawingToolRail.tsx";
import { MarketClosedBanner } from "../pages/trading/MarketClosedBanner.tsx";
import { OrderPanel } from "../pages/trading/OrderPanel.tsx";
import { ReplayScrubber } from "../pages/trading/ReplayScrubber.tsx";
import { getPipDigits } from "../pages/trading/utils.ts";
import { updateChartPreferences } from "../hooks/useChartPreferences.ts";
import { useTradingStore } from "../services/store.tsx";
import { useTerminal } from "../terminal/use-terminal.ts";
import { mobileBridge } from "./is-mobile.ts";
import { MobileMore } from "./MobileMore.tsx";
import { AccountStrip, Toggle } from "./parts.tsx";
import { type MobileTab, useMobileStore } from "./mobile-store.ts";
import { Sheet } from "./Sheet.tsx";
import { useBackButton } from "./use-back-button.ts";
import { SymbolList } from "./SymbolList.tsx";
import "./mobile.css";

/**
 * OpenCharts Mobile addition: the phone layout of the terminal. The chart
 * stays mounted under every tab (so drawings, indicators and the live feed
 * keep running); Markets, Trade, Orders and More slide over it. Everything is
 * the desktop terminal's own panels and state (`useTerminal`), arranged for a
 * touch screen.
 */
export function MobileTradingPage() {
  const t = useTerminal();
  const tab = useMobileStore((s) => s.tab);
  const setTab = useMobileStore((s) => s.setTab);
  const sheet = useMobileStore((s) => s.sheet);
  const setSheet = useMobileStore((s) => s.setSheet);

  // A dashboard's chart button or a notification tap charts the symbol: show the chart.
  useEffect(() => {
    const bridge = (window as unknown as { ocDesktop?: { app: { onOpenChart: (h: (s: string) => void) => () => void } } }).ocDesktop;
    return bridge?.app.onOpenChart(() => setTab("chart"));
  }, [setTab]);

  // Back on any tab but the chart returns to the chart.
  const toChart = useCallback(() => setTab("chart"), [setTab]);
  useBackButton(tab !== "chart" && sheet === null, toChart);

  const closeSheet = useCallback(() => setSheet(null), [setSheet]);
  const pick = (name: string) => {
    t.setSelectedSymbol(name);
    setTab("chart");
  };

  return (
    <div className="oc-mobile-root flex flex-col h-full overflow-hidden bg-background" data-testid="mobile-root">
      <div className="relative flex-1 min-h-0">
        {/* Chart: always mounted underneath. */}
        <section className="absolute inset-0 flex flex-col" aria-hidden={tab !== "chart"}>
          <ChartHeader />
          <ChartTools />
          <MarketClosedBanner symbolInfo={t.symbolInfo} />
          <div className="relative flex-1 min-h-0">
            <ChartPanel
              candles={t.replayCandles ?? t.candles ?? []}
              selectedSymbol={t.selectedSymbol}
              timeframe={t.replayCandles ? "1m" : t.timeframe}
              isDark={t.isDark}
              activeIndicators={t.activeIndicators}
              drawingTool={t.drawingTool}
              drawings={t.drawings}
              onAddDrawing={t.addDrawing}
              onUpdateDrawing={t.updateDrawing}
              onRemoveDrawing={t.removeDrawing}
              onDrawingComplete={() => t.setDrawingTool("none")}
              onDrawingToolSelect={t.setDrawingTool}
              onUndoDrawing={t.undoDrawing}
              onRedoDrawing={t.redoDrawing}
              magnetMode={t.chartPrefs.magnetMode}
              stayInDrawingMode={t.chartPrefs.stayInDrawingMode}
              onCycleMagnet={t.cycleMagnetMode}
              onToggleStayInDrawingMode={() =>
                updateChartPreferences({ stayInDrawingMode: !t.chartPrefs.stayInDrawingMode })
              }
              positions={t.chartPositions}
              orders={t.chartOrders}
              tick={t.replayCandles ? undefined : t.tick}
              liveCandle={t.replayCandles ? undefined : t.liveCandle}
              pipDigits={t.pipDigits}
              symbolInfo={t.symbolInfo}
              onModifyPosition={t.modifyPositionLevels}
              replayTradeEvents={t.replayTradeEvents}
              isReplaying={t.isReplaying}
              activePlugins={t.activePlugins}
              onTogglePlugin={t.togglePlugin}
              accountEquity={t.account?.equity ?? t.account?.balance ?? 0}
              accountId={t.activeAccountId}
              onQuickOrder={t.quickOrder}
              onClearDrawings={t.clearDrawings}
              onClearIndicators={t.clearIndicators}
            />
          </div>
          {REPLAY_ENABLED && t.isReplaying && t.activeAccountId != null && (
            <ReplayScrubber accountId={t.activeAccountId} />
          )}
          <ChartFooter />
        </section>

        {tab === "markets" && (
          <Pane title="Markets" testId="pane-markets">
            <SymbolList symbols={t.symbols} selectedSymbol={t.selectedSymbol} onPick={pick} />
          </Pane>
        )}
        {tab === "trade" && <TradePane />}
        {tab === "orders" && <OrdersPane />}
        {tab === "more" && (
          <Pane title="More" testId="pane-more">
            <MobileMore />
          </Pane>
        )}
      </div>

      <BottomNav />

      <Sheet open={sheet === "symbols"} title="Choose a symbol" onClose={closeSheet} full testId="sheet-symbols">
        <SymbolList symbols={t.symbols} selectedSymbol={t.selectedSymbol} onPick={pick} autoFocus />
      </Sheet>
      <IndicatorsSheet />
      <AlertsSheet />
    </div>
  );
}

/** A full-screen tab over the chart. */
function Pane({ title, children, testId, right }: { title: string; children: React.ReactNode; testId?: string; right?: React.ReactNode }) {
  return (
    <section className="absolute inset-0 z-10 flex flex-col bg-background" data-testid={testId}>
      <header className="oc-safe-top flex items-center h-12 px-4 border-b border-border bg-card shrink-0 box-content">
        <h1 className="flex-1 text-[17px] font-semibold">{title}</h1>
        {right}
      </header>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </section>
  );
}

// ── Chart tab ─────────────────────────────────────────────

function ChartHeader() {
  const t = useTerminal();
  const setSheet = useMobileStore((s) => s.setSheet);
  const openChartMenu = useMobileStore((s) => s.openChartMenu);
  const info = t.symbols.find((s) => s.name === t.selectedSymbol);
  const digits = getPipDigits(t.symbolInfo, t.selectedSymbol);
  const mid = t.tick ? (t.tick.bid + t.tick.ask) / 2 : null;
  const prev = useRef<number | null>(null);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (mid === null) return;
    if (prev.current !== null && mid !== prev.current) setDir(mid > prev.current ? "up" : "down");
    prev.current = mid;
  }, [mid]);
  const activeAlerts = useAlerts().alerts.filter((a) => a.status === "active" && a.symbol === t.selectedSymbol).length;
  const short = t.selectedSymbol.includes(":") ? t.selectedSymbol.split(":")[1] : t.selectedSymbol;

  return (
    <header className="oc-safe-top flex items-center gap-1 h-14 pl-2 pr-1 border-b border-border bg-card shrink-0 box-content">
      <button
        type="button"
        onClick={() => setSheet("symbols")}
        className="flex items-center gap-1.5 min-w-0 px-2 py-1.5 rounded-lg active:bg-secondary"
        data-testid="mobile-symbol"
      >
        <span className="flex flex-col items-start min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="text-[17px] font-bold tracking-tight truncate">{short}</span>
            <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {info && <VenueBadge symbol={info} />}
            <span className={cn("h-1.5 w-1.5 rounded-full", t.isFeedConnected ? "bg-emerald-400" : "bg-red-400")} />
          </span>
        </span>
      </button>
      <div className="flex-1" />
      <div className="text-right pr-1">
        <div
          className={cn(
            "font-mono font-bold text-[17px] tabular-nums leading-tight",
            dir === "up" ? "text-[#0ecb81]" : dir === "down" ? "text-[#f6465d]" : "text-foreground",
          )}
          data-testid="mobile-price"
        >
          {mid !== null ? formatNumber(mid, digits) : "—"}
        </div>
        {t.tick && (
          <div className="text-[11px] text-muted-foreground font-mono tabular-nums">
            spread {formatNumber(t.tick.ask - t.tick.bid, digits)}
          </div>
        )}
      </div>
      <IconButton label="Price alerts" onClick={() => setSheet("alerts")} badge={activeAlerts}>
        <Bell className="h-5 w-5" />
      </IconButton>
      <IconButton label="Chart menu" onClick={openChartMenu} testId="mobile-chart-menu">
        <MoreVertical className="h-5 w-5" />
      </IconButton>
    </header>
  );
}

function IconButton({
  label,
  onClick,
  children,
  badge,
  active,
  testId,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
  active?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-secondary",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      {children}
      {badge ? (
        <span className="absolute right-1.5 top-1.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-4">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function ChartTools() {
  const t = useTerminal();
  const drawOpen = useMobileStore((s) => s.drawOpen);
  const setDrawOpen = useMobileStore((s) => s.setDrawOpen);
  const setSheet = useMobileStore((s) => s.setSheet);
  const extras = t.activeIndicators.length + t.activePlugins.length;
  const chip = "shrink-0 h-8 px-3 rounded-lg text-[13px] font-medium";
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-card overflow-x-auto no-scrollbar shrink-0">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          disabled={t.isReplaying}
          onClick={() => t.setTimeframe(tf)}
          className={cn(
            chip,
            "px-2.5",
            tf === t.timeframe ? "bg-primary text-primary-foreground" : "text-muted-foreground active:bg-secondary",
          )}
        >
          {tf}
        </button>
      ))}
      <div className="h-5 border-l border-border mx-1 shrink-0" />
      <button
        type="button"
        onClick={() => setSheet("indicators")}
        className={cn(chip, "flex items-center gap-1", extras ? "bg-primary/15 text-primary" : "text-muted-foreground active:bg-secondary")}
      >
        <BarChart3 className="h-4 w-4" /> Indicators{extras ? ` · ${extras}` : ""}
      </button>
      <button
        type="button"
        onClick={() => {
          if (drawOpen) t.setDrawingTool("none");
          setDrawOpen(!drawOpen);
        }}
        className={cn(chip, "flex items-center gap-1", drawOpen ? "bg-primary/15 text-primary" : "text-muted-foreground active:bg-secondary")}
        data-testid="mobile-draw"
      >
        <PenTool className="h-4 w-4" /> Draw{t.drawings.length ? ` · ${t.drawings.length}` : ""}
      </button>
    </div>
  );
}

/** Buy / Sell under the chart, or the drawing bar while Draw is on. */
function ChartFooter() {
  const t = useTerminal();
  const drawOpen = useMobileStore((s) => s.drawOpen);
  const setDrawOpen = useMobileStore((s) => s.setDrawOpen);
  const done = useCallback(() => {
    t.setDrawingTool("none");
    setDrawOpen(false);
  }, [t, setDrawOpen]);
  useBackButton(drawOpen, done);
  if (!drawOpen) return <BuySellBar />;
  return (
    <MobileDrawingBar
      drawingTool={t.drawingTool}
      onDrawingTool={t.setDrawingTool}
      magnetMode={t.chartPrefs.magnetMode}
      onCycleMagnet={t.cycleMagnetMode}
      stayInDrawingMode={t.chartPrefs.stayInDrawingMode}
      onToggleStayInDrawingMode={() => updateChartPreferences({ stayInDrawingMode: !t.chartPrefs.stayInDrawingMode })}
      drawings={t.drawings}
      onUpdateDrawing={t.updateDrawing}
      onClearDrawings={t.clearDrawings}
      onUndo={t.undoDrawing}
      onRedo={t.redoDrawing}
      onDone={done}
    />
  );
}

function BuySellBar() {
  const t = useTerminal();
  const openTicket = useMobileStore((s) => s.openTicket);
  const digits = getPipDigits(t.symbolInfo, t.selectedSymbol);
  const price = (p?: number) => (p !== undefined ? formatNumber(p, digits) : "—");
  return (
    <div className="flex gap-2 px-2 pt-2 pb-2 border-t border-border bg-card shrink-0">
      <button
        type="button"
        onClick={() => openTicket("SELL")}
        className="flex-1 h-12 rounded-xl bg-[#f6465d] text-white active:brightness-90 flex flex-col items-center justify-center leading-tight"
        data-testid="mobile-sell"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider opacity-90">Sell</span>
        <span className="font-mono font-bold tabular-nums text-[15px]">{price(t.tick?.bid)}</span>
      </button>
      <button
        type="button"
        onClick={() => openTicket("BUY")}
        className="flex-1 h-12 rounded-xl bg-[#0ecb81] text-white active:brightness-90 flex flex-col items-center justify-center leading-tight"
        data-testid="mobile-buy"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider opacity-90">Buy</span>
        <span className="font-mono font-bold tabular-nums text-[15px]">{price(t.tick?.ask)}</span>
      </button>
    </div>
  );
}

function IndicatorsSheet() {
  const t = useTerminal();
  const sheet = useMobileStore((s) => s.sheet);
  const setSheet = useMobileStore((s) => s.setSheet);
  const close = useCallback(() => setSheet(null), [setSheet]);
  const row = "w-full flex items-center gap-3 px-4 h-12 text-left text-[15px] active:bg-secondary";
  return (
    <Sheet open={sheet === "indicators"} title="Indicators" onClose={close} testId="sheet-indicators">
      {INDICATOR_REGISTRY.map((ind) => {
        const on = t.activeIndicators.includes(ind.type);
        return (
          <button key={ind.type} type="button" onClick={() => t.toggleIndicator(ind.type)} className={row}>
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: ind.color }} />
            <span className="flex-1">{ind.label}</span>
            <span className="text-xs text-muted-foreground">{ind.pane}</span>
            <Toggle on={on} />
          </button>
        );
      })}
      <div className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Chart plugins</div>
      {CHART_PLUGIN_ITEMS.map(({ id, icon: Icon, label }) => (
        <button key={id} type="button" onClick={() => t.togglePlugin(id)} className={row}>
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1">{label}</span>
          <Toggle on={t.activePlugins.includes(id)} />
        </button>
      ))}
      {(t.activeIndicators.length > 0 || t.activePlugins.length > 0) && (
        <div className="p-4">
          <button
            type="button"
            onClick={() => {
              t.clearIndicators();
              t.setPlugins([]);
            }}
            className="w-full h-11 rounded-xl border border-border text-[15px] active:bg-secondary"
          >
            Remove all
          </button>
        </div>
      )}
    </Sheet>
  );
}

function AlertsSheet() {
  const t = useTerminal();
  const sheet = useMobileStore((s) => s.sheet);
  const setSheet = useMobileStore((s) => s.setSheet);
  const setTab = useMobileStore((s) => s.setTab);
  const ticks = useTradingStore((s) => s.ticks);
  const close = useCallback(() => setSheet(null), [setSheet]);
  const open = sheet === "alerts";
  // Ask for notification permission when the alerts open, so a firing can reach the phone.
  useEffect(() => {
    if (open) void mobileBridge()?.ensureNotifications();
  }, [open]);
  const midOf = useCallback(
    (s: string) => {
      const k = ticks[s];
      return k ? (k.bid + k.ask) / 2 : null;
    },
    [ticks],
  );
  return (
    <Sheet open={open} title="Price alerts" onClose={close} full testId="sheet-alerts">
      <div className="oc-alerts">
        <AlertsPanel
          defaultSymbol={t.selectedSymbol}
          midOf={midOf}
          symbols={t.symbols.map((s) => s.name)}
          onChart={(s) => {
            t.setSelectedSymbol(s);
            setTab("chart");
          }}
        />
      </div>
    </Sheet>
  );
}

// ── Trade tab ─────────────────────────────────────────────

function TradePane() {
  const t = useTerminal();
  const side = useMobileStore((s) => s.ticketSide);
  const nonce = useMobileStore((s) => s.ticketNonce);
  const setSheet = useMobileStore((s) => s.setSheet);
  const [depth, setDepth] = useState(false);
  const short = t.selectedSymbol.includes(":") ? t.selectedSymbol.split(":")[1] : t.selectedSymbol;
  return (
    <Pane
      title="Trade"
      testId="pane-trade"
      right={
        <button
          type="button"
          onClick={() => setSheet("symbols")}
          className="flex items-center gap-1 h-9 px-3 rounded-lg bg-secondary text-sm font-semibold"
        >
          {short} <ChevronDown className="h-4 w-4 opacity-60" />
        </button>
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="oc-ticket">
          <OrderPanel
            key={nonce}
            initialSide={side}
            symbol={t.selectedSymbol}
            symbolInfo={t.symbolInfo}
            tick={t.tick}
            accountId={t.activeAccountId}
            oneClick={t.oneClick}
            onToggleOneClick={t.toggleOneClick}
            onConfirmOrder={t.requestOrderConfirmation}
            accountBalance={t.account?.balance}
            isFeedConnected={t.isFeedConnected}
            soundMuted={t.soundMuted}
            onToggleMute={t.toggleSoundMute}
            onOrderSuccess={t.onOrderSuccess}
          />
        </div>
        <button
          type="button"
          onClick={() => setDepth((v) => !v)}
          className="w-full flex items-center justify-between px-4 h-12 border-t border-border text-[15px] font-medium active:bg-secondary"
        >
          Depth of market <ChevronDown className={cn("h-4 w-4 transition-transform", depth && "rotate-180")} />
        </button>
        {depth && (
          <div className="h-[420px] flex flex-col border-t border-border">
            <DOMPanel symbol={t.selectedSymbol} tick={t.tick} />
          </div>
        )}
      </div>
    </Pane>
  );
}

// ── Orders tab ────────────────────────────────────────────

function OrdersPane() {
  const t = useTerminal();
  const ordersTab = useMobileStore((s) => s.ordersTab);
  const setOrdersTab = useMobileStore((s) => s.setOrdersTab);
  const setTab = useMobileStore((s) => s.setTab);
  const toChart = (s: string) => {
    t.setSelectedSymbol(s);
    setTab("chart");
  };
  return (
    <Pane title="Orders & positions" testId="pane-orders">
      <AccountStrip />
      <BottomPanel
        fill
        tab={ordersTab}
        onTabChange={setOrdersTab}
        positions={t.positions}
        orders={t.orders}
        accountId={t.activeAccountId}
        onModifyPosition={t.editPosition}
        onModifyOrder={t.editOrder}
        onSelectPositionSymbol={toChart}
        onSelectOrderSymbol={toChart}
        isFeedConnected={t.isFeedConnected}
        journalEntries={t.journalEntries}
        journalLoading={t.journalLoading}
        onCreateJournal={t.createJournal}
        onUpdateJournal={t.updateJournal}
        onDeleteJournal={t.deleteJournal}
      />
    </Pane>
  );
}

// ── Bottom navigation ─────────────────────────────────────

function BottomNav() {
  const t = useTerminal();
  const tab = useMobileStore((s) => s.tab);
  const setTab = useMobileStore((s) => s.setTab);
  const open = t.positions.filter((p) => p.quantity > 0).length + t.orders.filter((o) => o.status === "PENDING" || o.status === "NEW").length;
  const items: Array<{ key: MobileTab; label: string; icon: typeof Menu; badge?: number }> = [
    { key: "chart", label: "Chart", icon: CandlestickChart },
    { key: "markets", label: "Markets", icon: Search },
    { key: "trade", label: "Trade", icon: ArrowLeftRight },
    { key: "orders", label: "Orders", icon: ClipboardList, badge: open },
    { key: "more", label: "More", icon: Menu },
  ];
  return (
    <nav className="flex border-t border-border bg-card shrink-0 z-20" style={{ paddingBottom: "var(--oc-safe-bottom)" }} data-testid="bottom-nav">
      {items.map(({ key, label, icon: Icon, badge }) => (
        <button
          key={key}
          type="button"
          onClick={() => setTab(key)}
          data-tab={key}
          className={cn(
            "relative flex-1 flex flex-col items-center justify-center gap-0.5 h-14 text-[11px] font-medium",
            tab === key ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Icon className="h-[22px] w-[22px]" strokeWidth={tab === key ? 2.2 : 1.8} />
          {label}
          {badge ? (
            <span className="absolute top-1.5 left-1/2 ml-2 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-4">
              {badge}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
