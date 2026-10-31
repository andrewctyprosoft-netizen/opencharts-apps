// Keyless forex and metals for the main process: live spot quotes from Swissquote's public
// feed and chart history from Yahoo Finance. Used when no OANDA token is set.
// Both are fetched here because neither sends CORS headers for the app:// page.

import { parseSwissquote, swissquoteUrl, yahooChartUrl } from "./lib.js";

const QUOTE_CONCURRENCY = 6;
const QUOTE_TIMEOUT_MS = 8_000;
const CHART_SPACING_MS = 300;
const CHART_BACKOFF_MS = 20_000;

/** @param {{ net: { fetch: typeof fetch } }} deps */
export function createFx({ net }) {
  async function quote(instrument) {
    const url = swissquoteUrl(instrument);
    if (!url) return null;
    try {
      const res = await net.fetch(url, { signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS) });
      if (!res.ok) return null;
      const q = parseSwissquote(await res.json());
      return q && { instrument, ...q };
    } catch {
      return null;
    }
  }

  /**
   * Latest bid/ask for each instrument ("EUR_USD"); instruments that fail are left out.
   * @param {unknown} instruments
   */
  async function quotes(instruments) {
    const list = (Array.isArray(instruments) ? instruments : []).filter((i) => swissquoteUrl(i)).slice(0, 100);
    const out = [];
    for (let i = 0; i < list.length; i += QUOTE_CONCURRENCY) {
      const batch = await Promise.all(list.slice(i, i + QUOTE_CONCURRENCY).map(quote));
      for (const q of batch) if (q) out.push(q);
    }
    return out;
  }

  // Chart requests go one at a time, a little apart, and pause after a 429.
  const queue = [];
  let busy = false;
  let nextAt = 0;

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const job = queue.shift();
      const wait = nextAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      nextAt = Date.now() + CHART_SPACING_MS;
      try {
        const res = await net.fetch(job.url, { headers: { Accept: "application/json" } });
        if (res.status === 429) {
          nextAt = Date.now() + CHART_BACKOFF_MS;
          job.reject(new Error("Yahoo Finance rate limit reached; chart history pauses for 20 s."));
        } else if (res.status === 422) {
          // The range is older than Yahoo keeps for that interval: an empty chart, not an error.
          job.resolve({ chart: { result: null } });
        } else if (!res.ok) {
          job.reject(new Error(`Yahoo Finance ${res.status} ${res.statusText}`));
        } else {
          job.resolve(await res.json());
        }
      } catch (err) {
        job.reject(new Error(`Yahoo Finance unreachable: ${err.message || err}`));
      }
    }
    busy = false;
  }

  /**
   * @param {unknown} symbol Yahoo symbol, e.g. "EURUSD=X" or "GC=F"
   * @param {unknown} query
   */
  function chart(symbol, query) {
    const url = yahooChartUrl(symbol, query);
    if (!url) return Promise.reject(new Error(`Chart request not allowed: ${symbol}`));
    return new Promise((resolve, reject) => {
      queue.push({ url, resolve, reject });
      pump();
    });
  }

  return { quotes, chart };
}
