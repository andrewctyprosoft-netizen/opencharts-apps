// Public web requests for the page: exchange market data, the market overview and wallet
// balances. Only hosts in lib.js PUBLIC_GET / PUBLIC_RPC are reachable. Requests to one host are
// spaced apart, and a 429 pauses that host for a while instead of hammering it.

import { publicGetUrl, publicRpcUrl } from "./lib.js";

const TIMEOUT_MS = 15_000;
const BACKOFF_MS = 20_000;
/** Minimum gap between requests to one host; free tiers that limit per minute get more. */
const SPACING_MS = {
  "api.coingecko.com": 2_500,
  "query1.finance.yahoo.com": 300,
  "api.ethplorer.io": 1_100,
  "api.dexscreener.com": 250,
  "api.mainnet-beta.solana.com": 250,
};
const DEFAULT_SPACING_MS = 60;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) OpenChartsDesktop";

/** @param {{ net: { fetch: typeof fetch } }} deps */
export function createWeb({ net }) {
  const hosts = new Map(); // host → { queue, busy, nextAt }

  const lane = (host) => {
    let l = hosts.get(host);
    if (!l) hosts.set(host, (l = { queue: [], busy: false, nextAt: 0 }));
    return l;
  };

  async function pump(host) {
    const l = lane(host);
    if (l.busy) return;
    l.busy = true;
    while (l.queue.length) {
      const job = l.queue.shift();
      const wait = l.nextAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      l.nextAt = Date.now() + (SPACING_MS[host] ?? DEFAULT_SPACING_MS);
      try {
        const res = await net.fetch(job.url, { ...job.init, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.status === 429 || res.status === 418) {
          l.nextAt = Date.now() + BACKOFF_MS;
          job.reject(new Error(`${host} rate limit reached; it pauses for 20 s.`));
          continue;
        }
        const type = res.headers.get("content-type") ?? "";
        const body = type.includes("json") ? await res.json().catch(() => null) : await res.text();
        if (!res.ok && body == null) job.reject(new Error(`${host} ${res.status} ${res.statusText}`));
        else job.resolve({ status: res.status, body });
      } catch (err) {
        job.reject(new Error(`${host} unreachable: ${err.message || err}`));
      }
    }
    l.busy = false;
  }

  // Smoke tests only: OC_SMOKE_BLOCK_HOST="www.okx.com:20000" fails that host for the first 20 s,
  // to check that an exchange missing at start is retried and added later.
  const [blockedHost, blockMs] = (process.env.OC_SMOKE ? process.env.OC_SMOKE_BLOCK_HOST || "" : "").split(":");
  const blockUntil = blockedHost ? Date.now() + Number(blockMs || 20_000) : 0;

  function enqueue(url, init) {
    const host = new URL(url).hostname;
    if (host === blockedHost && Date.now() < blockUntil) return Promise.reject(new Error(`${host} blocked by the smoke test`));
    return new Promise((resolve, reject) => {
      lane(host).queue.push({ url, init, resolve, reject });
      pump(host);
    });
  }

  /**
   * GET an allowed public URL. Resolves with { status, body } (JSON parsed when the reply is JSON).
   * @param {unknown} url
   */
  function get(url) {
    const u = publicGetUrl(url);
    if (!u) return Promise.reject(new Error(`URL not allowed: ${String(url).slice(0, 120)}`));
    return enqueue(u.toString(), { headers: { Accept: "application/json, text/csv, */*", "User-Agent": UA } });
  }

  /**
   * POST a read-only JSON-RPC call (or batch) to a known public node.
   * @param {unknown} chain
   * @param {unknown} body
   */
  async function rpc(chain, body) {
    const url = publicRpcUrl(chain, body);
    if (!url) throw new Error(`RPC call not allowed on ${String(chain)}`);
    const { status, body: out } = await enqueue(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
      body: JSON.stringify(body),
    });
    if (status >= 400) throw new Error(`${chain} RPC ${status}: ${JSON.stringify(out).slice(0, 160)}`);
    return out;
  }

  return { get, rpc };
}
