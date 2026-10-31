// OANDA v20 client for the main process: forex and metals prices, candles and the live price stream.
// The API token never leaves this process; the page only sees prices.

import { OANDA_HOSTS, parseOandaPriceLine, splitStreamLines } from "./lib.js";

const KEEP_TYPES = new Set(["CURRENCY", "METAL"]);
const STALE_STREAM_MS = 20_000;

/**
 * @param {{
 *   net: { fetch: typeof fetch },
 *   safeStorage: { isEncryptionAvailable(): boolean, encryptString(s: string): Buffer, decryptString(b: Buffer): string },
 *   getSettings: () => any,
 *   saveSettings: (s: any) => void,
 *   onPrice: (p: {instrument: string, bid: number, ask: number, time: number}) => void,
 *   onState: (state: string) => void,
 * }} deps
 */
export function createOanda({ net, safeStorage, getSettings, saveSettings, onPrice, onState }) {
  let accountId = null;
  let instrumentsCache = null;
  let stream = null; // { controller, instruments, timer }
  let reconnectAttempt = 0;

  const env = () => getSettings().oanda.env;
  const hosts = () => ({
    rest: process.env.OC_OANDA_REST || OANDA_HOSTS[env()].rest,
    stream: process.env.OC_OANDA_STREAM || OANDA_HOSTS[env()].stream,
  });

  function token() {
    if (process.env.OC_OANDA_TOKEN) return process.env.OC_OANDA_TOKEN;
    const enc = getSettings().oanda.tokenEnc;
    if (!enc) return "";
    try {
      return safeStorage.decryptString(Buffer.from(enc, "base64"));
    } catch {
      return "";
    }
  }

  async function request(base, path, tok = token(), init = {}) {
    if (!tok) throw new Error("No OANDA token set. Use Data › OANDA token… to add one.");
    const res = await net.fetch(base + path, {
      ...init,
      headers: { Authorization: `Bearer ${tok}`, "Accept-Datetime-Format": "UNIX" },
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).errorMessage ?? "";
      } catch {
        // body was not JSON
      }
      if (res.status === 401) throw new Error(`OANDA rejected the token (401). ${detail}`.trim());
      throw new Error(`OANDA ${res.status}: ${detail || res.statusText}`);
    }
    return res;
  }

  const getJson = async (path) => (await request(hosts().rest, path)).json();

  async function ensureAccount() {
    if (accountId) return accountId;
    const { accounts } = await getJson("/v3/accounts");
    if (!accounts?.length) throw new Error("This OANDA token has no accounts.");
    accountId = accounts[0].id;
    return accountId;
  }

  function reset() {
    accountId = null;
    instrumentsCache = null;
    stopStream();
  }

  // ── Public API (called over IPC) ──

  async function status() {
    if (!token()) return { configured: false, env: env() };
    try {
      return { configured: true, env: env(), accountId: await ensureAccount() };
    } catch (err) {
      return { configured: true, env: env(), error: String(err.message || err) };
    }
  }

  async function instruments() {
    if (instrumentsCache) return instrumentsCache;
    const id = await ensureAccount();
    const { instruments: list } = await getJson(`/v3/accounts/${id}/instruments`);
    instrumentsCache = (list ?? [])
      .filter((i) => KEEP_TYPES.has(i.type))
      .map(({ name, type, displayName, pipLocation, displayPrecision, marginRate }) => ({
        name,
        type,
        displayName,
        pipLocation,
        displayPrecision,
        marginRate,
      }));
    return instrumentsCache;
  }

  async function candles(instrument, query) {
    if (!/^[A-Z0-9]+_[A-Z0-9]+$/.test(instrument)) throw new Error(`Bad instrument ${instrument}`);
    if (typeof query !== "string" || !/^[\w.=&%:-]*$/.test(query)) throw new Error("Bad candle query");
    return getJson(`/v3/instruments/${instrument}/candles?${query}`);
  }

  async function pricing(names) {
    const id = await ensureAccount();
    const list = names.filter((n) => /^[A-Z0-9]+_[A-Z0-9]+$/.test(n)).join(",");
    if (!list) return { prices: [] };
    return getJson(`/v3/accounts/${id}/pricing?instruments=${list}`);
  }

  function stopStream() {
    if (!stream) return;
    clearTimeout(stream.timer);
    stream.stopped = true;
    stream.controller.abort();
    stream = null;
    onState("disconnected");
  }

  async function startStream(names) {
    stopStream();
    const list = names.filter((n) => /^[A-Z0-9]+_[A-Z0-9]+$/.test(n));
    if (!list.length || !token()) return;
    const current = { controller: new AbortController(), instruments: list, timer: null, stopped: false };
    stream = current;
    onState(reconnectAttempt ? "reconnecting" : "connecting");

    const retry = () => {
      if (current.stopped || stream !== current) return;
      current.controller.abort();
      stream = null;
      const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      onState("reconnecting");
      setTimeout(() => {
        if (!stream) startStream(list);
      }, delay);
    };
    const watchdog = () => {
      clearTimeout(current.timer);
      current.timer = setTimeout(retry, STALE_STREAM_MS);
    };

    try {
      const id = await ensureAccount();
      const res = await request(
        hosts().stream,
        `/v3/accounts/${id}/pricing/stream?snapshot=true&instruments=${list.join(",")}`,
        token(),
        { signal: current.controller.signal },
      );
      reconnectAttempt = 0;
      onState("connected");
      watchdog();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let rest = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        watchdog();
        const split = splitStreamLines(rest + decoder.decode(value, { stream: true }));
        rest = split.rest;
        for (const line of split.lines) {
          const price = parseOandaPriceLine(line);
          if (price) onPrice(price);
        }
      }
      retry();
    } catch (err) {
      if (current.stopped) return;
      console.error("[oanda] stream error", err.message || err);
      retry();
    }
  }

  /** Check a token against OANDA, then keep it encrypted with Windows DPAPI. */
  async function saveToken(rawToken, newEnv) {
    const tok = String(rawToken || "").trim();
    if (!(newEnv in OANDA_HOSTS)) return { ok: false, error: "Unknown environment." };
    if (!/^[A-Za-z0-9-]{20,200}$/.test(tok)) return { ok: false, error: "That does not look like an OANDA API token." };
    try {
      const base = process.env.OC_OANDA_REST || OANDA_HOSTS[newEnv].rest;
      const { accounts } = await (await request(base, "/v3/accounts", tok)).json();
      if (!accounts?.length) return { ok: false, error: "The token works but has no accounts." };
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "Windows encryption is not available." };
      const settings = getSettings();
      settings.oanda = { env: newEnv, tokenEnc: safeStorage.encryptString(tok).toString("base64") };
      saveSettings(settings);
      reset();
      return { ok: true, accountId: accounts[0].id };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  }

  // ── Trading (orders go to the account the token opens) ──

  async function send(method, path, body) {
    const tok = token();
    if (!tok) throw new Error("No OANDA token. Add one in Data › OANDA token.");
    const res = await net.fetch(hosts().rest + path, {
      method,
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", "Accept-Datetime-Format": "UNIX" },
      ...(body && { body: JSON.stringify(body) }),
    });
    const json = await res.json().catch(() => null);
    const reject = json?.orderRejectTransaction ?? json?.orderCancelTransaction;
    if (!res.ok || (reject && !json?.orderFillTransaction && !json?.orderCreateTransaction)) {
      const why = json?.errorMessage || reject?.rejectReason || reject?.reason || res.statusText;
      throw new Error(`OANDA: ${why} (${res.status})`);
    }
    return json;
  }

  async function balances() {
    const id = await ensureAccount();
    const { account } = await send("GET", `/v3/accounts/${id}/summary`);
    const balance = Number(account?.balance) || 0;
    const nav = Number(account?.NAV) || balance;
    const margin = Number(account?.marginUsed) || 0;
    return [{ asset: account?.currency ?? "USD", free: Math.max(0, nav - margin), locked: margin, usd: nav }];
  }

  async function openOrders() {
    const id = await ensureAccount();
    const [{ orders = [] }, { trades = [] }] = await Promise.all([
      send("GET", `/v3/accounts/${id}/pendingOrders`),
      send("GET", `/v3/accounts/${id}/openTrades`),
    ]);
    const entry = (o, type, price, units, filled) => ({
      id: String(o.id),
      native: o.instrument,
      side: Number(units) >= 0 ? "BUY" : "SELL",
      type,
      price: Number(price) || null,
      qty: Math.abs(Number(units) || 0),
      filled,
      time: Math.round(Number(o.createTime ?? o.openTime) * 1000) || 0,
    });
    return [
      ...orders.filter((o) => o.instrument).map((o) => entry(o, o.type, o.price, o.units, 0)),
      // Open trades are filled positions; shown with type TRADE and closed from the OANDA platform.
      ...trades.map((t) => ({
        ...entry(t, "TRADE", t.price, t.currentUnits, Math.abs(Number(t.currentUnits) || 0)),
        pnl: Number(t.unrealizedPL) || 0,
      })),
    ];
  }

  /** @param {{native: string, side: string, type: string, qty: string, price?: string, takeProfit?: string, stopLoss?: string}} o */
  async function placeOrder(o) {
    if (!/^[A-Z0-9]+_[A-Z0-9]+$/.test(o.native)) throw new Error("Bad OANDA instrument.");
    const id = await ensureAccount();
    const units = (o.side === "SELL" ? "-" : "") + o.qty;
    const order = {
      type: o.type,
      instrument: o.native,
      units,
      timeInForce: o.type === "MARKET" ? "FOK" : "GTC",
      positionFill: "DEFAULT",
      ...(o.type === "LIMIT" && { price: o.price }),
      ...(o.takeProfit && { takeProfitOnFill: { price: o.takeProfit } }),
      ...(o.stopLoss && { stopLossOnFill: { price: o.stopLoss } }),
    };
    const json = await send("POST", `/v3/accounts/${id}/orders`, { order });
    const fill = json.orderFillTransaction;
    return { id: String(fill?.orderID ?? json.orderCreateTransaction?.id ?? ""), status: fill ? "FILLED" : "SENT" };
  }

  async function closeTrade(tradeId) {
    const id = await ensureAccount();
    await send("PUT", `/v3/accounts/${id}/trades/${encodeURIComponent(tradeId)}/close`, { units: "ALL" });
  }

  async function cancelOrder(orderId) {
    const id = await ensureAccount();
    await send("PUT", `/v3/accounts/${id}/orders/${encodeURIComponent(orderId)}/cancel`);
  }

  function clearToken() {
    const settings = getSettings();
    settings.oanda = { env: settings.oanda.env, tokenEnc: "" };
    saveSettings(settings);
    reset();
  }

  return {
    status,
    instruments,
    candles,
    pricing,
    startStream,
    stopStream,
    saveToken,
    clearToken,
    balances,
    openOrders,
    placeOrder,
    cancelOrder,
    closeTrade,
  };
}
