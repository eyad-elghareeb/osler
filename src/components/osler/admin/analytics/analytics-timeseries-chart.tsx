"use client";

import { TrendingUp } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useI18n } from "@/components/osler/i18n-provider";
import { ChartCard } from "@/components/osler/ui-primitives";
import {
  ChartContainer,
  ChartTooltip,
  ChartEmpty,
  ChartLoading,
  ChartLegend,
  chartSeries,
} from "@/components/osler/analytics-primitives";
import type { AnalyticsTimeseries } from "@/components/osler/admin/admin-api";

interface AnalyticsTimeseriesPanelProps {
  data: AnalyticsTimeseries | null;
  loading: boolean;
}

// Series keys map to chartSeries(index) so colors read from --chart-1..5
// semantic tokens (theme-aware). Index keeps the legend swatch in sync
// with the area fill.
const SERIES: Array<{
  key: "page_view" | "web_vital" | "js_error" | "api_call" | "route_change";
  index: number;
  labelKey: string;
}> = [
  { key: "page_view",    index: 0, labelKey: "admin.analytics.series.pageView" },
  { key: "api_call",     index: 1, labelKey: "admin.analytics.series.apiCall" },
  { key: "web_vital",    index: 2, labelKey: "admin.analytics.series.webVital" },
  { key: "route_change", index: 3, labelKey: "admin.analytics.series.routeChange" },
  { key: "js_error",     index: 4, labelKey: "admin.analytics.series.jsError" },
];

export function AnalyticsTimeseriesPanel({ data, loading }: AnalyticsTimeseriesPanelProps) {
  const { t } = useI18n();

  const formatX = (ts: number) => {
    const d = new Date(ts);
    const range = data?.range ?? "24h";
    if (range === "24h") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (range === "7d")  return d.toLocaleDateString([], { weekday: "short", hour: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <ChartCard
      title={
        <span className="flex items-center gap-2">
          <TrendingUp className="size-4 text-primary" />
          {t("admin.analytics.timeseries.title")}
        </span>
      }
      subtitle={t("admin.analytics.timeseries.desc")}
    >
      {loading ? (
        <ChartLoading />
      ) : !data || data.series.length === 0 ? (
        <ChartEmpty
          icon={TrendingUp}
          title={t("admin.analytics.noData")}
          description={t("admin.analytics.timeseries.desc")}
        />
      ) : (
        <>
          <ChartContainer height={280}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  {SERIES.map((s) => {
                    const color = chartSeries(s.index);
                    return (
                      <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={color} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    );
                  })}
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
                {SERIES.map((s) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={t(s.labelKey as any)}
                    stroke={chartSeries(s.index)}
                    strokeWidth={1.5}
                    fill={`url(#grad-${s.key})`}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
          <ChartLegend
            className="mt-3"
            items={SERIES.map((s) => ({
              label: t(s.labelKey as any),
              index: s.index,
            }))}
          />
        </>
      )}
    </ChartCard>
  );
}
