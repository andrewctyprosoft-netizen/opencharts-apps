// GeckoTerminal client for the main process: a polite request queue under the free API's limit.
// The API allows a burst of about five calls, then about five a minute (measured 2026-11-01), so the
// gap between calls widens after each rate limit and narrows again as calls succeed. Chart and
// search requests jump ahead of background price polls. A rate-limited request waits out the
// pause and is tried again before it fails.

import { geckoUrl } from "./lib.js";

const SPACING_MS = 2_100;
const MAX_SPACING_MS = 12_000;
const BACKOFF_MS = 12_000;
const TRIES = 4;

/**
 * @param {{ net: { fetch: typeof fetch }, spacingMs?: number, maxSpacingMs?: number, backoffMs?: number }} deps
 */
export function createGecko({ net, spacingMs = SPACING_MS, maxSpacingMs = MAX_SPACING_MS, backoffMs = BACKOFF_MS }) {
  const queues = { high: [], low: [] };
  let busy = false;
  let nextAt = 0;
  let gap = spacingMs;

  async function pump() {
    if (busy) return;
    busy = true;
    while (queues.high.length || queues.low.length) {
      const job = queues.high.shift() ?? queues.low.shift();
      const wait = nextAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      nextAt = Date.now() + gap;
      try {
        const res = await net.fetch(job.url, { headers: { Accept: "application/json" } });
        if (res.status === 429) {
          gap = Math.min(maxSpacingMs, gap * 2);
          nextAt = Date.now() + backoffMs;
          job.tries += 1;
          if (job.tries < TRIES) queues[job.priority].unshift(job);
          else job.reject(new Error("GeckoTerminal rate limit reached; try again in a few seconds."));
        } else if (!res.ok) {
          job.reject(new Error(`GeckoTerminal ${res.status} ${res.statusText}`));
        } else {
          gap = Math.max(spacingMs, gap * 0.95);
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
      const queue = priority === "low" ? "low" : "high";
      queues[queue].push({ url, priority: queue, tries: 0, resolve, reject });
      pump();
    });
  }

  return { get };
}
