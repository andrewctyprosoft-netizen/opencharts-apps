// Vite dev-server plugin: runs the Android app's bridge in a desktop browser. Loaded by
// ../upstream/vite.config.ts only in `--mode mobile` (npm run dev in android/).
// - /bridge.js is bundled from bridge/ on each request (no build step while editing).
// - /keys.html and /oanda-token.html are served from bridge/.
// - /__oc/net does the bridge's network requests server-side (the phone does them natively,
//   free of CORS) and streams the answer back. Only the hosts the app talks to are allowed.

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { buildBridge } from "./build-bridge.mjs";
import { GECKO_BASE, OANDA_HOSTS, PUBLIC_GET, PUBLIC_RPC, SWISSQUOTE_BASE, YAHOO_CHART_BASE } from "../../../desktop/electron/lib.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const PRIVATE_HOSTS = [
  "api.binance.com",
  "testnet.binance.vision",
  "www.okx.com",
  "api.bybit.com",
  "api-testnet.bybit.com",
  "api.kucoin.com",
  "api.coinbase.com",
  "api.mexc.com",
];
const ALLOWED = new Set([
  ...Object.keys(PUBLIC_GET),
  ...Object.values(PUBLIC_RPC).map((u) => new URL(u).hostname),
  ...[GECKO_BASE, SWISSQUOTE_BASE, YAHOO_CHART_BASE].map((u) => new URL(u).hostname),
  ...Object.values(OANDA_HOSTS).flatMap((h) => [new URL(h.rest).hostname, new URL(h.stream).hostname]),
  ...PRIVATE_HOSTS,
]);

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

/** @returns {import("vite").Plugin} */
export function mobileDev() {
  return {
    name: "opencharts-mobile-dev",
    apply: "serve",
    // The bridge runs before the terminal's module script (classic scripts run first).
    transformIndexHtml: () => [{ tag: "script", attrs: { src: "./bridge.js" }, injectTo: "head-prepend" }],
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        try {
          if (url === "/bridge.js") {
            const js = await buildBridge({ write: false, minify: false });
            res.setHeader("Content-Type", "text/javascript");
            res.setHeader("Cache-Control", "no-store");
            return res.end(js);
          }
          if (url === "/keys.html" || url === "/oanda-token.html") {
            res.setHeader("Content-Type", "text/html");
            return res.end(fs.readFileSync(path.join(root, "bridge", url.slice(1))));
          }
          if (url === "/__oc/net" && req.method === "POST") {
            const job = JSON.parse(await readBody(req));
            const target = new URL(job.url);
            if (target.protocol !== "https:" || !ALLOWED.has(target.hostname)) {
              res.statusCode = 599;
              return res.end(`Dev proxy: host not allowed ${target.hostname}`);
            }
            const ctrl = new AbortController();
            res.on("close", () => ctrl.abort());
            let upstream;
            try {
              upstream = await fetch(target, {
                method: job.method,
                headers: job.headers,
                body: job.body ?? undefined,
                signal: ctrl.signal,
              });
            } catch (err) {
              res.statusCode = 599;
              return res.end(`${target.hostname} unreachable: ${err.message || err}`);
            }
            const headers = {};
            upstream.headers.forEach((v, k) => {
              if (!/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(k)) headers[k] = v;
            });
            res.statusCode = 200;
            res.setHeader("x-oc-status", String(upstream.status));
            res.setHeader("x-oc-status-text", upstream.statusText || "");
            res.setHeader("x-oc-headers", JSON.stringify(headers));
            res.setHeader("Content-Type", headers["content-type"] || "application/octet-stream");
            if (!upstream.body) return res.end();
            Readable.fromWeb(upstream.body).on("error", () => res.end()).pipe(res);
            return;
          }
        } catch (err) {
          res.statusCode = 500;
          return res.end(String(err?.stack || err));
        }
        next();
      });
    },
  };
}
