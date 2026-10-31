// OpenCharts Desktop patch: the left rail rebuilt after TradingView's: six tool groups with
// sectioned flyouts (every tool from TradingView's drawing menus except Image, Post and Idea),
// then measure, zoom, magnet, stay-in-drawing-mode, lock all, hide all and remove all.

import {
  Activity,
  ArrowBigDown,
  ArrowBigUp,
  ArrowRight,
  AudioWaveform,
  BarChart3,
  Brush,
  CalendarRange,
  ChartCandlestick,
  ChartSpline,
  ChevronRight,
  ChevronsLeft,
  ChevronsUpDown,
  Circle,
  Columns3,
  Crosshair,
  DollarSign,
  Equal,
  Eye,
  EyeOff,
  Fan,
  Flag,
  Ghost,
  GitCommitHorizontal,
  Grid2x2,
  Grid3x3,
  GripVertical,
  Highlighter,
  Info,
  Layers,
  Lock,
  LockOpen,
  type LucideIcon,
  Magnet,
  MapPin,
  MessageCircle,
  MessageSquare,
  Minus,
  MousePointer2,
  MoveHorizontal,
  MoveRight,
  MoveUpRight,
  MoveVertical,
  Orbit,
  PencilLine,
  PenTool,
  Pentagon,
  Percent,
  PieChart,
  Radius,
  Rainbow,
  Repeat,
  RotateCw,
  Rows3,
  Ruler,
  Scaling,
  Signpost,
  Slash,
  Spline,
  Square,
  StickyNote,
  Table,
  Tag,
  TrendingDown,
  TrendingUp,
  Trash2,
  Triangle,
  Type,
  Waves,
  Waypoints,
  ZoomIn,
  Undo2,
  Redo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "../../mobile/Sheet.tsx";
import { useDragOffset } from "../../hooks/useDragOffset.ts";
import { cn } from "../../lib/utils.ts";
import type { DrawingLine, DrawingTool, MagnetMode } from "./constants.ts";

interface ToolMeta {
  tool: DrawingTool;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

interface ToolSection {
  title: string;
  tools: ToolMeta[];
}

interface ToolGroup {
  id: string;
  label: string;
  sections: ToolSection[];
}

const GROUPS: ToolGroup[] = [
  {
    id: "lines",
    label: "Trend line tools",
    sections: [
      {
        title: "Lines",
        tools: [
          { tool: "trendline", icon: TrendingUp, label: "Trendline", shortcut: "Alt + T" },
          { tool: "ray", icon: MoveUpRight, label: "Ray" },
          { tool: "info-line", icon: Info, label: "Info line" },
          { tool: "extended", icon: Slash, label: "Extended line" },
          { tool: "trend-angle", icon: Percent, label: "Trend angle" },
          { tool: "horizontal", icon: Minus, label: "Horizontal line", shortcut: "Alt + H" },
          { tool: "horizontal-ray", icon: MoveRight, label: "Horizontal ray", shortcut: "Alt + J" },
          { tool: "vertical", icon: MoveVertical, label: "Vertical line", shortcut: "Alt + V" },
          { tool: "crossline", icon: Crosshair, label: "Crossline", shortcut: "Alt + C" },
        ],
      },
      {
        title: "Channels",
        tools: [
          { tool: "channel", icon: Equal, label: "Parallel channel" },
          { tool: "regression-trend", icon: Activity, label: "Regression trend" },
          { tool: "flat-top-bottom", icon: Rows3, label: "Flat top/bottom" },
          { tool: "disjoint-channel", icon: ChevronsUpDown, label: "Disjoint channel" },
        ],
      },
      {
        title: "Pitchforks",
        tools: [
          { tool: "pitchfork", icon: GitCommitHorizontal, label: "Pitchfork" },
          { tool: "schiff-pitchfork", icon: GitCommitHorizontal, label: "Schiff pitchfork" },
          { tool: "modified-schiff-pitchfork", icon: GitCommitHorizontal, label: "Modified Schiff pitchfork" },
          { tool: "inside-pitchfork", icon: GitCommitHorizontal, label: "Inside pitchfork" },
        ],
      },
    ],
  },
  {
    id: "fib",
    label: "Fib & Gann tools",
    sections: [
      {
        title: "Fibonacci",
        tools: [
          { tool: "fibonacci", icon: Layers, label: "Fib retracement & extension", shortcut: "Alt + F" },
          { tool: "fib-channel", icon: Rows3, label: "Fib channel" },
          { tool: "fib-time-zone", icon: Columns3, label: "Fib time zone" },
          { tool: "fib-speed-fan", icon: Fan, label: "Fib speed resistance fan" },
          { tool: "fib-trend-time", icon: Columns3, label: "Trend-based fib time" },
          { tool: "fib-circles", icon: Orbit, label: "Fib circles" },
          { tool: "fib-spiral", icon: RotateCw, label: "Fib spiral" },
          { tool: "fib-speed-arcs", icon: Rainbow, label: "Fib speed resistance arcs" },
          { tool: "fib-wedge", icon: PieChart, label: "Fib wedge" },
          { tool: "pitchfan", icon: Fan, label: "Pitchfan" },
        ],
      },
      {
        title: "Gann",
        tools: [
          { tool: "gann-box", icon: Grid3x3, label: "Gann box" },
          { tool: "gann-square-fixed", icon: Grid2x2, label: "Gann square fixed" },
          { tool: "gann-square", icon: Grid3x3, label: "Gann square" },
          { tool: "gann-fan", icon: Fan, label: "Gann fan" },
        ],
      },
    ],
  },
  {
    id: "patterns",
    label: "Patterns",
    sections: [
      {
        title: "Chart patterns",
        tools: [
          { tool: "xabcd", icon: Waypoints, label: "XABCD pattern" },
          { tool: "cypher", icon: Waypoints, label: "Cypher pattern" },
          { tool: "head-shoulders", icon: Activity, label: "Head and shoulders" },
          { tool: "abcd", icon: Waypoints, label: "ABCD pattern" },
          { tool: "triangle-pattern", icon: Triangle, label: "Triangle pattern" },
          { tool: "three-drives", icon: Activity, label: "Three drives pattern" },
        ],
      },
      {
        title: "Elliott waves",
        tools: [
          { tool: "elliott-impulse", icon: TrendingUp, label: "Elliott impulse wave (1·2·3·4·5)" },
          { tool: "elliott-correction", icon: TrendingDown, label: "Elliott correction wave (A·B·C)" },
          { tool: "elliott-triangle", icon: Triangle, label: "Elliott triangle wave (A·B·C·D·E)" },
          { tool: "elliott-double-combo", icon: Waves, label: "Elliott double combo wave (W·X·Y)" },
          { tool: "elliott-triple-combo", icon: Waves, label: "Elliott triple combo wave (W·X·Y·X·Z)" },
        ],
      },
      {
        title: "Cycles",
        tools: [
          { tool: "cyclic-lines", icon: Columns3, label: "Cyclic lines" },
          { tool: "time-cycles", icon: Repeat, label: "Time cycles" },
          { tool: "sine-line", icon: AudioWaveform, label: "Sine line" },
        ],
      },
    ],
  },
  {
    id: "forecast",
    label: "Forecasting and measurement tools",
    sections: [
      {
        title: "Forecasting",
        tools: [
          { tool: "long-position", icon: ArrowBigUp, label: "Long position" },
          { tool: "short-position", icon: ArrowBigDown, label: "Short position" },
          { tool: "position-forecast", icon: ChartSpline, label: "Position forecast" },
          { tool: "bars-pattern", icon: ChartCandlestick, label: "Bars pattern" },
          { tool: "ghost-feed", icon: Ghost, label: "Ghost feed" },
          { tool: "sector", icon: PieChart, label: "Sector" },
        ],
      },
      {
        title: "Volume-based",
        tools: [
          { tool: "anchored-vwap", icon: Activity, label: "Anchored VWAP" },
          { tool: "fixed-range-volume-profile", icon: BarChart3, label: "Fixed range volume profile" },
          { tool: "anchored-volume-profile", icon: BarChart3, label: "Anchored volume profile" },
        ],
      },
      {
        title: "Measurers",
        tools: [
          { tool: "price-range", icon: MoveVertical, label: "Price range" },
          { tool: "date-range", icon: MoveHorizontal, label: "Date range" },
          { tool: "date-price-range", icon: CalendarRange, label: "Date and price range" },
        ],
      },
    ],
  },
  {
    id: "shapes",
    label: "Geometric shapes",
    sections: [
      {
        title: "Brushes",
        tools: [
          { tool: "brush", icon: Brush, label: "Brush" },
          { tool: "highlighter", icon: Highlighter, label: "Highlighter" },
        ],
      },
      {
        title: "Arrows",
        tools: [
          { tool: "arrow-marker", icon: MoveUpRight, label: "Arrow marker" },
          { tool: "arrow", icon: ArrowRight, label: "Arrow" },
          { tool: "arrow-mark-up", icon: ArrowBigUp, label: "Arrow mark up" },
          { tool: "arrow-mark-down", icon: ArrowBigDown, label: "Arrow mark down" },
        ],
      },
      {
        title: "Shapes",
        tools: [
          { tool: "rectangle", icon: Square, label: "Rectangle", shortcut: "Alt + R" },
          { tool: "rotated-rectangle", icon: Scaling, label: "Rotated rectangle" },
          { tool: "path", icon: Waypoints, label: "Path" },
          { tool: "circle", icon: Circle, label: "Circle" },
          { tool: "ellipse", icon: Radius, label: "Ellipse" },
          { tool: "polyline", icon: Pentagon, label: "Polyline" },
          { tool: "triangle3", icon: Triangle, label: "Triangle" },
          { tool: "arc", icon: Rainbow, label: "Arc" },
          { tool: "curve", icon: Spline, label: "Curve" },
          { tool: "double-curve", icon: Spline, label: "Double curve" },
        ],
      },
    ],
  },
  {
    id: "text",
    label: "Annotation tools",
    sections: [
      {
        title: "Text and notes",
        tools: [
          { tool: "text", icon: Type, label: "Text" },
          { tool: "note", icon: StickyNote, label: "Note" },
          { tool: "price-note", icon: DollarSign, label: "Price note" },
          { tool: "pin", icon: MapPin, label: "Pin" },
          { tool: "table", icon: Table, label: "Table" },
          { tool: "callout", icon: MessageSquare, label: "Callout" },
          { tool: "comment", icon: MessageCircle, label: "Comment" },
          { tool: "price-label", icon: Tag, label: "Price label" },
          { tool: "signpost", icon: Signpost, label: "Signpost" },
          { tool: "flag-mark", icon: Flag, label: "Flag mark" },
        ],
      },
    ],
  },
];

const allTools = (g: ToolGroup) => g.sections.flatMap((s) => s.tools);

function RailButton({
  icon: Icon,
  title,
  active,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "p-1.5 rounded hover:bg-secondary",
        active ? "bg-primary/20 text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/**
 * A group shows its last used tool: clicking the icon arms it, the arrow opens the flyout.
 */
function RailGroup({
  group,
  current,
  activeTool,
  open,
  onToggle,
  onSelect,
}: {
  group: ToolGroup;
  current: ToolMeta;
  activeTool: DrawingTool;
  open: boolean;
  onToggle: () => void;
  onSelect: (t: DrawingTool) => void;
}) {
  const active = allTools(group).some((t) => t.tool === activeTool);
  return (
    <div className="relative flex items-center">
      <RailButton icon={current.icon} title={current.label} active={active} onClick={() => onSelect(current.tool)} />
      <button
        type="button"
        title={group.label}
        onClick={onToggle}
        className="absolute -right-0.5 h-full w-2 flex items-center justify-center text-muted-foreground/50 hover:text-foreground"
      >
        <ChevronRight className="h-2.5 w-2.5" />
      </button>
      {open && (
        <div className="absolute left-full top-0 ml-2 z-30 w-72 max-h-[78vh] overflow-y-auto rounded-md bg-card border border-border shadow-xl py-1">
          {group.sections.map((section, i) => (
            <div key={section.title} className={cn(i > 0 && "mt-1 border-t border-border/60 pt-1")}>
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.title}
              </div>
              {section.tools.map((t) => (
                <button
                  key={t.tool}
                  type="button"
                  onClick={() => onSelect(t.tool)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-secondary text-left",
                    activeTool === t.tool && "bg-secondary text-primary",
                  )}
                >
                  <t.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{t.label}</span>
                  {t.shortcut && <span className="text-[10px] text-muted-foreground">{t.shortcut}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const MAGNET_TITLE: Record<MagnetMode, string> = {
  none: "Magnet: off",
  weak: "Weak magnet (snaps near candle prices)",
  strong: "Strong magnet (always snaps to candle prices)",
};

export interface DrawingToolRailProps {
  drawingTool: DrawingTool;
  onDrawingTool: (t: DrawingTool) => void;
  magnetMode?: MagnetMode;
  onCycleMagnet?: () => void;
  stayInDrawingMode?: boolean;
  onToggleStayInDrawingMode?: () => void;
  drawings?: DrawingLine[];
  onUpdateDrawing?: (d: DrawingLine) => void;
  onClearDrawings?: () => void;
}

export function DrawingToolRail({
  drawingTool,
  onDrawingTool,
  magnetMode = "none",
  onCycleMagnet,
  stayInDrawingMode = false,
  onToggleStayInDrawingMode,
  drawings = [],
  onUpdateDrawing,
  onClearDrawings,
}: DrawingToolRailProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [lastUsed, setLastUsed] = useState<Record<string, DrawingTool>>({});
  const ref = useRef<HTMLDivElement>(null);
  const drag = useDragOffset();

  useEffect(() => {
    if (!openGroup) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenGroup(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openGroup]);

  const select = (groupId: string | null, t: DrawingTool) => {
    if (groupId) setLastUsed((m) => ({ ...m, [groupId]: t }));
    onDrawingTool(drawingTool === t ? "none" : t);
    setOpenGroup(null);
  };

  const allLocked = drawings.length > 0 && drawings.every((d) => d.locked);
  const allHidden = drawings.length > 0 && drawings.every((d) => d.hidden);
  const setAll = (patch: Partial<DrawingLine>) => {
    for (const d of drawings) onUpdateDrawing?.({ ...d, ...patch });
  };

  // Collapsed: a small restorable button where the rail was last positioned.
  if (hidden) {
    return (
      <button
        type="button"
        title="Show drawing tools"
        onClick={() => setHidden(false)}
        style={drag.style}
        className="absolute left-1 top-1 z-20 rounded-md border border-border bg-card/90 p-1.5 text-muted-foreground backdrop-blur-sm hover:text-primary"
      >
        <PenTool className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div
      ref={ref}
      style={drag.style}
      className="absolute left-1 top-1 z-20 flex flex-col items-center gap-0.5 rounded-md bg-card/90 border border-border p-0.5 pr-1.5 backdrop-blur-sm"
    >
      <div
        onPointerDown={drag.onPointerDown}
        title="Drag to move"
        className="flex w-full cursor-move justify-center py-0.5 text-muted-foreground/50 hover:text-muted-foreground"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>
      <RailButton
        icon={MousePointer2}
        title="Cursor"
        active={drawingTool === "none"}
        onClick={() => {
          onDrawingTool("none");
          setOpenGroup(null);
        }}
      />
      {GROUPS.map((g) => {
        const tools = allTools(g);
        const current =
          tools.find((t) => t.tool === drawingTool) ?? tools.find((t) => t.tool === lastUsed[g.id]) ?? tools[0]!;
        return (
          <RailGroup
            key={g.id}
            group={g}
            current={current}
            activeTool={drawingTool}
            open={openGroup === g.id}
            onToggle={() => setOpenGroup((o) => (o === g.id ? null : g.id))}
            onSelect={(t) => select(g.id, t)}
          />
        );
      })}
      <div className="my-0.5 w-full border-t border-border/50" />
      <RailButton icon={Ruler} title="Measure (Alt + M)" active={drawingTool === "measure"} onClick={() => select(null, "measure")} />
      <RailButton icon={ZoomIn} title="Zoom in: drag across a time range" active={drawingTool === "zoom"} onClick={() => select(null, "zoom")} />
      <div className="my-0.5 w-full border-t border-border/50" />
      <RailButton icon={Magnet} title={MAGNET_TITLE[magnetMode]} active={magnetMode !== "none"} onClick={() => onCycleMagnet?.()} />
      <RailButton
        icon={PencilLine}
        title={stayInDrawingMode ? "Stay in drawing mode: on" : "Stay in drawing mode: off"}
        active={stayInDrawingMode}
        onClick={() => onToggleStayInDrawingMode?.()}
      />
      <RailButton
        icon={allLocked ? Lock : LockOpen}
        title={allLocked ? "Unlock all drawings" : "Lock all drawings"}
        active={allLocked}
        onClick={() => setAll({ locked: !allLocked })}
      />
      <RailButton
        icon={allHidden ? EyeOff : Eye}
        title={allHidden ? "Show all drawings" : "Hide all drawings"}
        active={allHidden}
        onClick={() => setAll({ hidden: !allHidden })}
      />
      <RailButton icon={Trash2} title="Remove all drawings (Ctrl + Z to undo)" onClick={() => onClearDrawings?.()} />
      <div className="my-0.5 w-full border-t border-border/50" />
      <RailButton
        icon={ChevronsLeft}
        title="Hide toolbar"
        onClick={() => {
          setOpenGroup(null);
          setHidden(true);
        }}
      />
    </div>
  );
}


// ── OpenCharts Mobile addition: the phone's drawing bar ─────
// The same groups and tools as the rail, as a row of large buttons under the
// chart. A group opens its tools in a bottom sheet; the bar also has measure,
// zoom, magnet, stay in drawing mode, lock, hide, remove all, undo and redo.

const SHORT_LABEL: Record<string, string> = {
  lines: "Lines",
  fib: "Fib",
  patterns: "Patterns",
  forecast: "Forecast",
  shapes: "Shapes",
  text: "Text",
};

function BarButton({
  icon: Icon,
  label,
  active,
  onClick,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      data-testid={testId}
      className={cn(
        "flex h-12 min-w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10px]",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground active:bg-secondary",
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="max-w-[60px] truncate">{label}</span>
    </button>
  );
}

export interface MobileDrawingBarProps extends DrawingToolRailProps {
  onUndo?: () => void;
  onRedo?: () => void;
  onDone: () => void;
}

export function MobileDrawingBar({
  drawingTool,
  onDrawingTool,
  magnetMode = "none",
  onCycleMagnet,
  stayInDrawingMode = false,
  onToggleStayInDrawingMode,
  drawings = [],
  onUpdateDrawing,
  onClearDrawings,
  onUndo,
  onRedo,
  onDone,
}: MobileDrawingBarProps) {
  const [openGroup, setOpenGroup] = useState<ToolGroup | null>(null);
  const [lastUsed, setLastUsed] = useState<Record<string, DrawingTool>>({});
  const allLocked = drawings.length > 0 && drawings.every((d) => d.locked);
  const allHidden = drawings.length > 0 && drawings.every((d) => d.hidden);
  const setAll = (patch: Partial<DrawingLine>) => {
    for (const d of drawings) onUpdateDrawing?.({ ...d, ...patch });
  };
  const armed = GROUPS.flatMap(allTools).find((t) => t.tool === drawingTool);
  const toggle = (t: DrawingTool) => onDrawingTool(drawingTool === t ? "none" : t);

  return (
    <div className="shrink-0 border-t border-border bg-card" data-testid="mobile-drawing-bar">
      <div className="flex items-center gap-2 px-3 pt-1.5 text-[12px] text-muted-foreground">
        <span className="flex-1 truncate">
          {armed
            ? `${armed.label}: tap the chart to place each point${armed.tool === "path" || armed.tool === "polyline" || armed.tool === "ghost-feed" ? ", double-tap to finish" : ""}`
            : drawingTool === "measure"
              ? "Measure: tap two points"
              : drawingTool === "zoom"
                ? "Zoom: drag across a time range"
                : "Pick a tool. Tap a drawing to select it, double-tap for its settings."}
        </span>
        <button type="button" onClick={onDone} className="h-8 px-3 rounded-lg bg-secondary text-foreground font-semibold" data-testid="mobile-draw-done">
          Done
        </button>
      </div>
      <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar px-1 py-1">
        <BarButton icon={MousePointer2} label="Cursor" active={drawingTool === "none"} onClick={() => onDrawingTool("none")} />
        {GROUPS.map((g) => {
          const tools = allTools(g);
          const current = tools.find((t) => t.tool === drawingTool) ?? tools.find((t) => t.tool === lastUsed[g.id]) ?? tools[0]!;
          return (
            <BarButton
              key={g.id}
              icon={current.icon}
              label={SHORT_LABEL[g.id] ?? g.label}
              active={tools.some((t) => t.tool === drawingTool)}
              onClick={() => setOpenGroup(g)}
              testId={`draw-group-${g.id}`}
            />
          );
        })}
        <div className="mx-1 h-8 shrink-0 border-l border-border" />
        <BarButton icon={Ruler} label="Measure" active={drawingTool === "measure"} onClick={() => toggle("measure")} />
        <BarButton icon={ZoomIn} label="Zoom" active={drawingTool === "zoom"} onClick={() => toggle("zoom")} />
        <BarButton icon={Undo2} label="Undo" onClick={() => onUndo?.()} />
        <BarButton icon={Redo2} label="Redo" onClick={() => onRedo?.()} />
        <div className="mx-1 h-8 shrink-0 border-l border-border" />
        <BarButton icon={Magnet} label={magnetMode === "none" ? "Magnet" : magnetMode === "weak" ? "Weak" : "Strong"} active={magnetMode !== "none"} onClick={() => onCycleMagnet?.()} />
        <BarButton icon={PencilLine} label="Stay" active={stayInDrawingMode} onClick={() => onToggleStayInDrawingMode?.()} />
        <BarButton icon={allLocked ? Lock : LockOpen} label={allLocked ? "Unlock" : "Lock all"} active={allLocked} onClick={() => setAll({ locked: !allLocked })} />
        <BarButton icon={allHidden ? EyeOff : Eye} label={allHidden ? "Show" : "Hide all"} active={allHidden} onClick={() => setAll({ hidden: !allHidden })} />
        <BarButton icon={Trash2} label="Remove all" onClick={() => onClearDrawings?.()} />
      </div>
      <Sheet open={openGroup !== null} title={openGroup?.label ?? ""} onClose={() => setOpenGroup(null)} testId="sheet-draw-tools">
        {openGroup?.sections.map((section) => (
          <div key={section.title} className="pb-1">
            <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</div>
            <div className="grid grid-cols-2 gap-1 px-2">
              {section.tools.map((t) => (
                <button
                  key={t.tool}
                  type="button"
                  onClick={() => {
                    setLastUsed((m) => ({ ...m, [openGroup.id]: t.tool }));
                    onDrawingTool(t.tool);
                    setOpenGroup(null);
                  }}
                  className={cn(
                    "flex items-center gap-2.5 h-12 px-3 rounded-lg text-left text-[14px]",
                    drawingTool === t.tool ? "bg-primary/15 text-primary" : "active:bg-secondary",
                  )}
                >
                  <t.icon className="h-5 w-5 shrink-0" />
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="h-3" />
      </Sheet>
    </div>
  );
}
