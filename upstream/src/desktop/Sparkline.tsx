import { useId } from "react";
import { sparkPaths } from "../../../adapters/markets-data.ts";
import { cn } from "../lib/utils.ts";

/**
 * OpenCharts Desktop addition: a row's price line in the market overview, green when the
 * period ends higher than it started and red when lower, over a fading fill.
 * `values` undefined means still loading; an empty list means no data for this row.
 */
export function Sparkline({
  values,
  width,
  height,
  className,
}: {
  values: number[] | undefined;
  width: number;
  height: number;
  className?: string;
}) {
  // useId gives ":r1:" or "«r1»"; keep the fill reference to plain characters.
  const id = `spark${useId().replace(/[^\w-]/g, "")}`;
  if (!values || values.length < 2)
    return (
      <div
        style={{ width, height }}
        className={cn(
          "flex items-center justify-center text-[11px] text-muted-foreground",
          !values && "animate-pulse rounded bg-secondary/60",
          className,
        )}
      >
        {values ? "—" : null}
      </div>
    );
  const up = values.at(-1)! >= values[0]!;
  const color = up ? "hsl(var(--buy))" : "hsl(var(--sell))";
  const { line, area } = sparkPaths(values, width, height);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("block overflow-visible", className)}
      data-testid="market-spark"
      data-trend={up ? "up" : "down"}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.32} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
