// GeckoTerminal client for the main process: a polite request queue under the free API's
// 30 calls/minute. Chart and search requests jump ahead of background price polls.

import { geckoUrl } from "./lib.js";

const SPACING_MS = 2_100;
const BACKOFF_MS = 15_000;

/** @param {{ net: { fetch: typeof fetch } }} deps */
export function createGecko({ net }) {
  const queues = { high: [], low: [] };
  let busy = false;
  let nextAt = 0;

  async function pump() {
    if (busy) return;
    busy = true;
    while (queues.high.length || queues.low.length) {
      const job = queues.high.shift() ?? queues.low.shift();
      const wait = nextAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      nextAt = Date.now() + SPACING_MS;
      try {
        const res = await net.fetch(job.url, { headers: { Accept: "application/json" } });
        if (res.status === 429) {
          nextAt = Date.now() + BACKOFF_MS;
          job.reject(new Error("GeckoTerminal rate limit reached; try again in a few seconds."));
        } else if (!res.ok) {
          job.reject(new Error(`GeckoTerminal ${res.status} ${res.statusText}`));
        } else {
          job.resolve(await res.json());
        }
      } catch (err) {
        job.reject(new Error(`GeckoTerminal unreachable: ${err.message || err}`));
      }
    }
    busy = false;
  }

  /**
   * @param {string} path API path, e.g. "/search/pools?query=pepe"
   * @param {"high" | "low"} priority
   */
  function get(path, priority = "high") {
    const url = geckoUrl(path);
    if (!url) return Promise.reject(new Error(`Path not allowed: ${path}`));
    return new Promise((resolve, reject) => {
      queues[priority === "low" ? "low" : "high"].push({ url, resolve, reject });
      pump();
    });
  }

  return { get };
}
