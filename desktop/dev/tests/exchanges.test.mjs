import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import {
  accountBalanceRequest,
  apiError,
  balancesRequest,
  cancelError,
  cancelRequest,
  clientOrderId,
  coinbaseJwt,
  htxSpotAccount,
  openOrdersRequest,
  orderRequest,
  parseBalances,
  parseOpenOrders,
  parseOrderResult,
  signRequest,
} from "../../electron/exchanges.js";

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
  const demo = signRequest("binance", { apiKey: "k", secret: "s", demo: true }, { method: "GET", path: "/api/v3/account" }, NOW);
  assert.ok(demo.url.startsWith("https://demo-api.binance.com/api/v3/account?"));
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

test("HTX: signature v2 over the sorted, encoded query with the host", () => {
  const { url, init } = signRequest("htx", { apiKey: "ak", secret: "sk" }, { method: "GET", path: "/v1/order/openOrders", query: { size: 500 } }, Date.UTC(2026, 10, 3, 1, 2, 3, 456));
  const q = "AccessKeyId=ak&SignatureMethod=HmacSHA256&SignatureVersion=2&Timestamp=2026-11-03T01%3A02%3A03&size=500";
  const sig = hmac("sk", `GET\napi.huobi.pro\n/v1/order/openOrders\n${q}`, "base64");
  assert.equal(url, `https://api.huobi.pro/v1/order/openOrders?${q}&Signature=${encodeURIComponent(sig)}`);
  assert.equal(init.body, undefined);
  assert.equal(htxSpotAccount({ data: [{ id: 1, type: "margin" }, { id: 7, type: "spot", state: "working" }] }), "7");
  assert.equal(accountBalanceRequest("7").path, "/v1/account/accounts/7/balance");
});

test("WhiteBIT: base64 payload of the body, HMAC-SHA512 hex", () => {
  const { url, init } = signRequest("whitebit", { apiKey: "wk", secret: "ws" }, balancesRequest("whitebit"), NOW);
  assert.equal(url, "https://whitebit.com/api/v4/trade-account/balance");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body), { request: "/api/v4/trade-account/balance", nonce: String(NOW), nonceWindow: true });
  assert.equal(init.headers["X-TXC-PAYLOAD"], Buffer.from(init.body).toString("base64"));
  assert.equal(init.headers["X-TXC-SIGNATURE"], crypto.createHmac("sha512", "ws").update(init.headers["X-TXC-PAYLOAD"]).digest("hex"));
  assert.deepEqual(JSON.parse(signRequest("whitebit", { apiKey: "k", secret: "s" }, cancelRequest("whitebit", "BTC_USDT", "42"), NOW).init.body).orderId, 42);
});

test("Gate: HMAC-SHA512 of method, path, query, body hash and seconds", () => {
  const req = cancelRequest("gate", "BTC_USDT", "123");
  const { url, init } = signRequest("gate", { apiKey: "gk", secret: "gs" }, req, NOW);
  assert.equal(url, "https://api.gateio.ws/api/v4/spot/orders/123?currency_pair=BTC_USDT");
  const empty = crypto.createHash("sha512").update("").digest("hex");
  assert.ok(empty.startsWith("cf83e135"));
  const ts = String(NOW / 1000);
  assert.equal(init.headers.Timestamp, ts);
  assert.equal(init.headers.SIGN, crypto.createHmac("sha512", "gs").update(`DELETE\n/api/v4/spot/orders/123\ncurrency_pair=BTC_USDT\n${empty}\n${ts}`).digest("hex"));
});

test("HitBTC uses basic auth; Poloniex signs sorted params or the request body", () => {
  const h = signRequest("hitbtc", { apiKey: "hk", secret: "hs" }, balancesRequest("hitbtc"), NOW);
  assert.equal(h.init.headers.Authorization, `Basic ${Buffer.from("hk:hs").toString("base64")}`);
  const g = signRequest("poloniex", { apiKey: "pk", secret: "ps" }, openOrdersRequest("poloniex"), NOW);
  assert.equal(g.url, "https://api.poloniex.com/orders?limit=2000");
  assert.equal(g.init.headers.signature, hmac("ps", `GET\n/orders\nlimit=2000&signTimestamp=${NOW}`, "base64"));
  const d = signRequest("poloniex", { apiKey: "pk", secret: "ps" }, cancelRequest("poloniex", "BTC_USDT", "9"), NOW);
  assert.equal(d.init.headers.signature, hmac("ps", `DELETE\n/orders/9\nsignTimestamp=${NOW}`, "base64"));
  assert.equal(cancelError("poloniex", { orderId: "9", state: "PENDING_CANCEL", code: 200 }), null);
  assert.equal(cancelError("poloniex", { code: 21359, message: "Order was already canceled or filled." }), "Order was already canceled or filled. (21359)");
});

test("portfolio-only exchanges: errors, balances and open orders", () => {
  assert.equal(apiError("htx", 200, { status: "error", "err-code": "api-signature-not-valid", "err-msg": "Signature not valid" }), "Signature not valid (api-signature-not-valid)");
  assert.equal(apiError("htx", 200, { status: "ok", data: [] }), null);
  assert.equal(apiError("htx", 200, { status: "error", "err-code": "api-signature-not-valid", "err-msg": "Signature not valid: Incorrect Access key [Access key错误]" }), "Signature not valid: Incorrect Access key (api-signature-not-valid)");
  assert.equal(apiError("gate", 401, { label: "INVALID_KEY", message: "Invalid key provided" }), "Invalid key provided (INVALID_KEY)");
  assert.equal(apiError("whitebit", 422, { code: 30, message: "Validation failed", errors: { market: ["Market is not valid"] } }), "Validation failed Market is not valid (30)");
  assert.equal(apiError("whitebit", 200, { BTC: { available: "1", freeze: "0" } }), null);
  assert.equal(apiError("hitbtc", 401, { error: { code: 1002, message: "Authorization is required or has been failed" } }), "Authorization is required or has been failed (1002)");
  assert.equal(apiError("poloniex", 400, { code: 400, message: "Invalid Apikey or Signature" }), "Invalid Apikey or Signature (400)");
  assert.equal(apiError("poloniex", 200, [{ accountType: "SPOT", balances: [] }]), null);

  assert.deepEqual(
    parseBalances("htx", { data: { list: [{ currency: "usdt", type: "trade", balance: "10" }, { currency: "usdt", type: "frozen", balance: "2" }, { currency: "btc", type: "loan", balance: "-1" }] } }),
    [{ asset: "USDT", free: 10, locked: 2 }],
  );
  assert.deepEqual(parseBalances("whitebit", { BTC: { available: "0.5", freeze: "0.1" }, ETH: { available: "0", freeze: "0" } }), [{ asset: "BTC", free: 0.5, locked: 0.1 }]);
  assert.deepEqual(parseBalances("gate", [{ currency: "GT", available: "3", locked: "1" }]), [{ asset: "GT", free: 3, locked: 1 }]);
  assert.deepEqual(parseBalances("hitbtc", [{ currency: "ETH", available: "2", reserved: "0.5" }]), [{ asset: "ETH", free: 2, locked: 0.5 }]);
  assert.deepEqual(parseBalances("poloniex", [{ accountType: "SPOT", balances: [{ currency: "TRX", available: "100", hold: "5" }] }]), [{ asset: "TRX", free: 100, locked: 5 }]);

  const [htx] = parseOpenOrders("htx", { data: [{ id: 5, symbol: "btcusdt", type: "sell-limit-maker", price: "90000", amount: "0.1", "filled-amount": "0.02", "created-at": 7 }] });
  assert.deepEqual(htx, { id: "5", native: "BTCUSDT", side: "SELL", type: "LIMIT-MAKER", price: 90000, qty: 0.1, filled: 0.02, time: 7 });
  const [gate] = parseOpenOrders("gate", [{ currency_pair: "BTC_USDT", orders: [{ id: "1", currency_pair: "BTC_USDT", side: "buy", type: "limit", amount: "1", left: "0.25", price: "50000", create_time_ms: "8" }] }]);
  assert.deepEqual([gate.native, gate.filled, gate.time], ["BTC_USDT", 0.75, 8]);
  assert.equal(parseOpenOrders("whitebit", [{ orderId: 3, market: "ETH_USDT", side: "sell", type: "limit", price: "4000", amount: "1", dealStock: "0", timestamp: 1595792396.165973 }])[0].time, 1595792396166);
  assert.equal(parseOpenOrders("hitbtc", [{ id: 1, client_order_id: "abc123", symbol: "ETHBTC", side: "sell", type: "limit", quantity: "1", quantity_cumulative: "0", price: "0.05", created_at: "2026-11-01T00:00:00Z" }])[0].id, "abc123");
  assert.equal(parseOpenOrders("poloniex", [{ id: "77", symbol: "BTC_USDT", side: "BUY", type: "LIMIT", price: "1", quantity: "2", filledQuantity: "1", createTime: 9 }])[0].filled, 1);
});
