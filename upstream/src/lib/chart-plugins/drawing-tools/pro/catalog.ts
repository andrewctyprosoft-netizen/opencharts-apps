// OpenCharts Desktop patch: the TradingView-style drawing tools beyond the original set.
// Each tool is stored as a DrawingLine of type "pro" with `tool` and a `points` array.

/**
 * How a tool is placed:
 * - a number: that many clicks (or press-drag-release for the first two),
 * - "multi": click to add points, double-click or Enter to finish,
 * - "free": press and drag to paint, release to finish.
 */
export type PointSpec = number | "multi" | "free";

export interface ProToolDef {
  label: string;
  points: PointSpec;
  /** Draw the real shape while fewer points are placed (patterns); otherwise a guide polyline. */
  partial?: boolean;
  /** Default fill opacity when the tool has an area (also enables the Fill settings row). */
  fill?: number;
  /** Default text: the tool shows text and gets the text settings. */
  text?: string;
  color?: string;
  width?: number;
}

const BLUE = "#2962ff";

const TOOLS = {
  // Lines
  "info-line": { label: "Info line", points: 2 },
  "trend-angle": { label: "Trend angle", points: 2 },
  "horizontal-ray": { label: "Horizontal ray", points: 1 },
  crossline: { label: "Crossline", points: 1 },
  // Channels
  "regression-trend": { label: "Regression trend", points: 2, fill: 0.08 },
  "flat-top-bottom": { label: "Flat top/bottom", points: 3, fill: 0.1 },
  "disjoint-channel": { label: "Disjoint channel", points: 3, fill: 0.1 },
  // Pitchforks
  pitchfork: { label: "Pitchfork", points: 3, fill: 0.06 },
  "schiff-pitchfork": { label: "Schiff pitchfork", points: 3, fill: 0.06 },
  "modified-schiff-pitchfork": { label: "Modified Schiff pitchfork", points: 3, fill: 0.06 },
  "inside-pitchfork": { label: "Inside pitchfork", points: 3, fill: 0.06 },
  // Fibonacci
  "fib-channel": { label: "Fib channel", points: 3, fill: 0.06 },
  "fib-time-zone": { label: "Fib time zone", points: 2 },
  "fib-speed-fan": { label: "Fib speed resistance fan", points: 2, fill: 0.05 },
  "fib-trend-time": { label: "Trend-based fib time", points: 3 },
  "fib-circles": { label: "Fib circles", points: 2 },
  "fib-spiral": { label: "Fib spiral", points: 2 },
  "fib-speed-arcs": { label: "Fib speed resistance arcs", points: 2 },
  "fib-wedge": { label: "Fib wedge", points: 3, fill: 0.06 },
  pitchfan: { label: "Pitchfan", points: 3 },
  // Gann
  "gann-box": { label: "Gann box", points: 2, fill: 0.05 },
  "gann-square-fixed": { label: "Gann square fixed", points: 2 },
  "gann-square": { label: "Gann square", points: 2 },
  "gann-fan": { label: "Gann fan", points: 2 },
  // Chart patterns
  xabcd: { label: "XABCD pattern", points: 5, partial: true, fill: 0.15 },
  cypher: { label: "Cypher pattern", points: 5, partial: true, fill: 0.15 },
  "head-shoulders": { label: "Head and shoulders", points: 7, partial: true, fill: 0.12 },
  abcd: { label: "ABCD pattern", points: 4, partial: true },
  "triangle-pattern": { label: "Triangle pattern", points: 4, partial: true, fill: 0.12 },
  "three-drives": { label: "Three drives pattern", points: 7, partial: true },
  // Elliott waves
  "elliott-impulse": { label: "Elliott impulse wave (1·2·3·4·5)", points: 6, partial: true },
  "elliott-correction": { label: "Elliott correction wave (A·B·C)", points: 4, partial: true },
  "elliott-triangle": { label: "Elliott triangle wave (A·B·C·D·E)", points: 6, partial: true },
  "elliott-double-combo": { label: "Elliott double combo wave (W·X·Y)", points: 4, partial: true },
  "elliott-triple-combo": { label: "Elliott triple combo wave (W·X·Y·X·Z)", points: 6, partial: true },
  // Cycles
  "cyclic-lines": { label: "Cyclic lines", points: 2 },
  "time-cycles": { label: "Time cycles", points: 2 },
  "sine-line": { label: "Sine line", points: 2 },
  // Forecasting
  "position-forecast": { label: "Position forecast", points: 2 },
  "bars-pattern": { label: "Bars pattern", points: 2 },
  "ghost-feed": { label: "Ghost feed", points: "multi" },
  sector: { label: "Sector", points: 3, fill: 0.15 },
  // Volume-based
  "anchored-vwap": { label: "Anchored VWAP", points: 1 },
  "fixed-range-volume-profile": { label: "Fixed range volume profile", points: 2 },
  "anchored-volume-profile": { label: "Anchored volume profile", points: 1 },
  // Measurers
  "price-range": { label: "Price range", points: 2, fill: 0.15 },
  "date-range": { label: "Date range", points: 2, fill: 0.15 },
  "date-price-range": { label: "Date and price range", points: 2, fill: 0.15 },
  // Brushes
  brush: { label: "Brush", points: "free", width: 2 },
  highlighter: { label: "Highlighter", points: "free", color: "#ffeb3b", width: 14 },
  // Arrows
  "arrow-marker": { label: "Arrow marker", points: 2, fill: 1 },
  "arrow-mark-up": { label: "Arrow mark up", points: 1, color: "#089981", text: "" },
  "arrow-mark-down": { label: "Arrow mark down", points: 1, color: "#f23645", text: "" },
  // Shapes
  "rotated-rectangle": { label: "Rotated rectangle", points: 3, fill: 0.15 },
  path: { label: "Path", points: "multi" },
  circle: { label: "Circle", points: 2, fill: 0.15 },
  polyline: { label: "Polyline", points: "multi", fill: 0.15 },
  triangle3: { label: "Triangle", points: 3, fill: 0.15 },
  arc: { label: "Arc", points: 3, fill: 0.15 },
  curve: { label: "Curve", points: 3 },
  "double-curve": { label: "Double curve", points: 2 },
  // Text and notes
  note: { label: "Note", points: 1, text: "Note" },
  "price-note": { label: "Price note", points: 2 },
  pin: { label: "Pin", points: 1, text: "Pin" },
  table: { label: "Table", points: 1, text: "Header 1|Header 2\nValue 1|Value 2" },
  callout: { label: "Callout", points: 2, text: "Callout" },
  comment: { label: "Comment", points: 1, text: "Comment" },
  "price-label": { label: "Price label", points: 1 },
  signpost: { label: "Signpost", points: 1, text: "Signpost" },
  "flag-mark": { label: "Flag mark", points: 1, color: "#f23645" },
  // Throwaway: drag a range to zoom the time axis into it (left rail).
  zoom: { label: "Zoom in", points: 2 },
} satisfies Record<string, ProToolDef>;

export type ProToolId = keyof typeof TOOLS;

export const PRO_TOOLS: Record<ProToolId, ProToolDef> = TOOLS;

export function isProTool(tool: string): tool is ProToolId {
  return Object.prototype.hasOwnProperty.call(PRO_TOOLS, tool);
}

export function proDef(tool: ProToolId | undefined): ProToolDef | null {
  return tool && isProTool(tool) ? PRO_TOOLS[tool] : null;
}

export const PRO_DEFAULT_COLOR = BLUE;

/** Tools whose placement finishes when this many points exist (multi/free never auto-finish). */
export function requiredPoints(def: ProToolDef): number {
  return typeof def.points === "number" ? def.points : Number.POSITIVE_INFINITY;
}
