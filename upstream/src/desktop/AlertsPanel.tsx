import { Bell, BellOff, LineChart, Pause, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AlertMode, PriceAlert } from "../../../adapters/alerts.ts";
import { parseAmount } from "../../../adapters/market-filter.ts";
import { cn } from "../lib/utils.ts";
import { toast } from "../services/toast.ts";
import { alertsStore, useAlerts } from "./alerts-store.ts";
import { fmtPrice } from "./dash-format.ts";
import { VenueBadge } from "./VenueBadge.tsx";
import { isMobileApp } from "../mobile/is-mobile.ts";

/**
 * OpenCharts Desktop addition: the price alert list, used by the Alerts tab
 * under the chart and by the Alerts & positions window. Alerts are created
 * here or by right-clicking the chart (Set alert), and fire once or every time
 * the price crosses them.
 */

type Filter = "all" | "active" | "triggered" | "paused" | "log";

interface Props {
  /** Symbol the add form starts on (the charted one in the terminal). */
  defaultSymbol: string;
  /** Last mid price of a symbol, when known. */
  midOf: (symbol: string) => number | null;
  /** Symbols offered by the add form. */
  symbols: string[];
  onChart?: (symbol: string) => void;
  /** Smaller rows for the bottom panel. */
  compact?: boolean;
}

const ago = (t: number | null) => {
  if (!t) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
};

export function AlertsPanel({ defaultSymbol, midOf, symbols, onChart, compact }: Props) {
  const { alerts, log } = useAlerts();
  const [filter, setFilter] = useState<Filter>("all");
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState("");
  const [mode, setMode] = useState<AlertMode>("once");
  const [note, setNote] = useState("");
  const formSymbol = symbol.trim() || defaultSymbol;
  const formMid = midOf(formSymbol);

  const add = () => {
    const p = parseAmount(price || (formMid !== null ? String(formMid) : ""));
    if (!formSymbol || p === null || p <= 0) {
      toast.warning("Alert not added", "Enter a symbol and a price above zero.");
      return;
    }
    if (symbols.length && !symbols.includes(formSymbol)) {
      toast.warning("Unknown symbol", `${formSymbol} is not in the symbol list.`);
      return;
    }
    alertsStore.add(formSymbol, p, formMid, mode, note.trim());
    setPrice("");
    setNote("");
  };

  const counts = {
    all: alerts.length,
    active: alerts.filter((a) => a.status === "active").length,
    triggered: alerts.filter((a) => a.status === "triggered").length,
    paused: alerts.filter((a) => a.status === "paused").length,
    log: log.length,
  };
  const shown = [...alerts]
    .filter((a) => filter === "all" || a.status === filter)
    .sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === "active" ? -1 : b.status === "active" ? 1 : 0));
  const pad = compact ? "px-2 py-1" : "px-3 py-1.5";

  return (
    <div className="flex flex-col h-full text-[12px]" data-testid="alerts-panel">
      {/* Add form */}
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-b border-border">
        <Bell className="h-3.5 w-3.5 text-[#f0b90b]" />
        <input
          list="ocd-alert-symbols"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder={defaultSymbol}
          aria-label="Alert symbol"
          className="w-44 px-2 py-1 rounded border border-border bg-background font-mono"
        />
        <datalist id="ocd-alert-symbols">
          {symbols.slice(0, 2000).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <input
          data-testid="alert-price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={formMid !== null ? fmtPrice(formMid).replace(/,/g, "") : "price"}
          aria-label="Alert price"
          className="w-28 px-2 py-1 rounded border border-border bg-background font-mono"
        />
        <select value={mode} onChange={(e) => setMode(e.target.value as AlertMode)} aria-label="Alert repeat" className="px-2 py-1 rounded border border-border bg-background">
          <option value="once">Once</option>
          <option value="repeat">Every time</option>
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Alert note" className="w-40 px-2 py-1 rounded border border-border bg-background" />
        <button data-testid="alert-add" onClick={add} className="flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-primary-foreground font-medium">
          <Plus className="h-3.5 w-3.5" /> Add alert
        </button>
        <span className="text-muted-foreground ml-1 hidden lg:inline">or right-click the chart › Set alert</span>
        <div className="flex-1" />
        {(["all", "active", "triggered", "paused", "log"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn("px-2 py-0.5 rounded capitalize", filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}
          >
            {f === "log" ? "Log" : f} {counts[f] > 0 && <span className="opacity-70">{counts[f]}</span>}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {filter === "log" ? (
          <table className="w-full">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr>
                <th className={cn(pad, "text-left font-medium")}>Time</th>
                <th className={cn(pad, "text-left font-medium")}>Symbol</th>
                <th className={cn(pad, "text-left font-medium")}>Crossed</th>
                <th className={cn(pad, "text-right font-medium")}>Alert price</th>
                <th className={cn(pad, "text-right font-medium")}>Price then</th>
                <th className={cn(pad, "text-left font-medium")}>Note</th>
              </tr>
            </thead>
            <tbody>
              {log.map((e) => (
                <tr key={e.id} className="border-t border-border/40">
                  <td className={cn(pad, "text-muted-foreground whitespace-nowrap")}>{new Date(e.time).toLocaleString()}</td>
                  <td className={cn(pad, "font-medium")}>{e.symbol}</td>
                  <td className={cn(pad, e.direction === "up" ? "text-buy" : "text-sell")}>{e.direction === "up" ? "↑ up" : "↓ down"}</td>
                  <td className={cn(pad, "text-right font-mono")}>{fmtPrice(e.price)}</td>
                  <td className={cn(pad, "text-right font-mono")}>{fmtPrice(e.mid)}</td>
                  <td className={cn(pad, "text-muted-foreground")}>{e.note}</td>
                </tr>
              ))}
              {!log.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No alert has fired yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full" data-testid="alerts-table">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr>
                <th className={cn(pad, "text-left font-medium")}>Symbol</th>
                <th className={cn(pad, "text-left font-medium")}>Condition</th>
                <th className={cn(pad, "text-right font-medium")}>Now</th>
                <th className={cn(pad, "text-left font-medium")}>Repeat</th>
                <th className={cn(pad, "text-left font-medium")}>Status</th>
                <th className={cn(pad, "text-left font-medium")}>Fired</th>
                <th className={cn(pad, "text-left font-medium")}>Note</th>
                <th className={pad} />
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <AlertRow key={a.id} a={a} mid={midOf(a.symbol)} pad={pad} onChart={onChart} />
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                    {alerts.length
                      ? "No alerts in this view."
                      : isMobileApp() // OpenCharts Mobile patch: no right-click on a phone
                        ? "No alerts yet. Add one above, or use the chart's ⋮ menu › Set alert."
                        : "No alerts yet. Right-click a price on the chart and choose Set alert, or add one above."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {filter === "log" && log.length > 0 && (
        <div className="px-2 py-1 border-t border-border text-right">
          <button onClick={() => alertsStore.clearLog()} className="text-muted-foreground hover:text-foreground">
            Clear log
          </button>
        </div>
      )}
    </div>
  );
}

function AlertRow({ a, mid, pad, onChart }: { a: PriceAlert; mid: number | null; pad: string; onChart?: (symbol: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [priceText, setPriceText] = useState(String(a.price));
  const distance = mid !== null && mid > 0 ? ((a.price - mid) / mid) * 100 : null;
  const savePrice = () => {
    const p = parseAmount(priceText);
    if (p !== null && p > 0 && p !== a.price) alertsStore.update(a.id, { price: p }, mid);
    setEditing(false);
  };
  return (
    <tr className={cn("border-t border-border/40 hover:bg-secondary/60", a.status !== "active" && "opacity-60")} data-alert-status={a.status}>
      <td className={cn(pad, "whitespace-nowrap")}>
        <span className="flex items-center gap-1.5">
          <span className="font-medium">{a.symbol}</span>
          {/* Exchange pairs carry a prefix; six letters are forex or metals; anything else is a DEX pool. */}
          <VenueBadge symbol={{ name: a.symbol, category: a.symbol.includes(":") ? null : /^[A-Z]{6}$/.test(a.symbol) ? "FOREX" : "DEX" }} />
        </span>
      </td>
      <td className={cn(pad, "whitespace-nowrap")}>
        {editing ? (
          <input
            autoFocus
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            onBlur={savePrice}
            onKeyDown={(e) => (e.key === "Enter" ? savePrice() : e.key === "Escape" && setEditing(false))}
            className="w-28 px-1.5 py-0.5 rounded border border-border bg-background font-mono"
          />
        ) : (
          <button onClick={() => setEditing(true)} title="Click to change the price" className="font-mono hover:underline">
            Crossing {fmtPrice(a.price)}
          </button>
        )}
        {distance !== null && a.status === "active" && (
          <span className="ml-1.5 text-muted-foreground">({distance > 0 ? "+" : ""}{distance.toFixed(2)}%)</span>
        )}
      </td>
      <td className={cn(pad, "text-right font-mono")}>{fmtPrice(mid)}</td>
      <td className={pad}>
        <select
          value={a.mode}
          onChange={(e) => alertsStore.update(a.id, { mode: e.target.value as AlertMode })}
          aria-label="Repeat"
          className="px-1 py-0.5 rounded border border-border bg-background"
        >
          <option value="once">Once</option>
          <option value="repeat">Every time</option>
        </select>
      </td>
      <td className={pad}>
        <span
          className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase",
            a.status === "active" ? "bg-buy/15 text-buy" : a.status === "triggered" ? "bg-[#f0b90b]/15 text-[#f0b90b]" : "bg-secondary text-muted-foreground",
          )}
        >
          {a.status}
        </span>
      </td>
      <td className={cn(pad, "whitespace-nowrap text-muted-foreground")}>{a.count ? `${a.count}× · ${ago(a.triggeredAt)}` : "—"}</td>
      <td className={pad}>
        <input
          defaultValue={a.note}
          onBlur={(e) => e.target.value !== a.note && alertsStore.update(a.id, { note: e.target.value.trim() })}
          placeholder="—"
          aria-label="Note"
          className="w-full min-w-24 px-1 py-0.5 rounded bg-transparent hover:bg-background focus:bg-background border border-transparent focus:border-border"
        />
      </td>
      <td className={cn(pad, "whitespace-nowrap text-right")}>
        {a.status === "active" ? (
          <IconButton title="Pause" onClick={() => alertsStore.update(a.id, { status: "paused" })}>
            <Pause className="h-3.5 w-3.5" />
          </IconButton>
        ) : a.status === "paused" ? (
          <IconButton title="Resume" onClick={() => alertsStore.update(a.id, { status: "active" }, mid)}>
            <Play className="h-3.5 w-3.5" />
          </IconButton>
        ) : (
          <IconButton title="Re-arm (fire again on the next crossing)" onClick={() => alertsStore.update(a.id, { status: "active" }, mid)}>
            <RotateCcw className="h-3.5 w-3.5" />
          </IconButton>
        )}
        {onChart && (
          <IconButton title="Chart" onClick={() => onChart(a.symbol)}>
            <LineChart className="h-3.5 w-3.5" />
          </IconButton>
        )}
        <IconButton title="Delete" onClick={() => alertsStore.remove(a.id)}>
          {a.status === "triggered" ? <BellOff className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
        </IconButton>
      </td>
    </tr>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} className="p-1 rounded hover:bg-border text-muted-foreground hover:text-foreground">
      {children}
    </button>
  );
}
