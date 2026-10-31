// Pure wallet helpers for the portfolio: address kinds, the JSON-RPC calls that read balances,
// and reply parsing. EVM chains are read from public nodes (native coin + well-known tokens),
// Ethereum tokens are also discovered through Ethplorer, Solana through its public RPC, Bitcoin
// through mempool.space. Tested in dev/tests/wallets.test.ts.

export type WalletKind = "evm" | "bitcoin" | "solana";

export interface WalletHolding {
  chain: string;
  asset: string;
  /** Token contract / mint, empty for the native coin. */
  token: string;
  amount: number;
  /** USD price when known. */
  price: number | null;
}

/** Guess the address kind. Bitcoin is checked before Solana: legacy BTC addresses are base58 too. */
export function walletKind(address: string): WalletKind | null {
  const a = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return "evm";
  if (/^bc1[02-9ac-hj-np-z]{11,71}$/.test(a) || /^[13][1-9A-HJ-NP-Za-km-z]{25,33}$/.test(a)) return "bitcoin";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return "solana";
  return null;
}

interface Token {
  symbol: string;
  address: string;
  decimals: number;
}

/** EVM chains read from public nodes, with their native coin and well-known tokens. */
export const EVM_CHAINS: Record<string, { label: string; native: string; tokens: Token[] }> = {
  ethereum: {
    label: "Ethereum",
    native: "ETH",
    tokens: [
      { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      { symbol: "WBTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
      { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
      { symbol: "DAI", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
      { symbol: "LINK", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
    ],
  },
  bsc: {
    label: "BNB Chain",
    native: "BNB",
    tokens: [
      { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
      { symbol: "BTCB", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18 },
      { symbol: "ETH", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
      { symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 },
      { symbol: "CAKE", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18 },
    ],
  },
  base: {
    label: "Base",
    native: "ETH",
    tokens: [
      { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
    ],
  },
  arbitrum: {
    label: "Arbitrum",
    native: "ETH",
    tokens: [
      { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      { symbol: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
      { symbol: "WETH", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
      { symbol: "WBTC", address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8 },
      { symbol: "ARB", address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 },
    ],
  },
  polygon: {
    label: "Polygon",
    native: "POL",
    tokens: [
      { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
      { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
      { symbol: "WETH", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 },
      { symbol: "WBTC", address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8 },
    ],
  },
  optimism: {
    label: "Optimism",
    native: "ETH",
    tokens: [
      { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
      { symbol: "USDT", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
      { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      { symbol: "OP", address: "0x4200000000000000000000000000000000000042", decimals: 18 },
    ],
  },
  avalanche: {
    label: "Avalanche",
    native: "AVAX",
    tokens: [
      { symbol: "USDC", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
      { symbol: "USDT", address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6 },
      { symbol: "WAVAX", address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", decimals: 18 },
    ],
  },
};

/** Wrapped and bridged tokens priced as the coin they track. */
const PRICE_AS: Record<string, string> = {
  WETH: "ETH", WBTC: "BTC", cbBTC: "BTC", BTCB: "BTC", WBNB: "BNB", WAVAX: "AVAX", WSOL: "SOL", MATIC: "POL",
};
const STABLE = new Set(["USDT", "USDC", "DAI", "USD", "FDUSD", "USDE", "PYUSD", "TUSD", "USDS"]);

/** USD price of an asset from a symbol → price map (exchange tickers), or null. */
export function priceFor(asset: string, prices: ReadonlyMap<string, number>): number | null {
  const a = asset.toUpperCase();
  if (STABLE.has(a)) return 1;
  const key = PRICE_AS[asset] ?? PRICE_AS[a] ?? a;
  return prices.get(key) ?? null;
}

/** balanceOf(address) call data. */
export function balanceOfData(address: string): string {
  return `0x70a08231${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

/** One JSON-RPC batch per EVM chain: native balance first, then each token's balanceOf. */
export function evmBatch(chain: string, address: string): object[] {
  const spec = EVM_CHAINS[chain];
  if (!spec) return [];
  return [
    { jsonrpc: "2.0", id: 0, method: "eth_getBalance", params: [address, "latest"] },
    ...spec.tokens.map((t, i) => ({
      jsonrpc: "2.0",
      id: i + 1,
      method: "eth_call",
      params: [{ to: t.address, data: balanceOfData(address) }, "latest"],
    })),
  ];
}

/** A hex quantity scaled down by `decimals`, without losing precision on big balances. */
export function fromHex(hex: unknown, decimals: number): number {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex) || hex === "0x") return 0;
  const v = BigInt(hex);
  const base = 10n ** BigInt(decimals);
  return Number(v / base) + Number(v % base) / Number(base);
}

/** An EVM batch reply → holdings above zero. */
export function parseEvmBatch(chain: string, reply: unknown): WalletHolding[] {
  const spec = EVM_CHAINS[chain];
  if (!spec || !Array.isArray(reply)) return [];
  const byId = new Map((reply as Array<{ id: number; result?: string }>).map((r) => [r.id, r.result]));
  const out: WalletHolding[] = [];
  const native = fromHex(byId.get(0), 18);
  if (native > 0) out.push({ chain: spec.label, asset: spec.native, token: "", amount: native, price: null });
  spec.tokens.forEach((t, i) => {
    const amount = fromHex(byId.get(i + 1), t.decimals);
    if (amount > 0) out.push({ chain: spec.label, asset: t.symbol, token: t.address, amount, price: null });
  });
  return out;
}

interface EthplorerToken {
  tokenInfo?: {
    address?: string;
    symbol?: string;
    decimals?: string | number;
    price?: { rate?: number; volume24h?: number; marketCapUsd?: number } | false;
  };
  rawBalance?: string;
  balance?: number;
}

/** A priced token counts only with real trading: some daily volume, and the holding a small part of its market cap. */
const MIN_VOLUME_USD = 10_000;
const MAX_CAP_SHARE = 0.02;

/**
 * Ethplorer getAddressInfo → Ethereum tokens with a trustworthy price. Airdropped junk often has a
 * quoted price but no volume, or a "market cap" the wallet itself is a big part of; those are
 * counted in `hidden` instead.
 */
export function parseEthplorer(json: unknown): WalletHolding[] & { hidden?: number } {
  const tokens = ((json as { tokens?: EthplorerToken[] } | null)?.tokens ?? []) as EthplorerToken[];
  const out: WalletHolding[] & { hidden?: number } = [];
  let hidden = 0;
  for (const t of tokens) {
    const info = t.tokenInfo;
    const price = info?.price || null;
    const rate = price ? Number(price.rate) : NaN;
    if (!info?.symbol || !Number.isFinite(rate) || rate <= 0) continue;
    const decimals = Number(info.decimals) || 0;
    const amount = t.rawBalance ? Number(t.rawBalance) / 10 ** decimals : Number(t.balance) / 10 ** decimals;
    if (!(amount > 0)) continue;
    const cap = Number(price?.marketCapUsd) || 0;
    if (!(Number(price?.volume24h) >= MIN_VOLUME_USD) || !(cap > 0) || (amount * rate) / cap > MAX_CAP_SHARE) {
      hidden += 1;
      continue;
    }
    out.push({ chain: "Ethereum", asset: info.symbol, token: String(info.address ?? ""), amount, price: rate });
  }
  out.hidden = hidden;
  return out;
}

export const SPL_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];

export function solanaBatch(address: string): object[] {
  return [
    { jsonrpc: "2.0", id: 0, method: "getBalance", params: [address] },
    ...SPL_PROGRAMS.map((programId, i) => ({
      jsonrpc: "2.0",
      id: i + 1,
      method: "getTokenAccountsByOwner",
      params: [address, { programId }, { encoding: "jsonParsed" }],
    })),
  ];
}

/** Solana batch reply → SOL plus token balances by mint (symbols filled in later). */
export function parseSolanaBatch(reply: unknown): WalletHolding[] {
  if (!Array.isArray(reply)) return [];
  const out: WalletHolding[] = [];
  const mints = new Map<string, number>();
  for (const r of reply as Array<{ id: number; result?: { value?: unknown } }>) {
    if (r.id === 0) {
      const lamports = Number(r.result?.value);
      if (lamports > 0) out.push({ chain: "Solana", asset: "SOL", token: "", amount: lamports / 1e9, price: null });
      continue;
    }
    for (const acc of (r.result?.value as Array<{ account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } } } }>) ?? []) {
      const info = acc.account?.data?.parsed?.info;
      const amount = Number(info?.tokenAmount?.uiAmount);
      if (info?.mint && amount > 0) mints.set(info.mint, (mints.get(info.mint) ?? 0) + amount);
    }
  }
  for (const [mint, amount] of mints) out.push({ chain: "Solana", asset: `${mint.slice(0, 4)}…${mint.slice(-4)}`, token: mint, amount, price: null });
  return out;
}

/** Fill Solana token symbols and prices from Jupiter's price and token replies. */
export function applyJupiter(holdings: WalletHolding[], prices: unknown, tokens: unknown): WalletHolding[] {
  const p = (prices ?? {}) as Record<string, { usdPrice?: number }>;
  const meta = new Map(((Array.isArray(tokens) ? tokens : []) as Array<{ id: string; symbol?: string }>).map((t) => [t.id, t.symbol]));
  return holdings.map((h) => {
    if (!h.token) return h;
    const usd = Number(p[h.token]?.usdPrice);
    return { ...h, asset: meta.get(h.token) ?? h.asset, price: Number.isFinite(usd) && usd > 0 ? usd : h.price };
  });
}

/** mempool.space address reply → BTC balance (confirmed plus unconfirmed). */
export function parseMempool(json: unknown): WalletHolding[] {
  const j = json as { chain_stats?: Record<string, number>; mempool_stats?: Record<string, number> } | null;
  if (!j?.chain_stats) return [];
  const sats = (s?: Record<string, number>) => (s ? (s.funded_txo_sum ?? 0) - (s.spent_txo_sum ?? 0) : 0);
  const btc = (sats(j.chain_stats) + sats(j.mempool_stats)) / 1e8;
  return btc > 0 ? [{ chain: "Bitcoin", asset: "BTC", token: "", amount: btc, price: null }] : [];
}

/** Binance `/ticker/price` reply → USD price per base asset from its USDT pairs. */
export function usdtPrices(json: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of (Array.isArray(json) ? json : []) as Array<{ symbol?: string; price?: string }>) {
    const s = r.symbol ?? "";
    if (!s.endsWith("USDT")) continue;
    const price = Number(r.price);
    if (price > 0) out.set(s.slice(0, -4), price);
  }
  return out;
}
