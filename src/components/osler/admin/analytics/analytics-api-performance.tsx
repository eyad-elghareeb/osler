"use client";

import { Server } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AnalyticsApiPerformance, AnalyticsApiPerfRow } from "@/components/osler/admin/admin-api";

interface AnalyticsApiPerformancePanelProps {
  data: AnalyticsApiPerformance | null;
  loading: boolean;
}

function ratingMs(p95: number | null): "good" | "warn" | "bad" | "n/a" {
  if (p95 == null) return "n/a";
  if (p95 <= 500) return "good";
  if (p95 <= 1500) return "warn";
  return "bad";
}

const RATING_COLORS: Record<string, string> = {
  good: "bg-success/15 text-success border-success/30",
  warn: "bg-warning/15 text-warning border-warning/30",
  bad:  "bg-destructive/15 text-destructive border-destructive/30",
  "n/a":"bg-muted text-muted-foreground border-border",
};

function fmtMs(v: number | null): string {
  if (v == null) return "—";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(2)} s`;
}

export function AnalyticsApiPerformancePanel({ data, loading }: AnalyticsApiPerformancePanelProps) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="size-4 text-primary" />
          {t("admin.analytics.apiPerf.title")}
        </CardTitle>
        <CardDescription>{t("admin.analytics.apiPerf.desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full rounded-lg" />
        ) : !data || data.items.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            {t("admin.analytics.noData")}
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-3 py-2 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("admin.analytics.apiPerf.col.endpoint")}
                  </th>
                  <th className="px-3 py-2 text-end text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("admin.analytics.apiPerf.col.count")}
                  </th>
                  <th className="px-3 py-2 text-end text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("admin.analytics.apiPerf.col.p50")}
                  </th>
                  <th className="px-3 py-2 text-end text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("admin.analytics.apiPerf.col.p95")}
                  </th>
                  <th className="px-3 py-2 text-end text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("admin.analytics.apiPerf.col.max")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row: AnalyticsApiPerfRow, i) => {
                  const r = ratingMs(row.p95);
                  return (
                    <tr key={`${row.endpoint}-${i}`} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2">
                        <code className="font-mono text-xs">{row.endpoint}</code>
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-xs">
                        {row.count.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-xs">
                        {fmtMs(row.p50)}
                      </td>
                      <td className="px-3 py-2 text-end">
                        <span className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium font-mono tabular-nums",
                          RATING_COLORS[r],
                        )}>
                          {fmtMs(row.p95)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-xs text-muted-foreground">
                        {fmtMs(row.max)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
