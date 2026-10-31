import { Activity, AlignCenter, CalendarDays, Clock, Crosshair, Info, type LucideIcon } from "lucide-react";

/** Chart plugins the toolbar (and the phone layout's indicators sheet) can switch on. */
export const CHART_PLUGIN_ITEMS = [
  { id: "crosshair", icon: Crosshair, label: "Crosshair Highlight" },
  { id: "session", icon: Clock, label: "Session Highlighting" },
  { id: "session-breaks", icon: CalendarDays, label: "Session Breaks" },
  { id: "bands", icon: AlignCenter, label: "Bands Indicator" },
  { id: "tooltip", icon: Info, label: "OHLCV Tooltip" },
  { id: "delta-tooltip", icon: Activity, label: "Delta Tooltip" },
] satisfies Array<{ id: string; icon: LucideIcon; label: string }>;
