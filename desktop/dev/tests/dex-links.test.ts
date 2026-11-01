import assert from "node:assert/strict";
import { test } from "node:test";
import { tradeLink, walletLinks, type TradeVenue } from "../../../adapters/dex-links.ts";

const WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const POOL = "0xCBCdF9626bC03E24f779434178A73a0B4bad62eD";
const WSOL = "So11111111111111111111111111111111111111112";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const venue = (v: Partial<TradeVenue>): TradeVenue => ({
  chainId: "ethereum",
  dexId: "uniswap",
  dex: "uniswap v3",
  baseAddress: WBTC,
  quoteAddress: USDC,
  pool: POOL,
  ...v,
});

test("tradeLink: Uniswap uses mainnet for Ethereum and sells the quote token", () => {
  assert.deepEqual(tradeLink(venue({})), {
    site: "Uniswap",
    url: `https://app.uniswap.org/swap?chain=mainnet&inputCurrency=${USDC}&outputCurrency=${WBTC}`,
  });
});

test("tradeLink: a wrapped native quote is sold as the native coin", () => {
  assert.match(tradeLink(venue({ quoteAddress: WETH.toLowerCase() }))!.url, /inputCurrency=NATIVE&/);
  const bsc = tradeLink(venue({ chainId: "bsc", dexId: "pancakeswap", quoteAddress: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" }))!;
  assert.equal(bsc.url, `https://pancakeswap.finance/swap?chain=bsc&inputCurrency=BNB&outputCurrency=${WBTC}`);
  assert.match(tradeLink(venue({ chainId: "solana", dexId: "raydium", baseAddress: BONK, quoteAddress: WSOL, pool: BONK }))!.url, /inputMint=sol&outputMint=/);
});

test("tradeLink: each DEX's own page, and the chain default for the rest", () => {
  const sol = { chainId: "solana", baseAddress: BONK, quoteAddress: WSOL, pool: BONK };
  assert.equal(tradeLink(venue({ ...sol, dexId: "orca", dex: "orca" }))!.url, `https://www.orca.so/trade?tokenIn=${WSOL}&tokenOut=${BONK}`);
  assert.equal(tradeLink(venue({ ...sol, dexId: "meteora", dex: "meteora DLMM" }))!.url, `https://app.meteora.ag/dlmm/${BONK}`);
  // Meteora pools without a DLMM page, and DEXs we have no link for, go to Jupiter.
  assert.equal(tradeLink(venue({ ...sol, dexId: "meteora", dex: "meteora DYN" }))!.site, "Jupiter");
  assert.equal(tradeLink(venue({ ...sol, dexId: "pumpswap" }))!.url, `https://jup.ag/?sell=${WSOL}&buy=${BONK}`);
  assert.equal(tradeLink(venue({ chainId: "base", dexId: "aerodrome" }))!.site, "Aerodrome");
  assert.equal(tradeLink(venue({ chainId: "polygon", dexId: "quickswap" }))!.url.slice(0, 44), "https://app.uniswap.org/swap?chain=polygon&i");
  // PancakeSwap has no Polygon page: the chain default takes over.
  assert.equal(tradeLink(venue({ chainId: "polygon", dexId: "pancakeswap" }))!.site, "Uniswap");
  assert.equal(tradeLink(venue({ chainId: "avalanche", dexId: "traderjoe" }))!.site, "LFJ");
});

test("tradeLink: TON, Sui and Tron", () => {
  const jetton = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
  const ton = tradeLink(
    venue({ chainId: "ton", dexId: "stonfi", baseAddress: jetton, quoteAddress: "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c", pool: jetton }),
  )!;
  assert.equal(ton.url, `https://app.ston.fi/swap?ft=TON&tt=${jetton}`);
  const deep = "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP";
  const sui = tradeLink(venue({ chainId: "sui", dexId: "cetus", baseAddress: deep, quoteAddress: "0x2::sui::SUI", pool: `0x${"a".repeat(64)}` }))!;
  assert.equal(sui.url, `https://app.cetus.zone/swap/0x2::sui::SUI/${deep}`);
  const sun = "TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S";
  const tron = tradeLink(venue({ chainId: "tron", dexId: "sunswap", baseAddress: sun, quoteAddress: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR", pool: sun }))!;
  assert.equal(tron.url, `https://sun.io/?lang=en-US#/swap/smart/T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb/${sun}`);
});

test("tradeLink: bad addresses and unknown chains get no link, the rest fall back to DexScreener", () => {
  assert.equal(tradeLink(venue({ baseAddress: "javascript:alert(1)" })), null);
  assert.equal(tradeLink(venue({ baseAddress: "0x12" })), null);
  // A bad quote is dropped, not passed on: the page then sells the native coin.
  assert.match(tradeLink(venue({ quoteAddress: "x&y=1" }))!.url, /inputCurrency=NATIVE&outputCurrency=/);
  assert.equal(tradeLink(venue({ chainId: "zksync", dexId: "syncswap" })), null);
  const bare = `0x${"b".repeat(64)}`;
  assert.deepEqual(tradeLink(venue({ chainId: "sui", dexId: "cetus", baseAddress: bare, quoteAddress: "", pool: bare })), {
    site: "DexScreener",
    url: `https://dexscreener.com/sui/${bare}`,
  });
});

test("walletLinks: wallets per chain, target URL encoded where the wallet wants it", () => {
  const url = `https://app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=${WBTC}`;
  const evm = walletLinks(url, "ethereum");
  assert.deepEqual(
    evm.map((w) => w.id),
    ["metamask", "phantom", "trust", "coinbase", "okx"],
  );
  assert.equal(evm[0].url, `https://link.metamask.io/dapp/app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=${WBTC}`);
  assert.equal(evm[1].url, `https://phantom.com/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent("https://app.uniswap.org")}`);
  assert.equal(evm[2].url, `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}`);
  const okx = new URL(evm[4].url).searchParams.get("deeplink")!;
  assert.equal(new URL(okx.replace("okx://", "https://")).searchParams.get("dappUrl"), url);
  // Phantom doesn't run on Arbitrum; Solana has no MetaMask or Coinbase entry.
  assert.deepEqual(walletLinks(url, "arbitrum").map((w) => w.id), ["metamask", "trust", "coinbase", "okx"]);
  assert.deepEqual(walletLinks("https://jup.ag/?sell=a&buy=b", "solana").map((w) => w.id), ["phantom", "trust", "okx"]);
  assert.deepEqual(walletLinks("https://app.ston.fi/swap", "ton").map((w) => w.id), ["tonkeeper", "trust", "okx"]);
  assert.deepEqual(walletLinks("https://app.cetus.zone/swap", "sui").map((w) => w.id), ["slush", "trust", "okx"]);
  assert.deepEqual(walletLinks("http://example.com", "ethereum"), []);
  for (const w of evm) assert.match(w.url, /^https:\/\//);
});
