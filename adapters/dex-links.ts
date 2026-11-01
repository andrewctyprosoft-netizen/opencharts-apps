// Pure link builders for the "Trade" button: a DEX pool → that DEX's own swap page with the
// token prefilled, and that page → the in-app browser of a phone wallet. OpenCharts only opens
// the link; the user connects their wallet and trades on the DEX's site. URL formats checked on
// 2026-11-01 (see desktop/docs/dex-trade-links.md). Tested in dev/tests/dex-links.test.ts.

/** What a swap link needs, as DexScreener reports a pool (see DexVenue). */
export interface TradeVenue {
  /** DexScreener chain id: ethereum, bsc, solana, … */
  chainId: string;
  /** DexScreener DEX id: uniswap, raydium, … */
  dexId: string;
  /** DEX label as shown, e.g. "meteora DLMM". */
  dex: string;
  baseAddress: string;
  quoteAddress: string;
  pool: string;
}

export interface TradeLink {
  /** The DEX's swap page. */
  url: string;
  /** The site's name, for the button's tooltip. */
  site: string;
}

const EVM = new Set(["ethereum", "base", "arbitrum", "optimism", "polygon", "avalanche", "bsc"]);

/** Address shapes per chain family; anything else gets no link, so API text never reaches a URL unchecked. */
function validAddress(chain: string, a: string): boolean {
  if (EVM.has(chain)) return /^0x[0-9a-fA-F]{40}$/.test(a);
  switch (chain) {
    case "solana":
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
    case "ton":
      return /^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(a);
    case "sui":
      return /^0x[0-9a-fA-F]{1,64}(::[A-Za-z_][A-Za-z0-9_]*){2}$/.test(a) || /^0x[0-9a-fA-F]{64}$/.test(a);
    case "tron":
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a);
    default:
      return false;
  }
}

/** Wrapped native coins, lowercased for EVM: swapped for the chain's native coin in links. */
const WRAPPED = new Set([
  "ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  "base:0x4200000000000000000000000000000000000006",
  "optimism:0x4200000000000000000000000000000000000006",
  "arbitrum:0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  "polygon:0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
  "avalanche:0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7",
  "bsc:0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  "solana:So11111111111111111111111111111111111111112",
  "ton:EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
  "tron:TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR",
]);

const isNative = (chain: string, a: string) =>
  WRAPPED.has(`${chain}:${EVM.has(chain) ? a.toLowerCase() : a}`) ||
  (chain === "sui" && /^0x0*2::sui::SUI$/.test(a));

const UNISWAP_CHAIN: Record<string, string> = {
  ethereum: "mainnet",
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  polygon: "polygon",
  bsc: "bnb",
  avalanche: "avalanche",
};
const PANCAKE_CHAIN: Record<string, string> = { bsc: "bsc", ethereum: "eth", arbitrum: "arb", base: "base" };
const SUSHI_CHAINS = new Set(["ethereum", "arbitrum", "base", "polygon", "bsc", "avalanche", "optimism"]);

type Build = (chain: string, sell: string | null, buy: string, v: TradeVenue) => TradeLink | null;
const q = encodeURIComponent;

const uniswap: Build = (chain, sell, buy) =>
  UNISWAP_CHAIN[chain]
    ? { site: "Uniswap", url: `https://app.uniswap.org/swap?chain=${UNISWAP_CHAIN[chain]}&inputCurrency=${q(sell ?? "NATIVE")}&outputCurrency=${q(buy)}` }
    : null;
const pancakeswap: Build = (chain, sell, buy) =>
  PANCAKE_CHAIN[chain]
    ? {
        site: "PancakeSwap",
        url: `https://pancakeswap.finance/swap?chain=${PANCAKE_CHAIN[chain]}&inputCurrency=${q(sell ?? (chain === "bsc" ? "BNB" : "ETH"))}&outputCurrency=${q(buy)}`,
      }
    : null;
const sushiswap: Build = (chain, sell, buy) =>
  SUSHI_CHAINS.has(chain) ? { site: "SushiSwap", url: `https://www.sushi.com/${chain}/swap?token0=${q(sell ?? "NATIVE")}&token1=${q(buy)}` } : null;
const aerodrome: Build = (chain, sell, buy) =>
  chain === "base" ? { site: "Aerodrome", url: `https://aerodrome.finance/swap?from=${q(sell ?? "eth")}&to=${q(buy)}&chain0=8453&chain1=8453` } : null;
const velodrome: Build = (chain, sell, buy) =>
  chain === "optimism" ? { site: "Velodrome", url: `https://velodrome.finance/swap?from=${q(sell ?? "eth")}&to=${q(buy)}&chain0=10&chain1=10` } : null;
const lfj: Build = (chain, sell, buy) =>
  chain === "avalanche" ? { site: "LFJ", url: `https://lfj.gg/avalanche/swap?inputCurrency=${q(sell ?? "AVAX")}&outputCurrency=${q(buy)}` } : null;
const WSOL = "So11111111111111111111111111111111111111112";
const jupiter: Build = (chain, sell, buy) =>
  chain === "solana" ? { site: "Jupiter", url: `https://jup.ag/?sell=${q(sell ?? WSOL)}&buy=${q(buy)}` } : null;
const raydium: Build = (chain, sell, buy) =>
  chain === "solana" ? { site: "Raydium", url: `https://raydium.io/swap/?inputMint=${q(sell ?? "sol")}&outputMint=${q(buy)}` } : null;
const orca: Build = (chain, sell, buy) =>
  chain === "solana" ? { site: "Orca", url: `https://www.orca.so/trade?tokenIn=${q(sell ?? WSOL)}&tokenOut=${q(buy)}` } : null;
// Only DLMM pools have a pool page with a swap tab; other Meteora pools trade through Jupiter.
const meteora: Build = (chain, _sell, _buy, v) =>
  chain === "solana" && /\bDLMM\b/i.test(v.dex) && validAddress(chain, v.pool)
    ? { site: "Meteora", url: `https://app.meteora.ag/dlmm/${v.pool}` }
    : null;
const pumpfun: Build = (chain, _sell, buy) => (chain === "solana" ? { site: "Pump.fun", url: `https://pump.fun/coin/${buy}` } : null);
const stonfi: Build = (chain, sell, buy) =>
  chain === "ton" ? { site: "STON.fi", url: `https://app.ston.fi/swap?ft=${q(sell ?? "TON")}&tt=${q(buy)}` } : null;
const dedust: Build = (chain, sell, buy) => (chain === "ton" ? { site: "DeDust", url: `https://dedust.io/swap/${sell ?? "TON"}/${buy}` } : null);
// Cetus wants full coin types in the path; a bare Sui address is not one.
const cetus: Build = (chain, sell, buy) =>
  chain === "sui" && buy.includes("::") && (sell === null || sell.includes("::"))
    ? { site: "Cetus", url: `https://app.cetus.zone/swap/${sell ?? "0x2::sui::SUI"}/${buy}` }
    : null;
const sunswap: Build = (chain, sell, buy) =>
  chain === "tron" ? { site: "SunSwap", url: `https://sun.io/?lang=en-US#/swap/smart/${sell ?? "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"}/${buy}` } : null;

/** DexScreener DEX ids → their swap page. QuickSwap and PumpSwap are left to the chain default (prefill unreliable). */
const BY_DEX: Record<string, Build> = {
  uniswap,
  pancakeswap,
  sushiswap,
  sushi: sushiswap,
  aerodrome,
  aero: aerodrome,
  velodrome,
  traderjoe: lfj,
  lfj,
  jupiter,
  raydium,
  orca,
  meteora,
  pumpfun,
  stonfi,
  dedust,
  cetus,
  sunswap,
};

/** Each chain's main swap site, for pools on a DEX without a known link. */
const BY_CHAIN: Record<string, Build> = {
  ethereum: uniswap,
  base: uniswap,
  arbitrum: uniswap,
  optimism: uniswap,
  polygon: uniswap,
  avalanche: uniswap,
  bsc: pancakeswap,
  solana: jupiter,
  ton: stonfi,
  sui: cetus,
  tron: sunswap,
};

/**
 * A pool → the swap page that buys its base token with its quote token (a wrapped native quote
 * becomes the native coin). Falls back to the chain's main swap site, then the DexScreener pool
 * page. Null when the addresses don't look like that chain's.
 */
export function tradeLink(v: TradeVenue): TradeLink | null {
  const chain = v.chainId;
  if (!validAddress(chain, v.baseAddress)) return null;
  const buy = v.baseAddress;
  const sell = validAddress(chain, v.quoteAddress) && !isNative(chain, v.quoteAddress) ? v.quoteAddress : null;
  const dexId = v.dexId.toLowerCase();
  const link = BY_DEX[dexId]?.(chain, sell, buy, v) ?? BY_CHAIN[chain]?.(chain, sell, buy, v);
  if (link) return link;
  return validAddress(chain, v.pool) ? { site: "DexScreener", url: `https://dexscreener.com/${chain}/${v.pool}` } : null;
}

export interface WalletLink {
  id: string;
  name: string;
  url: string;
}

const TRUST_COIN: Record<string, number> = {
  ethereum: 60,
  bsc: 20000714,
  polygon: 966,
  avalanche: 10009000,
  arbitrum: 10042221,
  optimism: 10000070,
  base: 8453,
  solana: 501,
  ton: 607,
  sui: 784,
  tron: 195,
};
const PHANTOM_CHAINS = new Set(["solana", "ethereum", "base", "polygon", "bsc"]);

/**
 * A swap page → links that open it in a phone wallet's own browser, for the wallets that work on
 * that chain. All are https links: Android hands them to the wallet when it is installed, and to
 * the wallet's download or landing page when it is not.
 */
export function walletLinks(url: string, chainId: string): WalletLink[] {
  if (!/^https:\/\//.test(url)) return [];
  const out: WalletLink[] = [];
  const bare = url.slice("https://".length);
  if (EVM.has(chainId)) out.push({ id: "metamask", name: "MetaMask", url: `https://link.metamask.io/dapp/${bare}` });
  if (PHANTOM_CHAINS.has(chainId))
    out.push({ id: "phantom", name: "Phantom", url: `https://phantom.com/ul/browse/${q(url)}?ref=${q(new URL(url).origin)}` });
  if (chainId === "ton") out.push({ id: "tonkeeper", name: "Tonkeeper", url: `https://app.tonkeeper.com/dapp/${url}` });
  if (chainId === "sui") out.push({ id: "slush", name: "Slush", url: `https://my.slush.app/browse/${url}` });
  if (TRUST_COIN[chainId])
    out.push({ id: "trust", name: "Trust Wallet", url: `https://link.trustwallet.com/open_url?coin_id=${TRUST_COIN[chainId]}&url=${q(url)}` });
  if (EVM.has(chainId)) out.push({ id: "coinbase", name: "Coinbase Wallet", url: `https://go.cb-w.com/dapp?cb_url=${q(url)}` });
  if (TRUST_COIN[chainId])
    out.push({
      id: "okx",
      name: "OKX Wallet",
      url: `https://web3.okx.com/download?deeplink=${q(`okx://wallet/dapp/url?dappUrl=${q(url)}`)}`,
    });
  return out;
}
