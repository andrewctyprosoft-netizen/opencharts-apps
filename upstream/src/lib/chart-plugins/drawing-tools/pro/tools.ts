// OpenCharts Desktop patch: how each extra drawing tool looks. Every function draws through a
// Pen in media pixels, so the same code paints the chart and builds the hit-test shapes.

import type { DrawingLine, DrawingLineStyle } from "../../../../pages/trading/constants";
import type { DataPoint } from "../types";
import type { ProToolId } from "./catalog";
import type { Pen, Pt, Stroke } from "./pen";

export interface ProBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** What a tool may know about the chart, all in media pixels and data space. */
export interface ProEnv {
  width: number;
  height: number;
  fmt: (price: number) => string;
  priceToY: (price: number) => number | null;
  timeToX: (time: number) => number | null;
  intervalSec: number;
  /** Price tick of the symbol (minMove), for tick counts. */
  minMove: number;
  /** Chart bars with volume, oldest first. */
  bars: () => readonly ProBar[];
  /** The drawing's anchors in data space, same order as the pixel points. */
  data: readonly DataPoint[];
  /** Hovered or selected (pins reveal their text). */
  active: boolean;
}

export type DrawFn = (pen: Pen, P: Pt[], d: DrawingLine, env: ProEnv) => void;

const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const PALETTE = ["#787b86", "#f23645", "#ff9800", "#4caf50", "#089981", "#00bcd4", "#2962ff", "#9c27b0", "#e91e63"];
const UP = "#089981";
const DOWN = "#f23645";
const PHI = (1 + Math.sqrt(5)) / 2;

// ── Small helpers ───────────────────────────────────────────────────────────

function dashFor(style: DrawingLineStyle | undefined): number[] | undefined {
  if (style === "dashed") return [6, 6];
  if (style === "dotted") return [2, 3];
  return undefined;
}

const st = (d: DrawingLine, extra: Partial<Stroke> = {}): Stroke => ({
  color: d.color,
  width: d.width ?? 1,
  dash: dashFor(d.lineStyle),
  ...extra,
});

const guide = (d: DrawingLine): Stroke => ({ color: d.color, width: 1, dash: [4, 4], alpha: 0.7 });

function fillOf(d: DrawingLine, def: number) {
  return { fill: d.fillColor ?? d.color, fillAlpha: d.fillOpacity ?? def };
}

const levelColor = (i: number) => PALETTE[i % PALETTE.length]!;
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Pt) => Math.hypot(v.x, v.y);

/** Far point along a ray, well past the pane edge (the canvas clips it). */
function rayEnd(a: Pt, dir: Pt, env: ProEnv): Pt {
  const l = len(dir);
  if (l < 1e-6) return a;
  const k = (3 * (env.width + env.height)) / l;
  return { x: a.x + dir.x * k, y: a.y + dir.y * k };
}

function arcPts(c: Pt, rx: number, ry: number, a0 = 0, a1 = Math.PI * 2, n = 72): Pt[] {
  const steps = Math.max(8, Math.ceil((n * Math.abs(a1 - a0)) / (Math.PI * 2)));
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = a0 + ((a1 - a0) * i) / steps;
    out.push({ x: c.x + rx * Math.cos(t), y: c.y + ry * Math.sin(t) });
  }
  return out;
}

/** Signed angle from a1 to a2, in (−π, π]. */
function angleDelta(a1: number, a2: number): number {
  let d = a2 - a1;
  while (d <= -Math.PI) d += Math.PI * 2;
  while (d > Math.PI) d -= Math.PI * 2;
  return d;
}

function arrowHead(pen: Pen, from: Pt, to: Pt, s: Stroke, size = 10): void {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  for (const side of [-1, 1]) {
    const t = a + Math.PI - side * 0.45;
    pen.line(to, { x: to.x + size * Math.cos(t), y: to.y + size * Math.sin(t) }, s);
  }
}

function dot(pen: Pen, c: Pt, r: number, color: string): void {
  pen.poly(arcPts(c, r, r, 0, Math.PI * 2, 20), { color, closed: true, fill: color, fillAlpha: 1 });
}

function rect(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function textStyle(d: DrawingLine, color = "#ffffff") {
  return { color, size: d.fontSize ?? 12, bold: d.bold, italic: d.italic };
}

const sign = (v: number) => (v >= 0 ? "+" : "−");

function spanText(sec: number): string {
  const s = Math.abs(sec);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days >= 1) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours >= 1) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

function dateText(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function compactNumber(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(a < 10 ? 2 : 0);
}

function levelsOf(d: DrawingLine, def: readonly number[]): readonly number[] {
  return d.fibLevels && d.fibLevels.length > 0 ? d.fibLevels : def;
}

function barsBetween(env: ProEnv, t0: number, t1: number): ProBar[] {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  return env.bars().filter((b) => b.time >= lo && b.time <= hi);
}

/** Price change, bars and span between the first two anchors. */
export function moveStats(env: ProEnv) {
  const [p0, p1] = env.data;
  if (!p0 || !p1) return null;
  const dp = p1.price - p0.price;
  return {
    dp,
    pct: p0.price !== 0 ? (dp / p0.price) * 100 : 0,
    ticks: env.minMove > 0 ? Math.round(dp / env.minMove) : 0,
    bars: env.intervalSec > 0 ? Math.round((p1.time - p0.time) / env.intervalSec) : 0,
    span: p1.time - p0.time,
  };
}

function priceChangeText(env: ProEnv): string {
  const s = moveStats(env);
  if (!s) return "";
  return `${sign(s.dp)}${env.fmt(Math.abs(s.dp))} (${s.pct.toFixed(2)}%) ${sign(s.ticks)}${Math.abs(s.ticks).toLocaleString()}`;
}

// ── Lines and channels ─────────────────────────────────────────────────────

const infoLine: DrawFn = (pen, [a, b], d, env) => {
  pen.line(a!, b!, st(d, { width: d.width ?? 2 }));
  const s = moveStats(env);
  if (!s || !b) return;
  const angle = (Math.atan2(-(b.y - a!.y), b.x - a!.x) * 180) / Math.PI;
  const text = [
    `${sign(s.dp)}${env.fmt(Math.abs(s.dp))} (${s.pct.toFixed(2)}%)`,
    `${s.bars} bars, ${spanText(s.span)}`,
    `∠ ${angle.toFixed(1)}°`,
  ].join("\n");
  pen.text(text, { x: b.x + 10, y: b.y }, { ...textStyle(d), size: 11, bg: d.color, bgAlpha: 0.85, baseline: "middle" });
};

const trendAngle: DrawFn = (pen, [a, b], d) => {
  pen.line(a!, b!, st(d, { width: d.width ?? 2 }));
  const ang = Math.atan2(-(b!.y - a!.y), b!.x - a!.x);
  const r = 40;
  pen.line(a!, { x: a!.x + r * 1.5, y: a!.y }, guide(d));
  const arc: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = (ang * i) / 24;
    arc.push({ x: a!.x + r * Math.cos(t), y: a!.y - r * Math.sin(t) });
  }
  pen.poly(arc, st(d, { width: 1 }));
  pen.text(`${((ang * 180) / Math.PI).toFixed(1)}°`, { x: a!.x + r + 8, y: a!.y - (ang >= 0 ? 4 : -4) }, {
    color: d.color,
    size: 11,
    baseline: ang >= 0 ? "bottom" : "top",
  });
};

const horizontalRay: DrawFn = (pen, [a], d, env) => {
  pen.line(a!, { x: env.width + 10, y: a!.y }, st(d, { width: d.width ?? 2 }));
  pen.text(env.fmt(env.data[0]!.price), { x: a!.x + 4, y: a!.y - 3 }, { color: d.color, size: 11, baseline: "bottom" });
};

const crossline: DrawFn = (pen, [a], d, env) => {
  pen.line({ x: -10, y: a!.y }, { x: env.width + 10, y: a!.y }, st(d));
  pen.line({ x: a!.x, y: -10 }, { x: a!.x, y: env.height + 10 }, st(d));
};

const regressionTrend: DrawFn = (pen, [a, b], d, env) => {
  const bars = barsBetween(env, env.data[0]!.time, env.data[1]?.time ?? env.data[0]!.time);
  if (bars.length < 2) {
    pen.line(a!, b!, guide(d));
    return;
  }
  const n = bars.length;
  const mx = (n - 1) / 2;
  const my = bars.reduce((s, x) => s + x.close, 0) / n;
  let sxy = 0;
  let sxx = 0;
  bars.forEach((x, i) => {
    sxy += (i - mx) * (x.close - my);
    sxx += (i - mx) ** 2;
  });
  const slope = sxx > 0 ? sxy / sxx : 0;
  const at = (i: number) => my + slope * (i - mx);
  const sd = Math.sqrt(bars.reduce((s, x, i) => s + (x.close - at(i)) ** 2, 0) / n);
  const xF = env.timeToX(bars[0]!.time);
  const xL = env.timeToX(bars[n - 1]!.time);
  if (xF === null || xL === null) return;
  const line = (k: number): [Pt, Pt] | null => {
    const y0 = env.priceToY(at(0) + k * sd);
    const y1 = env.priceToY(at(n - 1) + k * sd);
    return y0 === null || y1 === null ? null : [{ x: xF, y: y0 }, { x: xL, y: y1 }];
  };
  const up = line(2);
  const md = line(0);
  const lo = line(-2);
  if (!up || !md || !lo) return;
  pen.poly([up[0], up[1], lo[1], lo[0]], { ...st(d), closed: true, noStroke: true, ...fillOf(d, 0.08) });
  pen.line(up[0], up[1], st(d));
  pen.line(lo[0], lo[1], st(d));
  pen.line(md[0], md[1], st(d, { dash: [6, 4] }));
};

const flatTopBottom: DrawFn = (pen, [a, b, c], d) => {
  const c1 = { x: a!.x, y: c!.y };
  const c2 = { x: b!.x, y: c!.y };
  pen.poly([a!, b!, c2, c1], { ...st(d), closed: true, noStroke: true, ...fillOf(d, 0.1) });
  pen.line(a!, b!, st(d));
  pen.line(c1, c2, st(d));
};

const disjointChannel: DrawFn = (pen, [a, b, c], d) => {
  const c1 = { x: a!.x, y: c!.y };
  const c2 = { x: b!.x, y: c!.y - (b!.y - a!.y) };
  pen.poly([a!, b!, c2, c1], { ...st(d), closed: true, noStroke: true, ...fillOf(d, 0.1) });
  pen.line(a!, b!, st(d));
  pen.line(c1, c2, st(d));
};

function pitchforkFn(kind: "andrews" | "schiff" | "modified" | "inside"): DrawFn {
  return (pen, [p0, p1, p2], d, env) => {
    const m = mid(p1!, p2!);
    let o = p0!;
    if (kind === "schiff") o = { x: p0!.x, y: (p0!.y + p1!.y) / 2 };
    if (kind === "modified") o = mid(p0!, p1!);
    if (kind === "inside") o = mid(p0!, p2!);
    const dir = sub(m, o);
    const e1 = rayEnd(p1!, dir, env);
    const e2 = rayEnd(p2!, dir, env);
    pen.poly([p1!, e1, e2, p2!], { ...st(d), closed: true, noStroke: true, ...fillOf(d, 0.06) });
    pen.line(o, rayEnd(o, dir, env), st(d));
    pen.line(p1!, e1, st(d));
    pen.line(p2!, e2, st(d));
    pen.line(p1!, p2!, st(d));
    if (o !== p0) pen.line(p0!, o, guide(d));
  };
}

// ── Fibonacci ───────────────────────────────────────────────────────────────

const fibChannel: DrawFn = (pen, [a, b, c], d) => {
  const dx = b!.x - a!.x || 1e-9;
  const off = c!.y - (a!.y + ((b!.y - a!.y) / dx) * (c!.x - a!.x));
  const levels = levelsOf(d, [...FIB, 1.618]);
  let prev: [Pt, Pt] | null = null;
  levels.forEach((l, i) => {
    const p = { x: a!.x, y: a!.y + off * l };
    const q = { x: b!.x, y: b!.y + off * l };
    if (prev) pen.poly([prev[0], prev[1], q, p], { color: levelColor(i), closed: true, noStroke: true, fill: levelColor(i), fillAlpha: d.fillOpacity ?? 0.06 });
    pen.line(p, q, { color: levelColor(i), width: d.width ?? 1 });
    pen.text(String(l), { x: p.x - 4, y: p.y }, { color: levelColor(i), size: 10, align: "right", baseline: "middle" });
    prev = [p, q];
  });
};

const fibTimeZone: DrawFn = (pen, [a, b], d, env) => {
  const dx = b!.x - a!.x;
  pen.line(a!, b!, guide(d));
  [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233].forEach((n, i) => {
    if (n > 0 && Math.abs(dx) < 2) return;
    const x = a!.x + n * dx;
    if (x < -10 || x > env.width + 10) return;
    pen.line({ x, y: 0 }, { x, y: env.height }, { color: levelColor(i), width: d.width ?? 1 });
    pen.text(String(n), { x: x + 3, y: env.height - 4 }, { color: levelColor(i), size: 10, baseline: "bottom" });
  });
};

const fibSpeedFan: DrawFn = (pen, [a, b], d, env) => {
  const dx = b!.x - a!.x;
  const dy = b!.y - a!.y;
  const levels = levelsOf(d, [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]);
  pen.poly(rect(a!.x, a!.y, b!.x, b!.y), { color: d.color, width: 1, alpha: 0.4, closed: true, ...fillOf(d, 0.05) });
  levels.forEach((l, i) => {
    const color = levelColor(i);
    pen.line({ x: a!.x, y: a!.y + dy * l }, { x: b!.x, y: a!.y + dy * l }, { color, width: 1, alpha: 0.35 });
    pen.line({ x: a!.x + dx * l, y: a!.y }, { x: a!.x + dx * l, y: b!.y }, { color, width: 1, alpha: 0.35 });
    pen.line(a!, rayEnd(a!, { x: dx, y: dy * l }, env), { color, width: d.width ?? 1 });
    pen.line(a!, rayEnd(a!, { x: dx * l, y: dy }, env), { color, width: d.width ?? 1 });
    pen.text(String(l), { x: b!.x + 4, y: a!.y + dy * l }, { color, size: 10, baseline: "middle" });
  });
};

const fibTrendTime: DrawFn = (pen, [a, b, c], d, env) => {
  pen.poly([a!, b!, c!], guide(d));
  const dx = b!.x - a!.x;
  [0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.382, 2.618, 3, 3.618, 4.236].forEach((l, i) => {
    const x = c!.x + dx * l;
    if (x < -10 || x > env.width + 10) return;
    pen.line({ x, y: 0 }, { x, y: env.height }, { color: levelColor(i), width: d.width ?? 1 });
    pen.text(String(l), { x: x + 3, y: env.height - 4 }, { color: levelColor(i), size: 10, baseline: "bottom" });
  });
};

const fibCircles: DrawFn = (pen, [a, b], d) => {
  const r = len(sub(b!, a!));
  pen.line(a!, b!, guide(d));
  levelsOf(d, [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618]).forEach((l, i) => {
    if (l <= 0) return;
    pen.poly(arcPts(a!, r * l, r * l), { color: levelColor(i), width: d.width ?? 1, closed: true });
    pen.text(String(l), { x: a!.x + r * l + 2, y: a!.y }, { color: levelColor(i), size: 10, baseline: "bottom" });
  });
};

const fibSpiral: DrawFn = (pen, [a, b], d, env) => {
  const r0 = len(sub(b!, a!));
  if (r0 < 1) return;
  const a0 = Math.atan2(b!.y - a!.y, b!.x - a!.x);
  const k = Math.log(PHI) / (Math.PI / 2);
  const maxR = 3 * (env.width + env.height);
  const pts: Pt[] = [];
  for (let t = -8 * Math.PI; t <= 6 * Math.PI; t += 0.05) {
    const r = r0 * Math.exp(k * t);
    if (r < 0.5) continue;
    if (r > maxR) break;
    pts.push({ x: a!.x + r * Math.cos(a0 + t), y: a!.y + r * Math.sin(a0 + t) });
  }
  pen.line(a!, b!, guide(d));
  pen.poly(pts, st(d));
};

const fibSpeedArcs: DrawFn = (pen, [a, b], d) => {
  const R = len(sub(b!, a!));
  const base = Math.atan2(b!.y - a!.y, b!.x - a!.x);
  pen.line(a!, b!, guide(d));
  levelsOf(d, [0.236, 0.382, 0.5, 0.618, 0.786, 1]).forEach((l, i) => {
    if (l <= 0) return;
    pen.poly(arcPts(a!, R * l, R * l, base - Math.PI / 2, base + Math.PI / 2), { color: levelColor(i), width: d.width ?? 1 });
    pen.text(String(l), { x: a!.x + R * l * Math.cos(base) + 3, y: a!.y + R * l * Math.sin(base) }, { color: levelColor(i), size: 10 });
  });
};

const fibWedge: DrawFn = (pen, [o, p, q], d) => {
  const R = len(sub(p!, o!));
  const a1 = Math.atan2(p!.y - o!.y, p!.x - o!.x);
  const delta = angleDelta(a1, Math.atan2(q!.y - o!.y, q!.x - o!.x));
  pen.poly([o!, ...arcPts(o!, R, R, a1, a1 + delta)], { ...st(d), closed: true, noStroke: true, ...fillOf(d, 0.06) });
  pen.line(o!, p!, st(d));
  pen.line(o!, { x: o!.x + R * Math.cos(a1 + delta), y: o!.y + R * Math.sin(a1 + delta) }, st(d));
  levelsOf(d, [0.236, 0.382, 0.5, 0.618, 0.786, 1]).forEach((l, i) => {
    if (l <= 0) return;
    pen.poly(arcPts(o!, R * l, R * l, a1, a1 + delta), { color: levelColor(i), width: d.width ?? 1 });
  });
};

const pitchfan: DrawFn = (pen, [o, p, q], d, env) => {
  pen.line(p!, q!, st(d));
  levelsOf(d, [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]).forEach((l, i) => {
    const t = { x: p!.x + (q!.x - p!.x) * l, y: p!.y + (q!.y - p!.y) * l };
    pen.line(o!, rayEnd(o!, sub(t, o!), env), { color: levelColor(i), width: d.width ?? 1 });
  });
};

// ── Gann ────────────────────────────────────────────────────────────────────

const gannBox: DrawFn = (pen, [a, b], d) => {
  const dx = b!.x - a!.x;
  const dy = b!.y - a!.y;
  const levels = levelsOf(d, [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]);
  levels.forEach((l, i) => {
    const color = levelColor(i);
    if (i > 0) {
      const l0 = levels[i - 1]!;
      pen.poly(rect(a!.x, a!.y + dy * l0, b!.x, a!.y + dy * l), { color, closed: true, noStroke: true, fill: color, fillAlpha: d.fillOpacity ?? 0.05 });
    }
    pen.line({ x: a!.x + dx * l, y: a!.y }, { x: a!.x + dx * l, y: b!.y }, { color, width: d.width ?? 1 });
    pen.line({ x: a!.x, y: a!.y + dy * l }, { x: b!.x, y: a!.y + dy * l }, { color, width: d.width ?? 1 });
    pen.text(String(l), { x: a!.x + dx * l, y: Math.min(a!.y, b!.y) - 3 }, { color, size: 10, align: "center", baseline: "bottom" });
    pen.text(String(l), { x: Math.min(a!.x, b!.x) - 4, y: a!.y + dy * l }, { color, size: 10, align: "right", baseline: "middle" });
  });
  pen.line(a!, b!, guide(d));
  pen.line({ x: a!.x, y: b!.y }, { x: b!.x, y: a!.y }, guide(d));
};

const gannSquareFixed: DrawFn = (pen, [a, b], d) => {
  const s = Math.abs(b!.x - a!.x) || 1;
  const sx = Math.sign(b!.x - a!.x) || 1;
  const sy = Math.sign(b!.y - a!.y) || 1;
  const c = { x: a!.x + sx * s, y: a!.y + sy * s };
  for (let k = 0; k <= 4; k++) {
    const color = levelColor(k);
    pen.line({ x: a!.x + (sx * s * k) / 4, y: a!.y }, { x: a!.x + (sx * s * k) / 4, y: c.y }, { color, width: 1 });
    pen.line({ x: a!.x, y: a!.y + (sy * s * k) / 4 }, { x: c.x, y: a!.y + (sy * s * k) / 4 }, { color, width: 1 });
    if (k > 0) {
      const start = sx > 0 ? (sy > 0 ? 0 : -Math.PI / 2) : sy > 0 ? Math.PI / 2 : Math.PI;
      pen.poly(arcPts(a!, (s * k) / 4, (s * k) / 4, start, start + Math.PI / 2), { color, width: 1, alpha: 0.7 });
    }
  }
  pen.line(a!, c, st(d));
  pen.line({ x: a!.x, y: c.y }, { x: c.x, y: a!.y }, st(d));
};

const gannSquare: DrawFn = (pen, [a, b], d) => {
  const dx = b!.x - a!.x;
  const dy = b!.y - a!.y;
  pen.poly(rect(a!.x, a!.y, b!.x, b!.y), { ...st(d), closed: true });
  for (let k = 1; k < 4; k++) {
    pen.line({ x: a!.x + (dx * k) / 4, y: a!.y }, { x: a!.x + (dx * k) / 4, y: b!.y }, { color: d.color, width: 1, alpha: 0.35 });
    pen.line({ x: a!.x, y: a!.y + (dy * k) / 4 }, { x: b!.x, y: a!.y + (dy * k) / 4 }, { color: d.color, width: 1, alpha: 0.35 });
  }
  for (let k = 1; k <= 4; k++) {
    pen.line(a!, { x: b!.x, y: a!.y + (dy * k) / 4 }, { color: levelColor(k), width: 1 });
    pen.line(a!, { x: a!.x + (dx * k) / 4, y: b!.y }, { color: levelColor(k + 4), width: 1 });
  }
  pen.line({ x: a!.x, y: b!.y }, { x: b!.x, y: a!.y }, guide(d));
};

const gannFan: DrawFn = (pen, [a, b], d, env) => {
  const dx = b!.x - a!.x;
  const dy = b!.y - a!.y;
  const ratios: Array<[number, number]> = [[1, 8], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [3, 1], [4, 1], [8, 1]];
  ratios.forEach(([pr, tm], i) => {
    const color = levelColor(i);
    pen.line(a!, rayEnd(a!, { x: dx * tm, y: dy * pr }, env), { color, width: d.width ?? 1 });
    const m = Math.max(pr, tm);
    pen.text(`${pr}x${tm}`, { x: a!.x + (dx * tm) / m + 3, y: a!.y + (dy * pr) / m }, { color, size: 10, baseline: "middle" });
  });
};

// ── Chart patterns and Elliott waves ───────────────────────────────────────

/** Point i is a local high on screen (smaller y than its neighbours). */
function isHigh(P: Pt[], i: number): boolean {
  const ys = [P[i - 1]?.y, P[i + 1]?.y].filter((y): y is number => y !== undefined);
  return ys.length === 0 ? true : ys.every((y) => P[i]!.y <= y);
}

function pointLabel(pen: Pen, P: Pt[], i: number, text: string, d: DrawingLine): void {
  if (!text || !P[i]) return;
  const high = isHigh(P, i);
  pen.text(text, { x: P[i]!.x, y: P[i]!.y + (high ? -6 : 6) }, {
    ...textStyle(d),
    size: d.fontSize ?? 11,
    bold: true,
    bg: d.color,
    align: "center",
    baseline: high ? "bottom" : "top",
  });
}

function ratioLabel(pen: Pen, a: Pt, b: Pt, value: number, d: DrawingLine): void {
  if (!Number.isFinite(value)) return;
  pen.line(a, b, guide(d));
  pen.text(value.toFixed(3), mid(a, b), { color: d.color, size: 10, align: "center", baseline: "middle" });
}

function priceRatio(env: ProEnv, i: number, j: number, k: number, l: number): number {
  const p = env.data;
  const den = Math.abs(p[l]!.price - p[k]!.price);
  return den > 0 ? Math.abs(p[j]!.price - p[i]!.price) / den : Number.NaN;
}

function harmonicFn(kind: "xabcd" | "cypher"): DrawFn {
  return (pen, P, d, env) => {
    const fill = { ...st(d), closed: true, noStroke: true, ...fillOf(d, 0.15) };
    if (P.length >= 3) pen.poly([P[0]!, P[1]!, P[2]!], fill);
    if (P.length >= 5) pen.poly([P[2]!, P[3]!, P[4]!], fill);
    pen.poly(P, st(d, { width: d.width ?? 2 }));
    if (P.length >= 3) ratioLabel(pen, P[0]!, P[2]!, priceRatio(env, 1, 2, 0, 1), d);
    if (kind === "xabcd") {
      if (P.length >= 4) ratioLabel(pen, P[1]!, P[3]!, priceRatio(env, 2, 3, 1, 2), d);
      if (P.length >= 5) {
        ratioLabel(pen, P[2]!, P[4]!, priceRatio(env, 3, 4, 2, 3), d);
        ratioLabel(pen, P[0]!, P[4]!, priceRatio(env, 1, 4, 0, 1), d);
      }
    } else {
      if (P.length >= 4) ratioLabel(pen, P[0]!, P[3]!, priceRatio(env, 0, 3, 0, 1), d);
      if (P.length >= 5) ratioLabel(pen, P[1]!, P[4]!, priceRatio(env, 3, 4, 0, 3), d);
    }
    ["X", "A", "B", "C", "D"].forEach((t, i) => pointLabel(pen, P, i, t, d));
  };
}

const abcd: DrawFn = (pen, P, d, env) => {
  pen.poly(P, st(d, { width: d.width ?? 2 }));
  if (P.length >= 3) ratioLabel(pen, P[0]!, P[2]!, priceRatio(env, 1, 2, 0, 1), d);
  if (P.length >= 4) ratioLabel(pen, P[1]!, P[3]!, priceRatio(env, 2, 3, 1, 2), d);
  ["A", "B", "C", "D"].forEach((t, i) => pointLabel(pen, P, i, t, d));
};

const headShoulders: DrawFn = (pen, P, d) => {
  if (P.length >= 3) pen.poly(P, { ...st(d), closed: true, noStroke: true, ...fillOf(d, 0.12) });
  pen.poly(P, st(d, { width: d.width ?? 2 }));
  if (P.length >= 5) {
    const n1 = P[2]!;
    const n2 = P[4]!;
    const slope = (n2.y - n1.y) / (n2.x - n1.x || 1e-9);
    const x0 = P[0]!.x;
    const x1 = P[P.length - 1]!.x;
    pen.line({ x: x0, y: n1.y + slope * (x0 - n1.x) }, { x: x1, y: n1.y + slope * (x1 - n1.x) }, st(d, { dash: [6, 4] }));
  }
  pointLabel(pen, P, 1, "Left Shoulder", d);
  pointLabel(pen, P, 3, "Head", d);
  pointLabel(pen, P, 5, "Right Shoulder", d);
};

/** Where lines a→b and c→d cross, or null when parallel. */
function intersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

const trianglePattern: DrawFn = (pen, P, d, env) => {
  pen.poly(P, st(d, { width: d.width ?? 2 }));
  if (P.length >= 4) {
    const [A, B, C, D] = P as [Pt, Pt, Pt, Pt];
    const apex = intersect(A, C, B, D);
    if (apex && apex.x > Math.max(C.x, D.x)) {
      pen.poly([A, apex, B], { ...st(d), closed: true, noStroke: true, ...fillOf(d, 0.12) });
      pen.line(A, apex, st(d, { dash: [6, 4] }));
      pen.line(B, apex, st(d, { dash: [6, 4] }));
    } else {
      pen.line(A, rayEnd(A, sub(C, A), env), st(d, { dash: [6, 4] }));
      pen.line(B, rayEnd(B, sub(D, B), env), st(d, { dash: [6, 4] }));
    }
  }
  ["A", "B", "C", "D"].forEach((t, i) => pointLabel(pen, P, i, t, d));
};

const threeDrives: DrawFn = (pen, P, d) => {
  pen.poly(P, st(d, { width: d.width ?? 2 }));
  ["", "1", "A", "2", "B", "3", ""].forEach((t, i) => pointLabel(pen, P, i, t, d));
};

function wavesFn(labels: string[]): DrawFn {
  return (pen, P, d) => {
    pen.poly(P, st(d, { width: d.width ?? 2 }));
    labels.forEach((t, i) => pointLabel(pen, P, i, t ? `(${t})` : "", d));
  };
}

// ── Cycles ──────────────────────────────────────────────────────────────────

const cyclicLines: DrawFn = (pen, [a, b], d, env) => {
  const step = b!.x - a!.x;
  for (let k = 0; k < 500; k++) {
    const x = a!.x + k * step;
    if (x < -1 || x > env.width + 1 || (k > 0 && Math.abs(step) < 3)) break;
    pen.line({ x, y: 0 }, { x, y: env.height }, st(d));
  }
};

const timeCycles: DrawFn = (pen, [a, b], d, env) => {
  const step = b!.x - a!.x;
  const r = Math.abs(step) / 2;
  const ry = Math.abs(b!.y - a!.y) || r;
  pen.line({ x: -10, y: a!.y }, { x: env.width + 10, y: a!.y }, guide(d));
  for (let k = 0; k < 300; k++) {
    const cx = a!.x + k * step + step / 2;
    if (cx - r > env.width || cx + r < 0 || r < 2) break;
    pen.poly(arcPts({ x: cx, y: a!.y }, r, ry, Math.PI, Math.PI * 2, 36), st(d));
  }
};

const sineLine: DrawFn = (pen, [a, b], d, env) => {
  const half = b!.x - a!.x;
  if (Math.abs(half) < 2) {
    pen.line(a!, b!, st(d));
    return;
  }
  const amp = (b!.y - a!.y) / 2;
  const yc = (a!.y + b!.y) / 2;
  const pts: Pt[] = [];
  for (let x = -5; x <= env.width + 5; x += 3) {
    pts.push({ x, y: yc - amp * Math.cos((Math.PI * (x - a!.x)) / half) });
  }
  pen.poly(pts, st(d));
};

// ── Forecasting ─────────────────────────────────────────────────────────────

const positionForecast: DrawFn = (pen, [a, b], d, env) => {
  const s = moveStats(env);
  const color = s && s.dp < 0 ? DOWN : UP;
  pen.line(a!, b!, { color, width: d.width ?? 2 });
  arrowHead(pen, a!, b!, { color, width: 2 });
  dot(pen, a!, 3, color);
  if (!s) return;
  const text = `${sign(s.dp)}${env.fmt(Math.abs(s.dp))} (${s.pct.toFixed(2)}%)\n${s.bars} bars · ${dateText(env.data[1]!.time)}`;
  pen.text(text, { x: b!.x + 8, y: b!.y }, { ...textStyle(d), size: 11, bg: color, baseline: "middle" });
};

function drawCandles(pen: Pen, bars: Array<[number, number, number, number, number]>, env: ProEnv, color: string): void {
  const t0 = bars[0]?.[0] ?? 0;
  const w = Math.max(1, ((env.timeToX(t0 + env.intervalSec) ?? 0) - (env.timeToX(t0) ?? 0)) * 0.6);
  for (const [t, o, h, l, c] of bars) {
    const x = env.timeToX(t);
    const [yo, yh, yl, yc] = [o, h, l, c].map(env.priceToY);
    if (x === null || yo == null || yh == null || yl == null || yc == null) continue;
    pen.line({ x, y: yh }, { x, y: yl }, { color, width: 1, alpha: 0.8 });
    const top = Math.min(yo, yc);
    const bot = Math.max(yo, yc, top + 1);
    pen.poly(rect(x - w / 2, top, x + w / 2, bot), {
      color,
      width: 1,
      alpha: 0.8,
      closed: true,
      fill: color,
      fillAlpha: c < o ? 0.6 : 0.15,
    });
  }
}

const barsPattern: DrawFn = (pen, P, d, env) => {
  const pattern = d.pattern;
  if (!pattern?.length) {
    // Still choosing the source range.
    const [a, b] = P;
    if (a && b) pen.poly(rect(a.x, 0, b.x, env.height), { color: d.color, width: 1, alpha: 0.5, closed: true, fill: d.color, fillAlpha: 0.08 });
    return;
  }
  const { time, price } = env.data[0]!;
  const bars = pattern.map(([dt, o, h, l, c]) => [time + dt!, price + o!, price + h!, price + l!, price + c!] as [number, number, number, number, number]);
  drawCandles(pen, bars, env, d.color);
};

/** Deterministic 0..1 noise so ghost candles stay the same between frames. */
const noise = (i: number, k: number) => {
  const v = Math.sin(i * 78.233 + k * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

const ghostFeed: DrawFn = (pen, P, d, env) => {
  const pts = env.data;
  const step = env.intervalSec;
  if (pts.length < 2 || step <= 0) {
    pen.poly(P, guide(d));
    return;
  }
  const lo = Math.min(...pts.map((p) => p.price));
  const hi = Math.max(...pts.map((p) => p.price));
  const scale = (hi - lo) * 0.04 || Math.abs(hi) * 0.001;
  const bars: Array<[number, number, number, number, number]> = [];
  let prev = pts[0]!.price;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.floor((b.time - a.time) / step);
    for (let k = 1; k <= Math.min(n, 2000); k++) {
      const close = a.price + ((b.price - a.price) * k) / n + (noise(i, k) - 0.5) * scale;
      const open = prev;
      const wick = Math.abs(close - open) * 0.5 + scale * 0.3;
      bars.push([a.time + k * step, open, Math.max(open, close) + wick * noise(k, i), Math.min(open, close) - wick * noise(i + 7, k), close]);
      prev = close;
    }
  }
  if (env.active) pen.poly(P, guide(d));
  drawCandles(pen, bars, env, d.color);
};

const sector: DrawFn = (pen, [o, p, q], d) => {
  const R = len(sub(p!, o!));
  const a1 = Math.atan2(p!.y - o!.y, p!.x - o!.x);
  const delta = angleDelta(a1, Math.atan2(q!.y - o!.y, q!.x - o!.x));
  pen.poly([o!, ...arcPts(o!, R, R, a1, a1 + delta)], { ...st(d), closed: true, ...fillOf(d, 0.15) });
};

// ── Volume-based ───────────────────────────────────────────────────────────

const anchoredVwap: DrawFn = (pen, [a], d, env) => {
  const t0 = env.data[0]!.time;
  let pv = 0;
  let vol = 0;
  const pts: Pt[] = [];
  for (const b of env.bars()) {
    if (b.time < t0) continue;
    const v = b.volume > 0 ? b.volume : 1;
    pv += ((b.high + b.low + b.close) / 3) * v;
    vol += v;
    const x = env.timeToX(b.time);
    const y = env.priceToY(pv / vol);
    if (x !== null && y !== null) pts.push({ x, y });
  }
  if (pts.length === 0) {
    dot(pen, a!, 3, d.color);
    return;
  }
  pen.poly(pts, st(d, { width: d.width ?? 2 }));
  const last = pts[pts.length - 1]!;
  pen.text("VWAP", { x: last.x + 4, y: last.y }, { color: d.color, size: 10, baseline: "middle" });
};

function volumeProfile(pen: Pen, d: DrawingLine, env: ProEnv, t0: number, t1: number, xLeft: number, xRight: number): void {
  const bars = barsBetween(env, t0, t1);
  if (bars.length === 0) return;
  const lo = Math.min(...bars.map((b) => b.low));
  const hi = Math.max(...bars.map((b) => b.high));
  const rows = 24;
  const h = (hi - lo) / rows || 1;
  const up = new Array<number>(rows).fill(0);
  const down = new Array<number>(rows).fill(0);
  for (const b of bars) {
    const i0 = Math.min(rows - 1, Math.max(0, Math.floor((b.low - lo) / h)));
    const i1 = Math.min(rows - 1, Math.max(0, Math.floor((b.high - lo) / h)));
    const share = (b.volume || 0) / (i1 - i0 + 1);
    for (let i = i0; i <= i1; i++) (b.close >= b.open ? up : down)[i]! += share;
  }
  const total = up.map((u, i) => u + down[i]!);
  const max = Math.max(...total);
  if (max <= 0) return;
  const poc = total.indexOf(max);
  // Value area: grow outward from the point of control until 70% of the volume is inside.
  const sum = total.reduce((s, v) => s + v, 0);
  let vaLo = poc;
  let vaHi = poc;
  let inside = max;
  while (inside < sum * 0.7 && (vaLo > 0 || vaHi < rows - 1)) {
    const below = vaLo > 0 ? total[vaLo - 1]! : -1;
    const above = vaHi < rows - 1 ? total[vaHi + 1]! : -1;
    if (above >= below) inside += total[++vaHi]!;
    else inside += total[--vaLo]!;
  }
  const widthMax = Math.max(60, (xRight - xLeft) * 0.3);
  for (let i = 0; i < rows; i++) {
    const yTop = env.priceToY(lo + (i + 1) * h);
    const yBot = env.priceToY(lo + i * h);
    if (yTop === null || yBot === null) continue;
    const alpha = i >= vaLo && i <= vaHi ? 0.7 : 0.3;
    const wu = (up[i]! / max) * widthMax;
    const wd = (down[i]! / max) * widthMax;
    const top = yTop + 0.5;
    const bot = Math.max(top + 1, yBot - 0.5);
    if (wu > 0) pen.poly(rect(xLeft, top, xLeft + wu, bot), { color: "#2962ff", closed: true, noStroke: true, fill: "#2962ff", fillAlpha: alpha });
    if (wd > 0) pen.poly(rect(xLeft + wu, top, xLeft + wu + wd, bot), { color: "#fbc02d", closed: true, noStroke: true, fill: "#fbc02d", fillAlpha: alpha });
  }
  const yPoc = env.priceToY(lo + (poc + 0.5) * h);
  if (yPoc !== null) pen.line({ x: xLeft, y: yPoc }, { x: xRight, y: yPoc }, { color: DOWN, width: 1 });
  const yHi = env.priceToY(hi);
  const yLo = env.priceToY(lo);
  if (yHi !== null && yLo !== null) pen.poly(rect(xLeft, yHi, xRight, yLo), { color: d.color, width: 1, alpha: 0.5, dash: [4, 4], closed: true });
}

const fixedRangeProfile: DrawFn = (pen, [a, b], d, env) => {
  volumeProfile(pen, d, env, env.data[0]!.time, env.data[1]!.time, Math.min(a!.x, b!.x), Math.max(a!.x, b!.x));
};

const anchoredProfile: DrawFn = (pen, [a], d, env) => {
  const bars = env.bars();
  const last = bars[bars.length - 1];
  const xRight = last ? (env.timeToX(last.time) ?? env.width) : env.width;
  volumeProfile(pen, d, env, env.data[0]!.time, Number.POSITIVE_INFINITY, a!.x, Math.max(xRight, a!.x + 60));
};

// ── Measurers ───────────────────────────────────────────────────────────────

function measureFn(kind: "price" | "date" | "both"): DrawFn {
  return (pen, [a, b], d, env) => {
    const s = moveStats(env);
    const color = kind === "both" && s ? (s.dp >= 0 ? "#2962ff" : DOWN) : d.color;
    const [x0, x1] = [Math.min(a!.x, b!.x), Math.max(a!.x, b!.x)];
    const [y0, y1] = [Math.min(a!.y, b!.y), Math.max(a!.y, b!.y)];
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const line = { color, width: 1 };
    pen.poly(rect(x0, y0, x1, y1), { color, closed: true, noStroke: true, fill: d.fillColor ?? color, fillAlpha: d.fillOpacity ?? 0.15 });
    if (kind !== "date") {
      pen.line({ x: mx, y: a!.y }, { x: mx, y: b!.y }, line);
      arrowHead(pen, { x: mx, y: a!.y }, { x: mx, y: b!.y }, line, 7);
      if (kind === "price") {
        pen.line({ x: x0, y: a!.y }, { x: x1, y: a!.y }, line);
        pen.line({ x: x0, y: b!.y }, { x: x1, y: b!.y }, line);
      }
    }
    if (kind !== "price") {
      pen.line({ x: a!.x, y: my }, { x: b!.x, y: my }, line);
      arrowHead(pen, { x: a!.x, y: my }, { x: b!.x, y: my }, line, 7);
      if (kind === "date") {
        pen.line({ x: a!.x, y: y0 }, { x: a!.x, y: y1 }, line);
        pen.line({ x: b!.x, y: y0 }, { x: b!.x, y: y1 }, line);
      }
    }
    if (!s) return;
    const lines: string[] = [];
    if (kind !== "date") lines.push(priceChangeText(env));
    if (kind !== "price") {
      const vol = barsBetween(env, env.data[0]!.time, env.data[1]!.time).reduce((sum, x) => sum + x.volume, 0);
      lines.push(`${s.bars} bars, ${s.span < 0 ? "−" : ""}${spanText(s.span)}`);
      if (vol > 0) lines.push(`Vol ${compactNumber(vol)}`);
    }
    const below = b!.y >= a!.y;
    pen.text(lines.join("\n"), { x: mx, y: below ? y1 + 6 : y0 - 6 }, {
      ...textStyle(d),
      size: 11,
      bg: color,
      align: "center",
      baseline: below ? "top" : "bottom",
      pad: 6,
    });
  };
}

// ── Brushes, arrows and shapes ─────────────────────────────────────────────

const brush: DrawFn = (pen, P, d) => pen.poly(P, st(d, { width: d.width ?? 2 }));
const highlighter: DrawFn = (pen, P, d) => pen.poly(P, { color: d.color, width: d.width ?? 14, alpha: 0.35 });

const arrowMarker: DrawFn = (pen, [a, b], d) => {
  const L = len(sub(b!, a!));
  if (L < 2) return;
  const u = { x: (b!.x - a!.x) / L, y: (b!.y - a!.y) / L };
  const n = { x: -u.y, y: u.x };
  const head = Math.min(L * 0.45, 22);
  const at = (base: Pt, w: number): Pt => ({ x: base.x + n.x * w, y: base.y + n.y * w });
  const base = { x: b!.x - u.x * head, y: b!.y - u.y * head };
  pen.poly([at(a!, 4), at(base, 4), at(base, 11), b!, at(base, -11), at(base, -4), at(a!, -4)], {
    ...st(d),
    closed: true,
    ...fillOf(d, 1),
  });
};

function arrowMarkFn(up: boolean): DrawFn {
  return (pen, [a], d) => {
    const dir = up ? 1 : -1;
    const tip = { x: a!.x, y: a!.y + 4 * dir };
    const y = (v: number) => tip.y + v * dir;
    pen.poly(
      [tip, { x: tip.x + 9, y: y(10) }, { x: tip.x + 4, y: y(10) }, { x: tip.x + 4, y: y(22) }, { x: tip.x - 4, y: y(22) }, { x: tip.x - 4, y: y(10) }, { x: tip.x - 9, y: y(10) }],
      { color: d.color, closed: true, fill: d.color, fillAlpha: 1 },
    );
    if (d.text) pen.text(d.text, { x: a!.x, y: y(26) }, { ...textStyle(d, d.color), align: "center", baseline: up ? "top" : "bottom" });
  };
}

const rotatedRectangle: DrawFn = (pen, [a, b, c], d) => {
  const L = len(sub(b!, a!));
  if (L < 1) return;
  const n = { x: -(b!.y - a!.y) / L, y: (b!.x - a!.x) / L };
  const w = (c!.x - a!.x) * n.x + (c!.y - a!.y) * n.y;
  pen.poly([a!, b!, { x: b!.x + n.x * w, y: b!.y + n.y * w }, { x: a!.x + n.x * w, y: a!.y + n.y * w }], {
    ...st(d),
    closed: true,
    ...fillOf(d, 0.15),
  });
};

const path: DrawFn = (pen, P, d) => {
  pen.poly(P, st(d, { width: d.width ?? 2 }));
  if (P.length >= 2) arrowHead(pen, P[P.length - 2]!, P[P.length - 1]!, st(d, { width: d.width ?? 2, dash: undefined }));
};

const circle: DrawFn = (pen, [a, b], d) => {
  const r = len(sub(b!, a!));
  pen.poly(arcPts(a!, r, r), { ...st(d), closed: true, ...fillOf(d, 0.15) });
};

const polyline: DrawFn = (pen, P, d) => {
  pen.poly(P, d.closed ? { ...st(d), closed: true, ...fillOf(d, 0.15) } : st(d));
};

const triangle3: DrawFn = (pen, P, d) => pen.poly(P, { ...st(d), closed: true, ...fillOf(d, 0.15) });

const arc: DrawFn = (pen, [a, b, c], d) => {
  const den = 2 * (a!.x * (b!.y - c!.y) + b!.x * (c!.y - a!.y) + c!.x * (a!.y - b!.y));
  if (Math.abs(den) < 1e-6) {
    pen.poly([a!, c!, b!], st(d));
    return;
  }
  const sq = (p: Pt) => p.x * p.x + p.y * p.y;
  const o = {
    x: (sq(a!) * (b!.y - c!.y) + sq(b!) * (c!.y - a!.y) + sq(c!) * (a!.y - b!.y)) / den,
    y: (sq(a!) * (c!.x - b!.x) + sq(b!) * (a!.x - c!.x) + sq(c!) * (b!.x - a!.x)) / den,
  };
  const r = len(sub(a!, o));
  const ang = (p: Pt) => Math.atan2(p.y - o.y, p.x - o.x);
  const tau = Math.PI * 2;
  const norm = (v: number) => ((v % tau) + tau) % tau;
  const A = ang(a!);
  const ccw = norm(ang(b!) - A);
  // Sweep from a to b the way that passes through c.
  const sweep = norm(ang(c!) - A) <= ccw ? ccw : ccw - tau;
  pen.poly(arcPts(o, r, r, A, A + sweep), { ...st(d), closed: true, ...fillOf(d, 0.15) });
};

function bezier(p0: Pt, c1: Pt, c2: Pt, p1: Pt, n = 48): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    });
  }
  return out;
}

const curve: DrawFn = (pen, [a, b, c], d, env) => {
  // Quadratic through control c, as a cubic.
  const c1 = { x: a!.x + (2 / 3) * (c!.x - a!.x), y: a!.y + (2 / 3) * (c!.y - a!.y) };
  const c2 = { x: b!.x + (2 / 3) * (c!.x - b!.x), y: b!.y + (2 / 3) * (c!.y - b!.y) };
  pen.poly(bezier(a!, c1, c2, b!), st(d, { width: d.width ?? 2 }));
  if (env.active) pen.poly([a!, c!, b!], guide(d));
};

const doubleCurve: DrawFn = (pen, [a, b], d) => {
  const mx = (a!.x + b!.x) / 2;
  pen.poly(bezier(a!, { x: mx, y: a!.y }, { x: mx, y: b!.y }, b!), st(d, { width: d.width ?? 2 }));
};

// ── Text and notes ──────────────────────────────────────────────────────────

const note: DrawFn = (pen, [a], d) => {
  pen.poly(rect(a!.x - 6, a!.y - 6, a!.x + 6, a!.y + 6), { color: d.color, closed: true, fill: d.color, fillAlpha: 1 });
  pen.line({ x: a!.x - 3, y: a!.y - 2 }, { x: a!.x + 3, y: a!.y - 2 }, { color: "#ffffff", width: 1 });
  pen.line({ x: a!.x - 3, y: a!.y + 1 }, { x: a!.x + 3, y: a!.y + 1 }, { color: "#ffffff", width: 1 });
  pen.text(d.text ?? "Note", { x: a!.x + 10, y: a!.y - 10 }, { ...textStyle(d), bg: d.textBgColor ?? d.color, bgAlpha: 0.92, baseline: "bottom", pad: 6 });
};

const priceNote: DrawFn = (pen, [a, b], d, env) => {
  pen.line(a!, b!, st(d));
  dot(pen, a!, 3, d.color);
  pen.text(env.fmt(env.data[0]!.price), { x: b!.x + 4, y: b!.y }, { ...textStyle(d), size: 11, bg: d.color, baseline: "middle" });
};

const pin: DrawFn = (pen, [a], d, env) => {
  const head = { x: a!.x, y: a!.y - 18 };
  pen.poly([{ x: a!.x - 5, y: a!.y - 14 }, a!, { x: a!.x + 5, y: a!.y - 14 }], { color: d.color, closed: true, fill: d.color, fillAlpha: 1 });
  dot(pen, head, 7, d.color);
  dot(pen, head, 2.5, "#ffffff");
  if (env.active && d.text) pen.text(d.text, { x: a!.x, y: a!.y - 30 }, { ...textStyle(d), bg: d.textBgColor ?? d.color, align: "center", baseline: "bottom", pad: 6 });
};

const table: DrawFn = (pen, [a], d) => {
  const rows = (d.text ?? "").split("\n").map((r) => r.split("|"));
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const size = d.fontSize ?? 12;
  const colW = Array.from({ length: cols }, (_, j) => Math.max(40, ...rows.map((r) => (r[j] ?? "").length * size * 0.6 + 14)));
  const rowH = size * 1.25 + 10;
  let y = a!.y;
  rows.forEach((r, i) => {
    let x = a!.x;
    for (let j = 0; j < cols; j++) {
      const header = i === 0;
      pen.poly(rect(x, y, x + colW[j]!, y + rowH), {
        color: d.color,
        width: 1,
        closed: true,
        fill: header ? d.color : (d.textBgColor ?? "#1e222d"),
        fillAlpha: header ? 0.9 : 0.85,
      });
      pen.text(r[j] ?? "", { x: x + 7, y: y + 5 }, { ...textStyle(d, header ? "#ffffff" : "#d1d4dc"), bold: header || d.bold });
      x += colW[j]!;
    }
    y += rowH;
  });
};

const callout: DrawFn = (pen, [a, b], d) => {
  const v = sub(a!, b!);
  const l = len(v) || 1;
  const n = { x: (-v.y / l) * 8, y: (v.x / l) * 8 };
  const bg = d.textBgColor ?? d.color;
  pen.poly([{ x: b!.x + n.x, y: b!.y + n.y }, a!, { x: b!.x - n.x, y: b!.y - n.y }], { color: bg, closed: true, fill: bg, fillAlpha: 1 });
  pen.text(d.text ?? "Callout", b!, { ...textStyle(d), bg, align: "center", baseline: "middle", pad: 8 });
};

const comment: DrawFn = (pen, [a], d) => {
  const bg = d.textBgColor ?? d.color;
  pen.poly([a!, { x: a!.x + 4, y: a!.y - 14 }, { x: a!.x + 16, y: a!.y - 14 }], { color: bg, closed: true, fill: bg, fillAlpha: 1 });
  pen.text(d.text ?? "Comment", { x: a!.x, y: a!.y - 13 }, { ...textStyle(d), bg, baseline: "bottom", pad: 7 });
};

const priceLabel: DrawFn = (pen, [a], d, env) => {
  pen.poly([a!, { x: a!.x + 10, y: a!.y - 13 }, { x: a!.x + 20, y: a!.y - 13 }], { color: d.color, closed: true, fill: d.color, fillAlpha: 1 });
  pen.text(env.fmt(env.data[0]!.price), { x: a!.x + 6, y: a!.y - 12 }, { ...textStyle(d), size: 11, bg: d.color, baseline: "bottom", pad: 5 });
};

const signpost: DrawFn = (pen, [a], d) => {
  pen.line(a!, { x: a!.x, y: a!.y - 40 }, { color: d.color, width: 2 });
  dot(pen, a!, 3, d.color);
  pen.text(d.text ?? "Signpost", { x: a!.x, y: a!.y - 40 }, { ...textStyle(d), bg: d.textBgColor ?? d.color, align: "center", baseline: "bottom", pad: 6 });
};

const flagMark: DrawFn = (pen, [a], d) => {
  pen.line(a!, { x: a!.x, y: a!.y - 26 }, { color: d.color, width: 2 });
  pen.poly([{ x: a!.x, y: a!.y - 26 }, { x: a!.x + 17, y: a!.y - 21 }, { x: a!.x, y: a!.y - 15 }], { color: d.color, closed: true, fill: d.color, fillAlpha: 1 });
};

const zoom: DrawFn = (pen, [a, b]) => {
  pen.poly(rect(a!.x, a!.y, b!.x, b!.y), { color: "#787b86", width: 1, dash: [4, 4], closed: true, fill: "#787b86", fillAlpha: 0.12 });
};

export const DRAW: Record<ProToolId, DrawFn> = {
  "info-line": infoLine,
  "trend-angle": trendAngle,
  "horizontal-ray": horizontalRay,
  crossline,
  "regression-trend": regressionTrend,
  "flat-top-bottom": flatTopBottom,
  "disjoint-channel": disjointChannel,
  pitchfork: pitchforkFn("andrews"),
  "schiff-pitchfork": pitchforkFn("schiff"),
  "modified-schiff-pitchfork": pitchforkFn("modified"),
  "inside-pitchfork": pitchforkFn("inside"),
  "fib-channel": fibChannel,
  "fib-time-zone": fibTimeZone,
  "fib-speed-fan": fibSpeedFan,
  "fib-trend-time": fibTrendTime,
  "fib-circles": fibCircles,
  "fib-spiral": fibSpiral,
  "fib-speed-arcs": fibSpeedArcs,
  "fib-wedge": fibWedge,
  pitchfan,
  "gann-box": gannBox,
  "gann-square-fixed": gannSquareFixed,
  "gann-square": gannSquare,
  "gann-fan": gannFan,
  xabcd: harmonicFn("xabcd"),
  cypher: harmonicFn("cypher"),
  "head-shoulders": headShoulders,
  abcd,
  "triangle-pattern": trianglePattern,
  "three-drives": threeDrives,
  "elliott-impulse": wavesFn(["", "1", "2", "3", "4", "5"]),
  "elliott-correction": wavesFn(["", "A", "B", "C"]),
  "elliott-triangle": wavesFn(["", "A", "B", "C", "D", "E"]),
  "elliott-double-combo": wavesFn(["", "W", "X", "Y"]),
  "elliott-triple-combo": wavesFn(["", "W", "X", "Y", "X", "Z"]),
  "cyclic-lines": cyclicLines,
  "time-cycles": timeCycles,
  "sine-line": sineLine,
  "position-forecast": positionForecast,
  "bars-pattern": barsPattern,
  "ghost-feed": ghostFeed,
  sector,
  "anchored-vwap": anchoredVwap,
  "fixed-range-volume-profile": fixedRangeProfile,
  "anchored-volume-profile": anchoredProfile,
  "price-range": measureFn("price"),
  "date-range": measureFn("date"),
  "date-price-range": measureFn("both"),
  brush,
  highlighter,
  "arrow-marker": arrowMarker,
  "arrow-mark-up": arrowMarkFn(true),
  "arrow-mark-down": arrowMarkFn(false),
  "rotated-rectangle": rotatedRectangle,
  path,
  circle,
  polyline,
  triangle3,
  arc,
  curve,
  "double-curve": doubleCurve,
  note,
  "price-note": priceNote,
  pin,
  table,
  callout,
  comment,
  "price-label": priceLabel,
  signpost,
  "flag-mark": flagMark,
  zoom,
};
