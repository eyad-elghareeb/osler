"use client";

/**
 * SparkTrend — small inline trend line for a stat tile. No axes, no legend,
 * no grid, just the shape of the last N data points plus an optional delta
 * badge.
 *
 * Dependency-free SVG: this was previously a Recharts AreaChart/LineChart,
 * which dragged ~300KB of chart runtime into every app route that only
 * needed a 72×28 squiggle (profile, QBank results + tracker). At this size
 * a hand-rolled smooth polyline is visually identical. Full Recharts stays
 * available for the admin analytics surfaces via `analytics-primitives`.
 *
 * Pattern reference: Tremor's `SparkAreaChart` / `SparkLineChart`
 * (`docs/design-library-roadmap.md` § "Next-wave candidate additions").
 * Colors always come from the semantic success/destructive tokens or
 * `chartSeries()`, never a hardcoded hex, so it holds up across all 6
 * theme families.
 *
 * Usage inside a `<StatTile>`:
 *   <StatTile label="Accuracy" value="82%" icon={Zap}
 *     trend={<SparkTrend data={last7DaysAccuracy} />} />
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SparkTrendProps {
  /** Ordered series of numeric values, oldest first. Needs 2+ points to draw a line. */
  data: number[];
  /** Variant: filled area (default) or a bare line. */
  variant?: "area" | "line";
  /**
   * Semantic tone. "auto" picks success/destructive by comparing the last
   * value to the first; "neutral" always uses the primary chart color.
   */
  tone?: "auto" | "success" | "destructive" | "neutral";
  /** Show the trailing delta as a small "+12%" / "−4%" badge beside the sparkline. */
  showDelta?: boolean;
  /** Format the delta value. Defaults to a signed percent-point difference. */
  deltaFormatter?: (first: number, last: number) => string;
  width?: number;
  height?: number;
  className?: string;
}

const SPARK_TONE_COLOR: Record<"success" | "destructive" | "neutral", string> = {
  success: "var(--success)",
  destructive: "var(--destructive)",
  neutral: "var(--chart-1)",
};

export function defaultSparkDelta(first: number, last: number): string {
  const diff = last - first;
  const sign = diff > 0 ? "+" : diff < 0 ? "\u2212" : "";
  return `${sign}${Math.abs(diff).toFixed(diff % 1 === 0 ? 0 : 1)}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Catmull-Rom → cubic bezier smoothing through the points. */
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 3) {
    return `M${pts.map((p) => `${round1(p.x)},${round1(p.y)}`).join(" L")}`;
  }
  let d = `M${round1(pts[0].x)},${round1(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${round1(c1x)},${round1(c1y)} ${round1(c2x)},${round1(c2y)} ${round1(p2.x)},${round1(p2.y)}`;
  }
  return d;
}

export const SparkTrend = React.memo(function SparkTrend({
  data,
  variant = "area",
  tone = "auto",
  showDelta = false,
  deltaFormatter = defaultSparkDelta,
  width = 72,
  height = 28,
  className,
}: SparkTrendProps) {
  const points = React.useMemo(
    () => data.filter((v) => typeof v === "number" && Number.isFinite(v)),
    [data],
  );
  const gradientId = React.useId();

  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const resolvedTone: "success" | "destructive" | "neutral" =
    tone === "auto" ? (last >= first ? "success" : "destructive") : tone === "neutral" ? "neutral" : tone;
  const color = SPARK_TONE_COLOR[resolvedTone];

  const pad = 2;
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const pts = points.map((value, i) => ({
    x: pad + (i / (points.length - 1)) * (width - pad * 2),
    y: height - pad - ((value - min) / span) * (height - pad * 2),
  }));
  const line = smoothPath(pts);
  const area =
    `${line} L${round1(pts[pts.length - 1].x)},${height} L${round1(pts[0].x)},${height} Z`;

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <svg width={width} height={height} aria-hidden="true" className="shrink-0">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {variant === "area" && (
          <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        )}
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showDelta && (
        <span
          className="text-[11px] font-medium tabular-nums shrink-0"
          style={{ color }}
        >
          {deltaFormatter(first, last)}
        </span>
      )}
    </div>
  );
});
