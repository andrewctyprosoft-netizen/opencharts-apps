import { cn } from "../lib/utils.ts";
import { useTerminal } from "../terminal/use-terminal.ts";

/** OpenCharts Mobile addition: small pieces shared by the phone screens. */

export function Toggle({ on }: { on: boolean }) {
  return (
    <span className={cn("relative inline-block h-6 w-10 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-secondary")}>
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </span>
  );
}

/** Paper account balance, equity, margin and open P&L. */
export function AccountStrip() {
  const t = useTerminal();
  const money = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const cells: Array<[string, string, string?]> = [
    ["Balance", money(t.account?.balance ?? 0)],
    ["Equity", money(t.account?.equity ?? t.account?.balance ?? 0)],
    ["Margin", money(t.account?.margin ?? 0)],
    [
      "P&L",
      `${t.positionPnl >= 0 ? "+" : ""}${money(t.positionPnl)}`,
      t.positionPnl > 0 ? "text-[#0ecb81]" : t.positionPnl < 0 ? "text-[#f6465d]" : "",
    ],
  ];
  return (
    <div className="grid grid-cols-4 gap-px bg-border border-b border-border shrink-0" data-testid="account-strip">
      {cells.map(([label, value, cls]) => (
        <div key={label} className="bg-card px-2 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className={cn("font-mono text-[12px] font-semibold tabular-nums truncate", cls)}>{value}</div>
        </div>
      ))}
    </div>
  );
}
