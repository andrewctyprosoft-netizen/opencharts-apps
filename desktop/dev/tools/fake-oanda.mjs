// A local stand-in for the OANDA v20 REST and streaming API, shaped like the documented responses.
// Lets the smoke test exercise the forex/gold path end to end without a real token.

import http from "node:http";

export const FAKE_TOKEN = "fake-oanda-token-for-smoke-tests-0001";
const ACCOUNT = "101-004-0000000-001";
const INSTRUMENTS = [
  { name: "XAU_USD", type: "METAL", displayName: "Gold", pipLocation: -2, displayPrecision: 3, marginRate: "0.05", base: 3876.4 },
  { name: "XAG_USD", type: "METAL", displayName: "Silver", pipLocation: -4, displayPrecision: 5, marginRate: "0.1", base: 46.21 },
  { name: "EUR_USD", type: "CURRENCY", displayName: "EUR/USD", pipLocation: -4, displayPrecision: 5, marginRate: "0.0333", base: 1.1166 },
  { name: "USD_JPY", type: "CURRENCY", displayName: "USD/JPY", pipLocation: -2, displayPrecision: 3, marginRate: "0.04", base: 152.31 },
  { name: "SPX500_USD", type: "CFD", displayName: "US SPX 500", pipLocation: 0, displayPrecision: 1, marginRate: "0.05", base: 6800 },
];
const SECONDS = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D: 86400, W: 604800 };

const priceLine = (inst, jitter = 0) => {
  const mid = inst.base * (1 + jitter);
  const half = inst.base * 0.00008;
  const d = inst.displayPrecision;
  return JSON.stringify({
    type: "PRICE",
    instrument: inst.name,
    time: (Date.now() / 1000).toFixed(9),
    tradeable: true,
    bids: [{ price: (mid - half).toFixed(d), liquidity: 1000000 }],
    asks: [{ price: (mid + half).toFixed(d), liquidity: 1000000 }],
    closeoutBid: (mid - half).toFixed(d),
    closeoutAsk: (mid + half).toFixed(d),
  });
};

function candles(inst, q) {
  const step = SECONDS[q.get("granularity")];
  if (!step) return { status: 400, body: { errorMessage: "Invalid value specified for 'granularity'" } };
  if (q.get("count") && q.get("from") && q.get("to")) {
    return { status: 400, body: { errorMessage: "'count' cannot be specified with both 'from' and 'to'" } };
  }
  const now = Math.floor(Date.now() / 1000);
  const to = Math.min(now, Number(q.get("to") ?? now));
  const count = Math.min(5000, Number(q.get("count") ?? 500));
  const from = q.get("from") != null ? Number(q.get("from")) : to - count * step;
  const list = [];
  for (let t = Math.ceil(from / step) * step; t <= to && list.length < (q.get("from") && q.get("to") ? 5000 : count); t += step) {
    const wave = Math.sin(t / (step * 20)) * 0.004;
    const o = inst.base * (1 + wave);
    const c = inst.base * (1 + wave + 0.0005);
    const d = inst.displayPrecision;
    list.push({
      complete: t + step <= now,
      volume: 100 + (t % 50),
      time: `${t}.000000000`,
      mid: { o: o.toFixed(d), h: (Math.max(o, c) * 1.0007).toFixed(d), l: (Math.min(o, c) * 0.9993).toFixed(d), c: c.toFixed(d) },
    });
  }
  return { status: 200, body: { instrument: inst.name, granularity: q.get("granularity"), candles: list } };
}

/** @returns {Promise<{ url: string, close: () => void, hits: Record<string, number> }>} */
export function startFakeOanda() {
  const hits = {};
  const streams = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const key = url.pathname.replace(/\/v3\/accounts\/[^/]+/, "/v3/accounts/:id").replace(/instruments\/[A-Z0-9_]+\//, "instruments/:i/");
    hits[key] = (hits[key] ?? 0) + 1;
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${FAKE_TOKEN}`) return json(401, { errorMessage: "Insufficient authorization to perform request." });

    if (url.pathname === "/v3/accounts") return json(200, { accounts: [{ id: ACCOUNT, tags: [] }] });
    if (url.pathname === `/v3/accounts/${ACCOUNT}/instruments`) {
      return json(200, { instruments: INSTRUMENTS.map(({ base, ...i }) => i), lastTransactionID: "1" });
    }
    const m = url.pathname.match(/^\/v3\/instruments\/([A-Z0-9_]+)\/candles$/);
    if (m) {
      const inst = INSTRUMENTS.find((i) => i.name === m[1]);
      if (!inst) return json(404, { errorMessage: "Invalid value specified for 'instrument'" });
      const r = candles(inst, url.searchParams);
      return json(r.status, r.body);
    }
    const wanted = (url.searchParams.get("instruments") ?? "").split(",");
    const chosen = INSTRUMENTS.filter((i) => wanted.includes(i.name));
    if (url.pathname === `/v3/accounts/${ACCOUNT}/pricing`) {
      return json(200, { prices: chosen.map((i) => JSON.parse(priceLine(i))), time: String(Date.now() / 1000) });
    }
    if (url.pathname === `/v3/accounts/${ACCOUNT}/pricing/stream`) {
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Transfer-Encoding": "chunked" });
      if (url.searchParams.get("snapshot") === "true") for (const i of chosen) res.write(priceLine(i) + "\n");
      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        for (const i of chosen) res.write(priceLine(i, Math.sin(n / 3) * 0.0004) + "\n");
        if (n % 10 === 0) res.write(JSON.stringify({ type: "HEARTBEAT", time: (Date.now() / 1000).toFixed(9) }) + "\n");
      }, 500);
      streams.add(res);
      req.on("close", () => {
        clearInterval(timer);
        streams.delete(res);
      });
      return;
    }
    json(404, { errorMessage: "Not found" });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        hits,
        close: () => {
          for (const s of streams) s.destroy();
          server.close();
        },
      }),
    ),
  );
}
