import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import {
  apiError,
  cancelError,
  clientOrderId,
  coinbaseJwt,
  orderRequest,
  parseBalances,
  parseOpenOrders,
  parseOrderResult,
  signRequest,
} from "../out/exchanges.bridge.mjs";

const NOW = 1_793_440_000_000;
const hmac = (secret, data, enc) => crypto.createHmac("sha256", secret).update(data).digest(enc);

test("Binance: matches the signature example in Binance's API docs", () => {
  // https://developers.binance.com/docs/binance-spot-api-docs/rest-api/endpoint-security-type (HMAC example)
  const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
  const query = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
  assert.equal(hmac(secret, query, "hex"), "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  const req = { method: "POST", path: "/api/v3/order", body: { symbol: "LTCBTC", side: "BUY", type: "LIMIT", timeInForce: "GTC", quantity: "1", price: "0.1" } };
  const { url, init } = signRequest("binance", { apiKey: "k", secret }, req, 1499827319559);
  assert.equal(url, `https://api.binance.com/api/v3/order?${query}&signature=c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71`);
  assert.equal(init.method, "POST");
  assert.equal(init.headers["X-MBX-APIKEY"], "k");
  assert.equal(init.body, undefined);
});

test("Binance testnet and MEXC use their own host and key header", () => {
  const t = signRequest("binance", { apiKey: "k", secret: "s", testnet: true }, { method: "GET", path: "/api/v3/account" }, NOW);
  assert.ok(t.url.startsWith("https://testnet.binance.vision/api/v3/account?recvWindow=5000&timestamp="));
  const m = signRequest("mexc", { apiKey: "mk", secret: "s" }, { method: "GET", path: "/api/v3/account" }, NOW);
  assert.ok(m.url.startsWith("https://api.mexc.com/api/v3/account?"));
  assert.equal(m.init.headers["X-MEXC-APIKEY"], "mk");
});

test("OKX: base64 HMAC of timestamp + method + path + body, with passphrase and demo header", () => {
  const body = { instId: "BTC-USDT", tdMode: "cash" };
  const { url, init } = signRequest("okx", { apiKey: "k", secret: "s", passphrase: "p", testnet: true }, { method: "POST", path: "/api/v5/trade/order", body }, NOW);
  const ts = new Date(NOW).toISOString();
  assert.equal(url, "https://www.okx.com/api/v5/trade/order");
  assert.equal(init.headers["OK-ACCESS-TIMESTAMP"], ts);
  assert.equal(init.headers["OK-ACCESS-SIGN"], hmac("s", `${ts}POST/api/v5/trade/order${JSON.stringify(body)}`, "base64"));
  assert.equal(init.headers["OK-ACCESS-PASSPHRASE"], "p");
  assert.equal(init.headers["x-simulated-trading"], "1");
  const get = signRequest("okx", { apiKey: "k", secret: "s", passphrase: "p" }, { method: "GET", path: "/api/v5/trade/orders-pending", query: { instType: "SPOT" } }, NOW);
  assert.equal(get.init.headers["OK-ACCESS-SIGN"], hmac("s", `${ts}GET/api/v5/trade/orders-pending?instType=SPOT`, "base64"));
  assert.equal(get.init.headers["x-simulated-trading"], undefined);
});

test("Bybit: hex HMAC of timestamp + key + recv window + query or body", () => {
  const g = signRequest("bybit", { apiKey: "k", secret: "s" }, { method: "GET", path: "/v5/account/wallet-balance", query: { accountType: "UNIFIED" } }, NOW);
  assert.equal(g.url, "https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED");
  assert.equal(g.init.headers["X-BAPI-SIGN"], hmac("s", `${NOW}k5000accountType=UNIFIED`, "hex"));
  const body = { category: "spot", symbol: "BTCUSDT" };
  const p = signRequest("bybit", { apiKey: "k", secret: "s", testnet: true }, { method: "POST", path: "/v5/order/create", body }, NOW);
  assert.ok(p.url.startsWith("https://api-testnet.bybit.com/"));
  assert.equal(p.init.headers["X-BAPI-SIGN"], hmac("s", `${NOW}k5000${JSON.stringify(body)}`, "hex"));
  assert.equal(p.init.body, JSON.stringify(body));
});

test("KuCoin: key version 2 signs the passphrase too", () => {
  const { url, init } = signRequest("kucoin", { apiKey: "k", secret: "s", passphrase: "p" }, { method: "GET", path: "/api/v1/accounts", query: { type: "trade" } }, NOW);
  assert.equal(url, "https://api.kucoin.com/api/v1/accounts?type=trade");
  assert.equal(init.headers["KC-API-SIGN"], hmac("s", `${NOW}GET/api/v1/accounts?type=trade`, "base64"));
  assert.equal(init.headers["KC-API-PASSPHRASE"], hmac("s", "p", "base64"));
  assert.equal(init.headers["KC-API-KEY-VERSION"], "2");
});

test("Coinbase: ES256 and Ed25519 JWTs verify with the matching public key", () => {
  for (const kind of ["ec", "ed25519"]) {
    const pair = kind === "ec" ? crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }) : crypto.generateKeyPairSync("ed25519");
    const secret =
      kind === "ec"
        ? pair.privateKey.export({ type: "sec1", format: "pem" })
        : Buffer.concat([
            pair.privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32),
            pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32),
          ]).toString("base64");
    const jwt = coinbaseJwt("organizations/o/apiKeys/k", kind === "ec" ? secret.replace(/\n/g, "\\n") : secret, "GET", "/api/v3/brokerage/accounts", NOW, "abc");
    const [h, p, sig] = jwt.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    assert.equal(header.alg, kind === "ec" ? "ES256" : "EdDSA");
    assert.equal(header.kid, "organizations/o/apiKeys/k");
    assert.equal(payload.uri, "GET api.coinbase.com/api/v3/brokerage/accounts");
    assert.equal(payload.iss, "cdp");
    assert.equal(payload.exp - payload.nbf, 120);
    const ok =
      kind === "ec"
        ? crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: pair.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))
        : crypto.verify(null, Buffer.from(`${h}.${p}`), pair.publicKey, Buffer.from(sig, "base64url"));
    assert.ok(ok, `${kind} signature verifies`);
  }
});

test("order bodies: market orders are in base units on every exchange", () => {
  const o = { native: "BTC-USDT", side: "BUY", type: "MARKET", qty: "0.001" };
  assert.deepEqual(orderRequest("okx", o, "id1").body, { instId: "BTC-USDT", tdMode: "cash", side: "buy", ordType: "market", sz: "0.001", tgtCcy: "base_ccy", clOrdId: "id1" });
  assert.equal(orderRequest("bybit", { ...o, native: "BTCUSDT" }, "id1").body.marketUnit, "baseCoin");
  assert.deepEqual(orderRequest("coinbase", { ...o, native: "BTC-USD" }, "id1").body.order_configuration, { market_market_ioc: { base_size: "0.001" } });
  assert.equal(orderRequest("kucoin", o, "id1").body.size, "0.001");
  const lim = orderRequest("binance", { native: "BTCUSDT", side: "SELL", type: "LIMIT", qty: "0.5", price: "80000" }, "id1").body;
  assert.equal(lim.timeInForce, "GTC");
  assert.equal(lim.price, "80000");
  assert.throws(() => orderRequest("mexc", { native: "BTCUSDT", side: "SELL", type: "LIMIT", qty: "1" }, "x"), /price/);
});

test("apiError reads each exchange's error shape", () => {
  assert.equal(apiError("binance", 400, { code: -2010, msg: "Account has insufficient balance" }), "Account has insufficient balance (-2010)");
  assert.equal(apiError("binance", 200, { orderId: 1 }), null);
  assert.equal(apiError("okx", 200, { code: "1", msg: "", data: [{ sCode: "51008", sMsg: "Insufficient balance" }] }), "Insufficient balance (51008)");
  assert.equal(apiError("okx", 200, { code: "0", data: [{ sCode: "0" }] }), null);
  assert.equal(apiError("bybit", 200, { retCode: 10003, retMsg: "API key is invalid." }), "API key is invalid. (10003)");
  assert.equal(apiError("kucoin", 200, { code: "400100", msg: "Balance insufficient" }), "Balance insufficient (400100)");
  assert.equal(apiError("coinbase", 200, { success: false, error_response: { message: "Insufficient balance" } }), "Insufficient balance");
  assert.equal(apiError("coinbase", 401, { error: "unauthorized" }), "unauthorized");
  assert.equal(cancelError("coinbase", { results: [{ success: false, failure_reason: "UNKNOWN_CANCEL_ORDER" }] }), "UNKNOWN_CANCEL_ORDER");
});

test("parseBalances and parseOpenOrders normalise replies", () => {
  assert.deepEqual(parseBalances("binance", { balances: [{ asset: "BTC", free: "0.5", locked: "0.1" }, { asset: "ETH", free: "0", locked: "0" }] }), [{ asset: "BTC", free: 0.5, locked: 0.1 }]);
  assert.deepEqual(parseBalances("okx", { data: [{ details: [{ ccy: "USDT", availBal: "10", frozenBal: "2", eqUsd: "12" }] }] }), [{ asset: "USDT", free: 10, locked: 2, usd: 12 }]);
  assert.deepEqual(parseBalances("bybit", { result: { list: [{ coin: [{ coin: "SOL", walletBalance: "3", locked: "1", usdValue: "300" }] }] } }), [{ asset: "SOL", free: 2, locked: 1, usd: 300 }]);
  assert.deepEqual(parseBalances("kucoin", { data: [{ currency: "BTC", available: "1", holds: "0" }, { currency: "BTC", available: "0.5", holds: "0.5" }] }), [{ asset: "BTC", free: 1.5, locked: 0.5 }]);
  assert.deepEqual(parseBalances("coinbase", { accounts: [{ currency: "USD", available_balance: { value: "100" }, hold: { value: "5" } }] }), [{ asset: "USD", free: 100, locked: 5 }]);
  const [o] = parseOpenOrders("coinbase", { orders: [{ order_id: "x", product_id: "BTC-USD", side: "BUY", order_type: "LIMIT", order_configuration: { limit_limit_gtc: { base_size: "0.1", limit_price: "50000" } }, filled_size: "0", created_time: "2026-10-31T00:00:00Z" }] });
  assert.deepEqual([o.price, o.qty, o.native], [50000, 0.1, "BTC-USD"]);
  assert.equal(parseOpenOrders("okx", { data: [{ ordId: "1", instId: "BTC-USDT", side: "sell", ordType: "limit", px: "90000", sz: "1", accFillSz: "0.2", cTime: "5" }] })[0].side, "SELL");
  assert.deepEqual(parseOrderResult("binance", { orderId: 42, status: "FILLED" }), { id: "42", status: "FILLED" });
  assert.match(clientOrderId(), /^oc[0-9a-f]{22}$/);
});

test("portfolio-only exchanges sign the same through the Android shim (SHA-512 included)", async () => {
  const node = await import("../../../desktop/electron/exchanges.js");
  const shim = await import("../out/exchanges.bridge.mjs");
  const creds = { apiKey: "key", secret: "secret" };
  for (const ex of ["htx", "whitebit", "gate", "hitbtc", "poloniex"]) {
    for (const req of [node.balancesRequest(ex), node.openOrdersRequest(ex), node.cancelRequest(ex, "BTC_USDT", "42")]) {
      assert.deepEqual(shim.signRequest(ex, creds, req, NOW), node.signRequest(ex, creds, req, NOW), `${ex} ${req.method} ${req.path}`);
    }
  }
});
