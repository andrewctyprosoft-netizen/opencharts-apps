// Private exchange API requests: signing, order bodies and reply parsing for Binance, OKX, Bybit,
// KuCoin, Coinbase (Advanced Trade) and MEXC. Pure apart from node:crypto; unit-tested in
// dev/tests/exchanges.test.mjs. Keys are passed in by electron/trade.js and never stored here.

import crypto from "node:crypto";

/** Production hosts, plus the test networks some exchanges offer for trying keys safely. */
export const PRIVATE_HOSTS = {
  binance: { live: "https://api.binance.com", test: "https://testnet.binance.vision" },
  okx: { live: "https://www.okx.com", test: "https://www.okx.com" }, // demo keys use a header instead
  bybit: { live: "https://api.bybit.com", test: "https://api-testnet.bybit.com" },
  kucoin: { live: "https://api.kucoin.com" },
  coinbase: { live: "https://api.coinbase.com" },
  mexc: { live: "https://api.mexc.com" },
};

/** Exchanges whose keys can be test-network / demo keys. */
export const HAS_TESTNET = new Set(["binance", "okx", "bybit"]);

const hmac = (secret, data, encoding) => crypto.createHmac("sha256", secret).update(data).digest(encoding);
const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** Query string in insertion order, skipping undefined values. */
export function queryString(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.append(k, String(v));
  return p.toString();
}

/**
 * The Coinbase CDP key as a Node KeyObject: an EC PEM ("-----BEGIN EC PRIVATE KEY-----", ES256)
 * or a base64 Ed25519 key (64 bytes: seed + public key, EdDSA).
 * @param {string} secret
 * @returns {{ key: crypto.KeyObject, alg: "ES256" | "EdDSA" }}
 */
export function coinbaseKey(secret) {
  const text = String(secret).trim().replace(/\\n/g, "\n");
  if (text.includes("BEGIN")) return { key: crypto.createPrivateKey(text), alg: "ES256" };
  const raw = Buffer.from(text, "base64");
  if (raw.length !== 64 && raw.length !== 32) throw new Error("Coinbase key must be a PEM EC key or a base64 Ed25519 key.");
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw.subarray(0, 32)]);
  return { key: crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" }), alg: "EdDSA" };
}

/**
 * Coinbase Advanced Trade bearer token for one request (valid 2 minutes).
 * @param {string} keyName "organizations/…/apiKeys/…" or the key id
 * @param {string} secret
 * @param {string} method
 * @param {string} path request path without the query string
 * @param {number} nowMs
 * @param {string} nonce
 */
export function coinbaseJwt(keyName, secret, method, path, nowMs, nonce) {
  const { key, alg } = coinbaseKey(secret);
  const now = Math.floor(nowMs / 1000);
  const header = { alg, kid: keyName, nonce, typ: "JWT" };
  const payload = { sub: keyName, iss: "cdp", nbf: now, exp: now + 120, uri: `${method} api.coinbase.com${path}` };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig =
    alg === "ES256"
      ? crypto.sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" })
      : crypto.sign(null, Buffer.from(input), key);
  return `${input}.${b64url(sig)}`;
}

/**
 * Sign a private request.
 * @param {string} ex exchange id
 * @param {{apiKey: string, secret: string, passphrase?: string, testnet?: boolean}} creds
 * @param {{method: string, path: string, query?: object, body?: object}} req
 * @param {number} nowMs
 * @param {string} [nonce] Coinbase JWT nonce
 * @returns {{url: string, init: {method: string, headers: Record<string, string>, body?: string}}}
 */
export function signRequest(ex, creds, req, nowMs, nonce = crypto.randomBytes(16).toString("hex")) {
  const hosts = PRIVATE_HOSTS[ex];
  if (!hosts) throw new Error(`Unknown exchange ${ex}`);
  const host = creds.testnet && hosts.test ? hosts.test : hosts.live;
  const method = req.method.toUpperCase();
  const qs = queryString(req.query);
  const body = req.body ? JSON.stringify(req.body) : "";
  const json = { "Content-Type": "application/json", Accept: "application/json" };

  switch (ex) {
    case "binance":
    case "mexc": {
      // Everything goes in the signed query string, POST and DELETE included.
      const signed = queryString({ ...req.query, ...req.body, recvWindow: 5000, timestamp: nowMs });
      const signature = hmac(creds.secret, signed, "hex");
      const keyHeader = ex === "binance" ? "X-MBX-APIKEY" : "X-MEXC-APIKEY";
      return {
        url: `${host}${req.path}?${signed}&signature=${signature}`,
        init: { method, headers: { [keyHeader]: creds.apiKey, Accept: "application/json", "Content-Type": "application/json" } },
      };
    }
    case "okx": {
      const path = qs ? `${req.path}?${qs}` : req.path;
      const ts = new Date(nowMs).toISOString();
      const headers = {
        ...json,
        "OK-ACCESS-KEY": creds.apiKey,
        "OK-ACCESS-SIGN": hmac(creds.secret, ts + method + path + body, "base64"),
        "OK-ACCESS-TIMESTAMP": ts,
        "OK-ACCESS-PASSPHRASE": creds.passphrase ?? "",
      };
      if (creds.testnet) headers["x-simulated-trading"] = "1";
      return { url: host + path, init: { method, headers, ...(body && { body }) } };
    }
    case "bybit": {
      const ts = String(nowMs);
      const recv = "5000";
      const payload = method === "GET" || method === "DELETE" ? qs : body;
      const headers = {
        ...json,
        "X-BAPI-API-KEY": creds.apiKey,
        "X-BAPI-TIMESTAMP": ts,
        "X-BAPI-RECV-WINDOW": recv,
        "X-BAPI-SIGN": hmac(creds.secret, ts + creds.apiKey + recv + payload, "hex"),
        "X-BAPI-SIGN-TYPE": "2",
      };
      return { url: host + req.path + (qs ? `?${qs}` : ""), init: { method, headers, ...(body && { body }) } };
    }
    case "kucoin": {
      const path = qs ? `${req.path}?${qs}` : req.path;
      const ts = String(nowMs);
      const headers = {
        ...json,
        "KC-API-KEY": creds.apiKey,
        "KC-API-SIGN": hmac(creds.secret, ts + method + path + body, "base64"),
        "KC-API-TIMESTAMP": ts,
        "KC-API-PASSPHRASE": hmac(creds.secret, creds.passphrase ?? "", "base64"),
        "KC-API-KEY-VERSION": "2",
      };
      return { url: host + path, init: { method, headers, ...(body && { body }) } };
    }
    case "coinbase": {
      const token = coinbaseJwt(creds.apiKey, creds.secret, method, req.path, nowMs, nonce);
      const headers = { ...json, Authorization: `Bearer ${token}` };
      return { url: host + req.path + (qs ? `?${qs}` : ""), init: { method, headers, ...(body && { body }) } };
    }
  }
  throw new Error(`Unknown exchange ${ex}`);
}

// ── Request specs ─────────────────────────────────────────

export function balancesRequest(ex) {
  switch (ex) {
    case "binance":
      return { method: "GET", path: "/api/v3/account", query: { omitZeroBalances: "true" } };
    case "mexc":
      return { method: "GET", path: "/api/v3/account" };
    case "okx":
      return { method: "GET", path: "/api/v5/account/balance" };
    case "bybit":
      return { method: "GET", path: "/v5/account/wallet-balance", query: { accountType: "UNIFIED" } };
    case "kucoin":
      return { method: "GET", path: "/api/v1/accounts", query: { type: "trade" } };
    case "coinbase":
      return { method: "GET", path: "/api/v3/brokerage/accounts", query: { limit: 250 } };
  }
  throw new Error(`Unknown exchange ${ex}`);
}

/** MEXC needs a symbol for open orders; pass it for MEXC, the others list everything. */
export function openOrdersRequest(ex, native) {
  switch (ex) {
    case "binance":
      return { method: "GET", path: "/api/v3/openOrders" };
    case "mexc":
      return { method: "GET", path: "/api/v3/openOrders", query: { symbol: native } };
    case "okx":
      return { method: "GET", path: "/api/v5/trade/orders-pending", query: { instType: "SPOT" } };
    case "bybit":
      return { method: "GET", path: "/v5/order/realtime", query: { category: "spot" } };
    case "kucoin":
      return { method: "GET", path: "/api/v1/orders", query: { status: "active", tradeType: "TRADE" } };
    case "coinbase":
      return { method: "GET", path: "/api/v3/brokerage/orders/historical/batch", query: { order_status: "OPEN" } };
  }
  throw new Error(`Unknown exchange ${ex}`);
}

/**
 * The request for a market or limit spot order. Quantities are in the base asset.
 * @param {string} ex
 * @param {{native: string, side: "BUY"|"SELL", type: "MARKET"|"LIMIT", qty: string, price?: string}} o
 * @param {string} clientId letters and digits, at most 32
 */
export function orderRequest(ex, o, clientId) {
  const limit = o.type === "LIMIT";
  if (limit && !o.price) throw new Error("A limit order needs a price.");
  switch (ex) {
    case "binance":
    case "mexc":
      return {
        method: "POST",
        path: "/api/v3/order",
        body: {
          symbol: o.native,
          side: o.side,
          type: o.type,
          quantity: o.qty,
          ...(limit && { price: o.price, timeInForce: "GTC" }),
          newClientOrderId: clientId,
          ...(ex === "binance" && { newOrderRespType: "RESULT" }),
        },
      };
    case "okx":
      return {
        method: "POST",
        path: "/api/v5/trade/order",
        body: {
          instId: o.native,
          tdMode: "cash",
          side: o.side.toLowerCase(),
          ordType: limit ? "limit" : "market",
          sz: o.qty,
          ...(limit ? { px: o.price } : { tgtCcy: "base_ccy" }),
          clOrdId: clientId,
        },
      };
    case "bybit":
      return {
        method: "POST",
        path: "/v5/order/create",
        body: {
          category: "spot",
          symbol: o.native,
          side: o.side === "BUY" ? "Buy" : "Sell",
          orderType: limit ? "Limit" : "Market",
          qty: o.qty,
          ...(limit ? { price: o.price, timeInForce: "GTC" } : { marketUnit: "baseCoin" }),
          orderLinkId: clientId,
        },
      };
    case "kucoin":
      return {
        method: "POST",
        path: "/api/v1/orders",
        body: {
          clientOid: clientId,
          side: o.side.toLowerCase(),
          symbol: o.native,
          type: limit ? "limit" : "market",
          size: o.qty,
          ...(limit && { price: o.price }),
        },
      };
    case "coinbase":
      return {
        method: "POST",
        path: "/api/v3/brokerage/orders",
        body: {
          client_order_id: clientId,
          product_id: o.native,
          side: o.side,
          order_configuration: limit
            ? { limit_limit_gtc: { base_size: o.qty, limit_price: o.price, post_only: false } }
            : { market_market_ioc: { base_size: o.qty } },
        },
      };
  }
  throw new Error(`Unknown exchange ${ex}`);
}

export function cancelRequest(ex, native, id) {
  switch (ex) {
    case "binance":
    case "mexc":
      return { method: "DELETE", path: "/api/v3/order", query: { symbol: native, orderId: id } };
    case "okx":
      return { method: "POST", path: "/api/v5/trade/cancel-order", body: { instId: native, ordId: id } };
    case "bybit":
      return { method: "POST", path: "/v5/order/cancel", body: { category: "spot", symbol: native, orderId: id } };
    case "kucoin":
      return { method: "DELETE", path: `/api/v1/orders/${encodeURIComponent(id)}` };
    case "coinbase":
      return { method: "POST", path: "/api/v3/brokerage/orders/batch_cancel", body: { order_ids: [id] } };
  }
  throw new Error(`Unknown exchange ${ex}`);
}

// ── Replies ───────────────────────────────────────────────

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * The exchange's error message for a reply, or null when it succeeded.
 * @param {string} ex
 * @param {number} status HTTP status
 * @param {any} json parsed body (may be null)
 */
export function apiError(ex, status, json) {
  const fallback =
    status === 401 || status === 403
      ? `the API key was rejected (${status}). Check the key and secret, that it has read and trade permission, and its IP whitelist.`
      : status >= 400
        ? `HTTP ${status}`
        : null;
  switch (ex) {
    case "binance":
    case "mexc":
      if (json && typeof json.code === "number" && json.code !== 0 && json.code !== 200 && json.msg) return `${json.msg} (${json.code})`;
      if (status >= 400) return json?.msg ? `${json.msg} (${json.code})` : fallback;
      return null;
    case "okx":
      if (json && json.code !== undefined && String(json.code) !== "0") {
        const d = json.data?.[0];
        return d?.sMsg ? `${d.sMsg} (${d.sCode})` : `${json.msg || "OKX error"} (${json.code})`;
      }
      if (json?.data?.[0]?.sCode && String(json.data[0].sCode) !== "0") return `${json.data[0].sMsg} (${json.data[0].sCode})`;
      return fallback;
    case "bybit":
      if (json && json.retCode !== undefined && json.retCode !== 0) return `${json.retMsg} (${json.retCode})`;
      return fallback;
    case "kucoin":
      if (json && json.code !== undefined && String(json.code) !== "200000") return `${json.msg || "KuCoin error"} (${json.code})`;
      return fallback;
    case "coinbase":
      if (json && json.success === false) {
        const e = json.error_response ?? {};
        return e.message || e.preview_failure_reason || e.error || json.failure_reason || "Coinbase rejected the order";
      }
      if (status >= 400) return json?.message || json?.error_details || json?.error || fallback;
      return null;
  }
  return fallback;
}

/** Balances reply → [{asset, free, locked, usd?}] for assets that are not zero. */
export function parseBalances(ex, json) {
  let list = [];
  switch (ex) {
    case "binance":
    case "mexc":
      list = (json?.balances ?? []).map((b) => ({ asset: b.asset, free: n(b.free), locked: n(b.locked) }));
      break;
    case "okx":
      list = (json?.data?.[0]?.details ?? []).map((d) => ({
        asset: d.ccy,
        free: n(d.availBal),
        locked: n(d.frozenBal),
        usd: n(d.eqUsd) || undefined,
      }));
      break;
    case "bybit":
      list = (json?.result?.list?.[0]?.coin ?? []).map((c) => ({
        asset: c.coin,
        free: Math.max(0, n(c.walletBalance) - n(c.locked)),
        locked: n(c.locked),
        usd: n(c.usdValue) || undefined,
      }));
      break;
    case "kucoin": {
      const by = new Map();
      for (const a of json?.data ?? []) {
        const prev = by.get(a.currency) ?? { asset: a.currency, free: 0, locked: 0 };
        prev.free += n(a.available);
        prev.locked += n(a.holds);
        by.set(a.currency, prev);
      }
      list = [...by.values()];
      break;
    }
    case "coinbase":
      list = (json?.accounts ?? []).map((a) => ({
        asset: a.currency,
        free: n(a.available_balance?.value),
        locked: n(a.hold?.value),
      }));
      break;
  }
  return list.filter((b) => b.asset && b.free + b.locked > 0);
}

/** Open orders reply → [{id, native, side, type, price, qty, filled, time}]. */
export function parseOpenOrders(ex, json) {
  switch (ex) {
    case "binance":
    case "mexc":
      return (Array.isArray(json) ? json : []).map((o) => ({
        id: String(o.orderId),
        native: o.symbol,
        side: o.side,
        type: o.type,
        price: n(o.price) || null,
        qty: n(o.origQty),
        filled: n(o.executedQty),
        time: n(o.time),
      }));
    case "okx":
      return (json?.data ?? []).map((o) => ({
        id: String(o.ordId),
        native: o.instId,
        side: String(o.side).toUpperCase(),
        type: String(o.ordType).toUpperCase(),
        price: n(o.px) || null,
        qty: n(o.sz),
        filled: n(o.accFillSz),
        time: n(o.cTime),
      }));
    case "bybit":
      return (json?.result?.list ?? []).map((o) => ({
        id: String(o.orderId),
        native: o.symbol,
        side: String(o.side).toUpperCase(),
        type: String(o.orderType).toUpperCase(),
        price: n(o.price) || null,
        qty: n(o.qty),
        filled: n(o.cumExecQty),
        time: n(o.createdTime),
      }));
    case "kucoin":
      return (json?.data?.items ?? []).map((o) => ({
        id: String(o.id),
        native: o.symbol,
        side: String(o.side).toUpperCase(),
        type: String(o.type).toUpperCase(),
        price: n(o.price) || null,
        qty: n(o.size),
        filled: n(o.dealSize),
        time: n(o.createdAt),
      }));
    case "coinbase":
      return (json?.orders ?? []).map((o) => {
        const cfg = Object.values(o.order_configuration ?? {})[0] ?? {};
        return {
          id: String(o.order_id),
          native: o.product_id,
          side: o.side,
          type: String(o.order_type || "LIMIT").toUpperCase(),
          price: n(cfg.limit_price) || null,
          qty: n(cfg.base_size),
          filled: n(o.filled_size),
          time: Date.parse(o.created_time) || 0,
        };
      });
  }
  return [];
}

/** Order reply → {id, status}. Call apiError first. */
export function parseOrderResult(ex, json) {
  switch (ex) {
    case "binance":
    case "mexc":
      return { id: String(json?.orderId ?? ""), status: String(json?.status ?? "NEW") };
    case "okx":
      return { id: String(json?.data?.[0]?.ordId ?? ""), status: "SENT" };
    case "bybit":
      return { id: String(json?.result?.orderId ?? ""), status: "SENT" };
    case "kucoin":
      return { id: String(json?.data?.orderId ?? ""), status: "SENT" };
    case "coinbase":
      return { id: String(json?.success_response?.order_id ?? json?.order_id ?? ""), status: "SENT" };
  }
  return { id: "", status: "SENT" };
}

/** Coinbase batch_cancel answers 200 even when the cancel failed. */
export function cancelError(ex, json) {
  if (ex !== "coinbase") return null;
  const r = json?.results?.[0];
  return r && r.success === false ? r.failure_reason || "Coinbase could not cancel the order" : null;
}

/** A client order id the exchanges all accept: letters and digits, 24 long. */
export function clientOrderId(prefix = "oc") {
  return (prefix + crypto.randomBytes(16).toString("hex")).slice(0, 24);
}
