// Routes orders from the terminal. Pairs on an exchange with a saved API key (or forex/metals
// with an OANDA token) become real orders after a confirmation; without a key the trader is
// reminded to add one, or can paper trade instead. DEX pools and the demo always paper trade.

import type { Order, PlaceOrderInput, Symbol, TradingGateway } from "../upstream/src/adapter/types.ts";
import { askGate } from "../upstream/src/desktop/order-gate.ts";
import { toast } from "../upstream/src/services/toast.ts";
import { EXCHANGE_INFO, type CexMarket } from "./cex-map.ts";
import { type BuiltOrder, buildCexOrder, buildOandaOrder, oandaInstrument } from "./order-map.ts";
import type { DesktopBridge, VenueId } from "./types.ts";
import { ipcMessage, venueOf } from "./venues.ts";

interface RouterDeps {
  paper: TradingGateway;
  bridge: DesktopBridge;
  market: (symbol: string) => CexMarket | null;
  symbol: (name: string) => Symbol | undefined;
  /** Last mid price, for the confirmation and minimum-value checks. */
  mid: (symbol: string) => number | null;
}

const fmt = (n: number, max = 8) => n.toLocaleString("en-US", { maximumFractionDigits: max });

export function createOrderRouter({ paper, bridge, market, symbol, mid }: RouterDeps): TradingGateway {
  async function placeOrder(input: PlaceOrderInput): Promise<Order> {
    const sym = symbol(input.symbol);
    const venue = sym ? venueOf(sym) : null;
    if (!venue?.id) return paper.placeOrder(input);
    const id: VenueId = venue.id;
    const status = await bridge.trade.status().catch(() => null);
    const summary = `${input.side} ${fmt(input.quantity)} ${input.symbol} (${input.type.toLowerCase()})`;

    if (!status?.[id]?.configured) {
      const answer = await askGate({
        kind: "missing-key",
        venue: id,
        venueLabel: venue.label,
        symbol: input.symbol,
        summary,
        keyWord: id === "oanda" ? "API token" : "API key",
      });
      if (answer === "paper") return paper.placeOrder(input);
      if (answer === "keys") {
        void bridge.trade.openKeys(id);
        throw new Error(`Not sent. Add your ${venue.label} ${id === "oanda" ? "token" : "API key"}, then place the order again.`);
      }
      throw new Error("Order cancelled.");
    }

    const price = mid(input.symbol) ?? 0;
    let built: BuiltOrder;
    let unit: string;
    if (id === "oanda") {
      const instrument = oandaInstrument(input.symbol);
      if (!instrument || !sym) throw new Error(`${input.symbol} cannot be traded on OANDA.`);
      built = buildOandaOrder(input, instrument, sym.contractSize, sym.tickSize, price);
      unit = "units";
    } else {
      const m = market(input.symbol);
      if (!m) throw new Error(`${input.symbol} is not listed right now; reload the terminal.`);
      built = buildCexOrder(input, m, price);
      unit = m.base;
    }

    const quote = id === "oanda" ? input.symbol.slice(3) : (market(input.symbol)?.quote ?? "");
    const lines: Array<[string, string]> = [
      ["Venue", `${venue.label}${status[id]?.testnet ? " (test / demo account)" : ""}`],
      ["Pair", `${input.symbol} → ${built.order.native}`],
      ["Side", built.order.side],
      ["Type", built.order.type === "LIMIT" ? `Limit at ${built.order.price}` : "Market"],
      ["Quantity", `${built.order.qty} ${unit}`],
      ["Est. value", price > 0 || built.order.price ? `≈ ${fmt(built.notional, 2)} ${quote}` : "unknown"],
    ];
    if (built.order.takeProfit) lines.push(["Take profit", built.order.takeProfit]);
    if (built.order.stopLoss) lines.push(["Stop loss", built.order.stopLoss]);

    const answer = await askGate({
      kind: "confirm-real",
      venue: id,
      venueLabel: venue.label,
      symbol: input.symbol,
      summary,
      lines,
      testnet: Boolean(status[id]?.testnet),
    });
    if (answer !== "confirm") throw new Error("Order cancelled.");

    const result = await bridge.trade.place(id, built.order).catch((err: unknown) => {
      throw new Error(ipcMessage(err));
    });
    toast.success(
      `${venue.label} order ${result.status === "FILLED" ? "filled" : "sent"}`,
      `${built.order.side} ${built.order.qty} ${built.order.native} · id ${result.id}. Balances and open orders: File › Dashboard › Portfolio.`,
    );
    const now = new Date().toISOString();
    return {
      id: `${id}-${result.id}`,
      accountId: input.accountId,
      symbolName: input.symbol,
      side: input.side,
      type: built.order.type,
      quantity: built.qty,
      price: built.order.price ? Number(built.order.price) : null,
      stopPrice: null,
      takeProfit: input.takeProfit ?? null,
      stopLoss: input.stopLoss ?? null,
      status: result.status === "FILLED" ? "FILLED" : "PENDING",
      filledQuantity: result.status === "FILLED" ? built.qty : 0,
      avgFillPrice: null,
      comment: `Real order on ${EXCHANGE_INFO[id as keyof typeof EXCHANGE_INFO]?.label ?? venue.label}`,
      createdAt: now,
      updatedAt: now,
    };
  }

  return { ...paper, placeOrder };
}
