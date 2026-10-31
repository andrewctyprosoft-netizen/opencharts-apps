// Pure helpers for the OpenCharts Desktop shell (no Electron imports, unit-tested in dev/tests).

/** Data sources the terminal understands, mapped to its `?adapter=` value. */
export const DATA_SOURCES = {
  live: { adapter: "binance", label: "Live prices" },
  demo: { adapter: "demo", label: "Offline demo (bundled history)" },
};

/** Centralised exchanges with live prices and API-key trading, in menu order. */
export const EXCHANGES = {
  binance: { label: "Binance", passphrase: false },
  okx: { label: "OKX", passphrase: true },
  bybit: { label: "Bybit", passphrase: false },
  kucoin: { label: "KuCoin", passphrase: true },
  coinbase: { label: "Coinbase", passphrase: false },
  mexc: { label: "MEXC", passphrase: false },
};

export const DEFAULT_SETTINGS = {
  dataSource: "live",
  bounds: { width: 1440, height: 900 },
  maximized: false,
  oanda: { env: "practice", tokenEnc: "" },
  exchanges: Object.fromEntries(Object.keys(EXCHANGES).map((id) => [id, true])),
  keys: {},
};

/** OANDA v20 hosts per environment. A practice (demo) token only works on practice hosts. */
export const OANDA_HOSTS = {
  practice: { rest: "https://api-fxpractice.oanda.com", stream: "https://stream-fxpractice.oanda.com" },
  live: { rest: "https://api-fxtrade.oanda.com", stream: "https://stream-fxtrade.oanda.com" },
};

/**
 * Merge saved settings over the defaults, dropping anything malformed.
 * @param {unknown} raw parsed settings.json content
 * @returns {{dataSource: string, bounds: {x?: number, y?: number, width: number, height: number}, maximized: boolean, oanda: {env: string, tokenEnc: string}}}
 */
export function normalizeSettings(raw) {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.dataSource === "string" && raw.dataSource in DATA_SOURCES) {
    out.dataSource = raw.dataSource;
  }
  const b = raw.bounds;
  if (b && typeof b === "object") {
    const num = (v) => typeof v === "number" && Number.isFinite(v);
    if (num(b.width) && num(b.height) && b.width >= 640 && b.height >= 480) {
      out.bounds = { width: Math.round(b.width), height: Math.round(b.height) };
      if (num(b.x) && num(b.y)) Object.assign(out.bounds, { x: Math.round(b.x), y: Math.round(b.y) });
    }
  }
  out.maximized = raw.maximized === true;
  const o = raw.oanda;
  if (o && typeof o === "object") {
    if (o.env in OANDA_HOSTS) out.oanda.env = o.env;
    if (typeof o.tokenEnc === "string") out.oanda.tokenEnc = o.tokenEnc;
  }
  if (raw.exchanges && typeof raw.exchanges === "object") {
    for (const id of Object.keys(EXCHANGES)) {
      if (typeof raw.exchanges[id] === "boolean") out.exchanges[id] = raw.exchanges[id];
    }
  }
  if (raw.keys && typeof raw.keys === "object") {
    for (const id of Object.keys(EXCHANGES)) {
      if (typeof raw.keys[id] === "string" && raw.keys[id]) out.keys[id] = raw.keys[id];
    }
  }
  return out;
}

// ── Public web requests from the page ─────────────────────
// Market data, the market overview and wallet balances go through the main process, limited to
// these hosts. Private exchange endpoints never go this way: they are signed in electron/trade.js.

/** host → path prefixes the page may GET. */
export const PUBLIC_GET = {
  "api.binance.com": ["/api/v3/ticker/", "/api/v3/klines", "/api/v3/exchangeInfo"],
  "www.okx.com": ["/api/v5/market/", "/api/v5/public/instruments"],
  "api.bybit.com": ["/v5/market/"],
  "api.kucoin.com": ["/api/v1/market/", "/api/v2/symbols"],
  "api.exchange.coinbase.com": ["/products"],
  "api.coinbase.com": ["/api/v3/brokerage/market/"],
  "api.mexc.com": ["/api/v3/ticker/", "/api/v3/klines", "/api/v3/exchangeInfo"],
  "api.coingecko.com": ["/api/v3/coins/markets"],
  "query1.finance.yahoo.com": ["/v8/finance/spark", "/v1/finance/screener/predefined/saved"],
  "api.ethplorer.io": ["/getAddressInfo/"],
  "mempool.space": ["/api/address/"],
  "api.dexscreener.com": ["/tokens/v1/"],
  "lite-api.jup.ag": ["/price/v3", "/tokens/v2/search"],
};

/** JSON-RPC endpoints the page may POST to (wallet balances only). */
export const PUBLIC_RPC = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  bsc: "https://bsc-rpc.publicnode.com",
  base: "https://base-rpc.publicnode.com",
  arbitrum: "https://arbitrum-one-rpc.publicnode.com",
  polygon: "https://polygon-bor-rpc.publicnode.com",
  optimism: "https://optimism-rpc.publicnode.com",
  avalanche: "https://avalanche-c-chain-rpc.publicnode.com",
  solana: "https://api.mainnet-beta.solana.com",
};

/** Read-only JSON-RPC methods allowed through the bridge. */
export const RPC_METHODS = new Set(["eth_getBalance", "eth_call", "getBalance", "getTokenAccountsByOwner"]);

/**
 * Check a URL the page wants fetched.
 * @param {unknown} url
 * @returns {URL | null} the parsed URL when it is https, on an allowed host and path
 */
export function publicGetUrl(url) {
  if (typeof url !== "string" || url.length > 4000) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const prefixes = PUBLIC_GET[u.hostname];
  if (!prefixes || u.pathname.includes("..")) return null;
  return prefixes.some((p) => u.pathname.startsWith(p)) ? u : null;
}

/**
 * Check a JSON-RPC call (single or batch) before it is posted.
 * @param {unknown} chain key of PUBLIC_RPC
 * @param {unknown} body
 * @returns {string | null} the endpoint URL, or null when the chain or any method is not allowed
 */
export function publicRpcUrl(chain, body) {
  if (typeof chain !== "string" || !Object.hasOwn(PUBLIC_RPC, chain)) return null;
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 100) return null;
  const ok = calls.every((c) => c && typeof c === "object" && RPC_METHODS.has(c.method));
  return ok ? PUBLIC_RPC[chain] : null;
}

/**
 * Split a chunked OANDA price stream into complete JSON lines.
 * @param {string} buffer text left over from earlier chunks plus the new chunk
 * @returns {{lines: string[], rest: string}} complete non-empty lines and the unfinished tail
 */
export function splitStreamLines(buffer) {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}

/**
 * Turn one OANDA stream line into a price event, or null for heartbeats and junk.
 * @param {string} line
 * @returns {{instrument: string, bid: number, ask: number, time: number} | null}
 */
export function parseOandaPriceLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return null;
  }
  if (msg?.type !== "PRICE") return null;
  const bid = Number(msg.bids?.[0]?.price ?? msg.closeoutBid);
  const ask = Number(msg.asks?.[0]?.price ?? msg.closeoutAsk);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
  const t = Number(msg.time);
  const time = Number.isFinite(t) ? Math.round(t * 1000) : Date.parse(msg.time) || Date.now();
  return { instrument: String(msg.instrument), bid, ask, time };
}

/** Hosts the page may reach through the GeckoTerminal bridge, and only under this path. */
export const GECKO_BASE = "https://api.geckoterminal.com/api/v2";

/**
 * Validate a GeckoTerminal API path from the page before it is fetched.
 * @param {unknown} p e.g. "/search/pools?query=pepe"
 * @returns {string | null} the full URL, or null when the path is not an allowed API path
 */
export function geckoUrl(p) {
  if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//") || p.length > 2000) return null;
  if (!/^\/(search\/pools|networks\/[a-z0-9_-]+\/pools\/)/.test(p)) return null;
  if (p.includes("..") || /[\s\\]/.test(p)) return null;
  return GECKO_BASE + p;
}

export const SWISSQUOTE_BASE = "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument";
export const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

/**
 * Swissquote's public quote URL for an instrument such as "XAU_USD".
 * @param {unknown} instrument
 * @returns {string | null}
 */
export function swissquoteUrl(instrument) {
  const m = typeof instrument === "string" && /^([A-Z]{3})_([A-Z]{3})$/.exec(instrument);
  return m ? `${SWISSQUOTE_BASE}/${m[1]}/${m[2]}` : null;
}

/**
 * Swissquote quote response → the tightest bid/ask of the first platform, or null.
 * @param {unknown} json
 * @returns {{bid: number, ask: number, time: number} | null}
 */
export function parseSwissquote(json) {
  const platform = Array.isArray(json) ? json[0] : null;
  let best = null;
  for (const p of platform?.spreadProfilePrices ?? []) {
    const bid = Number(p?.bid);
    const ask = Number(p?.ask);
    if (!(bid > 0 && ask >= bid)) continue;
    if (!best || ask - bid < best.ask - best.bid) best = { bid, ask };
  }
  if (!best) return null;
  const ts = Number(platform.ts);
  return { ...best, time: Number.isFinite(ts) && ts > 0 ? ts : Date.now() };
}

/**
 * Yahoo Finance chart URL, limited to forex pairs ("EURUSD=X") and the metal futures.
 * @param {unknown} symbol
 * @param {unknown} query e.g. "interval=1h&period1=…&period2=…"
 * @returns {string | null}
 */
export function yahooChartUrl(symbol, query) {
  if (typeof symbol !== "string" || !/^([A-Z]{6}=X|(GC|SI|PL|PA)=F)$/.test(symbol)) return null;
  if (typeof query !== "string" || query.length > 300 || !/^[\w.=&-]*$/.test(query)) return null;
  return `${YAHOO_CHART_BASE}/${symbol}?${query}`;
}

/**
 * The page URL for a data source.
 * @param {string} dataSource key of DATA_SOURCES
 * @param {string[]} [exchanges] enabled exchange ids, passed to the page as `ex`
 * @returns {string}
 */
export function pageUrl(dataSource, exchanges = Object.keys(EXCHANGES)) {
  const source = DATA_SOURCES[dataSource] ?? DATA_SOURCES[DEFAULT_SETTINGS.dataSource];
  const ex = exchanges.filter((id) => Object.hasOwn(EXCHANGES, id)).join(",");
  return `app://opencharts/index.html?adapter=${source.adapter}&ex=${ex}`;
}

/**
 * Map an app:// request path onto a file inside the web root, refusing anything that escapes it.
 * @param {string} pathname URL pathname, e.g. "/assets/index.js"
 * @returns {string | null} path relative to the web root, using forward slashes
 */
export function resolveWebPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const parts = [];
  for (const part of decoded.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === ".." || part.includes(":")) return null;
    parts.push(part);
  }
  return parts.length ? parts.join("/") : "index.html";
}

/**
 * Whether a link should open in the user's browser rather than inside the app.
 * @param {string} url
 * @returns {boolean}
 */
export function isExternalUrl(url) {
  return /^https?:\/\//i.test(url) || /^mailto:/i.test(url);
}
