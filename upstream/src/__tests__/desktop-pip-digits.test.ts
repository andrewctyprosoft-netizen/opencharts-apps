import { describe, expect, it } from "vitest";
import { getPipDigits, tickSizeDecimals } from "../pages/trading/utils.ts";

// OpenCharts Desktop: chart precision for crypto, forex, metals and tiny DEX tick sizes.
describe("tickSizeDecimals", () => {
  it("counts decimals without float noise or exponent notation", () => {
    expect(tickSizeDecimals(0.01)).toBe(2);
    expect(tickSizeDecimals(0.001)).toBe(3);
    expect(tickSizeDecimals(0.00001)).toBe(5);
    expect(tickSizeDecimals(0.25)).toBe(2);
    expect(tickSizeDecimals(1e-7)).toBe(7);
    expect(tickSizeDecimals(1e-10)).toBe(10);
    expect(tickSizeDecimals(1)).toBe(0);
    expect(tickSizeDecimals(0)).toBe(0);
  });
});

describe("getPipDigits", () => {
  it("matches the instrument", () => {
    expect(getPipDigits({ tickSize: 0.01 }, "BTCUSD")).toBe(2);
    expect(getPipDigits({ tickSize: 0.001 }, "XAUUSD")).toBe(3);
    expect(getPipDigits({ tickSize: 0.00001 }, "EURUSD")).toBe(5);
    expect(getPipDigits({ tickSize: 0.001 }, "USDJPY")).toBe(3);
    expect(getPipDigits({ tickSize: 1e-10 }, "PEPE/WETH")).toBe(10);
  });
});
