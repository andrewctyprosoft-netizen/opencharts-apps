import {
  Bell,
  BellRing,
  ChevronRight,
  Database,
  ExternalLink,
  KeyRound,
  LayoutGrid,
  Info,
  MousePointerClick,
  RefreshCw,
  Volume2,
  Wallet,
  Coins,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ChartTemplatesMenu } from "../pages/trading/ChartTemplatesMenu.tsx";
import { cn } from "../lib/utils.ts";
import { useTerminal } from "../terminal/use-terminal.ts";
import { type MobileState, mobileBridge } from "./is-mobile.ts";
import { AccountStrip, Toggle } from "./parts.tsx";
import { useMobileStore } from "./mobile-store.ts";
import type { IndicatorType } from "../lib/indicators.ts";

/**
 * OpenCharts Mobile addition: the More tab. Everything the desktop app keeps
 * in its menus and extra windows: the three dashboards, live prices per
 * exchange or the offline demo, exchange API keys and the OANDA token, plus
 * trading and notification settings, chart templates and About.
 */
export function MobileMore() {
  const t = useTerminal();
  const bridge = mobileBridge();
  const setTab = useMobileStore((s) => s.setTab);
  const setOrdersTab = useMobileStore((s) => s.setOrdersTab);
  const [state, setState] = useState<MobileState | null>(null);
  const [notes, setNotes] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    void bridge?.state().then(setState);
  }, [bridge]);
  useEffect(() => {
    refresh();
    // The keys and token panels change what is configured.
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(refresh, 4000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [refresh]);

  // Loading a chart template swaps the whole indicator list.
  const setIndicators = useCallback(
    (next: IndicatorType[]) => {
      for (const type of next) if (!t.activeIndicators.includes(type)) t.toggleIndicator(type);
      for (const type of t.activeIndicators) if (!next.includes(type)) t.toggleIndicator(type);
    },
    [t],
  );

  if (!bridge) return null;
  const live = state?.dataSource !== "demo";
  const keyCount = state ? Object.entries(state.keys).filter(([id, on]) => id !== "oanda" && on).length : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-6" data-testid="more-list">
      <AccountStrip />

      <Group title="Dashboards">
        <Row icon={Wallet} label="Portfolio" hint="Balances, open orders and wallets" onClick={() => bridge.openDashboard("portfolio")} testId="open-portfolio" />
        <Row icon={LayoutGrid} label="Market overview" hint="Crypto on exchanges and DEXs, forex & metals, stocks" onClick={() => bridge.openDashboard("markets")} testId="open-markets" />
        <Row icon={BellRing} label="Alerts & positions" hint="Every alert, position and order" onClick={() => bridge.openDashboard("desk")} testId="open-desk" />
        <Row
          icon={Bell}
          label="Price alerts"
          hint="Add, pause, re-arm and the firing log"
          onClick={() => {
            setOrdersTab("alerts");
            setTab("orders");
          }}
        />
      </Group>

      <Group title="Trading">
        <Row
          icon={KeyRound}
          label="Exchange API keys"
          hint={keyCount ? `${keyCount} exchange${keyCount === 1 ? "" : "s"} connected` : "Trade for real on Binance, OKX, Bybit, KuCoin, Coinbase, MEXC"}
          onClick={() => bridge.openKeys()}
          testId="open-keys"
        />
        <Row
          icon={Coins}
          label="OANDA token (forex & gold)"
          hint={state?.oanda.configured ? `Connected (${state.oanda.env})` : "Optional: free forex & gold work without it"}
          onClick={() => bridge.openOanda()}
        />
        <Row icon={MousePointerClick} label="One-click trading" hint="Orders go without the confirmation step" onClick={t.toggleOneClick} right={<Toggle on={t.oneClick} />} />
        <Row icon={Volume2} label="Order sounds" onClick={t.toggleSoundMute} right={<Toggle on={!t.soundMuted} />} />
      </Group>

      <Group title="Market data">
        <Row
          icon={Database}
          label="Live prices"
          hint={live ? "From the exchanges below" : "Off: the offline demo is running"}
          onClick={() => bridge.setDataSource(live ? "demo" : "live")}
          right={<Toggle on={live} />}
          testId="toggle-live"
        />
        {Object.entries(bridge.exchanges).map(([id, label]) => {
          const on = Boolean(live && state?.exchanges[id]);
          return (
            <Row
              key={id}
              inset
              label={label}
              hint={state?.keys[id] ? "API key saved" : undefined}
              onClick={() => bridge.setExchange(id, !on)}
              right={<Toggle on={on} />}
              testId={`toggle-${id}`}
            />
          );
        })}
        <Note>Forex & metals: OANDA with a token, otherwise Swissquote and Yahoo Finance. DEX pools: GeckoTerminal. Switching reloads the terminal; the paper account starts again.</Note>
      </Group>

      <Group title="Chart">
        <div className="px-4 py-2 flex items-center gap-3">
          <span className="flex-1 text-[15px]">Chart templates</span>
          <ChartTemplatesMenu
            activeIndicators={t.activeIndicators}
            onSetIndicators={setIndicators}
            activePlugins={t.activePlugins}
            onSetPlugins={t.setPlugins}
          />
        </div>
        <Row icon={RefreshCw} label="Reload terminal" onClick={() => bridge.reload()} />
      </Group>

      <Group title="Notifications">
        <Row
          icon={Bell}
          label="Alert notifications"
          hint={notes === null ? "Lets a price alert reach the notification shade" : notes ? "Allowed" : "Blocked: allow them in Android settings › Apps › OpenCharts"}
          onClick={() => void bridge.ensureNotifications().then(setNotes)}
        />
        <Note>Alerts are checked while OpenCharts is open. A crossing while it was closed fires at the next start.</Note>
      </Group>

      <Group title="About">
        <Row icon={Info} label={`OpenCharts for Android ${bridge.version}`} hint="Paper trading resets when the app closes. Not financial advice." />
        <Row icon={ExternalLink} label="OpenCharts on GitHub" onClick={() => bridge.openExternal("https://github.com/dylanpersonguy/OpenCharts")} />
        <Row icon={ExternalLink} label="TradingView Lightweight Charts" onClick={() => bridge.openExternal("https://www.tradingview.com/")} />
        <Note>
          Built on OpenCharts (MIT) and TradingView Lightweight Charts™ (Apache 2.0), Copyright (c) 2025 TradingView, Inc. Market data: Binance, OKX, Bybit, KuCoin,
          Coinbase and MEXC public APIs, GeckoTerminal, OANDA or Swissquote and Yahoo Finance, CoinGecko.
        </Note>
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <div className="px-4 pb-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="bg-card border-y border-border divide-y divide-border/60">{children}</div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  hint,
  onClick,
  right,
  inset,
  testId,
}: {
  icon?: typeof Bell;
  label: string;
  hint?: string;
  onClick?: () => void;
  right?: ReactNode;
  inset?: boolean;
  testId?: string;
}) {
  const body = (
    <>
      {Icon ? <Icon className="h-5 w-5 shrink-0 text-muted-foreground" /> : null}
      <span className="flex-1 min-w-0">
        <span className="block text-[15px]">{label}</span>
        {hint && <span className="block text-[12px] text-muted-foreground">{hint}</span>}
      </span>
      {right ?? (onClick ? <ChevronRight className="h-4 w-4 text-muted-foreground/60" /> : null)}
    </>
  );
  const cls = cn("w-full flex items-center gap-3 min-h-[52px] py-2 pr-4 text-left", inset ? "pl-12" : "pl-4");
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onClick} className={cn(cls, "active:bg-secondary")} data-testid={testId}>
      {body}
    </button>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-4 py-2.5 text-[12px] leading-relaxed text-muted-foreground">{children}</p>;
}
