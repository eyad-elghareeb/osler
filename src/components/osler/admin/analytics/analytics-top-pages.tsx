"use client";

import { Eye } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { ChartCard } from "@/components/osler/ui-primitives";
import { ChartEmpty, ChartLoading } from "@/components/osler/analytics-primitives";
import { MetricBar } from "@/components/osler/ui-primitives";
import type { AnalyticsTopPages } from "@/components/osler/admin/admin-api";

interface AnalyticsTopPagesPanelProps {
  data: AnalyticsTopPages | null;
  loading: boolean;
}

export function AnalyticsTopPagesPanel({ data, loading }: AnalyticsTopPagesPanelProps) {
  const { t } = useI18n();

  const max = data?.items?.[0]?.views ?? 1;

  return (
    <ChartCard
      title={
        <span className="flex items-center gap-2">
          <Eye className="size-4 text-primary" />
          {t("admin.analytics.topPages.title")}
        </span>
      }
      subtitle={t("admin.analytics.topPages.desc")}
    >
      {loading ? (
        <ChartLoading />
      ) : !data || data.items.length === 0 ? (
        <ChartEmpty
          icon={Eye}
          title={t("admin.analytics.noData")}
          description={t("admin.analytics.topPages.desc")}
        />
      ) : (
        <ul className="space-y-2">
          {data.items.map((p, i) => (
            <li key={p.path} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground font-mono w-6 shrink-0 text-end">
                    {i + 1}.
                  </span>
                  <code className="font-mono text-xs truncate">{p.path}</code>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {t("admin.analytics.topPages.unique", { n: p.uniqueSessions.toLocaleString() })}
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {p.views.toLocaleString()}
                  </span>
                </div>
              </div>
              {/* Per-row metric bar — replaces the hand-rolled progress
               * track with the shared MetricBar primitive. Reads the
               * row's view count relative to the top page. */}
              <MetricBar
                value={p.views}
                max={max}
                color="primary"
                label={`${p.path} views`}
                className="ms-8"
              />
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
