# DEX Trading Through the User's Own Wallet: Research

Status: research only, nothing built.
Checked 2026-11-01 against current docs; prices, limits and endpoints change often, so check again before building.
Not legal advice.

## Goal

Let users trade on DEXs from OpenCharts with **their own wallet**: the app finds a route, the wallet signs, the app never sees a private key or seed phrase (non-custodial).

## 1. Connecting a Wallet (No Browser Extension in Electron or the WebView)

| Option | Desktop (Electron) | Android (Capacitor) | Notes |
|:--|:--|:--|:--|
| WalletConnect / Reown Sign (EVM, Solana) | `@walletconnect/sign-client` in the main process; pairing QR shown in the page | Reown Kotlin Sign SDK in the native plugin; deep link to the wallet app | Free project ID; community licence needs a paid plan above 500 MAU or 2.5M RPC calls a month (Pro $89/mo, 7,500 MAU) |
| Solana Mobile Wallet Adapter | n/a | `mobile-wallet-adapter-clientlib-ktx` in the native plugin | Phantom, Solflare, Seed Vault; Android only |
| Phantom deep links | n/a | possible | `signAndSendTransaction` deprecated; MWA is cleaner |
| Ledger over USB | later | n/a | Aggregator calldata needs blind signing |

Not recommended: importing private keys or seed phrases (breaks the non-custodial promise and makes the app a "software wallet"), embedded or social-login wallets, loading browser extensions into Electron.

WalletConnect hosts for the allowlists: `relay.walletconnect.org` (wss and https), `rpc.walletconnect.org`, `pulse.walletconnect.org`, `verify.walletconnect.org` and their `.com` twins.

## 2. Swap Routes (Aggregator APIs)

| API | Key | Free tier | Integrator fee | Chains |
|:--|:--|:--|:--|:--|
| 0x Swap v2 (AllowanceHolder) | Yes | Check the dashboard; plans changed in 2026 | `swapFeeBps` up to 1,000 | 17+ EVM, Solana |
| KyberSwap | No (`x-client-id`) | 3 RPS | Yes | EVM |
| Velora (ParaSwap) | No | Not published | `partnerFeeBps` | EVM |
| Uniswap Trading API | Yes | 6 RPS | Up to 5% | 25+ (Uniswap liquidity only) |
| 1inch | Yes | 1 RPS, 100k calls/month | 0–3% | EVM |
| LI.FI | Optional | 75 quotes / 2 h without key | Yes | EVM, Solana, bridges |
| Jupiter Swap V2 | Optional | 0.5–1 RPS | 50–255 bps (Jupiter keeps 20%) | Solana |

Each returns a ready-to-sign transaction for the connected address.

Act now, unrelated to trading: the wallet balances call `lite-api.jup.ag`, which Jupiter is phasing out; move to `api.jup.ag`.

## 3. Flow and Safety

1. Quote with the connected address as taker.
2. Approval: exact amount, never unlimited; approve only the documented allowance target (0x AllowanceHolder, or Permit2 for Uniswap).
3. Check the transaction's `to` and allowance target against a pinned list of router addresses.
4. Simulate (`eth_call` / `eth_estimateGas`, Solana `simulateTransaction`); refuse a revert or an output below the minimum.
5. Send to the wallet to sign (`eth_sendTransaction` over WalletConnect; Solana via MWA or WalletConnect).
6. Track the receipt or signature status.

Guards: default slippage 0.5% with a hard cap; MEV warning on Ethereum mainnet (prefer intent or RFQ routes); verified token lists, never a token resolved from its ticker alone; flag fee-on-transfer and honeypot tokens; WalletConnect metadata with a real domain so wallets do not mark the app "unverified".

## 4. Store and Legal Notes

- Google Play: Financial Features Declaration; the crypto policy now offers a "non-custodial software wallet" self-declaration. A dApp front end with no keys fits, but the existing CEX order routing should be described carefully.
- US: SEC staff statement of 13 April 2026 on "covered user interfaces": no broker-dealer registration for self-custodial, non-discretionary interfaces, if any fee is fixed or a uniform percentage, there is no payment for order flow or "best price" claim, users can see alternative routes, and fees and MEV protections are disclosed.
- EU (MiCA): a fee-charging front end that passes on orders may count as reception and transmission of orders; start with no fee (at least for EU users) until counsel reviews.

## 5. Recommendation

- **EVM**: WalletConnect Sign on both platforms; 0x v2 as the main route with KyberSwap as a second quote (also shows users an alternative route).
- **Solana**: Mobile Wallet Adapter on Android, WalletConnect on desktop; Jupiter Swap V2.
- **Where code lives**: aggregator keys, the WalletConnect session (sealed with DPAPI or the Keystore), router checks, simulation and slippage caps in the Electron main process and the Android native plugin; the page only shows quotes, a decoded summary and the status.
- **Fee**: none, or one uniform percentage.
- **Effort for a first version** (EVM on Base, Arbitrum and Ethereum, plus Solana): about 22–30 working days, including 3–4 days of testing with small real amounts.
- **Main risks**: Reown licence cost above 500 MAU, API and pricing churn, Solana wallet support for WalletConnect, malicious tokens and bad routes, MEV, EU fee classification, a Play reviewer reading the app as an exchange.

## Sources

- Reown relay and CSP: <https://docs.reown.com/cloud/relay.md>, <https://docs.reown.com/advanced/security/content-security-policy.md>, pricing <https://reown.com/pricing>
- Solana Mobile Wallet Adapter: <https://docs.solanamobile.com/solana-mobile-stack/mobile-wallet-adapter.md>
- 0x: <https://0x.org/docs/0x-swap-api/guides/monetize-your-app-using-swap>; KyberSwap: <https://docs.kyberswap.com/developer-guide/start-here/rate-limits-and-client-id.md>; Velora: <https://docs.velora.xyz/docs/sdk/monetize>; Uniswap: <https://developers.uniswap.org/docs/trading/swapping-api/faqs>; LI.FI: <https://docs.li.fi/api-reference/rate-limits.md>; Jupiter: <https://developers.jup.ag/docs/portal/rate-limits>, migration <https://developers.jup.ag/docs/portal/migration>
- Google Play: <https://support.google.com/googleplay/android-developer/answer/13607354>, <https://support.google.com/googleplay/android-developer/answer/16329703>
- SEC staff statement: <https://www.sec.gov/newsroom/speeches-statements/staff-statement-regarding-broker-dealer-registration-certain-user-interfaces-utilized-prepare>
