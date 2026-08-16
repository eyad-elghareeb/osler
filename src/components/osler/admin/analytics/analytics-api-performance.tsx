"use client";

import { Server } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { ChartCard } from "@/components/osler/ui-primitives";
import { ChartEmpty, ChartLoading } from "@/components/osler/analytics-primitives";
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

// Premium rating colors — semantic soft-tint tokens.
const RATING_COLORS: Record<string, string> = {
  good: "bg-success-soft text-success border-success/30",
  warn: "bg-warning-soft text-warning border-warning/30",
  bad:  "bg-destructive-soft text-destructive border-destructive/30",
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
    <ChartCard
      title={
        <span className="flex items-center gap-2">
          <Server className="size-4 text-primary" />
          {t("admin.analytics.apiPerf.title")}
        </span>
      }
      subtitle={t("admin.analytics.apiPerf.desc")}
    >
      {loading ? (
        /* Shimmer table rows — mirrors the real layout (5 columns × 6 rows). */
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["endpoint", "count", "p50", "p95", "max"].map((c) => (
                  <th key={c} className="px-3 py-2 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(`admin.analytics.apiPerf.col.${c}` as any)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-3 py-2"><Skeleton className="h-4 w-32" /></td>
                  <td className="px-3 py-2"><Skeleton className="h-4 w-12 ms-auto" /></td>
                  <td className="px-3 py-2"><Skeleton className="h-4 w-12 ms-auto" /></td>
                  <td className="px-3 py-2"><Skeleton className="h-5 w-16 rounded-full ms-auto" /></td>
                  <td className="px-3 py-2"><Skeleton className="h-4 w-12 ms-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !data || data.items.length === 0 ? (
        <ChartEmpty
          icon={Server}
          title={t("admin.analytics.noData")}
          description={t("admin.analytics.apiPerf.desc")}
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="max-h-80 overflow-y-auto overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky top-0 z-10 bg-muted px-3 py-2 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("admin.analytics.apiPerf.col.endpoint")}
                  </th>
                  <th className="sticky top-0 z-10 bg-muted px-3 py-2 text-end text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("admin.analytics.apiPerf.col.count")}
                  </th>
                  <th className="sticky top-0 z-10 bg-muted px-3 py-2 text-end text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("admin.analytics.apiPerf.col.p50")}
                  </th>
                  <th className="sticky top-0 z-10 bg-muted px-3 py-2 text-end text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("admin.analytics.apiPerf.col.p95")}
                  </th>
                  <th className="sticky top-0 z-10 bg-muted px-3 py-2 text-end text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                          "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-medium font-mono tabular-nums whitespace-nowrap min-w-[4.5rem]",
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
        </div>
      )}
    </ChartCard>
  );
}

