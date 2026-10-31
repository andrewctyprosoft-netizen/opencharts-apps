// `net.fetch` for the desktop app's service modules (bridge/core): a fetch that is not bound by
// CORS. On Android it goes through the OcNative plugin (Java HttpURLConnection); in a desktop
// browser (dev) it goes through the Vite dev server's /__oc/net proxy. Both return a real Response,
// streaming when the request is a price stream, so the core modules run unchanged.

import { OcNative, isNative } from "./native.js";

const NULL_BODY = new Set([101, 204, 205, 304]);

function headersOf(init) {
  const h = {};
  const src = init?.headers;
  if (!src) return h;
  if (typeof src.forEach === "function" && !Array.isArray(src)) src.forEach((v, k) => (h[k] = String(v)));
  else for (const [k, v] of Object.entries(src)) h[k] = String(v);
  return h;
}

/** OANDA's chunked price stream is the only long-lived response. */
const isStream = (url) => /^https:\/\/stream-[\w.-]+\/v3\/accounts\/[^/]+\/pricing\/stream/.test(url);

function response(status, statusText, headers, body) {
  const s = status >= 200 && status <= 599 ? status : 502;
  return new Response(NULL_BODY.has(s) ? null : body, { status: s, statusText: statusText || "", headers: headers || {} });
}

function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

let streamSeq = 0;
const streams = new Map(); // id → { controller }
let listening = false;

function listenStreams() {
  if (listening) return;
  listening = true;
  OcNative.addListener("streamData", ({ id, chunk }) => {
    const s = streams.get(id);
    if (s) s.controller.enqueue(new TextEncoder().encode(chunk));
  });
  OcNative.addListener("streamEnd", ({ id, error }) => {
    const s = streams.get(id);
    if (!s) return;
    streams.delete(id);
    if (error) s.controller.error(new Error(error));
    else s.controller.close();
  });
}

async function nativeStream(url, init) {
  listenStreams();
  const id = `s${++streamSeq}`;
  let controller;
  const body = new ReadableStream({
    start(c) {
      controller = c;
    },
    cancel() {
      streams.delete(id);
      void OcNative.streamCancel({ id });
    },
  });
  streams.set(id, { controller });
  const signal = init?.signal;
  const onAbort = () => {
    const s = streams.get(id);
    streams.delete(id);
    void OcNative.streamCancel({ id });
    s?.controller.error(abortError(signal));
  };
  if (signal?.aborted) throw abortError(signal);
  signal?.addEventListener("abort", onAbort, { once: true });
  const head = await OcNative.streamOpen({ id, url, method: init?.method || "GET", headers: headersOf(init) });
  if (head.status >= 400) {
    streams.delete(id);
    return response(head.status, head.statusText, head.headers, head.body ?? "");
  }
  return response(head.status, head.statusText, head.headers, body);
}

async function nativeRequest(url, init) {
  const signal = init?.signal;
  if (signal?.aborted) throw abortError(signal);
  const call = OcNative.request({
    url,
    method: (init?.method || "GET").toUpperCase(),
    headers: headersOf(init),
    body: typeof init?.body === "string" ? init.body : undefined,
    timeoutMs: 30_000,
  });
  const aborted = new Promise((_, reject) => signal?.addEventListener("abort", () => reject(abortError(signal)), { once: true }));
  const res = await (signal ? Promise.race([call, aborted]) : call);
  return response(res.status, res.statusText, res.headers, res.body ?? "");
}

/** Dev only: the Vite middleware does the request and streams the answer back. */
async function devFetch(url, init) {
  const res = await fetch("/__oc/net", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, method: init?.method || "GET", headers: headersOf(init), body: init?.body }),
    signal: init?.signal,
  });
  if (res.status === 599) throw new Error(await res.text());
  const status = Number(res.headers.get("x-oc-status")) || res.status;
  const headers = JSON.parse(res.headers.get("x-oc-headers") || "{}");
  return response(status, res.headers.get("x-oc-status-text") || "", headers, res.body);
}

/**
 * Fetch without CORS limits, for the bridge's service modules only.
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export function netFetch(url, init) {
  const u = String(url);
  if (!isNative) return devFetch(u, init);
  return isStream(u) ? nativeStream(u, init) : nativeRequest(u, init);
}
