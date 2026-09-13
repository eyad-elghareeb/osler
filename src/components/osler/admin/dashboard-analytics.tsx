"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, Eye, Server, Users } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useI18n } from "@/components/osler/i18n-provider";
import { Button } from "@/components/ui/button";
import { ChartCard, StatTile } from "@/components/osler/ui-primitives";
import {
  ChartContainer, ChartEmpty, ChartLegend, ChartTooltip, chartSeries,
} from "@/components/osler/analytics-primitives";
import { Skeleton } from "@/components/ui/skeleton";
import {
  analyticsApi,
  type AnalyticsOverview,
  type AnalyticsTimeseries,
} from "@/components/osler/admin/admin-api";

/**
 * DashboardAnalyticsPreview — compact 24h analytics digest for the admin
 * dashboard. Mirrors the series→color mapping of the full analytics page
 * (indexes into --chart-1..5) so a series means the same color on both
 * surfaces. Silently renders nothing when the analytics backend is
 * unavailable (e.g. 503 in local dev) — the dashboard keeps its other
 * sections.
 */

// Subset of the analytics page's five series — the three that matter at a
// glance. Indexes match analytics-timeseries-chart.tsx.
const SERIES: Array<{
  key: "page_view" | "api_call" | "js_error";
  index: number;
  labelKey: string;
}> = [
  { key: "page_view", index: 0, labelKey: "admin.analytics.series.pageView" },
  { key: "api_call",  index: 1, labelKey: "admin.analytics.series.apiCall" },
  { key: "js_error",  index: 4, labelKey: "admin.analytics.series.jsError" },
];

/** Live "visitors now" ticker cadence. Each poll is one 5-minute-window
 *  distinct-count query (`timeseries?live=1`, no bucket scan) and pauses
 *  while the tab is hidden — the cheapest possible live signal. */
const VISITORS_POLL_MS = 60_000;

export function DashboardAnalyticsPreview() {
  const { t } = useI18n();
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [timeseries, setTimeseries] = useState<AnalyticsTimeseries | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([analyticsApi.overview("24h"), analyticsApi.timeseries("24h")])
      .then(([o, ts]) => {
        if (!alive) return;
        setOverview(o);
        setTimeseries(ts);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // Live ticker: refresh only the visitors-now number, never the curve.
  useEffect(() => {
    if (failed) return;
    let alive = true;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      analyticsApi.visitorsLive()
        .then((live) => {
          if (!alive) return;
          setTimeseries((ts) => (ts ? { ...ts, visitorsNow: live.visitorsNow } : ts));
        })
        .catch(() => {});
    }, VISITORS_POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [failed]);

  if (failed) return null;

  const loading = !overview || !timeseries;
  // Older Workers predate the visitors aggregates — hide the live box
  // rather than charting a flat zero line.
  const visitorsSupported =
    timeseries != null && timeseries.series.some((p) => typeof p.visitors === "number");
  const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
  const formatX = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <ChartCard
      title={
        <span className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          {t("admin.dashboard.analytics.title")}
        </span>
      }
      subtitle={t("admin.dashboard.analytics.desc")}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/analytics">
            {t("admin.dashboard.analytics.viewAll")}
            <ArrowRight className="size-3.5 ms-1 rtl-flip-x" />
          </Link>
        </Button>
      }
    >
      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border p-3.5 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-12" />
              </div>
            ))}
          </div>
          <Skeleton className="h-[200px] w-full rounded-lg" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className={visitorsSupported ? "grid grid-cols-2 lg:grid-cols-5 gap-3" : "grid grid-cols-2 lg:grid-cols-4 gap-3"}>
            <StatTile
              compact
              label={t("admin.analytics.kpi.events")}
              value={fmt(overview.totalEvents)}
              icon={Server}
              color="primary"
            />
            <StatTile
              compact
              label={t("admin.analytics.kpi.sessions")}
              value={fmt(overview.totalSessions)}
              icon={Users}
              color="info"
            />
            <StatTile
              compact
              label={t("admin.analytics.kpi.pageViews")}
              value={fmt(overview.pageViews)}
              icon={Eye}
              color="success"
            />
            <StatTile
              compact
              label={t("admin.analytics.kpi.jsErrors")}
              value={fmt(overview.jsErrors)}
              icon={AlertTriangle}
              color={overview.jsErrors ? "destructive" : "success"}
            />
            {visitorsSupported && (
              <StatTile
                compact
                label={t("admin.analytics.visitors.now")}
                value={
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-success animate-pulse shrink-0" />
                    {fmt(timeseries.visitorsNow)}
                  </span>
                }
                icon={Users}
                color="success"
                footer={
                  <div className="h-10 mt-2 -mb-1" aria-hidden>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={timeseries.series}
                        margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="dash-grad-visitors" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={chartSeries(2)} stopOpacity={0.35} />
                            <stop offset="95%" stopColor={chartSeries(2)} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area
                          type="monotone"
                          dataKey="visitors"
                          stroke={chartSeries(2)}
                          strokeWidth={1.5}
                          fill="url(#dash-grad-visitors)"
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                }
              />
            )}
          </div>

          {timeseries.series.length === 0 ? (
            <ChartEmpty
              icon={Activity}
              title={t("admin.analytics.noData")}
              description={t("admin.dashboard.analytics.desc")}
            />
          ) : (
            <>
              <ChartContainer height={200}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeseries.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      {SERIES.map((s) => {
                        const color = chartSeries(s.index);
                        return (
                          <linearGradient key={s.key} id={`dash-grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
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
                        fill={`url(#dash-grad-${s.key})`}
                        isAnimationActive={false}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
              <ChartLegend
                items={SERIES.map((s) => ({ label: t(s.labelKey as any), index: s.index }))}
              />
            </>
          )}
        </div>
      )}
    </ChartCard>
  );
}
