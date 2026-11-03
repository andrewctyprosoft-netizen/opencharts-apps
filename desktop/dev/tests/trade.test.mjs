import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanKeyText, keyFormatError, keyRejection, rejectedKeyHint } from "../../electron/exchanges.js";
import { createTrade } from "../../electron/trade.js";

const KEY = "A".repeat(64);
const SECRET = "b".repeat(64);
const REJECTED = { code: -2015, msg: "Invalid API-key, IP, or permissions for action." };

/** A trade service whose exchange answers come from `answer(url)`; `fetched` lists the URLs asked. */
function harness(answer) {
  let settings = { keys: {} };
  const fetched = [];
  const net = {
    async fetch(url, init) {
      fetched.push(url);
      const [status, body] = answer(url, init);
      return new Response(JSON.stringify(body), { status });
    },
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  };
  const trade = createTrade({
    net,
    safeStorage,
    getSettings: () => settings,
    saveSettings: (s) => (settings = s),
    oanda: { status: async () => ({ configured: false }) },
  });
  const saved = (ex) => JSON.parse(Buffer.from(settings.keys[ex], "base64").toString());
  return { trade, fetched, saved };
}

test("pasted keys lose invisible characters; Binance key shapes are checked before asking Binance", () => {
  assert.equal(cleanKeyText(`​ ${KEY}﻿ `), KEY);
  assert.equal(keyFormatError("binance", KEY, SECRET), null);
  assert.match(keyFormatError("binance", KEY.slice(0, 40), SECRET), /64 letters and digits; the one entered has 40/);
  assert.match(keyFormatError("binance", KEY, SECRET.slice(1)), /secret key .* shows the secret only once/);
  assert.match(keyFormatError("binance", KEY, "-----BEGIN PRIVATE KEY-----\nMC4C"), /self-generated/);
  assert.equal(keyFormatError("okx", "short", "short"), null);
});

test("keyRejection tells a refused key from a wrong secret and from other errors", () => {
  assert.equal(keyRejection("binance", 401, REJECTED), "key");
  assert.equal(keyRejection("binance", 400, { code: -1022, msg: "Signature for this request is not valid." }), "secret");
  assert.equal(keyRejection("binance", 400, { code: -2010, msg: "insufficient balance" }), null);
  assert.equal(keyRejection("bybit", 200, { retCode: 10010, retMsg: "Unmatched IP" }), "key");
  assert.equal(keyRejection("bybit", 200, { retCode: 10004, retMsg: "error sign!" }), "secret");
  assert.equal(keyRejection("okx", 401, { code: "50110", msg: "IP not whitelisted" }), "key");
  assert.equal(keyRejection("okx", 401, { code: "50113", msg: "Invalid Sign" }), "secret");
  assert.equal(keyRejection("gate", 401, { label: "INVALID_KEY" }), "key");
  assert.equal(keyRejection("gate", 401, { label: "INVALID_SIGNATURE" }), "secret");
  assert.equal(keyRejection("gate", 400, { label: "INVALID_PARAM_VALUE" }), null);
  assert.equal(keyRejection("poloniex", 400, { code: 400, message: "Invalid Apikey or Signature" }), "key");
  assert.equal(keyRejection("poloniex", 400, { code: 21359, message: "Order was already canceled or filled." }), null);
});

test("the hint fits the cause and reads right on a PC and a phone", () => {
  const key = rejectedKeyHint("binance", "Binance", "203.0.113.7");
  assert.match(key, /Binance sees this device as 203\.0\.113\.7\. The address can change \(a router restart, a phone moving between Wi-Fi and mobile data\)/);
  assert.doesNotMatch(key, /On a phone the address/);
  assert.match(key, /The secret is not checked yet: Binance reports a wrong secret with a different error/);
  assert.match(key, /Binance US, TR, Japan/);
  assert.match(key, /only after Save and its security check/);
  assert.match(rejectedKeyHint("htx", "HTX (Huobi)", null), /the key or secret was not copied in full/);
  const secret = rejectedKeyHint("binance", "Binance", null, "secret");
  assert.match(secret, /Binance accepted the key but not the secret/);
  assert.doesNotMatch(secret, /IP restriction/);
});

test("a Spot test network key saved without the box ticked is found and saved as a test key", async () => {
  const { trade, fetched, saved } = harness((url) =>
    url.startsWith("https://testnet.binance.vision/") ? [200, { balances: [{ asset: "USDT", free: "100", locked: "0" }] }] : [401, REJECTED],
  );
  const r = await trade.saveKeys("binance", { apiKey: KEY, secret: SECRET, testnet: false });
  assert.deepEqual(r, { ok: true, assets: 1, testnet: true, note: "This is a test network / demo key, so it was saved as one." });
  assert.equal(saved("binance").testnet, true);
  assert.equal(fetched.length, 2);
});

test("a Binance Demo Trading key is found on the demo host and saved as a demo key", async () => {
  const { trade, saved } = harness((url) =>
    url.startsWith("https://demo-api.binance.com/") ? [200, { balances: [{ asset: "USDT", free: "5000", locked: "0" }] }] : [401, REJECTED],
  );
  const r = await trade.saveKeys("binance", { apiKey: KEY, secret: SECRET });
  assert.equal(r.ok, true);
  assert.match(r.note, /Demo Trading key/);
  assert.equal(saved("binance").demo, true);
  assert.equal((await trade.status()).binance.testnet, true);
});

test("a Binance key and secret pasted into each other's boxes are saved the right way round", async () => {
  const { trade, saved } = harness((url, init) =>
    url.startsWith("https://api.binance.com/") && init?.headers?.["X-MBX-APIKEY"] === SECRET ? [200, { balances: [] }] : [401, REJECTED],
  );
  const r = await trade.saveKeys("binance", { apiKey: KEY, secret: SECRET });
  assert.equal(r.ok, true);
  assert.match(r.note, /each other's boxes/);
  assert.deepEqual([saved("binance").apiKey, saved("binance").secret], [SECRET, KEY]);
});

test("a refused Binance key explains the causes with the address Binance sees", async () => {
  const { trade, fetched } = harness((url) => (url.startsWith("https://api.ipify.org") ? [200, { ip: "203.0.113.7" }] : [401, REJECTED]));
  const r = await trade.saveKeys("binance", { apiKey: KEY, secret: SECRET });
  assert.equal(r.ok, false);
  assert.match(r.error, /^Binance: Invalid API-key, IP, or permissions for action\. \(-2015\)\n\nCommon causes:/);
  assert.match(r.error, /Binance sees this device as 203\.0\.113\.7\./);
  assert.match(r.error, /Already ruled out: the Spot test network, Demo Trading, and the key and secret swapped/);
  assert.deepEqual(
    fetched.map((u) => new URL(u).host),
    ["api.binance.com", "testnet.binance.vision", "demo-api.binance.com", "api.binance.com", "api.ipify.org"],
  );
});

test("a wrong secret gets the secret hint, without trying the test network or reading the address", async () => {
  const { trade, fetched } = harness(() => [400, { code: -1022, msg: "Signature for this request is not valid." }]);
  const r = await trade.saveKeys("binance", { apiKey: KEY, secret: SECRET });
  assert.match(r.error, /\(-1022\)\n\nCommon causes:\n• Binance accepted the key but not the secret/);
  assert.equal(fetched.length, 1);
});

test("other errors are passed on without the key hint, and a truncated key never reaches Binance", async () => {
  const { trade, fetched } = harness(() => [400, { code: -1021, msg: "Timestamp for this request is outside of the recvWindow." }]);
  const r = await trade.saveKeys("binance", { apiKey: KEY, secret: SECRET });
  assert.equal(r.error, "Binance: Timestamp for this request is outside of the recvWindow. (-1021)");
  const short = await trade.saveKeys("binance", { apiKey: KEY.slice(0, 63), secret: SECRET });
  assert.match(short.error, /has 63 characters/);
  assert.equal(fetched.length, 1);
});

test("portfolio-only exchanges take keys but refuse orders", async () => {
  const { trade } = harness(() => [200, []]);
  const st = await trade.status();
  assert.equal(st.gate.trading, false);
  assert.equal(st.binance.trading, true);
  await assert.rejects(trade.place("gate", { native: "BTC_USDT", side: "BUY", type: "MARKET", qty: "1" }), /portfolio only/);
});
