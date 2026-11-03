// Real trading for the main process: exchange API keys kept encrypted with Windows DPAPI
// (Electron safeStorage), balances, open orders, placing and cancelling orders. OANDA orders go
// through electron/oanda.js with the existing token. Keys never reach the page.

import { EXCHANGES, KEY_EXCHANGES } from "./lib.js";
import {
  HAS_TESTNET,
  accountBalanceRequest,
  apiError,
  balancesRequest,
  cancelError,
  cancelRequest,
  cleanKeyText,
  clientOrderId,
  htxSpotAccount,
  keyFormatError,
  keyRejected,
  openOrdersRequest,
  orderRequest,
  parseBalances,
  parseOpenOrders,
  parseOrderResult,
  rejectedKeyHint,
  signRequest,
} from "./exchanges.js";

const TIMEOUT_MS = 15_000;
const NATIVE_RE = /^[A-Z0-9]{1,20}([-_][A-Z0-9]{1,12})?$/;
const QTY_RE = /^\d{1,15}(\.\d{1,18})?$/;
/** Answers with the caller's public IPv4 address (the exchanges' API hosts are reached over IPv4). */
const IP_URL = "https://api.ipify.org?format=json";

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
  const isExchange = (ex) => typeof ex === "string" && Object.hasOwn(KEY_EXCHANGES, ex);
  const label = (ex) => KEY_EXCHANGES[ex].label;

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
    if (!c) throw new Error(`No ${label(ex)} API key. Add one in Data › Exchange API keys.`);
    const { url, init } = signRequest(ex, c, req, Date.now());
    let res;
    try {
      res = await net.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`${label(ex)} unreachable: ${err.message || err}`);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (an HTML error page); the status says enough.
    }
    const error = apiError(ex, res.status, json);
    if (error) throw Object.assign(new Error(`${label(ex)}: ${error}`), { keyRejected: keyRejected(ex, res.status, json) });
    return json;
  }

  // ── Keys (key window only) ──

  function validate(ex, fields) {
    const apiKey = cleanKeyText(fields?.apiKey);
    const secret = cleanKeyText(fields?.secret);
    const passphrase = cleanKeyText(fields?.passphrase);
    if (!apiKey || apiKey.length > 300) return { error: "Enter the API key." };
    if (!secret || secret.length > 4000) return { error: "Enter the API secret." };
    if (KEY_EXCHANGES[ex].passphrase && !passphrase) return { error: `${label(ex)} keys need the passphrase you chose when creating them.` };
    if (/\s/.test(apiKey)) return { error: "The API key has spaces in it; copy it again." };
    const shape = keyFormatError(ex, apiKey, secret);
    if (shape) return { error: shape };
    return { creds: { apiKey, secret, passphrase, testnet: HAS_TESTNET.has(ex) && fields?.testnet === true } };
  }

  /** This device's public IPv4 address, for the IP-restriction hint; null when it cannot be read. */
  async function publicIp() {
    try {
      const res = await net.fetch(IP_URL, { signal: AbortSignal.timeout(5000) });
      const ip = (await res.json())?.ip;
      return typeof ip === "string" && /^[\d.]{7,15}$/.test(ip) ? ip : null;
    } catch {
      return null;
    }
  }

  /**
   * Check the key by reading balances, then store it encrypted. A key the exchange refuses is
   * tried once on its other network (live ↔ test), so a test key saved without the box ticked,
   * or the other way round, still works.
   */
  async function saveKeys(ex, fields) {
    if (!isExchange(ex)) return { ok: false, error: "Unknown exchange." };
    const v = validate(ex, fields);
    if (v.error) return { ok: false, error: v.error };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "Encryption is not available on this device." };
    const read = async (c) => parseBalances(ex, await balancesReply(ex, c));
    let creds = v.creds;
    let assets;
    try {
      assets = await read(creds);
    } catch (err) {
      const other = HAS_TESTNET.has(ex) && err.keyRejected ? { ...creds, testnet: !creds.testnet } : null;
      if (other) assets = await read(other).then((a) => ((creds = other), a), () => undefined);
      if (!assets) {
        const message = String(err.message || err);
        if (!err.keyRejected) return { ok: false, error: message };
        return { ok: false, error: `${message}

Common causes:
${rejectedKeyHint(ex, label(ex), await publicIp())}` };
      }
    }
    const settings = getSettings();
    settings.keys = { ...settings.keys, [ex]: safeStorage.encryptString(JSON.stringify(creds)).toString("base64") };
    saveSettings(settings);
    return { ok: true, assets: assets.length, testnet: creds.testnet, switched: creds !== v.creds };
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
    for (const [id, info] of Object.entries(KEY_EXCHANGES)) {
      const c = creds(id);
      out[id] = { configured: Boolean(c), label: info.label, testnet: Boolean(c?.testnet), trading: Object.hasOwn(EXCHANGES, id) };
    }
    const o = await oanda.status();
    out.oanda = { configured: o.configured && !o.error, label: "OANDA", testnet: o.env === "practice" };
    return out;
  }

  /** The raw balances reply; HTX first needs the id of the spot account. */
  async function balancesReply(ex, c = creds(ex)) {
    const json = await call(ex, balancesRequest(ex), c);
    if (ex !== "htx") return json;
    const account = htxSpotAccount(json);
    return account ? call(ex, accountBalanceRequest(account), c) : null;
  }

  async function balances(venue) {
    if (venue === "oanda") return oanda.balances();
    if (!isExchange(venue)) throw new Error("Unknown venue.");
    return parseBalances(venue, await balancesReply(venue));
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
    if (!Object.hasOwn(EXCHANGES, venue)) throw new Error(`${label(venue)} is shown in the portfolio only; place orders on its own site.`);
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
    if (err) throw new Error(`${label(venue)}: ${err}`);
  }

  async function closeTrade(venue, id) {
    if (venue !== "oanda") throw new Error("Only OANDA has trades to close; exchange holdings are sold with an order.");
    if (typeof id !== "string" || !/^[\w-]{1,80}$/.test(id)) throw new Error("Bad trade id.");
    return oanda.closeTrade(id);
  }

  return { status, balances, openOrders, place, cancel, closeTrade, saveKeys, clearKeys };
}
