// Visual check of every extra drawing tool: one cell each on synthetic bars.
// Build: node dev/tools/gallery.mjs → dev/out/gallery.html

import type { DrawingLine } from "../../../upstream/src/pages/trading/constants";
import { PRO_TOOLS, type ProToolId } from "../../../upstream/src/lib/chart-plugins/drawing-tools/pro/catalog";
import { CanvasPen } from "../../../upstream/src/lib/chart-plugins/drawing-tools/pro/pen";
import { DRAW, type ProBar, type ProEnv } from "../../../upstream/src/lib/chart-plugins/drawing-tools/pro/tools";

const W = 320;
const H = 220;
const T0 = 1_700_000_000;
const STEP = 3600;
const bars: ProBar[] = Array.from({ length: 60 }, (_, i) => {
  const close = 100 + 4 * Math.sin(i / 6) + i * 0.08;
  return { time: T0 + i * STEP, open: close - 0.5 * Math.cos(i), high: close + 1, low: close - 1.1, close, volume: 500 + 400 * Math.abs(Math.sin(i / 3)) };
});
const timeToX = (t: number) => 10 + ((t - T0) / STEP) * 5;
const priceToY = (p: number) => H - 20 - (p - 94) * 12;

// Points per tool, in bar index and price, chosen to look like typical use.
function pointsFor(tool: ProToolId): Array<[number, number]> {
  const def = PRO_TOOLS[tool];
  const n = typeof def.points === "number" ? def.points : 6;
  if (def.points === "free") return Array.from({ length: 30 }, (_, i) => [10 + i, 100 + 3 * Math.sin(i / 4)]);
  if (n === 1) return [[25, 101]];
  if (n === 2) return [[12, 98], [32, 104]];
  if (n === 3) return [[10, 99], [24, 105], [36, 101]];
  const zig: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) zig.push([6 + i * (44 / (n - 1)), i % 2 ? 105 - i * 0.3 : 98 + i * 0.4]);
  return zig;
}

const canvas = document.createElement("canvas");
const tools = (Object.keys(PRO_TOOLS) as ProToolId[]).filter((t) => t !== "zoom");
const cols = 5;
canvas.width = cols * W;
canvas.height = Math.ceil(tools.length / cols) * H;
document.body.appendChild(canvas);
const ctx = canvas.getContext("2d")!;
ctx.fillStyle = "#131722";
ctx.fillRect(0, 0, canvas.width, canvas.height);

tools.forEach((tool, i) => {
  const ox = (i % cols) * W;
  const oy = Math.floor(i / cols) * H;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  ctx.strokeStyle = "#2a2e39";
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  for (const b of bars) {
    const x = timeToX(b.time);
    ctx.strokeStyle = b.close >= b.open ? "#08998155" : "#f2364555";
    ctx.beginPath();
    ctx.moveTo(x, priceToY(b.high));
    ctx.lineTo(x, priceToY(b.low));
    ctx.stroke();
  }
  const data = pointsFor(tool).map(([bar, price]) => ({ time: T0 + bar * STEP, price }));
  const d: DrawingLine = {
    id: tool,
    type: "pro",
    tool,
    color: PRO_TOOLS[tool].color ?? "#2962ff",
    width: PRO_TOOLS[tool].width,
    price: data[0]!.price,
    time: data[0]!.time,
    points: data,
    text: PRO_TOOLS[tool].text,
  };
  if (tool === "bars-pattern") {
    d.points = [data[0]!];
    d.pattern = bars.slice(5, 20).map((b) => [b.time - bars[5]!.time, b.open - bars[5]!.open, b.high - bars[5]!.open, b.low - bars[5]!.open, b.close - bars[5]!.open]);
  }
  const env: ProEnv = {
    width: W,
    height: H,
    fmt: (p) => p.toFixed(2),
    priceToY,
    timeToX,
    intervalSec: STEP,
    minMove: 0.01,
    bars: () => bars,
    data: d.points!,
    active: true,
  };
  const P = d.points!.map((p) => ({ x: timeToX(p.time), y: priceToY(p.price) }));
  DRAW[tool](new CanvasPen(ctx), P, d, env);
  ctx.fillStyle = "#d1d4dc";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText(PRO_TOOLS[tool].label, 8, 16);
  ctx.restore();
});
