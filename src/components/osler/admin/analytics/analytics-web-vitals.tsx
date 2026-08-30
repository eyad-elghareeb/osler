"use client";

import { Gauge } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { ChartCard } from "@/components/osler/ui-primitives";
import {
  ChartEmpty,
  ChartLoading,
} from "@/components/osler/analytics-primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AnalyticsWebVitals, AnalyticsWebVitalMetric } from "@/components/osler/admin/admin-api";

interface AnalyticsWebVitalsPanelProps {
  data: AnalyticsWebVitals | null;
  loading: boolean;
}

/** Rating thresholds from web.dev — green = good, amber = needs improvement,
 *  red = poor. The unit is ms for LCP/INP/FCP/TTFB/FID, unitless for CLS. */
function rating(metric: string, value: number | null): "good" | "warn" | "bad" | "n/a" {
  if (value == null) return "n/a";
  if (metric === "CLS") {
    if (value <= 0.1) return "good";
    if (value <= 0.25) return "warn";
    return "bad";
  }
  // Timings (ms).
  if (metric === "TTFB") {
    if (value <= 800) return "good";
    if (value <= 1800) return "warn";
    return "bad";
  }
  if (metric === "FCP") {
    if (value <= 1800) return "good";
    if (value <= 3000) return "warn";
    return "bad";
  }
  // LCP, INP, FID — same thresholds.
  if (value <= 2500) return "good";
  if (value <= 4000) return "warn";
  return "bad";
}

// Premium rating colors — use the semantic soft-tint tokens so the badge
// background reads as a perceptually consistent pair with the foreground
// color across all themes.
const RATING_COLORS: Record<string, string> = {
  good: "bg-success-soft text-success border-success/30",
  warn: "bg-warning-soft text-warning border-warning/30",
  bad:  "bg-destructive-soft text-destructive border-destructive/30",
  "n/a": "bg-muted text-muted-foreground border-border",
};

function formatValue(metric: string, value: number | null): string {
  if (value == null) return "—";
  if (metric === "CLS") return value.toFixed(3);
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function AnalyticsWebVitalsPanel({ data, loading }: AnalyticsWebVitalsPanelProps) {
  const { t } = useI18n();

  return (
    <ChartCard
      title={
        <span className="flex items-center gap-2">
          <Gauge className="size-4 text-primary" />
          {t("admin.analytics.webVitals.title")}
        </span>
      }
      subtitle={t("admin.analytics.webVitals.desc")}
    >
      {loading ? (
        /* Per-metric skeleton — mirrors the real layout (one row per
         * metric, with a 4-column percentile grid) so the transition
         * to populated content is seamless. */
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} className="rounded-md bg-muted/40 py-1.5 px-2">
                    <Skeleton className="h-2.5 w-8 mx-auto mb-1" />
                    <Skeleton className="h-3.5 w-12 mx-auto" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : !data || data.metrics.length === 0 ? (
        <ChartEmpty
          icon={Gauge}
          title={t("admin.analytics.noData")}
          description={t("admin.analytics.webVitals.desc")}
        />
      ) : (
        <div className="space-y-3">
          {data.metrics.map((m: AnalyticsWebVitalMetric) => {
            const r = rating(m.name, m.p75);
            return (
              <div key={m.name} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("admin.analytics.webVitals.samples", { n: m.count.toLocaleString() })}
                    </span>
                  </div>
                  <span className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    RATING_COLORS[r],
                  )}>
                    {t(`admin.analytics.webVitals.rating.${r === "n/a" ? "na" : r}` as any)}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {(["p50", "p75", "p95", "max"] as const).map((k) => (
                    <div key={k} className="rounded-md bg-muted/40 py-1.5 px-2">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {t(`admin.analytics.webVitals.${k}` as any)}
                      </div>
                      <div className="text-sm font-mono font-medium tabular-nums">
                        {formatValue(m.name, m[k])}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ChartCard>
  );
}
