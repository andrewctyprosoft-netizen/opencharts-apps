import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DexPool } from "../../../adapters/types.ts";
import { getAdapter } from "../adapter/registry.ts";
import { cn } from "../lib/utils.ts";
import { isDesktopAdapter } from "./is-desktop.ts";

/**
 * OpenCharts Desktop addition: GeckoTerminal pool search inside the symbol
 * picker. Picking a pool adds it to the symbol list and charts it.
 */

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatPrice(p: number): string {
  if (p >= 1) return p.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return p.toPrecision(4);
}

export function DexSearch({ query, onPick }: { query: string; onPick: (symbol: string) => void }) {
  const adapter = getAdapter();
  // The last finished search; results for any other query are not shown.
  const [found, setFound] = useState<{ q: string; pools: DexPool[]; error: string } | null>(null);
  const [, setVersion] = useState(0);
  const q = query.trim();
  const current = found?.q === q ? found : null;
  const results = current?.pools ?? [];
  const error = current?.error ?? "";
  const state = q.length < 2 ? "idle" : !current ? "loading" : error ? "error" : "idle";

  useEffect(() => {
    if (!isDesktopAdapter(adapter) || q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      adapter.marketData
        .searchDex(q)
        .then((pools) => {
          if (!cancelled) setFound({ q, pools: pools.slice(0, 15), error: "" });
        })
        .catch((err: unknown) => {
          if (!cancelled) setFound({ q, pools: [], error: String((err as Error).message ?? err) });
        });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [adapter, q]);

  if (!isDesktopAdapter(adapter)) return null;
  const md = adapter.marketData;

  return (
    <div className="border-t border-border">
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>DEX pools (GeckoTerminal)</span>
        {state === "loading" && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
      {q.length < 2 && (
        <div className="px-3 pb-2 text-xs text-muted-foreground">
          Type a token name, ticker or contract address to search every chain.
        </div>
      )}
      {state === "error" && <div className="px-3 pb-2 text-xs text-destructive">{error}</div>}
      {q.length >= 2 && state === "idle" && results.length === 0 && (
        <div className="px-3 pb-2 text-xs text-muted-foreground">No pools match &ldquo;{q}&rdquo;</div>
      )}
      {results.map((pool) => {
        const savedName = md.savedDexName(pool);
        return (
          <div
            key={`${pool.network}:${pool.address}`}
            className={cn("group flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-secondary", savedName && "bg-secondary/40")}
          >
            <button
              className="flex-1 min-w-0 text-left"
              title={`${pool.network} · ${pool.address}`}
              onClick={async () => onPick(savedName ?? (await md.addDex(pool)))}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium truncate">
                  {pool.base}/{pool.quote}
                </span>
                <span className="text-xs tabular-nums">${formatPrice(pool.priceUsd)}</span>
              </div>
              <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">
                  {pool.dex} · {pool.network}
                </span>
                <span className="shrink-0">liq {compactUsd.format(pool.liquidityUsd)}</span>
              </div>
            </button>
            {savedName ? (
              <button
                className="p-1 rounded hover:bg-background text-muted-foreground hover:text-destructive"
                title={`Remove ${savedName} from the symbol list`}
                onClick={async () => {
                  await md.removeDex(savedName);
                  setVersion((v) => v + 1);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : (
              <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
            )}
          </div>
        );
      })}
    </div>
  );
}
