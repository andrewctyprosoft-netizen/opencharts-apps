import {
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DesktopBridge,
  VenueBalance,
  VenueId,
  VenueOrder,
  VenueStatus,
} from "../../../adapters/types.ts";
import { KEYED_VENUES } from "../../../adapters/types.ts";
import {
  EVM_CHAINS,
  type WalletHolding,
  type WalletKind,
  applyJupiter,
  evmBatch,
  parseEthplorer,
  parseEvmBatch,
  parseMempool,
  parseSolanaBatch,
  priceFor,
  solanaBatch,
  usdtPrices,
  walletKind,
} from "../../../adapters/wallets.ts";
import { ipcMessage } from "../../../adapters/venues.ts";
import { safeStorage } from "../lib/safe-storage.ts";
import { cn } from "../lib/utils.ts";
import { toast } from "../services/toast.ts";
import { fmtNum, fmtPrice, fmtUsd } from "./dash-format.ts";
import { isMobileApp } from "../mobile/is-mobile.ts";

/**
 * OpenCharts Desktop addition: File › Dashboard › Portfolio. Balances and open
 * orders on every exchange with a saved API key and the OANDA account, plus
 * on-chain wallets read by address (EVM chains, Solana, Bitcoin), valued in USD.
 */

const VENUES: VenueId[] = KEYED_VENUES;
const WALLETS_KEY = "ocd_wallets";
const AUTO_REFRESH_MS = 60_000;
const PALETTE = [
  "#14b8a6",
  "#3773f5",
  "#f0b90b",
  "#a78bfa",
  "#f97316",
  "#ec4899",
  "#22c55e",
  "#eab308",
  "#64748b",
];

interface SavedWallet {
  id: string;
  label: string;
  address: string;
  kind: WalletKind;
}
interface VenueState {
  balances: VenueBalance[];
  orders: VenueOrder[];
  loading: boolean;
  error: string;
}
interface WalletState {
  holdings: WalletHolding[];
  loading: boolean;
  errors: string[];
  /** Ethereum tokens left out for thin trading. */
  hidden: number;
}

function loadWallets(): SavedWallet[] {
  try {
    const list = JSON.parse(
      safeStorage.getItem(WALLETS_KEY) ?? "[]",
    ) as SavedWallet[];
    return Array.isArray(list)
      ? list.filter((w) => w && typeof w.address === "string")
      : [];
  } catch {
    return [];
  }
}

export function PortfolioPage({ bridge }: { bridge: DesktopBridge }) {
  const [status, setStatus] = useState<Record<VenueId, VenueStatus> | null>(
    null,
  );
  const [venues, setVenues] = useState<Partial<Record<VenueId, VenueState>>>(
    {},
  );
  const [wallets, setWallets] = useState<SavedWallet[]>(loadWallets);
  const [walletData, setWalletData] = useState<Record<string, WalletState>>({});
  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const [updatedAt, setUpdatedAt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefresh = useRef(0);

  const getJson = useCallback(
    async (url: string) => {
      const { status: code, body } = await bridge.web.get(url);
      if (code >= 400)
        throw new Error(`${new URL(url).hostname} answered ${code}`);
      return body;
    },
    [bridge],
  );

  const loadVenue = useCallback(
    async (id: VenueId) => {
      setVenues((v) => ({
        ...v,
        [id]: {
          balances: v[id]?.balances ?? [],
          orders: v[id]?.orders ?? [],
          loading: true,
          error: "",
        },
      }));
      const [b, o] = await Promise.allSettled([
        bridge.trade.balances(id),
        bridge.trade.openOrders(id),
      ]);
      const error =
        [b, o]
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => ipcMessage(r.reason))[0] ?? "";
      setVenues((v) => ({
        ...v,
        [id]: {
          balances: b.status === "fulfilled" ? b.value : [],
          orders:
            o.status === "fulfilled"
              ? o.value.sort((x, y) => y.time - x.time)
              : [],
          loading: false,
          error: ipcMessage(error),
        },
      }));
    },
    [bridge],
  );

  const loadWallet = useCallback(
    async (w: SavedWallet) => {
      setWalletData((d) => ({
        ...d,
        [w.id]: {
          holdings: d[w.id]?.holdings ?? [],
          loading: true,
          errors: [],
          hidden: d[w.id]?.hidden ?? 0,
        },
      }));
      const errors: string[] = [];
      let holdings: WalletHolding[] = [];
      let hidden = 0;
      try {
        if (w.kind === "bitcoin") {
          holdings = parseMempool(
            await getJson(`https://mempool.space/api/address/${w.address}`),
          );
        } else if (w.kind === "solana") {
          holdings = parseSolanaBatch(
            await bridge.web.rpc("solana", solanaBatch(w.address)),
          );
          const mints = holdings
            .filter((h) => h.token)
            .map((h) => h.token)
            .slice(0, 50);
          if (mints.length) {
            const [p, t] = await Promise.allSettled([
              getJson(
                `https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`,
              ),
              getJson(
                `https://lite-api.jup.ag/tokens/v2/search?query=${mints.join(",")}`,
              ),
            ]);
            holdings = applyJupiter(
              holdings,
              p.status === "fulfilled" ? p.value : null,
              t.status === "fulfilled" ? t.value : null,
            );
          }
        } else {
          const chains = Object.keys(EVM_CHAINS);
          const [eth, ...rest] = await Promise.allSettled([
            getJson(
              `https://api.ethplorer.io/getAddressInfo/${w.address}?apiKey=freekey`,
            ),
            ...chains.map((c) =>
              bridge.web
                .rpc(c, evmBatch(c, w.address))
                .then((r) => parseEvmBatch(c, r)),
            ),
          ]);
          const discovered =
            eth.status === "fulfilled" ? parseEthplorer(eth.value) : [];
          hidden = (discovered as { hidden?: number }).hidden ?? 0;
          const seen = new Set(discovered.map((h) => h.token.toLowerCase()));
          rest.forEach((r, i) => {
            if (r.status === "fulfilled")
              holdings.push(
                ...r.value.filter(
                  (h) => !h.token || !seen.has(h.token.toLowerCase()),
                ),
              );
            else
              errors.push(
                `${EVM_CHAINS[chains[i]!]!.label}: ${ipcMessage(r.reason)}`,
              );
          });
          holdings.push(...discovered);
        }
      } catch (err) {
        errors.push(ipcMessage(err));
      }
      setWalletData((d) => ({
        ...d,
        [w.id]: { holdings, loading: false, errors, hidden },
      }));
    },
    [bridge, getJson],
  );

  const refresh = useCallback(async () => {
    lastRefresh.current = Date.now();
    setRefreshing(true);
    try {
      const [st, px] = await Promise.allSettled([
        bridge.trade.status(),
        getJson("https://api.binance.com/api/v3/ticker/price"),
      ]);
      if (px.status === "fulfilled") setPrices(usdtPrices(px.value));
      if (st.status === "fulfilled") {
        setStatus(st.value);
        await Promise.all([
          ...VENUES.filter((id) => st.value[id]?.configured).map(loadVenue),
          ...loadWallets().map(loadWallet),
        ]);
      }
      setUpdatedAt(Date.now());
    } finally {
      setRefreshing(false);
    }
  }, [bridge, getJson, loadVenue, loadWallet]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const timer = setInterval(() => void refresh(), AUTO_REFRESH_MS);
    // Coming back from the keys window: pick up a new key soon.
    const onFocus = () =>
      Date.now() - lastRefresh.current > 15_000 && void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // ── Valuation ──
  const valueOf = useCallback(
    (
      asset: string,
      amount: number,
      usd?: number | null,
      price?: number | null,
    ) => {
      if (usd !== undefined && usd !== null && Number.isFinite(usd)) return usd;
      const p = price ?? priceFor(asset, prices);
      return p === null ? null : amount * p;
    },
    [prices],
  );

  const totals = useMemo(() => {
    const byAsset = new Map<string, number>();
    let cex = 0;
    let oanda = 0;
    let chain = 0;
    for (const id of VENUES) {
      for (const b of venues[id]?.balances ?? []) {
        const v = valueOf(b.asset, b.free + b.locked, b.usd) ?? 0;
        if (id === "oanda") oanda += v;
        else cex += v;
        byAsset.set(b.asset, (byAsset.get(b.asset) ?? 0) + v);
      }
    }
    for (const w of wallets) {
      for (const h of walletData[w.id]?.holdings ?? []) {
        const v = valueOf(h.asset, h.amount, null, h.price) ?? 0;
        chain += v;
        byAsset.set(h.asset, (byAsset.get(h.asset) ?? 0) + v);
      }
    }
    const sorted = [...byAsset.entries()]
      .filter(([, v]) => v > 0.005)
      .sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 8);
    const other = sorted.slice(8).reduce((s, [, v]) => s + v, 0);
    if (other > 0) top.push(["Other", other]);
    return { cex, oanda, chain, total: cex + oanda + chain, allocation: top };
  }, [venues, wallets, walletData, valueOf]);

  const cancelOrder = async (id: VenueId, o: VenueOrder) => {
    if (
      !window.confirm(
        `Cancel ${o.side} ${o.qty} ${o.native} on ${status?.[id]?.label ?? id}?`,
      )
    )
      return;
    try {
      await bridge.trade.cancel(id, o.native, o.id);
      toast.success("Order cancelled", `${o.native} · ${o.id}`);
      void loadVenue(id);
    } catch (err) {
      toast.error("Cancel failed", ipcMessage(err));
    }
  };

  const saveWallets = (list: SavedWallet[]) => {
    setWallets(list);
    safeStorage.setItem(WALLETS_KEY, JSON.stringify(list));
  };

  const connected = VENUES.filter((id) => status?.[id]?.configured);
  const notConnected = VENUES.filter((id) => status && !status[id]?.configured);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card">
        <h1 className={isMobileApp() ? "hidden" : "text-base font-semibold"}>Portfolio</h1>
        <span className="text-[11px] text-muted-foreground">
          {updatedAt
            ? `Updated ${new Date(updatedAt).toLocaleTimeString()} · refreshes every minute`
            : "Loading…"}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => void bridge.trade.openKeys()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-secondary text-[12px] text-muted-foreground"
        >
          <KeyRound className="h-3.5 w-3.5" /> API keys
        </button>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
        {/* Summary */}
        <div
          className="grid grid-cols-2 lg:grid-cols-4 gap-3"
          data-testid="portfolio-summary"
        >
          <Stat label="Total value" value={fmtUsd(totals.total, 1e9)} strong />
          <Stat label="Exchanges" value={fmtUsd(totals.cex, 1e9)} />
          <Stat label="OANDA" value={fmtUsd(totals.oanda, 1e9)} />
          <Stat label="Wallets (on-chain)" value={fmtUsd(totals.chain, 1e9)} />
        </div>
        {totals.allocation.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="text-[12px] text-muted-foreground mb-2">
              Allocation by asset
            </div>
            <div className="flex h-3 rounded overflow-hidden">
              {totals.allocation.map(([asset, v], i) => (
                <div
                  key={asset}
                  style={{
                    width: `${(v / totals.total) * 100}%`,
                    background: PALETTE[i % PALETTE.length],
                  }}
                  title={`${asset} ${fmtUsd(v)}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px]">
              {totals.allocation.map(([asset, v], i) => (
                <span key={asset} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ background: PALETTE[i % PALETTE.length] }}
                  />
                  {asset}{" "}
                  <span className="text-muted-foreground">
                    {((v / totals.total) * 100).toFixed(1)}% · {fmtUsd(v)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Exchanges and OANDA */}
        <h2 className="text-[13px] font-semibold pt-1">
          Exchanges &amp; brokers
        </h2>
        {!status && (
          <div className="text-muted-foreground text-[12px]">
            Checking saved keys…
          </div>
        )}
        {connected.map((id) => {
          const v = venues[id];
          const rows = (v?.balances ?? [])
            .map((b) => ({
              ...b,
              value: valueOf(b.asset, b.free + b.locked, b.usd),
            }))
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
          const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
          return (
            <section
              key={id}
              className="rounded-lg border border-border bg-card"
              data-venue-card={id}
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <span className="font-semibold">{status![id].label}</span>
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded",
                    status![id].testnet
                      ? "bg-primary/15 text-primary"
                      : "bg-buy/15 text-buy",
                  )}
                >
                  {status![id].testnet ? "Test / demo" : "Live"}
                </span>
                {v?.loading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
                <div className="flex-1" />
                <span className="font-mono">{fmtUsd(total, 1e9)}</span>
                <button
                  onClick={() => void loadVenue(id)}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground"
                  title="Refresh"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              {v?.error && (
                <div className="px-3 py-2 text-[12px] text-sell">{v.error}</div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[12px]">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-3 py-1.5">
                        Asset
                      </th>
                      <th className="text-right font-medium px-3">Available</th>
                      <th className="text-right font-medium px-3">In orders</th>
                      <th className="text-right font-medium px-3">Price</th>
                      <th className="text-right font-medium px-3">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.asset} className="border-t border-border/40">
                        <td className="px-3 py-1.5 font-medium">{r.asset}</td>
                        <td className="px-3 text-right font-mono">
                          {fmtNum(r.free)}
                        </td>
                        <td className="px-3 text-right font-mono">
                          {r.locked ? fmtNum(r.locked) : "—"}
                        </td>
                        <td className="px-3 text-right font-mono">
                          {fmtPrice(
                            r.usd
                              ? r.usd / (r.free + r.locked)
                              : priceFor(r.asset, prices),
                          )}
                        </td>
                        <td className="px-3 text-right font-mono">
                          {fmtUsd(r.value)}
                        </td>
                      </tr>
                    ))}
                    {!rows.length && !v?.loading && !v?.error && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-3 text-muted-foreground"
                        >
                          No balances on this account.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {(v?.orders.length ?? 0) > 0 && (
                <div className="border-t border-border">
                  <div className="px-3 pt-2 text-[12px] text-muted-foreground">
                    {id === "oanda"
                      ? "Pending orders and open trades"
                      : "Open orders"}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-[12px]">
                      <tbody>
                        {v!.orders.map((o) => (
                          <tr key={o.id} className="border-t border-border/40">
                            <td className="px-3 py-1.5 font-medium">
                              {o.native}
                            </td>
                            <td
                              className={cn(
                                "px-3",
                                o.side === "BUY" ? "text-buy" : "text-sell",
                              )}
                            >
                              {o.side}
                            </td>
                            <td className="px-3 text-muted-foreground">
                              {o.type}
                            </td>
                            <td className="px-3 text-right font-mono">
                              {o.price ? fmtPrice(o.price) : "market"}
                            </td>
                            <td className="px-3 text-right font-mono">
                              {fmtNum(o.filled)} / {fmtNum(o.qty)}
                            </td>
                            <td className="px-3 text-right text-muted-foreground">
                              {o.time ? new Date(o.time).toLocaleString() : ""}
                            </td>
                            <td className="px-3 text-right">
                              {o.type !== "TRADE" && (
                                <button
                                  onClick={() => void cancelOrder(id, o)}
                                  className="px-2 py-0.5 rounded border border-border hover:bg-secondary"
                                >
                                  Cancel
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          );
        })}
        {notConnected.length > 0 && (
          <div
            className="flex flex-wrap gap-2"
            data-testid="portfolio-not-connected"
          >
            {notConnected.map((id) => (
              <button
                key={id}
                onClick={() => void bridge.trade.openKeys(id)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> Connect{" "}
                {status![id]?.label ?? id}
              </button>
            ))}
          </div>
        )}

        {/* Wallets */}
        <h2 className="text-[13px] font-semibold pt-2">On-chain wallets</h2>
        <AddWallet
          onAdd={(w) => {
            if (
              wallets.some(
                (x) => x.address.toLowerCase() === w.address.toLowerCase(),
              )
            ) {
              toast.warning("Already added", w.address);
              return;
            }
            const list = [...wallets, w];
            saveWallets(list);
            void loadWallet(w);
          }}
        />
        {wallets.map((w) => {
          const d = walletData[w.id];
          const rows = (d?.holdings ?? [])
            .map((h) => {
              const price = h.price ?? priceFor(h.asset, prices);
              return {
                ...h,
                price,
                value: price === null ? null : h.amount * price,
              };
            })
            .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
          const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
          return (
            <section
              key={w.id}
              className="rounded-lg border border-border bg-card"
              data-wallet-card={w.kind}
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">{w.label}</span>
                <span className="text-[11px] text-muted-foreground font-mono truncate">
                  {w.address}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                  {w.kind === "evm"
                    ? "EVM chains"
                    : w.kind === "solana"
                      ? "Solana"
                      : "Bitcoin"}
                </span>
                {d?.loading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
                <div className="flex-1" />
                <span className="font-mono">{fmtUsd(total, 1e9)}</span>
                <button
                  onClick={() => void loadWallet(w)}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground"
                  title="Refresh"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() =>
                    saveWallets(wallets.filter((x) => x.id !== w.id))
                  }
                  className="p-1 rounded hover:bg-secondary text-muted-foreground"
                  title="Remove wallet"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {d?.errors.map((e) => (
                <div key={e} className="px-3 pt-1.5 text-[11px] text-sell">
                  {e}
                </div>
              ))}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[12px]">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-3 py-1.5">
                        Chain
                      </th>
                      <th className="text-left font-medium px-3">Asset</th>
                      <th className="text-right font-medium px-3">Balance</th>
                      <th className="text-right font-medium px-3">Price</th>
                      <th className="text-right font-medium px-3">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={`${r.chain}-${r.asset}-${r.token}`}
                        className="border-t border-border/40"
                      >
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {r.chain}
                        </td>
                        <td
                          className="px-3 font-medium"
                          title={r.token || undefined}
                        >
                          {r.asset}
                        </td>
                        <td className="px-3 text-right font-mono">
                          {fmtNum(r.amount)}
                        </td>
                        <td className="px-3 text-right font-mono">
                          {fmtPrice(r.price)}
                        </td>
                        <td className="px-3 text-right font-mono">
                          {fmtUsd(r.value)}
                        </td>
                      </tr>
                    ))}
                    {!rows.length && !d?.loading && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-3 text-muted-foreground"
                        >
                          Nothing found on the supported chains.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {(d?.hidden ?? 0) > 0 && (
                <div className="px-3 py-1.5 border-t border-border/40 text-[11px] text-muted-foreground">
                  {d!.hidden} thinly traded Ethereum token
                  {d!.hidden === 1 ? "" : "s"} hidden (under $10K daily volume,
                  or the wallet holds over 2% of the token's market cap):
                  usually airdropped spam.
                </div>
              )}
            </section>
          );
        })}
        <p className="text-[11px] text-muted-foreground pb-2">
          EVM addresses are read on Ethereum, BNB Chain, Base, Arbitrum,
          Polygon, Optimism and Avalanche: the native coin and the main
          stablecoins and wrapped coins, plus every priced Ethereum token (via
          Ethplorer). Solana reads SOL and all SPL tokens; Bitcoin reads the
          address balance. Prices come from Binance, Jupiter and Ethplorer.
          Read-only: no wallet is connected and nothing is signed.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-mono tabular-nums mt-0.5",
          strong ? "text-xl font-semibold text-primary" : "text-lg",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function AddWallet({ onAdd }: { onAdd: (w: SavedWallet) => void }) {
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<WalletKind | "auto">("auto");
  const guessed = walletKind(address);
  const final = kind === "auto" ? guessed : kind;
  const submit = () => {
    const a = address.trim();
    if (!final || !a) {
      toast.warning(
        "Unknown address",
        "Paste an EVM (0x…), Solana or Bitcoin address.",
      );
      return;
    }
    onAdd({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      address: a,
      kind: final,
      label:
        label.trim() ||
        `${final === "evm" ? "EVM" : final === "solana" ? "Solana" : "Bitcoin"} wallet`,
    });
    setAddress("");
    setLabel("");
    setKind("auto");
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <input
        data-testid="wallet-address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Wallet address (0x…, Solana or Bitcoin)"
        className="flex-1 min-w-[22rem] px-2 py-1.5 rounded border border-border bg-background font-mono"
      />
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (optional)"
        className="w-40 px-2 py-1.5 rounded border border-border bg-background"
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as WalletKind | "auto")}
        className="px-2 py-1.5 rounded border border-border bg-background"
      >
        <option value="auto">
          {guessed
            ? `Auto: ${guessed === "evm" ? "EVM" : guessed === "solana" ? "Solana" : "Bitcoin"}`
            : "Auto-detect"}
        </option>
        <option value="evm">EVM chains</option>
        <option value="solana">Solana</option>
        <option value="bitcoin">Bitcoin</option>
      </select>
      <button
        data-testid="wallet-add"
        onClick={submit}
        className="flex items-center gap-1 px-3 py-1.5 rounded bg-primary text-primary-foreground font-medium"
      >
        <Plus className="h-3.5 w-3.5" /> Add wallet
      </button>
      {address && !final && (
        <span className="flex items-center gap-1 text-sell">
          <X className="h-3.5 w-3.5" /> Not a recognised address
        </span>
      )}
    </div>
  );
}
