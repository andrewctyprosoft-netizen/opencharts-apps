// OpenCharts Desktop patch: a tiny drawing API in media (CSS) pixels. The same tool code draws
// onto the chart canvas (CanvasPen) and, for hit-testing, into a RecordPen that keeps the shapes.

import { distToSegment, type Pt } from "../geometry";

export type { Pt };

export interface Stroke {
  color: string;
  width?: number;
  dash?: readonly number[];
  alpha?: number;
}

export interface PolyStyle extends Stroke {
  closed?: boolean;
  fill?: string;
  fillAlpha?: number;
  /** Fill only. */
  noStroke?: boolean;
}

export interface TextOpts {
  color: string;
  size?: number;
  align?: "left" | "center" | "right";
  baseline?: "top" | "middle" | "bottom";
  bold?: boolean;
  italic?: boolean;
  bg?: string;
  bgAlpha?: number;
  border?: string;
  pad?: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pen {
  line(a: Pt, b: Pt, s: Stroke): void;
  poly(pts: readonly Pt[], s: PolyStyle): void;
  /** Draws (multi-line) text and returns its box. */
  text(t: string, at: Pt, o: TextOpts): Box;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
const LINE_HEIGHT = 1.25;

function fontOf(o: TextOpts): string {
  return `${o.italic ? "italic " : ""}${o.bold ? "bold " : ""}${o.size ?? 12}px ${FONT}`;
}

/** Box of a text block given its widest line width. */
function layout(lines: string[], widest: number, at: Pt, o: TextOpts): Box {
  const size = o.size ?? 12;
  const pad = o.pad ?? (o.bg || o.border ? 4 : 0);
  const w = widest + pad * 2;
  const h = lines.length * size * LINE_HEIGHT + pad * 2;
  const x = o.align === "center" ? at.x - w / 2 : o.align === "right" ? at.x - w : at.x;
  const y = o.baseline === "middle" ? at.y - h / 2 : o.baseline === "bottom" ? at.y - h : at.y;
  return { x, y, w, h };
}

export class CanvasPen implements Pen {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  private applyStroke(s: Stroke): void {
    const c = this.ctx;
    c.strokeStyle = s.color;
    c.globalAlpha = s.alpha ?? 1;
    c.lineWidth = s.width ?? 1;
    c.lineJoin = "round";
    c.lineCap = "round";
    c.setLineDash(s.dash ? [...s.dash] : []);
  }

  line(a: Pt, b: Pt, s: Stroke): void {
    const c = this.ctx;
    c.save();
    this.applyStroke(s);
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.restore();
  }

  poly(pts: readonly Pt[], s: PolyStyle): void {
    if (pts.length < 2) return;
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i]!.x, pts[i]!.y);
    if (s.closed) c.closePath();
    if (s.fill) {
      c.fillStyle = s.fill;
      c.globalAlpha = s.fillAlpha ?? 0.15;
      c.fill();
    }
    if (!s.noStroke) {
      this.applyStroke(s);
      c.stroke();
    }
    c.restore();
  }

  text(t: string, at: Pt, o: TextOpts): Box {
    const c = this.ctx;
    const lines = t.split("\n");
    c.save();
    c.font = fontOf(o);
    const widest = lines.reduce((m, l) => Math.max(m, c.measureText(l).width), 0);
    const box = layout(lines, widest, at, o);
    if (o.bg) {
      c.globalAlpha = o.bgAlpha ?? 1;
      c.fillStyle = o.bg;
      c.beginPath();
      c.roundRect(box.x, box.y, box.w, box.h, 3);
      c.fill();
    }
    if (o.border) {
      c.globalAlpha = 1;
      c.strokeStyle = o.border;
      c.lineWidth = 1;
      c.setLineDash([]);
      c.beginPath();
      c.roundRect(box.x, box.y, box.w, box.h, 3);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.fillStyle = o.color;
    c.textBaseline = "top";
    const size = o.size ?? 12;
    const pad = o.pad ?? (o.bg || o.border ? 4 : 0);
    lines.forEach((line, i) => {
      const lw = c.measureText(line).width;
      const x =
        o.align === "center" ? box.x + (box.w - lw) / 2 : o.align === "right" ? box.x + box.w - pad - lw : box.x + pad;
      c.fillText(line, x, box.y + pad + i * size * LINE_HEIGHT + size * 0.1);
    });
    c.restore();
    return box;
  }
}

function insidePolygon(p: Pt, pts: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Records shapes instead of painting them, then answers "is this point on the drawing?". */
export class RecordPen implements Pen {
  private readonly segments: Array<{ a: Pt; b: Pt; w: number }> = [];
  private readonly areas: Pt[][] = [];
  private readonly boxes: Box[] = [];

  line(a: Pt, b: Pt, s: Stroke): void {
    this.segments.push({ a, b, w: s.width ?? 1 });
  }

  poly(pts: readonly Pt[], s: PolyStyle): void {
    if (pts.length < 2) return;
    if (s.fill && (s.fillAlpha ?? 0.15) > 0 && pts.length > 2) this.areas.push([...pts]);
    if (s.noStroke) return;
    for (let i = 1; i < pts.length; i++) this.segments.push({ a: pts[i - 1]!, b: pts[i]!, w: s.width ?? 1 });
    if (s.closed) this.segments.push({ a: pts[pts.length - 1]!, b: pts[0]!, w: s.width ?? 1 });
  }

  text(t: string, at: Pt, o: TextOpts): Box {
    const lines = t.split("\n");
    const size = o.size ?? 12;
    const widest = lines.reduce((m, l) => Math.max(m, l.length * size * 0.6), 0);
    const box = layout(lines, widest, at, o);
    this.boxes.push(box);
    return box;
  }

  hit(p: Pt, tol: number): boolean {
    for (const s of this.segments) if (distToSegment(p, s.a, s.b) <= tol + s.w / 2) return true;
    for (const b of this.boxes) {
      if (p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) return true;
    }
    return this.areas.some((poly) => insidePolygon(p, poly));
  }
}
