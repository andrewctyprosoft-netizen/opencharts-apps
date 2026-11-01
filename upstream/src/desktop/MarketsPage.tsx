import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EXCHANGE_IDS,
  type ExchangeId,
  klineUrl,
  marketListUrls,
  parseKlines,
  parseMarkets,
} from "../../../adapters/cex-map.ts";
import { FX_INSTRUMENTS, yahooSymbol } from "../../../adapters/fx-map.ts";
import { ohlcvPath, parseOhlcv } from "../../../adapters/gecko-map.ts";
import {
  type ColumnDef,
  type Row,
  changeBetween,
  compileCondition,
  inRange,
  parseAmount,
  sortRows,
} from "../../../adapters/market-filter.ts";
import {
  CHART_SPECS,
  COINGECKO_LIST_URL,
  CRYPTO_COLUMNS,
  type CoinToken,
  DEX_CHAINS,
  type DexVenue,
  FX_COLUMNS,
  PERIODS,
  type Period,
  STOCK_COLUMNS,
  changeOverDays,
  closesBetween,
  coinTokens,
  coingeckoUrl,
  dexDayLine,
  dexOnlyRow,
  fxRows,
  pairRows,
  pairsByBase,
  parseCoinSparks,
  parseCoins,
  parseDexChartId,
  parseDexRows,
  parseSpark,
  parseStocks,
  parseTokenPairs,
  sparkUrl,
  stocksUrl,
  tokenPairsUrl,
  trendingPoolsPath,
  withVenues,
} from "../../../adapters/markets-data.ts";
import type { DesktopBridge } from "../../../adapters/types.ts";
import { ipcMessage } from "../../../adapters/venues.ts";
import { cn } from "../lib/utils.ts";
import { fmtNum, fmtPct, fmtPrice, fmtUsd, pctClass } from "./dash-format.ts";
import { isMobileApp } from "../mobile/is-mobile.ts";
import { Sparkline } from "./Sparkline.tsx";

/**
 * OpenCharts Desktop addition: File › Dashboard › Market overview. Lists coins
 * (CoinGecko) with where each trades: the enabled exchanges' pairs and the DEX
 * pools on eleven chains (DexScreener), plus trending DEX-only tokens
 * (GeckoTerminal); forex and metals (Yahoo) and the largest companies (Yahoo).
 * Period changes, min/max ranges, sorting and a custom condition over any column.
 */

type Tab = "crypto" | "forex" | "stocks";
const TABS: Array<{
  id: Tab;
  label: string;
  columns: ColumnDef[];
  source: string;
}> = [
  {
    id: "crypto",
    label: "Crypto",
    columns: CRYPTO_COLUMNS,
    source: "CoinGecko top 1,000 · 6 exchanges · DEX pools (DexScreener) · trending (GeckoTerminal)",
  },
  {
    id: "forex",
    label: "Forex & metals",
    columns: FX_COLUMNS,
    source: "Yahoo Finance daily closes (metals from futures)",
  },
  {
    id: "stocks",
    label: "Stocks",
    columns: STOCK_COLUMNS,
    source: "Yahoo Finance · largest companies by market cap",
  },
];
const PAGE = 300;
const HISTORY_ROWS = 200;
/** Trending DEX pools load 20 a page; GeckoTerminal's free API allows about five calls a minute. */
const DEX_PAGES = 5;
/** Exchange pairs per exchange matched to coins (the busiest USD pairs). */
const PAIRS_PER_EXCHANGE = 1500;
/** Chains looked up per coin for its DEX pools, and pools kept per coin. */
const TOKEN_CHAINS = 2;
const VENUES_KEPT = 12;
type Closes = Array<[number, number]>;
interface TabData {
  rows: Row[];
  loading: boolean;
  error: string;
  loadedAt: number;
}
const EMPTY: TabData = { rows: [], loading: false, error: "", loadedAt: 0 };
const rateLimited = (err: unknown) => /rate limit/i.test(ipcMessage(err));
/** Trending DEX-only tokens are rows too; their id is the pool's chart id. */
const isDex = (r: Row) => String(r.id).startsWith("dex:");
const day = (d: Date) => d.toISOString().slice(0, 10);

export function MarketsPage({ bridge }: { bridge: DesktopBridge }) {
  const exchanges = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get("ex");
    const list = (raw ?? EXCHANGE_IDS.join(","))
      .split(",")
      .filter((x): x is ExchangeId => (EXCHANGE_IDS as string[]).includes(x));
    return list.length ? list : [...EXCHANGE_IDS];
  }, []);
  const [tab, setTab] = useState<Tab>("crypto");
  const [data, setData] = useState<Record<Tab, TabData>>({
    crypto: EMPTY,
    forex: EMPTY,
    stocks: EMPTY,
  });
  const [period, setPeriod] = useState<Period>("1d");
  const [from, setFrom] = useState(() =>
    day(new Date(Date.now() - 90 * 86_400_000)),
  );
  const [to, setTo] = useState(() => day(new Date()));
  const [search, setSearch] = useState("");
  const [range, setRange] = useState({
    volMin: "",
    volMax: "",
    capMin: "",
    capMax: "",
    chgMin: "",
    chgMax: "",
  });
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "mcap",
    dir: "desc",
  });
  const [condition, setCondition] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  // OpenCharts Mobile patch: on the phone the ranges, sort and condition fold away behind Filters.
  const mobile = isMobileApp();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showFilters = !mobile || filtersOpen;
  const [limit, setLimit] = useState(PAGE);
  const [history, setHistory] = useState(() => new Map<string, Closes>());
  const inflight = useRef(new Set<string>());
  const alive = useRef(true);
  const binancePairs = useRef<Set<string> | null>(null);
  // Where each coin trades: exchange pairs by ticker, a coin's tokens (by CoinGecko id), its DEX
  // pools (loaded for rows on screen or expanded), and the trending pools of DEX-only tokens.
  const [pairs, setPairs] = useState(() => pairsByBase([]));
  const [tokens, setTokens] = useState(() => new Map<string, CoinToken[]>());
  const [dexVenues, setDexVenues] = useState(() => new Map<string, DexVenue[]>());
  const venuesInflight = useRef(new Set<string>());
  const [trending, setTrending] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState(() => new Set<string>());
  // Row charts for the day, week and month views, keyed `${period}:${row id}` (year and custom
  // charts come from `history`). Only rows on screen are fetched; see `onScreen`.
  const [charts, setCharts] = useState(() => new Map<string, number[]>());
  const chartsInflight = useRef(new Set<string>());
  const coinWeek = useRef(new Map<string, Closes>());
  const scroller = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(() => new Set<string>());
  const onScreenRef = useRef(onScreen);
  const view = useRef({ tab, period: "1d" as Period });

  const spec = TABS.find((t) => t.id === tab)!;
  const has = (key: string) => spec.columns.some((c) => c.key === key);

  const getJson = useCallback(
    async (url: string) => {
      const { status, body } = await bridge.web.get(url);
      if (status >= 400)
        throw new Error(`${new URL(url).hostname} answered ${status}`);
      return body;
    },
    [bridge],
  );

  const patch = (t: Tab, p: Partial<TabData>) =>
    setData((d) => ({ ...d, [t]: { ...d[t], ...p } }));
  const addHistory = (entries: Array<[string, Closes]>) =>
    setHistory((h) => {
      const next = new Map(h);
      for (const [k, v] of entries) next.set(k, v);
      return next;
    });
  const addCharts = (entries: Array<[string, number[]]>) =>
    setCharts((m) => {
      const next = new Map(m);
      for (const [k, v] of entries) next.set(k, v);
      return next;
    });

  /** A coin's candles from the first exchange that lists it against USDT (Binance, Bybit, OKX). */
  const coinCandles = useCallback(
    async (
      symbol: string,
      timeframe: string,
      limit: number,
    ): Promise<Closes> => {
      if (!binancePairs.current) {
        try {
          const list = (await getJson(
            "https://api.binance.com/api/v3/ticker/price",
          )) as Array<{ symbol: string }>;
          binancePairs.current = new Set(list.map((p) => p.symbol));
        } catch {
          binancePairs.current = new Set();
        }
      }
      const candidates: Array<[ExchangeId, string]> = [
        ...(binancePairs.current.has(`${symbol}USDT`)
          ? [["binance", `${symbol}USDT`] as [ExchangeId, string]]
          : []),
        ["bybit", `${symbol}USDT`],
        ["okx", `${symbol}-USDT`],
      ];
      for (const [ex, native] of candidates) {
        const request = { symbol: native, timeframe, limit };
        const url = klineUrl(ex, native, request, Date.now());
        if (!url) continue;
        try {
          const closes = parseKlines(ex, await getJson(url), request).map(
            (c): [number, number] => [c.time, c.close],
          );
          if (closes.length > 1) return closes;
        } catch {
          // not listed there; try the next exchange
        }
      }
      return [];
    },
    [getJson],
  );

  /** A DEX pool's closes, through the GeckoTerminal queue that keeps under its rate limit. */
  const dexCloses = useCallback(
    async (id: string, timeframe: string, limit: number): Promise<Closes> => {
      const pool = parseDexChartId(id);
      const request = { symbol: id, timeframe, limit };
      const path = pool && ohlcvPath(pool, request);
      if (!path) return [];
      return parseOhlcv(await bridge.gecko.get(path, "low"), request).map(
        (c): [number, number] => [c.time, c.close],
      );
    },
    [bridge],
  );

  /** The crypto tab's venues: the exchanges' pairs, then the trending DEX pools. */
  const loadVenues = useCallback(async () => {
    const lists = await Promise.allSettled(
      exchanges.map(async (ex) =>
        parseMarkets(ex, await Promise.all(marketListUrls(ex).map(getJson)), PAIRS_PER_EXCHANGE),
      ),
    );
    setPairs(pairsByBase(lists.flatMap((r) => (r.status === "fulfilled" ? r.value : []))));
    const failed = lists.filter((r) => r.status === "rejected").length;
    if (failed) patch("crypto", { error: `${failed} exchange(s) did not answer.` });
    let rows: Row[] = [];
    for (let page = 1; page <= DEX_PAGES; page++) {
      try {
        // The trending list can shift between pages; keep a pool's first place.
        const seen = new Set(rows.map((r) => r.id));
        const more = parseDexRows(await bridge.gecko.get(trendingPoolsPath(page), "low"), rows.length);
        rows = rows.concat(more.filter((r) => !seen.has(r.id)));
        if (alive.current) setTrending(rows);
      } catch {
        break; // GeckoTerminal busy: the pools so far will do
      }
    }
  }, [exchanges, getJson, bridge]);

  const load = useCallback(
    async (t: Tab) => {
      patch(t, { loading: true, error: "" });
      try {
        if (t === "crypto") {
          let rows: Row[] = [];
          for (let page = 1; page <= 4; page++) {
            // CoinGecko's free tier allows a few calls a minute: after a rate limit, wait out the pause once.
            const reply = await getJson(coingeckoUrl(page)).catch(
              async (err: unknown) => {
                if (!/rate limit/.test(ipcMessage(err))) throw err;
                await new Promise((r) => setTimeout(r, 21_000));
                return getJson(coingeckoUrl(page));
              },
            );
            rows = rows.concat(parseCoins(reply));
            // CoinGecko's 7-day hourly line is the week chart, and the day chart when no exchange lists the coin.
            for (const [id, closes] of parseCoinSparks(reply))
              if (closes.length > 1) coinWeek.current.set(id, closes);
            patch(t, { rows, loadedAt: Date.now() });
          }
          // Then the venues: after the coins, so the first rows' chart requests go out first (the
          // exchanges' full ticker lists are large, and on a phone they queue on the same hosts).
          void loadVenues();
          // Each coin's tokens on the DEX chains, for its pools.
          const ids = new Set(rows.map((r) => String(r.id)));
          void getJson(COINGECKO_LIST_URL).then(
            (list) => setTokens(coinTokens(list, ids)),
            () => setTokens(new Map()),
          );
        } else if (t === "forex") {
          const symbols = FX_INSTRUMENTS.map((i) => yahooSymbol(i.name));
          const spark = new Map<string, Closes>();
          for (let i = 0; i < symbols.length; i += 20) {
            for (const [k, v] of parseSpark(
              await getJson(sparkUrl(symbols.slice(i, i + 20))),
            ))
              spark.set(k, v);
          }
          addHistory(
            FX_INSTRUMENTS.map((inst) => [
              inst.name.replace("_", ""),
              spark.get(yahooSymbol(inst.name)) ?? [],
            ]),
          );
          patch(t, {
            rows: fxRows(FX_INSTRUMENTS, spark, yahooSymbol),
            loadedAt: Date.now(),
          });
        } else {
          const first = parseStocks(await getJson(stocksUrl(0)), 0);
          patch(t, { rows: first, loadedAt: Date.now() });
          const second = parseStocks(await getJson(stocksUrl(250)), 250);
          patch(t, { rows: [...first, ...second], loadedAt: Date.now() });
        }
      } catch (err) {
        patch(t, { error: ipcMessage(err) });
      } finally {
        patch(t, { loading: false });
      }
    },
    [getJson, loadVenues],
  );


  const selectTab = (t: Tab) => {
    setTab(t);
    // The new tab's rows report themselves once drawn; until then its top rows count as on screen.
    setOnScreen(new Set());
    if (!data[t].loadedAt && !data[t].loading) void load(t);
    // Default sort per tab: by size where there is a size column.
    const cols = TABS.find((x) => x.id === t)!.columns;
    const hasCol = (k: string) => cols.some((c) => c.key === k);
    setSort(
      hasCol("mcap")
        ? { key: "mcap", dir: "desc" }
        : hasCol("volume")
          ? { key: "volume", dir: "desc" }
          : { key: "symbol", dir: "asc" },
    );
    setLimit(PAGE);
  };
  useEffect(() => {
    void Promise.resolve().then(() => load("crypto"));
  }, [load]);

  // ── Period change per row ──
  const days = PERIODS.find((p) => p.id === period)?.days ?? 0;
  const fromSec = Date.parse(`${from}T00:00:00Z`) / 1000;
  const toSec = Date.parse(`${to}T23:59:59Z`) / 1000;
  const changeOf = useCallback(
    (row: Row): number | null => {
      if (period !== "custom") {
        const native = row[`chg_${period}`];
        if (typeof native === "number") return native;
        // DEX pools: the week and month change come from the row's own chart.
        const line = charts.get(`${period}:${String(row.id)}`);
        if (isDex(row) && line && line.length > 1)
          return (line.at(-1)! / line[0]! - 1) * 100;
        const closes = history.get(String(row.id));
        return closes ? changeOverDays(closes, days) : null;
      }
      const closes = history.get(String(row.id));
      return closes && Number.isFinite(fromSec) && Number.isFinite(toSec)
        ? changeBetween(closes, fromSec, toSec)
        : null;
    },
    [period, days, fromSec, toSec, history, charts],
  );

  // ── Filtering and sorting ──
  const { shown, total, conditionError, needHistory, visible } = useMemo(() => {
    let conditionError = "";
    let pred: (r: Row) => boolean = () => true;
    try {
      pred = compileCondition(condition, spec.columns);
    } catch (err) {
      conditionError = (err as Error).message;
    }
    const q = search.trim().toLowerCase();
    const num = (s: string) => (s.trim() ? parseAmount(s) : null);
    let base = data[tab].rows;
    if (tab === "crypto") {
      // A trending pool whose token is one of the coins is already in that coin's DEX pools.
      const known = new Set(
        [...tokens.values()].flat().map((t) => t.address.toLowerCase()),
      );
      base = [
        ...base.map((r) =>
          withVenues(r, pairs.get(String(r.symbol)), dexVenues.get(String(r.id))),
        ),
        ...trending
          .filter((p) => !known.has(String(p.base_addr ?? "").toLowerCase()))
          .map(dexOnlyRow),
      ];
    }
    const rows = base.map((r): Row => ({
      ...r,
      change: changeOf(r),
    }));
    const filtered = rows.filter(
      (r) =>
        (!q ||
          spec.columns.some(
            (c) =>
              c.kind === "text" &&
              String(r[c.key] ?? "")
                .toLowerCase()
                .includes(q),
          )) &&
        inRange(
          r,
          "volume",
          has("volume") ? num(range.volMin) : null,
          has("volume") ? num(range.volMax) : null,
        ) &&
        inRange(
          r,
          "mcap",
          has("mcap") ? num(range.capMin) : null,
          has("mcap") ? num(range.capMax) : null,
        ) &&
        inRange(r, "change", num(range.chgMin), num(range.chgMax)) &&
        pred(r),
    );
    const sorted = sortRows(filtered, sort.key, sort.dir);
    // Until the observer reports (it waits for the window to paint), the top rows count as on screen.
    const visible = onScreen.size
      ? onScreen
      : new Set(sorted.slice(0, 30).map((r) => String(r.id)));
    // Rows still missing a change value for this period, near the top of the current view, and
    // rows on screen whose year or custom chart is drawn from daily closes. DEX pools only fetch
    // on screen: GeckoTerminal allows about five calls a minute.
    const dailyCharts = period === "1y" || period === "custom";
    const needHistory = sorted.filter(
      (r, i) =>
        !history.has(String(r.id)) &&
        ((i < HISTORY_ROWS && r.change === null && !isDex(r)) ||
          (dailyCharts && visible.has(String(r.id)))),
    );
    return {
      shown: sorted,
      total: rows.length,
      conditionError,
      needHistory,
      visible,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data,
    tab,
    changeOf,
    search,
    range,
    sort,
    condition,
    spec,
    history,
    onScreen,
    pairs,
    tokens,
    dexVenues,
    trending,
  ]);

  // The visible top rows whose change needs daily history (custom range, or week/month on pairs and stocks).
  const historyKey = needHistory.map((r) => r.id).join(",");
  useEffect(() => {
    if (!needHistory.length || period === "1d") return;
    // Runs are not cancelled when the list changes (each result changes it); only unmounting stops them.
    const todo = needHistory.filter((r) => !inflight.current.has(String(r.id)));
    if (!todo.length) return;
    for (const r of todo) inflight.current.add(String(r.id));

    void (async () => {
      if (tab === "stocks" || tab === "forex") {
        for (let i = 0; i < todo.length && alive.current; i += 20) {
          const batch = todo.slice(i, i + 20);
          const ids = batch.map((r) =>
            tab === "forex"
              ? yahooSymbol(
                  `${String(r.id).slice(0, 3)}_${String(r.id).slice(3)}`,
                )
              : String(r.id),
          );
          try {
            const spark = parseSpark(await getJson(sparkUrl(ids)));
            if (alive.current)
              addHistory(
                batch.map((r, k) => [String(r.id), spark.get(ids[k]!) ?? []]),
              );
          } catch {
            if (alive.current) addHistory(batch.map((r) => [String(r.id), []]));
          }
        }
        return;
      }
      const queue = [...todo];
      const worker = async () => {
        while (queue.length && alive.current) {
          const r = queue.shift()!;
          let closes: Closes = [];
          try {
            closes = isDex(r)
              ? await dexCloses(String(r.id), "1d", 1000)
              : await coinCandles(String(r.symbol), "1d", 1000);
          } catch (err) {
            // A DEX pool still rate limited after the queue's retries stays unloaded and is tried again later.
            if (isDex(r) && rateLimited(err)) continue;
            closes = [];
          }
          if (alive.current) addHistory([[String(r.id), closes]]);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    })().finally(() => {
      for (const r of todo) inflight.current.delete(String(r.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey, period, tab]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // ── Row charts ──
  const renderedKey = shown
    .slice(0, limit)
    .map((r) => r.id)
    .join(",");
  // Rows within a screen of the visible area count as on screen; only they fetch charts.
  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const seen = new Set<string>();
    let frame = 0;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.rowId!;
          if (e.isIntersecting) seen.add(id);
          else seen.delete(id);
        }
        clearTimeout(frame);
        frame = window.setTimeout(
          () =>
            setOnScreen((old) =>
              old.size === seen.size && [...seen].every((id) => old.has(id))
                ? old
                : new Set(seen),
            ),
          80,
        );
      },
      { root, rootMargin: "100% 0px" },
    );
    root
      .querySelectorAll<HTMLElement>("tr[data-row-id]")
      .forEach((el) => io.observe(el));
    return () => {
      clearTimeout(frame);
      io.disconnect();
    };
    // Re-observe only when the rendered rows change, not on every chart or history update.
  }, [renderedKey]);

  // What the chart fetches check before each request: still this view, still on screen?
  useEffect(() => {
    view.current = { tab, period };
    onScreenRef.current = visible;
  }, [tab, period, visible]);
  const chartSpec =
    period in CHART_SPECS
      ? CHART_SPECS[period as keyof typeof CHART_SPECS]
      : null;
  /** The row's chart for the current period; undefined while it loads. */
  const chartOf = (r: Row): number[] | undefined => {
    const id = String(r.id);
    if (chartSpec) {
      const line = charts.get(`${period}:${id}`);
      // A DEX pool's day line starts from its reported changes until its 15-minute bars arrive.
      if (!line && isDex(r) && period === "1d") {
        const rough = dexDayLine(r);
        return rough.length ? rough : undefined;
      }
      return line;
    }
    const closes = history.get(id);
    if (!closes) return undefined;
    const last = closes.at(-1)?.[0] ?? 0;
    return (
      period === "1y"
        ? closesBetween(closes, last - 365 * 86_400, last)
        : closesBetween(closes, fromSec, toSec)
    ).map(([, c]) => c);
  };
  const needCharts = chartSpec
    ? shown.filter(
        (r) =>
          visible.has(String(r.id)) && !charts.has(`${period}:${String(r.id)}`),
      )
    : [];
  const chartKey = needCharts.map((r) => r.id).join(",");
  useEffect(() => {
    if (!chartSpec || !needCharts.length) return;
    const p = period;
    const key = (r: Row) => `${p}:${String(r.id)}`;
    const todo = needCharts.filter((r) => !chartsInflight.current.has(key(r)));
    if (!todo.length) return;
    for (const r of todo) chartsInflight.current.add(key(r));
    // A row that scrolled away, or a view that changed, is skipped; it fetches again when shown.
    const wanted = (r: Row) =>
      alive.current &&
      view.current.tab === tab &&
      view.current.period === p &&
      onScreenRef.current.has(String(r.id));
    const values = (closes: Closes) => closes.map(([, c]) => c);

    void (async () => {
      if (tab === "stocks" || tab === "forex") {
        for (let i = 0; i < todo.length; i += 20) {
          const batch = todo.slice(i, i + 20).filter(wanted);
          if (!batch.length) continue;
          const ids = batch.map((r) =>
            tab === "forex"
              ? yahooSymbol(
                  `${String(r.id).slice(0, 3)}_${String(r.id).slice(3)}`,
                )
              : String(r.id),
          );
          let spark = new Map<string, Closes>();
          try {
            spark = parseSpark(
              await getJson(sparkUrl(ids, chartSpec.range, chartSpec.interval)),
            );
          } catch {
            // the batch's charts stay empty
          }
          if (alive.current)
            addCharts(
              batch.map((r, k) => [key(r), values(spark.get(ids[k]!) ?? [])]),
            );
        }
        return;
      }
      // CoinGecko's week line needs no request.
      const week =
        tab === "crypto" && p === "1w"
          ? todo.filter((r) => coinWeek.current.has(String(r.id)))
          : [];
      if (week.length)
        addCharts(
          week.map((r) => [
            key(r),
            values(coinWeek.current.get(String(r.id))!),
          ]),
        );
      const queue = todo.filter((r) => !week.includes(r));
      const worker = async () => {
        while (queue.length) {
          const r = queue.shift()!;
          if (!wanted(r)) continue;
          let closes: Closes = [];
          try {
            if (isDex(r)) {
              closes = await dexCloses(
                String(r.id),
                chartSpec.bar,
                chartSpec.bars,
              );
            } else {
              closes = await coinCandles(
                String(r.symbol),
                chartSpec.bar,
                chartSpec.bars,
              );
              const gecko = coinWeek.current.get(String(r.id));
              if (closes.length < 2 && p === "1d" && gecko)
                closes = gecko.slice(-25);
            }
          } catch (err) {
            if (isDex(r) && rateLimited(err)) continue;
            closes = [];
          }
          if (alive.current) addCharts([[key(r), values(closes)]]);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    })().finally(() => {
      for (const r of todo) chartsInflight.current.delete(key(r));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartKey, period, tab]);

  // ── DEX pools per coin (DexScreener, about 240 calls a minute) ──
  /** The tokens whose pools a row lists: a coin's first chains, or a DEX-only token's own. */
  const tokensOf = (r: Row): CoinToken[] => {
    if (!isDex(r)) return (tokens.get(String(r.id)) ?? []).slice(0, TOKEN_CHAINS);
    const network = String(r.id).split(":")[1];
    const chain = DEX_CHAINS.find((c) => c.gt === network);
    return chain && r.base_addr ? [{ chain: chain.ds, address: String(r.base_addr) }] : [];
  };
  const needVenues =
    tab === "crypto"
      ? shown.filter(
          (r) =>
            (visible.has(String(r.id)) || expanded.has(String(r.id))) &&
            !dexVenues.has(String(r.id)) &&
            tokensOf(r).length > 0,
        )
      : [];
  const venuesKey = needVenues.map((r) => r.id).join(",");
  useEffect(() => {
    const todo = needVenues.filter((r) => !venuesInflight.current.has(String(r.id)));
    if (!todo.length) return;
    for (const r of todo) venuesInflight.current.add(String(r.id));
    const queue = [...todo];
    const worker = async () => {
      while (queue.length && alive.current) {
        const r = queue.shift()!;
        const id = String(r.id);
        const found: DexVenue[] = [];
        for (const token of tokensOf(r)) {
          try {
            found.push(...parseTokenPairs(await getJson(tokenPairsUrl(token)), token));
          } catch {
            // that chain's pools stay unknown
          }
        }
        found.sort((a, b) => b.liquidity - a.liquidity);
        if (alive.current)
          setDexVenues((m) => new Map(m).set(id, found.slice(0, VENUES_KEPT)));
      }
    };
    void Promise.all([worker(), worker()]).finally(() => {
      for (const r of todo) venuesInflight.current.delete(String(r.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venuesKey]);
  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const loadingHistory = period !== "1d" && needHistory.length > 0;
  const current = data[tab];
  const periodLabel =
    period === "custom"
      ? `${from} → ${to}`
      : PERIODS.find((p) => p.id === period)!.label;
  // Big enough to read a trend at a glance, small enough to keep the table dense; narrower on phones.
  const spark = mobile ? { w: 92, h: 30 } : { w: 140, h: 34 };
  const columns = spec.columns.map((c) =>
    c.key === "change" ? { ...c, label: `Change (${periodLabel})` } : c,
  );
  // The rank and name columns stay put while the table scrolls sideways; the rank column has a
  // fixed width so the name column knows where to stick.
  const pinned = columns.findIndex((c) => c.kind === "text") + 1;
  const pinClass = (i: number) =>
    i < pinned
      ? cn(
          "sticky z-[2]",
          i === 0 ? "left-0" : "left-12",
          columns[i]!.key === "rank" && "w-12 min-w-12 max-w-12",
          // OpenCharts Mobile patch: a long pinned name ("Binance Bridged USDT …") filled a phone screen.
          mobile && i === pinned - 1 && i > 0 && "max-w-28 overflow-hidden text-ellipsis",
          i === pinned - 1 && "shadow-[inset_-1px_0_0_hsl(var(--border))]",
        )
      : "";
  const clickSort = (key: string) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "desc" ? "asc" : "desc" }
        : {
            key,
            dir:
              columns.find((c) => c.key === key)?.kind === "text"
                ? "asc"
                : "desc",
          },
    );
  const reset = () => {
    setSearch("");
    setRange({
      volMin: "",
      volMax: "",
      capMin: "",
      capMax: "",
      chgMin: "",
      chgMax: "",
    });
    setCondition("");
    setPeriod("1d");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header and tabs */}
      <div className={cn("flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card", mobile && "overflow-x-auto no-scrollbar px-3")}>
        <h1 className={cn("text-base font-semibold mr-3", mobile && "hidden")}>Market overview</h1>
        {TABS.map((t) => (
          <button
            key={t.id}
            data-tab={t.id}
            onClick={() => selectTab(t.id)}
            className={cn(
              "px-3 py-1.5 rounded-md text-[13px] font-medium shrink-0 whitespace-nowrap",
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "hover:bg-secondary text-muted-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground hidden lg:inline">
          {spec.source}
        </span>
        <button
          onClick={() => {
            // Redraw the row charts too: the rows on screen fetch theirs again, and their DEX pools.
            setCharts(new Map());
            setDexVenues(new Map());
            void load(tab);
          }}
          disabled={current.loading}
          title="Refresh"
          className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground disabled:opacity-50"
        >
          <RefreshCw
            className={cn("h-4 w-4", current.loading && "animate-spin")}
          />
        </button>
      </div>

      {/* Period, search, ranges */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 px-4 py-2 border-b border-border bg-card/60 text-[12px]">
        <div>
          <div className="text-muted-foreground mb-1">Change over</div>
          <div className="flex rounded-md border border-border overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                data-period={p.id}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "px-2.5 py-1",
                  period === p.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-secondary",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {period === "custom" && (
          <div className="flex items-end gap-1">
            <label className="flex flex-col">
              <span className="text-muted-foreground mb-1">From</span>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="px-2 py-1 rounded border border-border bg-background"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-muted-foreground mb-1">To</span>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="px-2 py-1 rounded border border-border bg-background"
              />
            </label>
          </div>
        )}
        <label className="flex flex-col">
          <span className="text-muted-foreground mb-1">Search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or symbol"
            className="w-36 px-2 py-1 rounded border border-border bg-background"
          />
        </label>
        {mobile && (
          <div className="flex items-center gap-2 w-full">
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className={cn("h-9 px-3 rounded-md border flex items-center gap-1", filtersOpen ? "border-primary text-primary" : "border-border")}
            >
              Filters &amp; sort {filtersOpen ? "▴" : "▾"}
            </button>
            <span className="flex-1" />
            {(current.loading || loadingHistory) && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <span className="text-muted-foreground">
              {shown.length.toLocaleString()} of {total.toLocaleString()}
            </span>
          </div>
        )}
        {showFilters && (<>
        <RangeInputs
          label="Volume"
          disabled={!has("volume")}
          min={range.volMin}
          max={range.volMax}
          onMin={(v) => setRange({ ...range, volMin: v })}
          onMax={(v) => setRange({ ...range, volMax: v })}
          hint="e.g. 10M"
        />
        <RangeInputs
          label="Market cap"
          disabled={!has("mcap")}
          min={range.capMin}
          max={range.capMax}
          onMin={(v) => setRange({ ...range, capMin: v })}
          onMax={(v) => setRange({ ...range, capMax: v })}
          hint="e.g. 1B"
        />
        <RangeInputs
          label="Change %"
          min={range.chgMin}
          max={range.chgMax}
          onMin={(v) => setRange({ ...range, chgMin: v })}
          onMax={(v) => setRange({ ...range, chgMax: v })}
          hint="e.g. -5"
        />
        <label className="flex flex-col">
          <span className="text-muted-foreground mb-1">Sort</span>
          <div className="flex gap-1">
            <select
              value={sort.key}
              onChange={(e) => setSort({ ...sort, key: e.target.value })}
              className="px-2 py-1 rounded border border-border bg-background"
            >
              {columns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                setSort({ ...sort, dir: sort.dir === "desc" ? "asc" : "desc" })
              }
              title={sort.dir === "desc" ? "High to low" : "Low to high"}
              className="px-2 py-1 rounded border border-border hover:bg-secondary flex items-center gap-1"
            >
              {sort.dir === "desc" ? (
                <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              ) : (
                <ArrowUpNarrowWide className="h-3.5 w-3.5" />
              )}
              {sort.dir === "desc" ? "High → low" : "Low → high"}
            </button>
          </div>
        </label>
        <button
          onClick={reset}
          className="px-2 py-1 rounded border border-border hover:bg-secondary flex items-center gap-1"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
        </>)}
      </div>

      {/* Custom condition */}
      {showFilters && (
      <div className="px-4 py-2 border-b border-border bg-card/40 text-[12px]">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground shrink-0">Condition</span>
          <input
            data-testid="market-condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            placeholder={
              tab === "crypto"
                ? 'change > 5 and dex_liq > 1M and exchanges contains "BIN"'
                : tab === "stocks"
                  ? "pe < 25 and div_yield > 1 and mcap > 100B"
                  : "change > 0 and volume > 1M"
            }
            className={cn(
              "flex-1 px-2 py-1 rounded border bg-background font-mono",
              conditionError ? "border-sell" : "border-border",
            )}
          />
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="p-1 rounded hover:bg-secondary text-muted-foreground"
            title="Condition help"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <span
            className="text-muted-foreground shrink-0 hidden xl:inline"
            title="Or drag the scrollbar under the table"
          >
            {isMobileApp() ? "Swipe the table sideways" : "Shift + wheel scrolls sideways"}
          </span>
          <span
            className="text-muted-foreground shrink-0"
            data-testid="market-count"
          >
            {shown.length.toLocaleString()} of {total.toLocaleString()}
          </span>
          {(current.loading || loadingHistory) && (
            <span className="flex items-center gap-1 text-muted-foreground shrink-0">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {current.loading ? "Loading…" : "Loading history…"}
            </span>
          )}
        </div>
        {conditionError && (
          <div className="mt-1 text-sell">{conditionError}</div>
        )}
        {current.error && <div className="mt-1 text-sell">{current.error}</div>}
        {showHelp && (
          <div className="mt-2 p-3 rounded-md bg-secondary text-muted-foreground space-y-1">
            <div>
              Compare columns with <code>&gt; &gt;= &lt; &lt;= = !=</code>, text
              with <code>contains</code>, <code>startswith</code>,{" "}
              <code>endswith</code>, ranges with <code>between 1 and 10</code>.
              Join with <code>and</code>, <code>or</code>, <code>not</code> and
              brackets. Numbers take K, M, B, T and %.
            </div>
            <div>
              <span className="text-foreground">Change</span> follows the period
              above. Columns:{" "}
              {spec.columns.map((c) => (
                <button
                  key={c.key}
                  onClick={() =>
                    setCondition(
                      (s) => `${s}${s && !/\s$/.test(s) ? " " : ""}${c.key} `,
                    )
                  }
                  className="mr-1 mb-1 px-1.5 py-0.5 rounded bg-background font-mono text-foreground hover:bg-border"
                >
                  {c.key}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Table */}
      <div
        ref={scroller}
        className="flex-1 min-h-0 overflow-auto"
        data-testid="market-scroll"
      >
        <table
          className="w-full text-[12px] border-collapse"
          data-testid="market-table"
        >
          <thead className="sticky top-0 bg-card z-10">
            <tr>
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  onClick={() => clickSort(c.key)}
                  className={cn(
                    pinClass(i),
                    "bg-card px-3 py-2 font-medium text-muted-foreground border-b border-border cursor-pointer select-none whitespace-nowrap hover:text-foreground",
                    c.kind === "text" ? "text-left" : "text-right",
                    sort.key === c.key && "text-foreground",
                  )}
                >
                  {c.label}
                  {sort.key === c.key
                    ? sort.dir === "desc"
                      ? " ↓"
                      : " ↑"
                    : ""}
                </th>
              ))}
              <th className="sticky right-0 z-[2] bg-card px-3 py-2 font-medium text-muted-foreground border-b border-border text-left whitespace-nowrap shadow-[inset_1px_0_0_hsl(var(--border))]">
                Chart · {period === "custom" ? "Custom" : periodLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r) => (
              <Fragment key={String(r.id)}>
              <tr
                data-row-id={String(r.id)}
                className="group border-b border-border/40 hover:bg-secondary"
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={cn(
                      pinClass(i),
                      i < pinned && "bg-background group-hover:bg-secondary",
                      "px-3 py-1.5 whitespace-nowrap",
                      c.kind === "text"
                        ? "text-left"
                        : "text-right font-mono tabular-nums",
                      c.kind === "pct" && pctClass(r[c.key] as number | null),
                    )}
                  >
                    {tab === "crypto" && c.key === "name" ? (
                      // A coin opens into its exchange pairs and DEX pools.
                      <button
                        type="button"
                        data-testid="market-expand"
                        onClick={() => toggle(String(r.id))}
                        className="flex items-center gap-1 max-w-full hover:text-primary"
                        title="Exchanges and DEX pools"
                      >
                        {expanded.has(String(r.id)) ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span className="truncate">{cell(c, r[c.key] ?? null)}</span>
                      </button>
                    ) : (
                      cell(c, r[c.key] ?? null)
                    )}
                  </td>
                ))}
                {/* The row chart stays at the right edge, however far the table scrolls; a click opens the full chart. */}
                <td className="sticky right-0 z-[1] px-3 py-1 bg-background group-hover:bg-secondary shadow-[inset_1px_0_0_hsl(var(--border))]">
                  <button
                    type="button"
                    disabled={!r.chart}
                    onClick={() => void bridge.app.openChart(String(r.chart))}
                    title={
                      r.chart
                        ? `${String(r.name ?? r.pair ?? r.symbol)} · ${periodLabel} · click to open ${isDex(r) ? `the pool on ${String(r.dex)}` : String(r.chart).startsWith("dex:") ? "its most liquid DEX pool" : String(r.chart)}`
                        : `${String(r.name ?? r.symbol)} · ${periodLabel}`
                    }
                    className="block rounded enabled:cursor-pointer enabled:hover:ring-1 enabled:hover:ring-border"
                  >
                    <Sparkline
                      values={chartOf(r)}
                      width={spark.w}
                      height={spark.h}
                    />
                  </button>
                </td>
              </tr>
              {expanded.has(String(r.id)) && (
                <tr data-testid="market-venues" className="border-b border-border/40 bg-card/40">
                  <td colSpan={columns.length + 1} className="p-0">
                    <Venues
                      cex={isDex(r) ? [] : pairRows(pairs.get(String(r.symbol)) ?? [])}
                      dex={dexVenues.get(String(r.id))}
                      noTokens={tokensOf(r).length === 0}
                      onOpen={(chart) => void bridge.app.openChart(chart)}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {shown.length > limit && (
          <button
            onClick={() => setLimit((l) => l + PAGE)}
            className="w-full py-2 text-[12px] text-primary hover:bg-secondary"
          >
            Show {Math.min(PAGE, shown.length - limit)} more (
            {(shown.length - limit).toLocaleString()} hidden)
          </button>
        )}
        {!current.loading && !shown.length && (
          <div className="py-10 text-center text-muted-foreground">
            {total ? "No rows match the filters." : "No data yet."}
          </div>
        )}
      </div>
    </div>
  );
}

/** An expanded coin: its exchange pairs and DEX pools, each opening its own chart. */
function Venues({
  cex,
  dex,
  noTokens,
  onOpen,
}: {
  cex: Row[];
  dex: DexVenue[] | undefined;
  noTokens: boolean;
  onOpen: (chart: string) => void;
}) {
  const head = "px-2 py-1 font-medium text-muted-foreground text-left whitespace-nowrap";
  const num = "px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap";
  const open = (chart: string | null, kind: string, label: string) =>
    chart ? (
      <button
        type="button"
        data-testid="venue-chart"
        data-kind={kind}
        onClick={() => onOpen(chart)}
        className="px-2 py-0.5 rounded border border-border hover:bg-secondary"
        title={`Open ${label} on the chart`}
      >
        Chart
      </button>
    ) : null;
  return (
    // Window-wide and pinned left, so it stays in view while the wide table scrolls sideways.
    <div className="sticky left-0 w-[calc(100vw-1rem)] flex flex-wrap gap-x-8 gap-y-3 px-4 py-3">
      <section>
        <div className="mb-1 font-medium">Exchanges ({cex.length})</div>
        {cex.length ? (
          <table className="text-[12px]">
            <thead>
              <tr>
                <th className={head}>Exchange</th>
                <th className={head}>Pair</th>
                <th className={cn(head, "text-right")}>Price</th>
                <th className={cn(head, "text-right")}>24h</th>
                <th className={cn(head, "text-right")}>Volume 24h</th>
                <th className={cn(head, "text-right")}>Spread %</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cex.map((m) => (
                <tr key={String(m.id)} data-venue="cex">
                  <td className="px-2 py-1">{String(m.exchange)}</td>
                  <td className="px-2 py-1">{String(m.pair)}</td>
                  <td className={num}>{fmtPrice(Number(m.price))}</td>
                  <td className={cn(num, pctClass(m.chg_1d as number | null))}>{cell({ key: "chg_1d", label: "", kind: "pct" }, m.chg_1d ?? null)}</td>
                  <td className={num}>{fmtUsd(Number(m.volume), 1e5)}</td>
                  <td className={num}>{m.spread == null ? "—" : Number(m.spread).toFixed(3)}</td>
                  <td className="px-2 py-1">{open(String(m.chart), "cex", String(m.id))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-muted-foreground">Not listed on the exchanges switched on.</div>
        )}
      </section>
      <section>
        <div className="mb-1 font-medium">DEX pools ({dex?.length ?? "…"})</div>
        {noTokens ? (
          <div className="text-muted-foreground">No token on the supported chains.</div>
        ) : !dex ? (
          <div className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading pools…
          </div>
        ) : dex.length ? (
          <table className="text-[12px]">
            <thead>
              <tr>
                <th className={head}>Chain</th>
                <th className={head}>DEX</th>
                <th className={head}>Pair</th>
                <th className={cn(head, "text-right")}>Price</th>
                <th className={cn(head, "text-right")}>24h</th>
                <th className={cn(head, "text-right")}>Liquidity</th>
                <th className={cn(head, "text-right")}>Volume 24h</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dex.map((v, i) => (
                <tr key={`${v.chart ?? v.pair}:${i}`} data-venue="dex">
                  <td className="px-2 py-1">{v.chain}</td>
                  <td className="px-2 py-1">{v.dex}</td>
                  <td className="px-2 py-1">{v.pair}</td>
                  <td className={num}>{fmtPrice(v.price)}</td>
                  <td className={cn(num, pctClass(v.change))}>{v.change == null ? "—" : fmtPct(v.change)}</td>
                  <td className={num}>{fmtUsd(v.liquidity, 1e5)}</td>
                  <td className={num}>{fmtUsd(v.volume, 1e5)}</td>
                  <td className="px-2 py-1">{open(v.chart, "dex", `${v.pair} on ${v.dex}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-muted-foreground">No DEX pools found.</div>
        )}
      </section>
    </div>
  );
}

function cell(c: ColumnDef, v: Row[string]): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  switch (c.kind) {
    case "pct":
      return fmtPct(v);
    case "usd":
      return fmtUsd(v, 1e5);
    case "price":
      return fmtPrice(v);
    default:
      return c.key === "rank" ? String(v) : fmtNum(v);
  }
}

function RangeInputs({
  label,
  min,
  max,
  onMin,
  onMax,
  hint,
  disabled,
}: {
  label: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  hint: string;
  disabled?: boolean;
}) {
  const bad = (s: string) => s.trim() !== "" && parseAmount(s) === null;
  return (
    <div
      className={cn(disabled && "opacity-40")}
      title={disabled ? "This tab has no such column" : undefined}
    >
      <div className="text-muted-foreground mb-1">{label}</div>
      <div className="flex items-center gap-1">
        <input
          aria-label={`${label} min`}
          disabled={disabled}
          value={min}
          onChange={(e) => onMin(e.target.value)}
          placeholder={`min ${hint}`}
          className={cn(
            "w-24 px-2 py-1 rounded border bg-background",
            bad(min) ? "border-sell" : "border-border",
          )}
        />
        <span className="text-muted-foreground">–</span>
        <input
          aria-label={`${label} max`}
          disabled={disabled}
          value={max}
          onChange={(e) => onMax(e.target.value)}
          placeholder="max"
          className={cn(
            "w-24 px-2 py-1 rounded border bg-background",
            bad(max) ? "border-sell" : "border-border",
          )}
        />
      </div>
    </div>
  );
}
