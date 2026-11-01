# DEX Trade Links

Status: built (Market overview, a coin's DEX pools, **Trade** button).
Link formats checked on 2026-11-01; DEX sites change their URLs, so recheck when a link stops prefilling.
Code: `adapters/dex-links.ts`, tests in `desktop/dev/tests/dex-links.test.ts`.

## What OpenCharts Does, and Does Not Do

OpenCharts only opens a link.
The DEX's own site does the rest: the user connects their wallet there, reviews the quote and signs in the wallet.
OpenCharts never sees a key, never builds, signs or routes a transaction, and charges nothing.

- **Desktop:** **Trade** opens the pool's swap page in the system browser, where the user's wallet extension (MetaMask, Phantom…) connects.
- **Android:** **Trade** shows a short list: the swap page in the phone's browser, or the same page inside a wallet app's own browser (MetaMask, Phantom, Trust Wallet, Coinbase Wallet, OKX Wallet, Tonkeeper, Slush).
  Every entry is an `https` link opened with `ACTION_VIEW`: Android hands it to the wallet when it is installed, and to the wallet's download or landing page when it is not.

In-app swaps through WalletConnect and aggregator APIs were researched first and dropped: OpenCharts stays a chart and research tool, not a trading front end for DEXs.

## Swap Pages

The link buys the pool's base token with its quote token.
A wrapped native quote (WETH, WBNB, wSOL, WTRX, TON's GRAM) is replaced by the chain's native coin.
`X` is the base token address, `Q` the quote token address or the native value.

| DexScreener DEX id | Swap page | Native value |
|:--|:--|:--|
| `uniswap` (EVM chains) | `app.uniswap.org/swap?chain={c}&inputCurrency={Q}&outputCurrency={X}` | `NATIVE` |
| `pancakeswap` (bsc, ethereum, arbitrum, base) | `pancakeswap.finance/swap?chain={c}&inputCurrency={Q}&outputCurrency={X}` | `BNB` on bsc, else `ETH` |
| `sushiswap` | `www.sushi.com/{chain}/swap?token0={Q}&token1={X}` | `NATIVE` |
| `aerodrome` (base) | `aerodrome.finance/swap?from={Q}&to={X}&chain0=8453&chain1=8453` | `eth` |
| `velodrome` (optimism) | `velodrome.finance/swap?from={Q}&to={X}&chain0=10&chain1=10` | `eth` |
| `traderjoe` (avalanche) | `lfj.gg/avalanche/swap?inputCurrency={Q}&outputCurrency={X}` | `AVAX` |
| `jupiter` (solana) | `jup.ag/?sell={Q}&buy={X}` | wSOL mint |
| `raydium` | `raydium.io/swap/?inputMint={Q}&outputMint={X}` | `sol` |
| `orca` | `www.orca.so/trade?tokenIn={Q}&tokenOut={X}` | wSOL mint |
| `meteora` DLMM pools | `app.meteora.ag/dlmm/{pool}` | n/a |
| `pumpfun` | `pump.fun/coin/{X}` | n/a |
| `stonfi` (ton) | `app.ston.fi/swap?ft={Q}&tt={X}` | `TON` |
| `dedust` (ton) | `dedust.io/swap/{Q}/{X}` | `TON` |
| `cetus` (sui) | `app.cetus.zone/swap/{Q}/{X}` (full coin types) | `0x2::sui::SUI` |
| `sunswap` (tron) | `sun.io/?lang=en-US#/swap/smart/{Q}/{X}` | `T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb` |

- Uniswap's `chain` values: `mainnet` (not `ethereum`), `base`, `arbitrum`, `optimism`, `polygon`, `bnb`, `avalanche`.
- PancakeSwap's: `bsc`, `eth`, `arb`, `base`.
- Any other DEX uses the chain's main site: Uniswap on the EVM chains, PancakeSwap on bsc, Jupiter on Solana (also for PumpSwap and non-DLMM Meteora pools), STON.fi on TON, Cetus on Sui, SunSwap on Tron.
  QuickSwap goes to Uniswap on Polygon because its links did not prefill the token.
- Last resort: the DexScreener pool page.

## Wallet Browser Links

| Wallet | Link | Chains offered |
|:--|:--|:--|
| MetaMask | `https://link.metamask.io/dapp/{page without https://}` | EVM |
| Phantom | `https://phantom.com/ul/browse/{encoded page}?ref={encoded origin}` | solana, ethereum, base, polygon, bsc |
| Tonkeeper | `https://app.tonkeeper.com/dapp/{page}` | ton |
| Slush | `https://my.slush.app/browse/{page}` | sui |
| Trust Wallet | `https://link.trustwallet.com/open_url?coin_id={id}&url={encoded page}` | all eleven |
| Coinbase Wallet | `https://go.cb-w.com/dapp?cb_url={encoded page}` | EVM |
| OKX Wallet | `https://web3.okx.com/download?deeplink={encoded okx://wallet/dapp/url?dappUrl={encoded page}}` | all eleven |

Trust Wallet coin ids: ethereum 60, bsc 20000714, polygon 966, avalanche 10009000, arbitrum 10042221, optimism 10000070, base 8453, solana 501, ton 607, sui 784, tron 195.
Custom schemes (`okx://`, `slush://`) are never launched directly: they fail with no fallback when the app is missing.

Known limits:

- The Coinbase Wallet link format is no longer documented (the page is gone); it still forwards to the Base app.
- Tonkeeper only opens dApps in its own catalog.
- Phantom does not support Arbitrum, Optimism or Avalanche, so it is not offered there.

## Safety

- Links are always built on the fixed host for that DEX, never from text in an API reply.
- Token and pool addresses must match the chain's address shape (EVM `0x` + 40 hex, Solana base58, TON `EQ`/`UQ`, Sui coin types, Tron `T…`), or no Trade button is shown.
- Token warnings and terms pop-ups on the DEX's site (unverified tokens, Pump.fun and Cetus terms, DeDust's import prompt) are left for the user; OpenCharts accepts nothing on their behalf.

## Sources

- Uniswap interface source (`apps/web/src/utils/params/chainParams.ts`, `currencyParams.ts`) and <https://developers.uniswap.org/docs/trading/custom-interface-links>
- PancakeSwap: <https://pancakeswap.ai/skills/swap-planner.html>
- Phantom: <https://docs.phantom.com/phantom-deeplinks/other-methods/browse>
- MetaMask: <https://docs.metamask.io/sdk/guides/use-deeplinks>
- Trust Wallet: <https://developer.trustwallet.com/developer/develop-for-trust/deeplinking>
- OKX: <https://web3.okx.com/build/docs/waas/app-universal-link>
- Tonkeeper: <https://docs.tonconsole.com/tonkeeper/deep-linking>
- Slush: <https://sdk.mystenlabs.com/slush-wallet/deep-linking>
- The other DEX pages were opened live and checked to prefill the pair.
