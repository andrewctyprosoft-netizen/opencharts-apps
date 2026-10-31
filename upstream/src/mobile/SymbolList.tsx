import { Search, Star, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { venueGroup, venueOf } from "../../../adapters/venues.ts";
import { DexSearch } from "../desktop/DexSearch.tsx";
import { VenueBadge } from "../desktop/VenueBadge.tsx";
import { safeStorage } from "../lib/safe-storage.ts";
import { cn } from "../lib/utils.ts";
import { useTradingStore } from "../services/store.tsx";

/**
 * OpenCharts Mobile addition: the symbol list used by the Markets tab and the
 * symbol picker. Same search as the desktop picker (several words, venue
 * names), venue chips, a starred list shared with the watchlist, live prices,
 * and the GeckoTerminal DEX search under the results.
 */

/** Rows shown at once; the rest are reached by searching or picking a venue. */
const ROWS = 150;
const FAVORITES_KEY = "watchlist_favorites";

interface SymbolRow {
  id?: string;
  name: string;
  displayName?: string | null;
  category?: string;
  assetClass?: string;
}

function formatQuote(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 10) return p.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  if (p >= 1) return p.toFixed(5);
  return p.toPrecision(4);
}

function readFavorites(): Set<string> {
  try {
    const saved = safeStorage.getItem(FAVORITES_KEY);
    return new Set(saved ? (JSON.parse(saved) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function SymbolList({
  symbols,
  selectedSymbol,
  onPick,
  autoFocus,
}: {
  symbols: SymbolRow[];
  selectedSymbol: string;
  onPick: (name: string) => void;
  autoFocus?: boolean;
}) {
  const ticks = useTradingStore((s) => s.ticks);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(readFavorites);
  const [chip, setChip] = useState<string | null>(() => (readFavorites().size ? "★" : null));

  const toggleFavorite = useCallback((name: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      safeStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const groups = useMemo(() => [...new Set(symbols.map((s) => venueGroup(s)))], [symbols]);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = symbols.filter((s) => {
    // A search looks through everything; the chips narrow an empty search.
    if (!terms.length && chip === "★" && !favorites.has(s.name)) return false;
    if (chip && chip !== "★" && venueGroup(s) !== chip) return false;
    const hay = `${s.name} ${s.displayName ?? ""} ${s.category ?? ""} ${venueOf(s).label}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const shown = filtered.slice(0, ROWS);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-1 pb-2 space-y-2 border-b border-border">
        <label className="flex items-center gap-2 h-11 px-3 rounded-xl bg-secondary/70 focus-within:ring-1 focus-within:ring-primary">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search coins, forex, gold or DEX tokens"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70"
            data-testid="symbol-search"
          />
          {query && (
            <button type="button" aria-label="Clear" onClick={() => setQuery("")} className="p-1 text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3">
          {["★", null, ...groups].map((g) => (
            <button
              key={g ?? "all"}
              type="button"
              data-venue-chip={g ?? "All"}
              onClick={() => setChip(g)}
              className={cn(
                "shrink-0 h-8 px-3 rounded-full text-[13px] font-medium border",
                chip === g ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground",
              )}
            >
              {g === "★" ? "★ Starred" : (g ?? "All")}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" data-testid="symbol-list">
        {shown.length === 0 && !terms.length && chip === "★" && (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            No starred symbols yet. Tap the star on any row to keep it here.
          </div>
        )}
        {shown.length === 0 && (terms.length > 0 || chip !== "★") && (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">No listed symbol matches.</div>
        )}
        {shown.map((s) => {
          const t = ticks[s.name];
          const fav = favorites.has(s.name);
          return (
            <div
              key={s.id || s.name}
              className={cn(
                "flex items-center gap-2 pl-3 pr-1 border-b border-border/40 active:bg-secondary",
                s.name === selectedSymbol && "bg-secondary/60",
              )}
            >
              <button type="button" onClick={() => onPick(s.name)} className="flex-1 min-w-0 flex items-center gap-2 py-2.5 text-left">
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="font-semibold text-[15px] truncate">{s.name.includes(":") ? s.name.split(":")[1] : s.name}</span>
                    <VenueBadge symbol={s} />
                  </span>
                  {s.displayName && s.displayName !== s.name && (
                    <span className="block text-xs text-muted-foreground truncate">{s.displayName}</span>
                  )}
                </span>
                <span className="text-right font-mono tabular-nums text-sm">{t ? formatQuote((t.bid + t.ask) / 2) : "—"}</span>
              </button>
              <button
                type="button"
                aria-label={fav ? "Unstar" : "Star"}
                onClick={() => toggleFavorite(s.name)}
                className="h-11 w-10 flex items-center justify-center shrink-0"
              >
                <Star className={cn("h-4 w-4", fav ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50")} />
              </button>
            </div>
          );
        })}
        {filtered.length > shown.length && (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            {filtered.length - shown.length} more. Type a coin or pick an exchange to narrow the list.
          </div>
        )}
        <div className="px-1">
          <DexSearch query={query} onPick={onPick} />
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}
