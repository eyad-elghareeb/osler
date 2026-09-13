"use client";

import { Radio, TrendingUp, Users } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useI18n } from "@/components/osler/i18n-provider";
import { ChartCard, StatTile } from "@/components/osler/ui-primitives";
import {
  ChartContainer, ChartTooltip, ChartEmpty, ChartLoading, chartSeries,
} from "@/components/osler/analytics-primitives";
import type { AnalyticsTimeseries } from "@/components/osler/admin/admin-api";

interface AnalyticsVisitorsPanelProps {
  /** The volume section's already-fetched timeseries — the visitor curve
   *  rides on it, so this panel costs zero extra requests. */
  timeseries: AnalyticsTimeseries | null;
  loading: boolean;
}

export function AnalyticsVisitorsPanel({ timeseries, loading }: AnalyticsVisitorsPanelProps) {
  const { t } = useI18n();

  // Older Workers predate the visitors aggregates — every point lacks the
  // field. Show an explicit nudge instead of a flat zero curve.
  const supported =
    timeseries != null && timeseries.series.some((p) => typeof p.visitors === "number");
  const peak = supported
    ? timeseries!.series.reduce((m, p) => Math.max(m, p.visitors ?? 0), 0)
    : 0;

  const formatX = (ts: number) => {
    const d = new Date(ts);
    const range = timeseries?.range ?? "24h";
    if (range === "24h") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (range === "7d") return d.toLocaleDateString([], { weekday: "short", hour: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const color = chartSeries(2);

  return (
    <ChartCard
      title={
        <span className="flex items-center gap-2">
          <Radio className="size-4 text-success" />
          {t("admin.analytics.visitors.title")}
          {!loading && supported && (
            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
              <span className="size-1.5 rounded-full bg-success animate-pulse" />
              {t("admin.analytics.visitors.live")}
            </span>
          )}
        </span>
      }
      subtitle={t("admin.analytics.visitors.desc")}
    >
      {loading ? (
        <ChartLoading />
      ) : !supported ? (
        <ChartEmpty
          icon={Users}
          title={t("admin.analytics.noData")}
          description={t("admin.analytics.visitors.needsWorkerUpdate")}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              compact
              label={t("admin.analytics.visitors.now")}
              value={timeseries!.visitorsNow ?? "—"}
              icon={Users}
              color="success"
            />
            <StatTile
              compact
              label={t("admin.analytics.visitors.peak")}
              value={peak.toLocaleString()}
              icon={TrendingUp}
              color="info"
            />
          </div>

          <ChartContainer height={220}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeseries!.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-visitors" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={formatX}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  stroke="var(--border)"
                  minTickGap={32}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  stroke="var(--border)"
                  allowDecimals={false}
                  width={32}
                />
                <Tooltip
                  content={<ChartTooltip labelFormatter={(label) => formatX(Number(label))} />}
                />
                <Area
                  type="monotone"
                  dataKey="visitors"
                  name={t("admin.analytics.visitors.now")}
                  stroke={color}
                  strokeWidth={1.5}
                  fill="url(#grad-visitors)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>

          <p className="text-xs text-muted-foreground">
            {t("admin.analytics.visitors.windowNote")}
          </p>
        </div>
      )}
    </ChartCard>
  );
}
