"use client";

/**
 * Osler analytics primitives — shared chart + table vocabulary for the
 * Dashboard, Profile, QBank results, and admin analytics views.
 *
 * Why this exists: every analytics surface in Osler hand-rolled its own
 * Recharts container, tooltip styling, empty/loading/error state, and
 * series color lookup. That drift made the Dashboard, Profile, and QBank
 * results feel like three different products. Centralising the wrapper
 * here means a future tweak to the tooltip — or the addition of an
 * accessible summary — ripples through every chart automatically.
 *
 * Pattern source: `docs/design-library-roadmap.md` § "Build a shared
 * analytics vocabulary". The roadmap recommends defining Osler wrappers
 * around the existing Recharts + TanStack Table stack before adopting
 * Tremor; this file is that wrapper.
 *
 * Public API:
 *   - <ChartContainer>      responsive wrapper that pins height + radius
 *   - <ChartTooltip>        themed tooltip for Recharts <Tooltip content={...} />
 *   - <ChartEmpty>          centered empty state with optional icon + CTA
 *   - <ChartLoading>        centered spinner + optional label
 *   - <ChartError>          centered error state with optional retry
 *   - <ChartLegend>         accessible legend with semantic series colors
 *   - <SparkTrend>          small inline trend line for a stat tile
 *   - chartSeries           semantic series color lookup by index
 *   - useChartHeight        helper for responsive chart heights
 *
 * Rules (per AGENTS.md):
 *   - Never hardcode Recharts colors — read from `chartSeries` (which
 *     reads from `--chart-1..5` semantic tokens).
 *   - Every chart must have an empty / loading / error state — never
 *     render a bare `<ResponsiveContainer>` without one.
 *   - Tooltips must be readable in both light and dark themes; the
 *     themed wrapper handles that via `bg-popover text-popover-foreground`.
 */

import * as React from "react";
import { AlertCircle, Inbox, Loader2, type LucideIcon } from "lucide-react";
import {
  ResponsiveContainer as RechartsResponsiveContainer,
  AreaChart as RechartsAreaChart,
  Area as RechartsArea,
  LineChart as RechartsLineChart,
  Line as RechartsLine,
} from "recharts";
import { cn } from "@/lib/utils";

/* ─── Series colors ──────────────────────────────────────────────────── */

/**
 * Semantic chart series colors. Reads from the `--chart-1..5` CSS
 * variables so theme switches (dark / light / custom) propagate
 * automatically. Indexes 6+ cycle through 1..5.
 *
 * Use in Recharts:
 *   <Line stroke={chartSeries(0)} />
 *   <Bar fill={chartSeries(1)} />
 */
export function chartSeries(index: number): string {
  const i = ((index % 5) + 5) % 5; // 0..4, handles negative indices
  return `var(--chart-${i + 1})`;
}

/** Array form — handy for mapping a series of N items. */
export const CHART_SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/* ─── ChartContainer ─────────────────────────────────────────────────── */

interface ChartContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Height in pixels. Defaults to 240. */
  height?: number;
  /** Optional min-height for sparse charts. */
  minHeight?: number;
}

/**
 * Responsive chart wrapper. Pins a height so Recharts `<ResponsiveContainer>`
 * has a measurable parent. Use inside `<ChartCard>` for the title + actions
 * chrome, or standalone when you only need the chart surface.
 */
export function ChartContainer({
  height = 240,
  minHeight,
  className,
  style,
  ...props
}: ChartContainerProps) {
  return (
    <div
      className={cn("w-full", className)}
      style={{ height, minHeight, ...style }}
      {...props}
    />
  );
}

/** Convenience hook for responsive chart heights. Returns a fixed height
 * per breakpoint tier — keeps chart sizing consistent across views. */
export function useChartHeight(
  tier: "sm" | "md" | "lg" = "md",
): number {
  switch (tier) {
    case "sm":
      return 180;
    case "lg":
      return 320;
    default:
      return 240;
  }
}

/* ─── ChartTooltip ───────────────────────────────────────────────────── */

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number | string;
    color?: string;
    dataKey?: string | number;
    payload?: Record<string, unknown>;
  }>;
  label?: React.ReactNode;
  /** Optional formatter — e.g. `(v) => `${v}%``. */
  valueFormatter?: (value: number | string | undefined, name?: string) => string;
  /** Optional label formatter for the x-axis label. */
  labelFormatter?: (label: React.ReactNode) => React.ReactNode;
  /** Hide the label row (e.g. for pie charts). */
  hideLabel?: boolean;
  className?: string;
}

/**
 * Themed tooltip for Recharts `<Tooltip content={<ChartTooltip />} />`.
 * Renders as a small popover card with the label on top and one row per
 * series, each with a colored dot + name + value.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
  labelFormatter,
  hideLabel = false,
  className,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-popover/95 backdrop-blur-md px-3 py-2 text-xs shadow-e3",
        "min-w-[8rem] max-w-[16rem]",
        className,
      )}
      role="tooltip"
    >
      {!hideLabel && label !== undefined && (
        <p className="font-medium text-popover-foreground mb-1 truncate">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="size-2 rounded-full shrink-0"
              style={{ backgroundColor: entry.color ?? chartSeries(i) }}
            />
            {entry.name && (
              <span className="text-muted-foreground truncate">{entry.name}</span>
            )}
            <span className="ml-auto font-medium text-popover-foreground tabular-nums">
              {valueFormatter ? valueFormatter(entry.value, entry.name) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── ChartEmpty ─────────────────────────────────────────────────────── */

interface ChartEmptyProps {
  icon?: LucideIcon;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function ChartEmpty({
  icon: Icon = Inbox,
  title = "No data yet",
  description,
  actions,
  className,
}: ChartEmptyProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-2 py-10",
        className,
      )}
    >
      <div className="size-12 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground max-w-xs">{description}</p>
      )}
      {actions && <div className="flex items-center gap-2 mt-1">{actions}</div>}
    </div>
  );
}

/* ─── ChartLoading ───────────────────────────────────────────────────── */

interface ChartLoadingProps {
  label?: React.ReactNode;
  className?: string;
}

export function ChartLoading({ label, className }: ChartLoadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-muted-foreground gap-2 py-10",
        className,
      )}
    >
      <Loader2 className="size-5 animate-spin" />
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}

/* ─── ChartError ─────────────────────────────────────────────────────── */

interface ChartErrorProps {
  message?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: React.ReactNode;
  className?: string;
}

export function ChartError({
  message = "Couldn't load this chart.",
  onRetry,
  retryLabel = "Try again",
  className,
}: ChartErrorProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-2 py-10",
        className,
      )}
    >
      <div className="size-12 rounded-full bg-destructive-soft flex items-center justify-center text-destructive">
        <AlertCircle className="size-5" />
      </div>
      <p className="text-sm font-medium">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs text-primary hover:underline mt-1"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/* ─── ChartLegend ────────────────────────────────────────────────────── */

interface ChartLegendItem {
  label: React.ReactNode;
  /** Series index — picks from `chartSeries()`. */
  index: number;
}

interface ChartLegendProps {
  items: ChartLegendItem[];
  className?: string;
}

/**
 * Accessible legend for a chart. Renders as a flex row of swatches +
 * labels. Pair with `chartSeries(index)` on the chart's series colors so
 * the legend swatch always matches the bar / line color.
 */
export const ChartLegend = React.memo(function ChartLegend({ items, className }: ChartLegendProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: chartSeries(item.index) }}
          />
          <span className="text-xs text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
});

/* ─── SparkTrend ─────────────────────────────────────────────────────── */

/**
 * Small inline trend line for a stat tile — no axes, no legend, no grid,
 * just the shape of the last N data points plus an optional delta badge.
 *
 * Pattern reference: Tremor's `SparkAreaChart` / `SparkLineChart`
 * (`docs/design-library-roadmap.md` § "Next-wave candidate additions").
 * Re-implemented locally on the existing Recharts dependency rather than
 * installing `@tremor/react` — this is the "small shared chart layer" the
 * roadmap prefers over a second charting runtime. Colors always come from
 * `chartSeries()` / the semantic success/destructive tokens, never a
 * hardcoded hex, so it holds up across all 6 theme families.
 *
 * Usage inside a `<StatTile>`:
 *   <StatTile label="Accuracy" value="82%" icon={Zap}
 *     trend={<SparkTrend data={last7DaysAccuracy} />} />
 */
interface SparkTrendProps {
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
  const chartData = points.map((value, i) => ({ i, value }));

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <div style={{ width, height }} aria-hidden="true">
        <RechartsResponsiveContainer width="100%" height="100%">
          {variant === "area" ? (
            <RechartsAreaChart data={chartData} margin={{ top: 2, right: 1, bottom: 2, left: 1 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <RechartsArea
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
              />
            </RechartsAreaChart>
          ) : (
            <RechartsLineChart data={chartData} margin={{ top: 2, right: 1, bottom: 2, left: 1 }}>
              <RechartsLine
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </RechartsLineChart>
          )}
        </RechartsResponsiveContainer>
      </div>
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

