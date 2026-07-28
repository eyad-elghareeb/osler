"use client";

import { TrendingUp } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useI18n } from "@/components/osler/i18n-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalyticsTimeseries } from "@/components/osler/admin/admin-api";

interface AnalyticsTimeseriesPanelProps {
  data: AnalyticsTimeseries | null;
  loading: boolean;
}

const SERIES: Array<{
  key: "page_view" | "web_vital" | "js_error" | "api_call" | "route_change";
  color: string;
  labelKey: string;
}> = [
  { key: "page_view",   color: "var(--chart-1)", labelKey: "admin.analytics.series.pageView" },
  { key: "api_call",    color: "var(--chart-2)", labelKey: "admin.analytics.series.apiCall" },
  { key: "web_vital",   color: "var(--chart-3)", labelKey: "admin.analytics.series.webVital" },
  { key: "route_change",color: "var(--chart-4)", labelKey: "admin.analytics.series.routeChange" },
  { key: "js_error",    color: "var(--chart-5)", labelKey: "admin.analytics.series.jsError" },
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="size-4 text-primary" />
          {t("admin.analytics.timeseries.title")}
        </CardTitle>
        <CardDescription>{t("admin.analytics.timeseries.desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full rounded-lg" />
        ) : !data || data.series.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            {t("admin.analytics.noData")}
          </div>
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  {SERIES.map((s) => (
                    <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={s.color} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
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
                  contentStyle={{
                    backgroundColor: "var(--background)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "var(--muted-foreground)", marginBottom: 4 }}
                  labelFormatter={(label) => formatX(Number(label))}
                />
                {SERIES.map((s) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={t(s.labelKey as any)}
                    stroke={s.color}
                    strokeWidth={1.5}
                    fill={`url(#grad-${s.key})`}
                    isAnimationActive={false}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        {!loading && data && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ backgroundColor: s.color }} />
                <span className="text-muted-foreground">{t(s.labelKey as any)}</span>
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
