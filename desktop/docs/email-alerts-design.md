# Email Alerts While the App Is Closed — Design

Status: proposal, 2026-10-31.
Nothing here is built yet, and the desktop app's alert behaviour is unchanged.

## Goal

When OpenCharts is closed (or the PC sleeps), price alerts set in the app still fire and arrive by email.
No server hosts the app, and nothing runs on the user's PC while the app is closed.
While the app runs, it keeps notifying as today (Windows notification, sound, toast) and no email is sent for the same crossing.

## Recommendation: a Google Apps Script "alert mailer"

A small Apps Script mini app, `projects/09_Mini_Apps/Google Apps Script/opencharts-alert-mailer/`, in the workspace's deploy-ready format (`appsscript.json`, `Code.gs`, `DEPLOY-CHECKLIST.txt`, `README.md`; no `Index.html` needed, or a one-page status view).
It runs under the user's own Google account:

- A **Web App `doPost`** receives the alert list from the desktop app.
- A **time-driven trigger every 1 minute** fetches public prices with `UrlFetchApp.fetchAll` and checks the alerts with the same rules as `adapters/alerts.ts`.
- **`MailApp.sendEmail`** sends the alert to the account's own address (no SMTP password, no third-party mail key).

### Why Apps Script, compared

| | Apps Script | GitHub Actions cron | Cloudflare Workers cron |
|:--|:--|:--|:--|
| Cost | Free | Free on public repos; private repos get 2,000 min/month and each run bills at least 1 min, so a 5-min cron (~8,600 runs/month) is over | Free plan |
| Minimum interval | 1 min (`everyMinutes(1)`) | 5 min, often delayed 5–30 min at busy times, runs can be dropped | 1 min (cron syntax) |
| Main quotas | See table below | Schedules auto-disabled after 60 days without repo activity | 10 ms CPU per run, 50 subrequests, 5 cron triggers per account, KV free tier 1,000 writes/day |
| Email | Built in (`MailApp`) | Needs an SMTP or mail-API secret | Needs Email Routing to a verified address, or a mail-API key |
| Receiving the alert list | Web App `doPost` | Commit a file to the repo through the GitHub API (needs a token in the app) | Worker `fetch` handler + KV/D1 |
| Setup for this user | Paste files, deploy, set one property; same format as the existing Drive tools | Repo, workflow YAML, secrets | New account, `wrangler`, deploy step |
| Exchange geo-blocking | Runs on Google's US IPs | Runs on US Azure IPs | Edge location chosen by Cloudflare |

Apps Script wins on the two things that matter here: a 1-minute interval for free and email without any extra secret.
Every option runs from a cloud IP, so the exchange blocks below apply to all of them.

### Apps Script quotas that apply

From [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas):

| Quota | Gmail account | Google Workspace |
|:------|:--------------|:-----------------|
| Email recipients per day | 100 | 1,500 |
| URL Fetch calls per day | 20,000 | 100,000 |
| Trigger runtime per day | 90 min | 6 h |
| Runtime per execution | 6 min | 6 min |
| Properties reads/writes per day | 50,000 | 500,000 |
| Property value size / store size | 9 KB / 500 KB | 9 KB / 500 KB |

Budget at a 1-minute interval (1,440 runs a day):

- **Fetches.** One call per venue per run when the venue's all-pairs ticker is used, one per symbol for forex (Swissquote) and DEX pools (GeckoTerminal). With alerts on 3 venues + 2 forex symbols that is ~7,200 calls a day, inside the Gmail limit. More than ~13 distinct fetch targets would pass 20,000 on a Gmail account; the script then drops to a 5-minute trigger and says so in its status.
- **Runtime.** A run with fetches takes about 1–3 s, so 25–70 min a day; tight on a Gmail account (90 min), easy on Workspace. Runs while the app is online return at once without fetching.
- **Mail.** All alerts that fire in one run go in one email, and a repeating alert sends at most one email per 15 minutes, so 100 a day is enough for normal use.

## Price Sources and How They Differ From the App

The script uses the same public endpoints and the same mid price, `(bid + ask) / 2`, as the app (`adapters/cex-map.ts`, `electron/lib.js`).
The app sends each alert's venue and native pair id (e.g. `okx` / `BTC-USDT`), so the script needs no symbol mapping of its own.

| Source | From Google's servers | Plan |
|:-------|:----------------------|:-----|
| Binance `api.binance.com` | Blocked: HTTP 451 "restricted location" (US IPs) | Try `data-api.binance.vision` (Binance's market-data-only host); else price the same pair on a fallback venue |
| Bybit `api.bybit.com` | Blocked: Bybit's docs say US IPs get 403 | Fallback venue |
| OKX, KuCoin, MEXC, Coinbase | Not verified | Checked by the probe (setup step 3) |
| Swissquote (forex, metals) | Not verified | Probe; this is the keyless forex/gold source |
| GeckoTerminal (DEX pools) | Not verified | Probe; 30 calls/min public limit is enough |
| OANDA | Needs the user's token | Not used: the token stays in the app. Forex alerts are priced from Swissquote, a few pips from OANDA |

A **fallback venue** is the same base/quote pair on another exchange the probe reached (e.g. `BINANCE:BTCUSDT` → OKX `BTC-USDT`).
The app picks it from its market list when it syncs, and the email says "priced from OKX" so a level hit on one exchange but not another is explained.

Other differences:

- **Coarser checks.** The app checks the charted pair every second and other alerted pairs every 15 s; the script checks once a minute (trigger runs drift by some seconds). The crossing rule (`side` flips) still catches any move that is past the level at a check, but a wick that crosses and comes back within the minute is missed.
  Optional later step: also read the 1-minute candles since the last check and fire on their high/low. That costs one extra call per symbol per run.
- **Repeat cooldown.** The app's 60 s cooldown becomes "at most one email per alert per 15 min" so a price chopping around a level does not flood the inbox; each crossing is still counted.

## Sync Between the App and the Script

### Who notifies: an ownership hand-over

Exactly one side evaluates alerts at a time, so nothing is notified twice.

1. **App starts (or resumes from sleep):** before checking any tick, the app POSTs `takeover`.
   The script stops evaluating and replies with what changed while it owned the alerts: each alert's `status`, `side`, `triggeredAt`, `count`, and the fired events.
   The app merges those into `ocd_alerts_v1` and `ocd_alert_log_v1` (events marked "emailed") and then evaluates as today.
2. **App runs:** every 5 minutes, and whenever the alert list changes, it POSTs `heartbeat` with the full list.
3. **App quits:** it POSTs `handover` with the full list, including each alert's current `side`.
   The script owns the alerts from its next run.
4. **App crashes, PC sleeps or loses network:** heartbeats stop. After 10 minutes with no heartbeat the script takes over on its own.
   Because each alert remembers its `side`, a crossing during that gap is caught at the first check, only late.

If the script cannot be reached, the app keeps evaluating locally (today's behaviour) and retries; it never waits on the network to show a notification.

On resume from sleep, the app's feeds may tick before the `takeover` reply arrives.
The app therefore holds alert checks until the reply (or a 10 s timeout) — **this is the one change to the app's alert behaviour and needs the user's OK.**

### Merge rules

- The app owns the alert definitions: add, edit, delete, pause. The script never creates or deletes alerts.
- The script only changes the runtime fields `status`, `side`, `triggeredAt`, `count`.
- Each POST from the app replaces the script's list; for an alert id both sides know, the copy with the later `triggeredAt` keeps its runtime fields.
- An alert edited in the app (new price, resumed) is re-armed by the app as today, and the next sync carries the new `side`.

### The endpoint

```json
{
  "v": 1,
  "op": "handover",
  "ts": 1793462400000,
  "nonce": "b6f0…",
  "alerts": [
    {
      "id": "k3x…",
      "symbol": "OKX:BTCUSDT",
      "venue": "okx",
      "native": "BTC-USDT",
      "fallback": null,
      "price": 77500,
      "mode": "once",
      "status": "active",
      "side": "below",
      "note": "",
      "triggeredAt": null,
      "count": 0
    }
  ],
  "sig": "base64 HMAC-SHA256 of everything above"
}
```

- `op` is `takeover`, `heartbeat`, `handover`, `probe` or `test-email`.
- **Shared secret, HMAC-signed.** Apps Script's `doPost` cannot read request headers, so the signature travels in the body.
  The script recomputes it with `Utilities.computeHmacSha256Signature`, rejects a `ts` more than 5 minutes off and a reused `nonce` (kept in `CacheService` for 10 minutes).
- **Deployment.** Web App, "Execute as: Me", "Who has access: Anyone". Anyone can reach the URL, but only a signed request does anything; a bad request gets the same empty reply as a missing one.
- **Redirect.** A Web App POST answers with a 302 to `script.googleusercontent.com`; the reply must be fetched with a GET, which Electron's `net.fetch` does when it follows the redirect.
- **Locking.** `doPost` and the trigger take `LockService.getScriptLock()`, so a `takeover` never interleaves with a run.
- **Storage.** One Script Property per alert (`a:<id>`, well under 9 KB each) plus `owner`, `lastBeat` and a short event list; 500 KB holds about 2,000 alerts.

### Secrets

- The app generates a 32-byte random secret and stores it, with the Web App URL, encrypted with DPAPI in `%APPDATA%\OpenCharts\settings.json`, like the exchange keys. It lives in the main process only.
- A new **Data › Email alerts…** window shows the secret once with a Copy button; the user pastes it into the script's Script Properties as `OCD_SECRET`.
- The secret never goes in chat, in `Code.gs`, in the README or in any committed file. `Code.gs` reads it from `PropertiesService`.
- The email goes to the script owner (`Session.getEffectiveUser().getEmail()`), or to an address set in the `OCD_MAIL_TO` property.

## Email

- Subject: `Price alert · OKX:BTCUSDT crossed up 77,500` (several in one run: `3 price alerts · OKX:BTCUSDT, XAUUSD …`).
- Body: the same line as `eventText()`, the time in the account's time zone, the venue the price came from, and "Checked while OpenCharts was closed".
- A once-alert that fired shows as **triggered** in the Alerts tab after the next app start, with the event in the log.

## Steps

### Prototype (only after approval)

1. **Mini app.** Create `Google Apps Script/opencharts-alert-mailer/` from `_shared/templates/google-apps-script/`: `Code.gs` (entry: `doPost`, `onTick`, `setup`; service: store, fetch, mail; pure helpers: a copy of the alert rules from `alerts.ts`, ticker parsers, HMAC check, merge), `appsscript.json` with only `script.external_request`, `script.send_mail` and `script.scriptapp` scopes, `DEPLOY-CHECKLIST.txt`, `README.md`, `CHANGELOG.md`, and `dev/tests/` run by `npm test` against `Code.gs` in a Node `vm` with fakes. Add it to the catalog in `projects/09_Mini_Apps/README.md`.
2. **Deploy (user).** Paste the files, run `setup` once (installs the 1-minute trigger, asks for the scopes), deploy as Web App, set `OCD_SECRET`.
3. **Probe.** The app's Email alerts window sends `probe`; the script fetches one ticker from every venue and Swissquote and replies which ones answered. The app uses that list to pick fallback venues.
4. **App side (needs OK, since it touches alert behaviour).** `electron/remote-alerts.js` in the main process (sign, POST, retry; IPC `alerts:sync`), the Email alerts window, and in `upstream/src/desktop/DesktopSync.tsx` the takeover-before-check gate and the merge into `alertsStore`. Tests for signing, merging and the gate; the alert smoke test extended with a fake endpoint.
5. **End-to-end check.** Set an alert just above the price, quit the app, wait for the email, start the app and confirm the alert shows as triggered with no Windows notification for the same crossing.

### Not in scope

- Push notifications to a phone (Telegram, ntfy) — easy to add later beside `MailApp`.
- Running the app's paper or real orders from the script.
- Alerts on drawings (trend-line alerts); only horizontal price alerts sync.

## Sources

- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Binance market-data-only URLs](https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only)
- [Binance 451 from Apps Script (forum)](https://dev.binance.vision/t/api-connection-with-google-apps-script/18993)
- [Bybit V5 integration guide (US IPs restricted)](https://bybit-exchange.github.io/docs/v5/guide)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits)
- [GitHub Actions scheduled workflows are unreliable](https://runhooks.app/blog/github-actions-scheduled-workflows-unreliable/)
