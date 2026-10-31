// OpenCharts Desktop patch: render and hit-test "pro" drawings (the extra TradingView tools).

import type { BitmapCoordinatesRenderingScope } from "fancy-canvas";
import type { DrawingLine } from "../../../../pages/trading/constants";
import type { Hit, ResolvedEntry } from "../types";
import { PRO_TOOLS, proDef, requiredPoints, type ProToolId } from "./catalog";
import { CanvasPen, type Pen, type Pt, RecordPen } from "./pen";
import { DRAW } from "./tools";

export { isProTool, PRO_TOOLS, proDef, type ProToolId } from "./catalog";

const HANDLE_RADIUS = 5;

/** The drawing's anchors in pixels, or null when any is off the time axis. */
function pixelPoints(e: ResolvedEntry): Pt[] | null {
  const pts = e.pts ?? [];
  if (pts.length === 0) return null;
  const out: Pt[] = [];
  for (const p of pts) {
    if (p.x === null || p.y === null) return null;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

function drawTool(pen: Pen, e: ResolvedEntry, P: Pt[]): void {
  const d = e.d;
  const def = proDef(d.tool);
  if (!def || !d.tool || !e.proEnv) return;
  // Multi-point tools show a guide polyline until enough points exist to draw them.
  if (!def.partial && typeof def.points === "number" && P.length < def.points) {
    pen.poly(P, { color: d.color, width: 1, dash: [4, 4] });
    return;
  }
  DRAW[d.tool](pen, P, d, e.proEnv);
}

/** Free-hand strokes have hundreds of points: no handles, whole-stroke drags only. */
export function hasHandles(d: DrawingLine): boolean {
  return proDef(d.tool)?.points !== "free";
}

export function renderPro(scope: BitmapCoordinatesRenderingScope, e: ResolvedEntry): void {
  const P = pixelPoints(e);
  if (!P) return;
  const ctx = scope.context;
  ctx.save();
  ctx.scale(scope.horizontalPixelRatio, scope.verticalPixelRatio);
  const pen = new CanvasPen(ctx);
  drawTool(pen, e, P);
  if ((e.state === "hovered" || e.state === "selected") && hasHandles(e.d)) {
    for (const p of P) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = e.d.color;
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function hitPro(e: ResolvedEntry, p: Pt, tol: { handle: number; line: number }): Hit | null {
  const P = pixelPoints(e);
  if (!P) return null;
  if (hasHandles(e.d)) {
    for (let i = P.length - 1; i >= 0; i--) {
      if (Math.hypot(p.x - P[i]!.x, p.y - P[i]!.y) <= tol.handle) {
        return { id: e.d.id, region: { kind: "pt", index: i } };
      }
    }
  }
  const pen = new RecordPen();
  drawTool(pen, e, P);
  return pen.hit(p, tol.line) ? { id: e.d.id, region: { kind: "body" } } : null;
}

/** Display name for a drawing (pro tools by their catalog label). */
export function proLabel(d: Pick<DrawingLine, "type" | "tool">): string | null {
  const def = proDef(d.tool);
  return d.type === "pro" && def ? def.label : null;
}

/** Text-bearing pro tools get the text settings dialog. */
export function proHasText(d: Pick<DrawingLine, "type" | "tool">): boolean {
  return d.type === "pro" && proDef(d.tool)?.text !== undefined;
}

/** Pro tools with an area get the Fill row in the settings dialog. */
export function proHasFill(d: Pick<DrawingLine, "type" | "tool">): boolean {
  return d.type === "pro" && proDef(d.tool)?.fill !== undefined;
}

export function proRequiredPoints(tool: ProToolId): number {
  return requiredPoints(PRO_TOOLS[tool]);
}
