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
export function ChartLegend({ items, className }: ChartLegendProps) {
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
}
