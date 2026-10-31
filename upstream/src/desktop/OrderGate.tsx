import { KeyRound, ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "../components/ui/button.tsx";
import { cn } from "../lib/utils.ts";
import { answerGate, useGatePrompt } from "./order-gate.ts";
import { isMobileApp } from "../mobile/is-mobile.ts";

/**
 * OpenCharts Desktop addition: the dialogs the order router opens.
 *
 * - "missing-key": the pair's exchange (or OANDA) has no saved key. Guides the
 *   trader to Data › Exchange API keys, or lets them paper trade this order.
 * - "confirm-real": the last check before a real order leaves the app.
 */
export function OrderGate() {
  const prompt = useGatePrompt();

  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") answerGate("cancel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prompt]);

  if (!prompt) return null;

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm" onClick={() => answerGate("cancel")} />
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-label={prompt.kind === "missing-key" ? "API key needed" : "Confirm real order"}
          data-testid={`order-gate-${prompt.kind}`}
          className="pointer-events-auto w-full max-w-md bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        >
          {prompt.kind === "missing-key" ? (
            <>
              <div className="px-5 py-3 border-b border-border bg-primary/10 flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Connect {prompt.venueLabel} to trade for real</h3>
              </div>
              <div className="px-5 py-4 space-y-3 text-sm">
                <p>
                  <span className="font-semibold">{prompt.symbol}</span> trades on {prompt.venueLabel}, and no {prompt.venueLabel}{" "}
                  {prompt.keyWord} is saved yet.
                </p>
                <ol className="list-decimal pl-5 space-y-1 text-muted-foreground text-[13px]">
                  <li>
                    Create {prompt.keyWord === "API token" ? "an API token" : "an API key"} in your {prompt.venueLabel} account
                    {prompt.keyWord === "API token" ? "" : " with read and spot trading only (never withdrawals)"}.
                  </li>
                  {/* OpenCharts Mobile patch: the phone keeps these under More and stores keys with the Android Keystore. */}
                  <li>
                    Open {isMobileApp() ? "More › " : "Data › "}
                    {prompt.keyWord === "API token" ? "OANDA token" : "Exchange API keys"} and paste it. It is checked, then stored encrypted on
                    this {isMobileApp() ? "phone" : "PC"}.
                  </li>
                  <li>Place the order again: it goes to your {prompt.venueLabel} account after one confirmation.</li>
                </ol>
                <p className="text-[12px] text-muted-foreground">
                  Order: {prompt.summary}. Paper trading uses the $100,000 practice account instead.
                </p>
              </div>
              <div className="px-5 py-3 border-t border-border/40 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => answerGate("cancel")}>
                  Cancel
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => answerGate("paper")}>
                  Paper trade
                </Button>
                <Button className="flex-1" onClick={() => answerGate("keys")}>
                  Add {prompt.keyWord}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div
                className={cn(
                  "px-5 py-3 border-b flex items-center gap-2",
                  prompt.testnet ? "bg-primary/10 border-primary/20" : "bg-sell/10 border-sell/30",
                )}
              >
                <ShieldAlert className={cn("h-4 w-4", prompt.testnet ? "text-primary" : "text-sell")} />
                <h3 className="text-sm font-semibold">
                  {prompt.testnet ? `Send to your ${prompt.venueLabel} test account?` : `Send a REAL order to ${prompt.venueLabel}?`}
                </h3>
              </div>
              <div className="px-5 py-4 space-y-1.5 text-sm">
                {prompt.lines.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium text-right font-mono text-[13px]">{value}</span>
                  </div>
                ))}
                <p className="pt-2 text-[12px] text-muted-foreground">
                  {prompt.testnet
                    ? "This key is a test-network or demo key, so no real money moves."
                    : "This uses real funds on your exchange account. Market orders fill at the exchange's price, which can differ from the chart."}
                </p>
              </div>
              <div className="px-5 py-3 border-t border-border/40 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => answerGate("cancel")}>
                  Cancel
                </Button>
                <Button
                  variant={prompt.lines.find(([l]) => l === "Side")?.[1] === "SELL" ? "sell" : "buy"}
                  className="flex-1"
                  onClick={() => answerGate("confirm")}
                >
                  Send order
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
