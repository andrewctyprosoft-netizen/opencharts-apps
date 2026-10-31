import { Bell, BriefcaseBusiness, ListOrdered, Loader2, RefreshCw, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopBridge, VenueBalance, VenueId, VenueOrder, VenueStatus } from "../../../adapters/types.ts";
import { ipcMessage } from "../../../adapters/venues.ts";
import { priceFor, usdtPrices } from "../../../adapters/wallets.ts";
import { cn } from "../lib/utils.ts";
import { toast } from "../services/toast.ts";
import { AlertsPanel } from "./AlertsPanel.tsx";
import { useAlerts } from "./alerts-store.ts";
import { fmtNum, fmtPrice, fmtUsd, pctClass } from "./dash-format.ts";
import { type DeskMessage, type DeskSnapshot, openDeskChannel } from "./desk-channel.ts";
import { isMobileApp } from "../mobile/is-mobile.ts";

/**
 * OpenCharts Desktop addition: File › Dashboard › Alerts & positions. One
 * place for every price alert, every open position (paper account, OANDA
 * trades) and every open order (paper, the six exchanges, OANDA), with close
 * and cancel. The paper account comes from the terminal window over a
 * BroadcastChannel; real accounts come from the API keys in the main process.
 */

const VENUES: VenueId[] = ["binance", "okx", "bybit", "kucoin", "coinbase", "mexc", "oanda"];
const REFRESH_MS = 30_000;
const STALE_MS = 6_000;

interface VenueData {
  balances: VenueBalance[];
  orders: VenueOrder[];
  error: string;
}

interface PositionRow {
  key: string;
  venue: string;
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  entry: number;
  current: number | null;
  pnl: number | null;
  close: () => void;
}

interface OrderRow {
  key: string;
  venue: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  price: number | null;
  qty: number;
  filled: number;
  time: number;
  cancel: () => void;
}

export function DeskPage({ bridge }: { bridge: DesktopBridge }) {
  const { alerts, log } = useAlerts();
  const [snap, setSnap] = useState<DeskSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState<Record<VenueId, VenueStatus> | null>(null);
  const [venues, setVenues] = useState<Partial<Record<VenueId, VenueData>>>({});
  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const channel = useRef<ReturnType<typeof openDeskChannel> | null>(null);

  useEffect(() => {
    const ch = openDeskChannel((m: DeskMessage) => {
      if (m.type === "snapshot") setSnap(m);
      else if (m.type === "result") (m.ok ? toast.success : toast.error)(m.ok ? m.message : "Not done", m.ok ? "" : m.message);
    });
    channel.current = ch;
    ch.post({ type: "hello" });
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(clock);
      ch.close();
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [st, px] = await Promise.allSettled([bridge.trade.status(), bridge.web.get("https://api.binance.com/api/v3/ticker/price")]);
      if (px.status === "fulfilled" && px.value.status < 400) setPrices(usdtPrices(px.value.body));
      if (st.status !== "fulfilled") return;
      setStatus(st.value);
      const entries = await Promise.all(
        VENUES.filter((id) => st.value[id]?.configured).map(async (id) => {
          const [b, o] = await Promise.allSettled([bridge.trade.balances(id), bridge.trade.openOrders(id)]);
          const err = [b, o].find((r): r is PromiseRejectedResult => r.status === "rejected");
          return [
            id,
            {
              balances: b.status === "fulfilled" ? b.value : [],
              orders: o.status === "fulfilled" ? o.value : [],
              error: err ? ipcMessage(err.reason) : "",
            },
          ] as const;
        }),
      );
      setVenues(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const live = snap !== null && now - snap.at < STALE_MS;
  const label = (id: VenueId) => status?.[id]?.label ?? id;
  const send = (m: DeskMessage) => channel.current?.post(m);
  const run = async (what: string, p: Promise<unknown>, venue: VenueId) => {
    try {
      await p;
      toast.success(what, "");
      setTimeout(() => void refresh(), 800);
    } catch (err) {
      toast.error(`${label(venue)}: not done`, ipcMessage(err));
    }
  };

  // ── Unified positions and orders ──
  const positions: PositionRow[] = useMemo(() => {
    const rows: PositionRow[] = (live ? snap!.positions : []).map((p) => ({
      key: `paper-${p.id}`,
      venue: "Paper",
      symbol: p.symbolName,
      side: p.side,
      qty: p.quantity,
      entry: p.entryPrice,
      current: p.currentPrice ?? snap!.mids[p.symbolName] ?? null,
      pnl: p.unrealizedPnl,
      close: () => window.confirm(`Close the paper ${p.side} ${p.quantity} ${p.symbolName}?`) && send({ type: "close-position", id: p.id }),
    }));
    for (const t of venues.oanda?.orders.filter((o) => o.type === "TRADE") ?? []) {
      const symbol = t.native.replace("_", "");
      rows.push({
        key: `oanda-${t.id}`,
        venue: "OANDA",
        symbol,
        side: t.side === "BUY" ? "LONG" : "SHORT",
        qty: t.qty,
        entry: t.price ?? 0,
        current: snap?.mids[symbol] ?? null,
        pnl: t.pnl ?? null,
        close: () =>
          window.confirm(`Close the OANDA trade ${t.side} ${t.qty} ${t.native}? This is a real order.`) &&
          void run("OANDA trade closed", bridge.trade.closeTrade("oanda", t.id), "oanda"),
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, live, venues]);

  const orders: OrderRow[] = useMemo(() => {
    const rows: OrderRow[] = (live ? snap!.orders : []).map((o) => ({
      key: `paper-${o.id}`,
      venue: "Paper",
      symbol: o.symbolName,
      side: o.side,
      type: o.type,
      price: o.price ?? o.stopPrice,
      qty: o.quantity,
      filled: o.filledQuantity,
      time: Date.parse(o.createdAt) || 0,
      cancel: () => send({ type: "cancel-order", id: o.id }),
    }));
    for (const id of VENUES) {
      for (const o of venues[id]?.orders.filter((x) => x.type !== "TRADE") ?? []) {
        rows.push({
          key: `${id}-${o.id}`,
          venue: label(id),
          symbol: o.native,
          side: o.side,
          type: o.type,
          price: o.price,
          qty: o.qty,
          filled: o.filled,
          time: o.time,
          cancel: () =>
            window.confirm(`Cancel ${o.side} ${o.qty} ${o.native} on ${label(id)}?`) &&
            void run("Order cancelled", bridge.trade.cancel(id, o.native, o.id), id),
        });
      }
    }
    return rows.sort((a, b) => b.time - a.time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, live, venues, status]);

  const holdings = VENUES.filter((id) => id !== "oanda" && status?.[id]?.configured).map((id) => {
    const rows = (venues[id]?.balances ?? []).map((b) => {
      const p = priceFor(b.asset, prices);
      return { ...b, value: b.usd ?? (p === null ? null : (b.free + b.locked) * p) };
    });
    rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return { id, rows, total: rows.reduce((s, r) => s + (r.value ?? 0), 0), error: venues[id]?.error ?? "" };
  });

  const unrealized = positions.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const fired24h = log.filter((e) => now - e.time < 86_400_000).length;
  const connected = VENUES.filter((id) => status?.[id]?.configured).length;
  const midOf = useCallback((symbol: string) => snap?.mids[symbol] ?? null, [snap]);

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card">
        <h1 className={isMobileApp() ? "hidden" : "text-base font-semibold"}>Alerts &amp; positions</h1>
        <span
          data-testid="desk-terminal"
          className={cn("text-[11px] px-2 py-0.5 rounded", live ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell")}
          title="Alerts are checked and the paper account runs in the main terminal window"
        >
          {live ? "Terminal running · alerts armed" : "Terminal window not running: alerts are not checked"}
        </span>
        <div className="flex-1" />
        <button onClick={() => void bridge.app.openWindow("portfolio")} className="px-2.5 py-1.5 rounded-md hover:bg-secondary text-[12px] text-muted-foreground">
          Portfolio
        </button>
        <button onClick={() => void bridge.trade.openKeys()} className="px-2.5 py-1.5 rounded-md hover:bg-secondary text-[12px] text-muted-foreground">
          API keys
        </button>
        <button onClick={() => void refresh()} disabled={loading} title="Refresh accounts" className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground disabled:opacity-50">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-testid="desk-summary">
          <Stat label="Active alerts" value={String(alerts.filter((a) => a.status === "active").length)} />
          <Stat label="Alerts fired (24h)" value={String(fired24h)} />
          <Stat label="Open positions" value={String(positions.length)} />
          <Stat label="Open orders" value={String(orders.length)} />
          <Stat label="Unrealized P&L" value={`${unrealized >= 0 ? "+" : ""}${fmtUsd(unrealized)}`} className={pctClass(unrealized)} />
          <Stat label="Accounts" value={`Paper ${live && snap!.account ? fmtUsd(snap!.account.equity, 1e9) : "—"} · ${connected}/7 live`} small />
        </div>

        <Section icon={<Bell className="h-4 w-4 text-[#f0b90b]" />} title="Price alerts" note={`Fire once or every time the price crosses; a ${isMobileApp() ? "phone" : "Windows"} notification, sound and toast while the app runs.`}>
          <div className="h-[340px] rounded-lg border border-border bg-card overflow-hidden">
            <AlertsPanel
              defaultSymbol={snap?.selected ?? ""}
              midOf={midOf}
              symbols={snap?.symbols ?? []}
              onChart={(symbol) => void bridge.app.openChart(symbol)}
            />
          </div>
        </Section>

        <Section icon={<BriefcaseBusiness className="h-4 w-4 text-primary" />} title="Open positions" note="Paper account and OANDA trades. Spot exchange holdings are listed under Holdings.">
          <Table
            testId="desk-positions"
            head={["Venue", "Symbol", "Side", "Quantity", "Entry", "Current", "Unrealized P&L", ""]}
            empty={live ? "No open positions." : "Open the terminal window to see the paper account."}
            rows={positions.map((p) => [
              p.venue,
              <button key="s" onClick={() => void bridge.app.openChart(p.symbol)} className="font-medium hover:underline">
                {p.symbol}
              </button>,
              <span key="d" className={p.side === "LONG" ? "text-buy" : "text-sell"}>{p.side}</span>,
              fmtNum(p.qty),
              fmtPrice(p.entry),
              fmtPrice(p.current),
              <span key="p" className={cn("font-mono", pctClass(p.pnl))}>{p.pnl === null ? "—" : `${p.pnl >= 0 ? "+" : ""}${fmtUsd(p.pnl)}`}</span>,
              <SmallButton key="c" onClick={p.close}>Close</SmallButton>,
            ])}
          />
        </Section>

        <Section icon={<ListOrdered className="h-4 w-4 text-primary" />} title="Open orders" note="Resting orders on the paper account, every exchange with a key, and OANDA.">
          <Table
            testId="desk-orders"
            head={["Venue", "Symbol", "Side", "Type", "Price", "Filled / qty", "Placed", ""]}
            empty="No open orders."
            rows={orders.map((o) => [
              o.venue,
              o.symbol,
              <span key="d" className={o.side === "BUY" ? "text-buy" : "text-sell"}>{o.side}</span>,
              o.type,
              o.price ? fmtPrice(o.price) : "market",
              `${fmtNum(o.filled)} / ${fmtNum(o.qty)}`,
              o.time ? new Date(o.time).toLocaleString() : "—",
              <SmallButton key="c" onClick={o.cancel}>Cancel</SmallButton>,
            ])}
          />
        </Section>

        <Section icon={<Wallet className="h-4 w-4 text-primary" />} title="Holdings" note="Spot balances per exchange; File › Dashboard › Portfolio has every asset and your wallets.">
          {status === null ? (
            <div className="text-[12px] text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking API keys…
            </div>
          ) : holdings.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">
              No exchange API keys yet.{" "}
              <button onClick={() => void bridge.trade.openKeys()} className="text-primary hover:underline">
                Add one
              </button>{" "}
              to see balances and real orders here.
            </div>
          ) : (
            <Table
              testId="desk-holdings"
              head={["Exchange", "Value", "Assets", "Largest"]}
              empty=""
              rows={holdings.map((h) => [
                label(h.id),
                fmtUsd(h.total, 1e9),
                String(h.rows.length),
                h.error ? <span key="e" className="text-sell">{h.error}</span> : h.rows.slice(0, 4).map((r) => `${r.asset} ${fmtUsd(r.value)}`).join(" · ") || "—",
              ])}
            />
          )}
          {Object.entries(venues).some(([id, v]) => id === "oanda" && v?.error) && <div className="text-[12px] text-sell mt-2">OANDA: {venues.oanda!.error}</div>}
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value, className, small }: { label: string; value: string; className?: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("font-mono tabular-nums mt-0.5 truncate", small ? "text-[13px] pt-1" : "text-lg", className)}>{value}</div>
    </div>
  );
}

function Section({ icon, title, note, children }: { icon: React.ReactNode; title: string; note: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="self-center">{icon}</span>
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <span className="text-[11px] text-muted-foreground">{note}</span>
      </div>
      {children}
    </section>
  );
}

function Table({ head, rows, empty, testId }: { head: string[]; rows: React.ReactNode[][]; empty: string; testId: string }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-x-auto" data-testid={testId}>
      <table className="w-full min-w-[720px] text-[12px]">
        <thead className="text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={cn("px-3 py-1.5 font-medium", i <= 1 ? "text-left" : "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/40 hover:bg-secondary/60">
              {r.map((c, j) => (
                <td key={j} className={cn("px-3 py-1.5 whitespace-nowrap", j <= 1 ? "text-left" : "text-right", j > 2 && "font-mono")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && empty && (
            <tr>
              <td colSpan={head.length} className="px-3 py-4 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SmallButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="px-2 py-0.5 rounded border border-border hover:bg-secondary font-sans">
      {children}
    </button>
  );
}
