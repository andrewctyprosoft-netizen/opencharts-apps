// Real trading for the main process: exchange API keys kept encrypted with Windows DPAPI
// (Electron safeStorage), balances, open orders, placing and cancelling orders. OANDA orders go
// through electron/oanda.js with the existing token. Keys never reach the page.

import { EXCHANGES } from "./lib.js";
import {
  HAS_TESTNET,
  apiError,
  balancesRequest,
  cancelError,
  cancelRequest,
  clientOrderId,
  openOrdersRequest,
  orderRequest,
  parseBalances,
  parseOpenOrders,
  parseOrderResult,
  signRequest,
} from "./exchanges.js";

const TIMEOUT_MS = 15_000;
const NATIVE_RE = /^[A-Z0-9]{1,20}([-_][A-Z0-9]{1,12})?$/;
const QTY_RE = /^\d{1,15}(\.\d{1,18})?$/;

/**
 * @param {{
 *   net: { fetch: typeof fetch },
 *   safeStorage: { isEncryptionAvailable(): boolean, encryptString(s: string): Buffer, decryptString(b: Buffer): string },
 *   getSettings: () => any,
 *   saveSettings: (s: any) => void,
 *   oanda: ReturnType<typeof import("./oanda.js").createOanda>,
 * }} deps
 */
export function createTrade({ net, safeStorage, getSettings, saveSettings, oanda }) {
  const isExchange = (ex) => typeof ex === "string" && Object.hasOwn(EXCHANGES, ex);

  function creds(ex) {
    const enc = getSettings().keys?.[ex];
    if (!enc) return null;
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(enc, "base64")));
    } catch {
      return null;
    }
  }

  async function call(ex, req, c = creds(ex)) {
    if (!c) throw new Error(`No ${EXCHANGES[ex].label} API key. Add one in Data › Exchange API keys.`);
    const { url, init } = signRequest(ex, c, req, Date.now());
    let res;
    try {
      res = await net.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`${EXCHANGES[ex].label} unreachable: ${err.message || err}`);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (an HTML error page); the status says enough.
    }
    const error = apiError(ex, res.status, json);
    if (error) throw new Error(`${EXCHANGES[ex].label}: ${error}`);
    return json;
  }

  // ── Keys (key window only) ──

  function validate(ex, fields) {
    const apiKey = String(fields?.apiKey ?? "").trim();
    const secret = String(fields?.secret ?? "").trim();
    const passphrase = String(fields?.passphrase ?? "").trim();
    if (!apiKey || apiKey.length > 300) return { error: "Enter the API key." };
    if (!secret || secret.length > 4000) return { error: "Enter the API secret." };
    if (EXCHANGES[ex].passphrase && !passphrase) return { error: `${EXCHANGES[ex].label} keys need the passphrase you chose when creating them.` };
    if (/\s/.test(apiKey)) return { error: "The API key has spaces in it; copy it again." };
    return { creds: { apiKey, secret, passphrase, testnet: HAS_TESTNET.has(ex) && fields?.testnet === true } };
  }

  /** Check the key by reading balances, then store it encrypted. */
  async function saveKeys(ex, fields) {
    if (!isExchange(ex)) return { ok: false, error: "Unknown exchange." };
    const v = validate(ex, fields);
    if (v.error) return { ok: false, error: v.error };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "Windows encryption is not available." };
    try {
      const assets = parseBalances(ex, await call(ex, balancesRequest(ex), v.creds));
      const settings = getSettings();
      settings.keys = { ...settings.keys, [ex]: safeStorage.encryptString(JSON.stringify(v.creds)).toString("base64") };
      saveSettings(settings);
      return { ok: true, assets: assets.length };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  }

  function clearKeys(ex) {
    if (!isExchange(ex)) return;
    const settings = getSettings();
    const keys = { ...settings.keys };
    delete keys[ex];
    settings.keys = keys;
    saveSettings(settings);
  }

  // ── Page API ──

  async function status() {
    const out = {};
    for (const [id, info] of Object.entries(EXCHANGES)) {
      const c = creds(id);
      out[id] = { configured: Boolean(c), label: info.label, testnet: Boolean(c?.testnet) };
    }
    const o = await oanda.status();
    out.oanda = { configured: o.configured && !o.error, label: "OANDA", testnet: o.env === "practice" };
    return out;
  }

  async function balances(venue) {
    if (venue === "oanda") return oanda.balances();
    if (!isExchange(venue)) throw new Error("Unknown venue.");
    return parseBalances(venue, await call(venue, balancesRequest(venue)));
  }

  async function openOrders(venue) {
    if (venue === "oanda") return oanda.openOrders();
    if (!isExchange(venue)) throw new Error("Unknown venue.");
    if (venue !== "mexc") return parseOpenOrders(venue, await call(venue, openOrdersRequest(venue)));
    // MEXC lists open orders per pair: ask for each asset that has funds on hold.
    const held = (await balances("mexc")).filter((b) => b.locked > 0 && b.asset !== "USDT");
    const lists = await Promise.all(
      held.map((b) => call("mexc", openOrdersRequest("mexc", `${b.asset}USDT`)).then((j) => parseOpenOrders("mexc", j), () => [])),
    );
    return lists.flat();
  }

  /**
   * @param {string} venue
   * @param {{native: string, side: string, type: string, qty: string, price?: string, takeProfit?: string, stopLoss?: string}} order
   */
  async function place(venue, order) {
    const o = order ?? {};
    if (!NATIVE_RE.test(String(o.native))) throw new Error("Bad pair.");
    if (o.side !== "BUY" && o.side !== "SELL") throw new Error("Bad side.");
    if (o.type !== "MARKET" && o.type !== "LIMIT") throw new Error("Only market and limit orders can be sent to the exchange.");
    for (const k of ["qty", "price", "takeProfit", "stopLoss"]) {
      if (o[k] !== undefined && !QTY_RE.test(String(o[k]))) throw new Error(`Bad ${k}.`);
    }
    if (!(Number(o.qty) > 0)) throw new Error("Quantity must be above zero.");
    if (venue === "oanda") return oanda.placeOrder(o);
    if (!isExchange(venue)) throw new Error("Unknown venue.");
    const req = orderRequest(venue, o, clientOrderId());
    return parseOrderResult(venue, await call(venue, req));
  }

  async function cancel(venue, native, id) {
    if (typeof id !== "string" || !/^[\w-]{1,80}$/.test(id)) throw new Error("Bad order id.");
    if (venue === "oanda") return oanda.cancelOrder(id);
    if (!isExchange(venue)) throw new Error("Unknown venue.");
    if (!NATIVE_RE.test(String(native))) throw new Error("Bad pair.");
    const json = await call(venue, cancelRequest(venue, native, id));
    const err = cancelError(venue, json);
    if (err) throw new Error(`${EXCHANGES[venue].label}: ${err}`);
  }

  async function closeTrade(venue, id) {
    if (venue !== "oanda") throw new Error("Only OANDA has trades to close; exchange holdings are sold with an order.");
    if (typeof id !== "string" || !/^[\w-]{1,80}$/.test(id)) throw new Error("Bad trade id.");
    return oanda.closeTrade(id);
  }

  return { status, balances, openOrders, place, cancel, closeTrade, saveKeys, clearKeys };
}
