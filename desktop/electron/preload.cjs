// Bridge between the terminal page and the main process. Exposes data calls only; no Node access.
const { contextBridge, ipcRenderer } = require("electron");

function listen(channel, handler) {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("ocDesktop", {
  web: {
    get: (url) => ipcRenderer.invoke("web:get", url),
    rpc: (chain, body) => ipcRenderer.invoke("web:rpc", chain, body),
  },
  trade: {
    status: () => ipcRenderer.invoke("trade:status"),
    balances: (venue) => ipcRenderer.invoke("trade:balances", venue),
    openOrders: (venue) => ipcRenderer.invoke("trade:open-orders", venue),
    place: (venue, order) => ipcRenderer.invoke("trade:place", venue, order),
    cancel: (venue, native, id) => ipcRenderer.invoke("trade:cancel", venue, native, id),
    closeTrade: (venue, id) => ipcRenderer.invoke("trade:close-trade", venue, id),
    openKeys: (venue) => ipcRenderer.invoke("trade:open-keys", venue),
  },
  app: {
    openWindow: (view) => ipcRenderer.invoke("app:open-window", view),
    openChart: (symbol) => ipcRenderer.invoke("app:open-chart", symbol),
    notify: (title, body, symbol) => ipcRenderer.invoke("app:notify", title, body, symbol),
    onOpenChart: (handler) => listen("app:open-chart", handler),
  },
  gecko: {
    get: (path, priority) => ipcRenderer.invoke("gecko:get", path, priority),
  },
  fx: {
    quotes: (instruments) => ipcRenderer.invoke("fx:quotes", instruments),
    chart: (symbol, query) => ipcRenderer.invoke("fx:chart", symbol, query),
  },
  oanda: {
    status: () => ipcRenderer.invoke("oanda:status"),
    instruments: () => ipcRenderer.invoke("oanda:instruments"),
    candles: (instrument, query) => ipcRenderer.invoke("oanda:candles", instrument, query),
    pricing: (names) => ipcRenderer.invoke("oanda:pricing", names),
    startStream: (names) => ipcRenderer.invoke("oanda:stream-start", names),
    stopStream: () => ipcRenderer.invoke("oanda:stream-stop"),
    onPrice: (handler) => listen("oanda:price", handler),
    onState: (handler) => listen("oanda:state", handler),
  },
  // Used by the OANDA token window only.
  settings: {
    saveOandaToken: (token, env) => ipcRenderer.invoke("oanda:save-token", token, env),
    clearOandaToken: () => ipcRenderer.invoke("oanda:clear-token"),
    close: () => ipcRenderer.invoke("settings:close"),
  },
  // Used by the exchange API keys window only.
  keys: {
    status: () => ipcRenderer.invoke("keys:status"),
    save: (venue, fields) => ipcRenderer.invoke("keys:save", venue, fields),
    clear: (venue) => ipcRenderer.invoke("keys:clear", venue),
    openOanda: () => ipcRenderer.invoke("keys:open-oanda"),
    close: () => ipcRenderer.invoke("keys:close"),
  },
});
