// Pure order mapping: a terminal order (PlaceOrderInput) → the rounded order a venue accepts,
// with the checks that would otherwise come back as exchange errors. Tested in
// dev/tests/order-map.test.ts.

import type { PlaceOrderInput } from "../upstream/src/adapter/types.ts";
import { type CexMarket, roundDown, roundTick } from "./cex-map.ts";
import type { RealOrder } from "./types.ts";

export interface BuiltOrder {
  order: RealOrder;
  /** Quantity actually sent, in base units (or OANDA units). */
  qty: number;
  /** Estimated value in the quote currency at `price`. */
  notional: number;
}

/** A thrown Error whose message the terminal shows the trader. */
const fail = (message: string): never => {
  throw new Error(message);
};

function checkType(input: PlaceOrderInput): "MARKET" | "LIMIT" {
  if (input.type === "STOP" || input.type === "STOP_LIMIT") {
    fail("Stop orders are not sent to exchanges yet. Use a market or limit order, or set the stop on the exchange.");
  }
  if (input.type === "LIMIT" && !(Number(input.price) > 0)) fail("A limit order needs a price.");
  return input.type === "LIMIT" ? "LIMIT" : "MARKET";
}

/**
 * Exchange spot order: quantity in the base asset, rounded down to the lot step, price to the tick.
 * @param price current mid price, used for the minimum-value check of market orders
 */
export function buildCexOrder(input: PlaceOrderInput, m: CexMarket, price: number): BuiltOrder {
  const type = checkType(input);
  if (input.takeProfit || input.stopLoss) {
    fail(`Take profit and stop loss are not sent to ${m.exchange === "coinbase" ? "Coinbase" : "spot exchanges"}. Clear them, or place them on the exchange after the fill.`);
  }
  const qtyText = roundDown(input.quantity, m.stepSize);
  const qty = Number(qtyText);
  if (!(qty > 0)) fail(`Quantity ${input.quantity} is below the smallest step (${m.stepSize} ${m.base}).`);
  if (m.minQty > 0 && qty < m.minQty) fail(`The minimum order on this pair is ${m.minQty} ${m.base}.`);
  const at = type === "LIMIT" ? Number(input.price) : price;
  const notional = qty * at;
  if (m.minNotional > 0 && at > 0 && notional < m.minNotional) {
    fail(`Order value ${notional.toFixed(2)} ${m.quote} is below the pair's minimum of ${m.minNotional} ${m.quote}.`);
  }
  const order: RealOrder = { native: m.native, side: input.side, type, qty: qtyText };
  if (type === "LIMIT") order.price = roundTick(Number(input.price), m.tickSize || 1e-8);
  return { order, qty, notional };
}

/**
 * OANDA order: lots × contract size → whole units; take profit and stop loss go with it.
 * @param instrument OANDA name, e.g. "XAU_USD"
 */
export function buildOandaOrder(
  input: PlaceOrderInput,
  instrument: string,
  contractSize: number,
  tickSize: number,
  price: number,
): BuiltOrder {
  const type = checkType(input);
  const units = Math.floor(input.quantity * contractSize + 1e-9);
  if (units < 1) fail(`${input.quantity} lots is less than one ${instrument.replace("_", "/")} unit.`);
  const order: RealOrder = { native: instrument, side: input.side, type, qty: String(units) };
  if (type === "LIMIT") order.price = roundTick(Number(input.price), tickSize);
  if (input.takeProfit) order.takeProfit = roundTick(input.takeProfit, tickSize);
  if (input.stopLoss) order.stopLoss = roundTick(input.stopLoss, tickSize);
  const at = type === "LIMIT" ? Number(input.price) : price;
  return { order, qty: units, notional: units * at };
}

/** "XAUUSD" → "XAU_USD" (every forex and metal symbol is 3 + 3 letters). */
export function oandaInstrument(symbol: string): string | null {
  return /^[A-Z]{6}$/.test(symbol) ? `${symbol.slice(0, 3)}_${symbol.slice(3)}` : null;
}
