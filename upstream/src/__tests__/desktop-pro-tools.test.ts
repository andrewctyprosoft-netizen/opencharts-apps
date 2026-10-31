// OpenCharts Desktop patch: every extra drawing tool draws, and can be hit, without a chart.

import { describe, expect, it } from "vitest";
import type { DrawingLine } from "../pages/trading/constants";
import { isProTool, PRO_TOOLS, type ProToolId } from "../lib/chart-plugins/drawing-tools/pro/catalog";
import { RecordPen } from "../lib/chart-plugins/drawing-tools/pro/pen";
import { compactNumber, DRAW, type ProBar, type ProEnv } from "../lib/chart-plugins/drawing-tools/pro/tools";

const T0 = 1_700_000_000;
const STEP = 3600;
const bars: ProBar[] = Array.from({ length: 120 }, (_, i) => {
  const close = 100 + 5 * Math.sin(i / 8) + i * 0.05;
  return { time: T0 + i * STEP, open: close - 0.4, high: close + 1, low: close - 1.2, close, volume: 1000 + i * 10 };
});

// 6 px per bar, 20 px per price unit.
const timeToX = (t: number) => ((t - T0) / STEP) * 6;
const priceToY = (p: number) => 600 - (p - 90) * 20;

function setup(tool: ProToolId, count: number) {
  const data = Array.from({ length: count }, (_, i) => ({
    time: T0 + (20 + i * 12) * STEP,
    price: 100 + (i % 2 === 0 ? -3 : 3) + i * 0.5,
  }));
  const env: ProEnv = {
    width: 900,
    height: 600,
    fmt: (p) => p.toFixed(2),
    priceToY,
    timeToX,
    intervalSec: STEP,
    minMove: 0.01,
    bars: () => bars,
    data,
    active: true,
  };
  const d: DrawingLine = {
    id: "t",
    type: "pro",
    tool,
    color: "#2962ff",
    price: data[0]!.price,
    time: data[0]!.time,
    points: data,
    text: PRO_TOOLS[tool].text,
  };
  const P = data.map((p) => ({ x: timeToX(p.time), y: priceToY(p.price) }));
  return { env, d, P };
}

const countFor = (tool: ProToolId) => {
  const pts = PRO_TOOLS[tool].points;
  return typeof pts === "number" ? pts : 5;
};

describe("desktop pro drawing tools", () => {
  const tools = Object.keys(PRO_TOOLS) as ProToolId[];

  it("covers the TradingView menus with a draw function each", () => {
    expect(tools.length).toBeGreaterThanOrEqual(70);
    for (const t of tools) expect(typeof DRAW[t]).toBe("function");
    expect(isProTool("pitchfork")).toBe(true);
    expect(isProTool("trendline")).toBe(false);
  });

  it.each(tools)("%s draws something that can be clicked", (tool) => {
    const { env, d, P } = setup(tool, countFor(tool));
    const pen = new RecordPen();
    expect(() => DRAW[tool](pen, P, d, env)).not.toThrow();
    // Somewhere on the pane the drawing must answer a hit test.
    let hit = false;
    for (let x = 0; x <= 900 && !hit; x += 6) {
      for (let y = 0; y <= 600 && !hit; y += 6) hit = pen.hit({ x, y }, 4);
    }
    expect(hit).toBe(true);
  });

  it("patterns draw with only some points placed", () => {
    for (const tool of ["xabcd", "head-shoulders", "elliott-impulse"] as ProToolId[]) {
      const { env, d, P } = setup(tool, 2);
      expect(() => DRAW[tool](new RecordPen(), P, d, env)).not.toThrow();
    }
  });

  it("the date and price range reads change, bars and volume", () => {
    const { env, d, P } = setup("date-price-range", 2);
    const texts: string[] = [];
    const pen = new RecordPen();
    const orig = pen.text.bind(pen);
    pen.text = (t, at, o) => {
      texts.push(t);
      return orig(t, at, o);
    };
    DRAW["date-price-range"](pen, P, d, env);
    const label = texts.join("\n");
    expect(label).toContain("+6.50 (6.70%) +650");
    expect(label).toContain("12 bars, 12h");
    expect(label).toMatch(/Vol \d/);
  });

  it("anchored VWAP follows bars from its anchor onward", () => {
    const { env, d, P } = setup("anchored-vwap", 1);
    const pen = new RecordPen();
    DRAW["anchored-vwap"](pen, P, d, env);
    const lastBar = bars[bars.length - 1]!;
    expect(pen.hit({ x: timeToX(lastBar.time), y: priceToY(100) }, 200)).toBe(true);
  });

  it("compactNumber formats like TradingView", () => {
    expect(compactNumber(7_870_000)).toBe("7.87M");
    expect(compactNumber(1_701)).toBe("1.70K");
  });
});
