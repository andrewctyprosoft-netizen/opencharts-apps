// Private exchange API requests: signing, order bodies and reply parsing for Binance, OKX, Bybit,
// KuCoin, Coinbase (Advanced Trade) and MEXC, plus balances, open orders and cancels for the
// portfolio-only exchanges (HTX, WhiteBIT, Gate.io, HitBTC, Poloniex). Pure apart from
// node:crypto; unit-tested in dev/tests/exchanges.test.mjs. Keys are passed in by
// electron/trade.js and never stored here.

import crypto from "node:crypto";

/** Production hosts, plus the test networks some exchanges offer for trying keys safely. */
export const PRIVATE_HOSTS = {
  // Demo Trading keys (made at demo.binance.com) only work on the demo host.
  binance: { live: "https://api.binance.com", test: "https://testnet.binance.vision", demo: "https://demo-api.binance.com" },
  okx: { live: "https://www.okx.com", test: "https://www.okx.com" }, // demo keys use a header instead
  bybit: { live: "https://api.bybit.com", test: "https://api-testnet.bybit.com" },
  kucoin: { live: "https://api.kucoin.com" },
  coinbase: { live: "https://api.coinbase.com" },
  mexc: { live: "https://api.mexc.com" },
  htx: { live: "https://api.huobi.pro" },
  whitebit: { live: "https://whitebit.com" },
  gate: { live: "https://api.gateio.ws" },
  hitbtc: { live: "https://api.hitbtc.com" },
  poloniex: { live: "https://api.poloniex.com" },
};

/** Exchanges whose keys can be test-network / demo keys. */
export const HAS_TESTNET = new Set(["binance", "okx", "bybit"]);

const hmac = (secret, data, encoding, alg = "sha256") => crypto.createHmac(alg, secret).update(data).digest(encoding);
const sha512Hex = (data) => crypto.createHash("sha512").update(data).digest("hex");
/** k=v pairs sorted by key (ASCII), values percent-encoded. */
const sortedQuery = (params) =>
  Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join("&");
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
 * @param {{apiKey: string, secret: string, passphrase?: string, testnet?: boolean, demo?: boolean}} creds
 * @param {{method: string, path: string, query?: object, body?: object}} req
 * @param {number} nowMs
 * @param {string} [nonce] Coinbase JWT nonce
 * @returns {{url: string, init: {method: string, headers: Record<string, string>, body?: string}}}
 */
export function signRequest(ex, creds, req, nowMs, nonce = crypto.randomBytes(16).toString("hex")) {
  const hosts = PRIVATE_HOSTS[ex];
  if (!hosts) throw new Error(`Unknown exchange ${ex}`);
  const host = creds.demo && hosts.demo ? hosts.demo : creds.testnet && hosts.test ? hosts.test : hosts.live;
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
    case "htx": {
      // Signature v2: the auth fields go in the query, sorted with the request's own parameters.
      const signed = sortedQuery({
        ...req.query,
        AccessKeyId: creds.apiKey,
        SignatureMethod: "HmacSHA256",
        SignatureVersion: "2",
        Timestamp: new Date(nowMs).toISOString().slice(0, 19),
      });
      const signature = hmac(creds.secret, `${method}\n${new URL(host).host}\n${req.path}\n${signed}`, "base64");
      return { url: `${host}${req.path}?${signed}&Signature=${encodeURIComponent(signature)}`, init: { method, headers: json, ...(body && { body }) } };
    }
    case "whitebit": {
      // Every private call is a POST whose JSON body names the endpoint; the body is signed as base64.
      const raw = JSON.stringify({ ...req.body, request: req.path, nonce: String(nowMs), nonceWindow: true });
      const payload = Buffer.from(raw).toString("base64");
      const headers = { ...json, "X-TXC-APIKEY": creds.apiKey, "X-TXC-PAYLOAD": payload, "X-TXC-SIGNATURE": hmac(creds.secret, payload, "hex", "sha512") };
      return { url: host + req.path, init: { method: "POST", headers, body: raw } };
    }
    case "gate": {
      const ts = String(Math.floor(nowMs / 1000));
      const headers = { ...json, KEY: creds.apiKey, Timestamp: ts, SIGN: hmac(creds.secret, `${method}\n${req.path}\n${qs}\n${sha512Hex(body)}\n${ts}`, "hex", "sha512") };
      return { url: host + req.path + (qs ? `?${qs}` : ""), init: { method, headers, ...(body && { body }) } };
    }
    case "hitbtc": {
      const headers = { ...json, Authorization: `Basic ${Buffer.from(`${creds.apiKey}:${creds.secret}`).toString("base64")}` };
      return { url: host + req.path + (qs ? `?${qs}` : ""), init: { method, headers, ...(body && { body }) } };
    }
    case "poloniex": {
      const ts = String(nowMs);
      const params = body ? `requestBody=${body}&signTimestamp=${ts}` : sortedQuery({ ...req.query, signTimestamp: ts });
      const headers = { ...json, key: creds.apiKey, signTimestamp: ts, signature: hmac(creds.secret, `${method}\n${req.path}\n${params}`, "base64") };
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
    case "htx":
      return { method: "GET", path: "/v1/account/accounts" }; // then accountBalanceRequest
    case "whitebit":
      return { method: "POST", path: "/api/v4/trade-account/balance", body: {} };
    case "gate":
      return { method: "GET", path: "/api/v4/spot/accounts" };
    case "hitbtc":
      return { method: "GET", path: "/api/3/spot/balance" };
    case "poloniex":
      return { method: "GET", path: "/accounts/balances" };
  }
  throw new Error(`Unknown exchange ${ex}`);
}

/** HTX keeps balances per account: the spot account's id from /v1/account/accounts, or null. */
export function htxSpotAccount(json) {
  const spot = (json?.data ?? []).filter((a) => a.type === "spot");
  const acc = spot.find((a) => a.state !== "lock") ?? spot[0];
  return acc ? String(acc.id) : null;
}

/** HTX balance of one account. */
export function accountBalanceRequest(accountId) {
  return { method: "GET", path: `/v1/account/accounts/${encodeURIComponent(accountId)}/balance` };
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
    case "htx":
      return { method: "GET", path: "/v1/order/openOrders", query: { size: 500 } };
    case "whitebit":
      return { method: "POST", path: "/api/v4/orders", body: { limit: 100 } };
    case "gate":
      return { method: "GET", path: "/api/v4/spot/open_orders", query: { limit: 100 } };
    case "hitbtc":
      return { method: "GET", path: "/api/3/spot/order" };
    case "poloniex":
      return { method: "GET", path: "/orders", query: { limit: 2000 } };
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
    case "htx":
      return { method: "POST", path: `/v1/order/orders/${encodeURIComponent(id)}/submitcancel`, body: {} };
    case "whitebit":
      return { method: "POST", path: "/api/v4/order/cancel", body: { market: native, orderId: Number(id) } };
    case "gate":
      return { method: "DELETE", path: `/api/v4/spot/orders/${encodeURIComponent(id)}`, query: { currency_pair: native } };
    case "hitbtc":
      return { method: "DELETE", path: `/api/3/spot/order/${encodeURIComponent(id)}` };
    case "poloniex":
      return { method: "DELETE", path: `/orders/${encodeURIComponent(id)}` };
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
    case "htx":
      // The message may end in a Chinese copy in brackets: "Incorrect Access key [Access key错误]".
      if (json?.status === "error") return `${String(json["err-msg"] || "HTX error").replace(/\s*\[[^\]]*[^\x00-\x7F][^\]]*\]/g, "")} (${json["err-code"]})`;
      if (json && json.code !== undefined && json.code !== 200) return `${json.message || "HTX error"} (${json.code})`;
      return fallback;
    case "whitebit":
      if (status >= 400 || (json && json.success === false)) {
        const detail = Object.values(json?.errors ?? {}).flat()[0];
        return json?.message ? `${json.message}${detail ? ` ${detail}` : ""}${json.code !== undefined ? ` (${json.code})` : ""}` : fallback;
      }
      return null;
    case "gate":
      if (status >= 400) return json?.label ? `${json.message || json.label} (${json.label})` : fallback;
      return null;
    case "hitbtc":
      if (json?.error) return `${json.error.message}${json.error.description ? `: ${json.error.description}` : ""} (${json.error.code})`;
      return fallback;
    case "poloniex":
      if (status >= 400 || (json && !Array.isArray(json) && json.code !== undefined && json.code !== 200)) {
        return json?.message ? `${json.message}${json.code !== undefined ? ` (${json.code})` : ""}` : fallback;
      }
      return null;
  }
  return fallback;
}

// ── Checking a new key ────────────────────────────────────

/** Zero-width characters and byte-order marks some phone keyboards and chat apps paste along. */
const INVISIBLE_RE = /[​-‍⁠﻿­]/g;

/** Pasted key text without invisible characters and surrounding blanks. */
export function cleanKeyText(v) {
  return String(v ?? "").replace(INVISIBLE_RE, "").trim();
}

/**
 * A plain-language problem with a pasted key's shape, or null. Only checks what is certain for
 * the exchange (Binance's system-generated HMAC keys are 64 letters and digits).
 * @param {string} ex
 * @param {string} apiKey
 * @param {string} secret
 */
export function keyFormatError(ex, apiKey, secret) {
  if (ex !== "binance") return null;
  if (/BEGIN|PRIVATE KEY/.test(secret)) {
    return "That is the private key of a self-generated (Ed25519 or RSA) Binance key. OpenCharts signs with HMAC: create a system-generated key and paste its API key and secret key.";
  }
  const shape = (v) => /^[A-Za-z0-9]{64}$/.test(v);
  if (!shape(apiKey)) return `A Binance API key is 64 letters and digits; the one entered has ${apiKey.length} characters. Copy it again in full.`;
  if (!shape(secret)) return `A Binance secret key is 64 letters and digits; the one entered has ${secret.length} characters. Binance shows the secret only once, when the key is created: if it is lost, delete the key and create a new one.`;
  return null;
}

/** Exchanges that answer a wrong secret (bad signature) with its own error, apart from a refused key. */
const SIGNATURE_ERRORS = new Set(["binance", "mexc", "okx", "bybit", "gate"]);

/**
 * Why a failed reply refused the credentials: "secret" when the exchange accepted the key but
 * not its signature, "key" when it refused the key itself (unknown key, wrong network, IP not
 * allowed, missing permission; on HTX, HitBTC, Poloniex and WhiteBIT possibly the secret too),
 * or null for a bad request or an outage.
 * @param {string} ex
 * @param {number} status
 * @param {any} json
 * @returns {"key" | "secret" | null}
 */
export function keyRejection(ex, status, json) {
  const pick = (secret, key) => (secret ? "secret" : key ? "key" : null);
  switch (ex) {
    case "binance":
    case "mexc": {
      const code = Number(json?.code);
      return pick([-1022, 700002].includes(code), [-2008, -2014, -2015, 10072, 700006, 700007].includes(code));
    }
    case "okx": {
      const code = String(json?.code);
      return pick(code === "50113", ["50110", "50111", "50119", "50120", "50121"].includes(code));
    }
    case "bybit": {
      const code = Number(json?.retCode);
      return pick(code === 10004, [10003, 10005, 10010, 33004].includes(code));
    }
    case "gate":
      return pick(json?.label === "INVALID_SIGNATURE", ["INVALID_KEY", "FORBIDDEN", "IP_FORBIDDEN", "READ_ONLY"].includes(json?.label) || status === 401);
    case "htx":
      return pick(false, /^(api-signature-not-valid|invalid-access-key|api-not-support-temp-addr|forbidden-trade-for-ip|api-key-not-found|login-required)/.test(String(json?.["err-code"] ?? "")));
    case "hitbtc":
      return pick(false, [1001, 1002, 1003, 1004].includes(Number(json?.error?.code)) || status === 401);
    case "poloniex":
      return pick(false, status === 401 || /api ?key|signature/i.test(String(json?.message ?? "")));
  }
  return pick(false, status === 401 || status === 403);
}

/**
 * Other readings of a key the exchange refused, most likely first: the other network (a test key
 * saved as live or the reverse), Binance Demo Trading, and on Binance the key and secret swapped
 * (both are 64 letters and digits, so their shape cannot tell them apart).
 * @param {string} ex
 * @param {{apiKey: string, secret: string, passphrase?: string, testnet?: boolean, demo?: boolean}} creds
 * @returns {{creds: object, note: string}[]} each with what it means once it works
 */
export function keyAlternatives(ex, creds) {
  const out = [];
  if (HAS_TESTNET.has(ex)) {
    const flip = { ...creds, testnet: !creds.testnet, demo: false };
    out.push({ creds: flip, note: flip.testnet ? "This is a test network / demo key, so it was saved as one." : "This is a live key, so it was saved as one." });
  }
  if (ex === "binance") {
    if (!creds.demo) {
      out.push({
        creds: { ...creds, testnet: false, demo: true },
        note: "This is a Binance Demo Trading key (made at demo.binance.com), so it was saved as one: the portfolio and orders use the demo account. For your real account, create the key with Demo Trading switched off.",
      });
    }
    out.push({ creds: { ...creds, apiKey: creds.secret, secret: creds.apiKey }, note: "The API key and the secret were in each other's boxes; they were saved the right way round." });
  }
  return out;
}

/**
 * What to check after the exchange refused a key, with the address it saw this device on.
 * @param {string} ex
 * @param {string} label
 * @param {string | null} ip public IPv4 address of this device, when it could be read
 * @param {"key" | "secret"} [cause] from keyRejection
 */
export function rejectedKeyHint(ex, label, ip, cause = "key") {
  if (cause === "secret") {
    return [
      `• ${label} accepted the key but not the secret: the secret belongs to another key, or was not copied in full.`,
      "• Exchanges show a secret only once, when the key is created. If it is lost, delete the key and create a new one.",
    ].join("\n");
  }
  const where = ip ? ` ${label} sees this device as ${ip}.` : "";
  const lines = [
    `• The key has an IP restriction that does not include this device.${where} The address can change (a router restart, a phone moving between Wi-Fi and mobile data): add each address, or set the key to Unrestricted (read and spot trading only, never withdrawals).`,
    SIGNATURE_ERRORS.has(ex)
      ? `• The key was deleted, or not copied in full. (The secret is not checked yet: ${label} reports a wrong secret with a different error.)`
      : "• The key was deleted, or the key or secret was not copied in full.",
  ];
  if (ex === "binance") {
    lines.push("• The key comes from another Binance site (Binance US, TR, Japan…): OpenCharts uses www.binance.com keys.");
    lines.push("• Enable Reading is off, or a change to the key's restrictions was not saved: Binance applies it only after Save and its security check.");
    lines.push("Already ruled out: the Spot test network, Demo Trading, and the key and secret swapped (OpenCharts tried each).");
  } else {
    lines.push("• The key is missing the read permission.");
  }
  return lines.join("\n");
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
    case "htx": {
      const by = new Map();
      for (const b of json?.data?.list ?? []) {
        const asset = String(b.currency).toUpperCase();
        const prev = by.get(asset) ?? { asset, free: 0, locked: 0 };
        // Only these two are holdings; loan and interest rows are debts.
        if (b.type === "trade") prev.free += n(b.balance);
        else if (b.type === "frozen") prev.locked += n(b.balance);
        else continue;
        by.set(asset, prev);
      }
      list = [...by.values()];
      break;
    }
    case "whitebit":
      list = Object.entries(json && typeof json === "object" && !Array.isArray(json) ? json : {}).map(([asset, b]) => ({
        asset,
        free: n(b?.available),
        locked: n(b?.freeze),
      }));
      break;
    case "gate":
    case "hitbtc":
      list = (Array.isArray(json) ? json : []).map((b) => ({ asset: b.currency, free: n(b.available), locked: n(b.locked ?? b.reserved) }));
      break;
    case "poloniex": {
      const by = new Map();
      for (const acc of Array.isArray(json) ? json : []) {
        for (const b of acc.balances ?? []) {
          const prev = by.get(b.currency) ?? { asset: b.currency, free: 0, locked: 0 };
          prev.free += n(b.available);
          prev.locked += n(b.hold);
          by.set(b.currency, prev);
        }
      }
      list = [...by.values()];
      break;
    }
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
    case "htx":
      return (json?.data ?? []).map((o) => {
        // "buy-limit", "sell-limit-maker", "buy-ioc" …
        const [side, ...type] = String(o.type).toUpperCase().split("-");
        return {
          id: String(o.id),
          native: String(o.symbol).toUpperCase(),
          side,
          type: type.join("-") || "LIMIT",
          price: n(o.price) || null,
          qty: n(o.amount),
          filled: n(o["filled-amount"]),
          time: n(o["created-at"]),
        };
      });
    case "whitebit":
      return (Array.isArray(json) ? json : []).map((o) => ({
        id: String(o.orderId),
        native: o.market,
        side: String(o.side).toUpperCase(),
        type: String(o.type).toUpperCase(),
        price: n(o.price) || null,
        qty: n(o.amount),
        filled: n(o.dealStock),
        time: Math.round(n(o.timestamp) * 1000),
      }));
    case "gate":
      return (Array.isArray(json) ? json : []).flatMap((p) =>
        (p.orders ?? []).map((o) => ({
          id: String(o.id),
          native: o.currency_pair,
          side: String(o.side).toUpperCase(),
          type: String(o.type).toUpperCase(),
          price: n(o.price) || null,
          qty: n(o.amount),
          filled: Math.max(0, n(o.amount) - n(o.left)),
          time: n(o.create_time_ms),
        })),
      );
    case "hitbtc":
      // HitBTC cancels by the client order id, so that is the id kept.
      return (Array.isArray(json) ? json : []).map((o) => ({
        id: String(o.client_order_id),
        native: o.symbol,
        side: String(o.side).toUpperCase(),
        type: String(o.type).toUpperCase(),
        price: n(o.price) || null,
        qty: n(o.quantity),
        filled: n(o.quantity_cumulative),
        time: Date.parse(o.created_at) || 0,
      }));
    case "poloniex":
      return (Array.isArray(json) ? json : []).map((o) => ({
        id: String(o.id),
        native: o.symbol,
        side: String(o.side).toUpperCase(),
        type: String(o.type).toUpperCase(),
        price: n(o.price) || null,
        qty: n(o.quantity),
        filled: n(o.filledQuantity),
        time: n(o.createTime),
      }));
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

/** Coinbase batch_cancel and Poloniex answer 200 even when the cancel failed. */
export function cancelError(ex, json) {
  if (ex === "poloniex") {
    return json?.code !== undefined && Number(json.code) !== 200 ? `${json.message || "Poloniex could not cancel the order"} (${json.code})` : null;
  }
  if (ex !== "coinbase") return null;
  const r = json?.results?.[0];
  return r && r.success === false ? r.failure_reason || "Coinbase could not cancel the order" : null;
}

/** A client order id the exchanges all accept: letters and digits, 24 long. */
export function clientOrderId(prefix = "oc") {
  return (prefix + crypto.randomBytes(16).toString("hex")).slice(0, 24);
}
