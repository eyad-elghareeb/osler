"use client";

import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { ChartCard } from "@/components/osler/ui-primitives";
import { ChartEmpty, ChartLoading } from "@/components/osler/analytics-primitives";
import { Badge } from "@/components/ui/badge";
import type { AnalyticsErrors } from "@/components/osler/admin/admin-api";

interface AnalyticsErrorsPanelProps {
  data: AnalyticsErrors | null;
  loading: boolean;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function AnalyticsErrorsPanel({ data, loading }: AnalyticsErrorsPanelProps) {
  const { t } = useI18n();

  return (
    <ChartCard
      title={
        <span className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-destructive" />
          {t("admin.analytics.errors.title")}
        </span>
      }
      subtitle={t("admin.analytics.errors.desc")}
    >
      {loading ? (
        <ChartLoading />
      ) : !data || data.items.length === 0 ? (
        <ChartEmpty
          icon={AlertTriangle}
          title={t("admin.analytics.errors.none")}
          description={t("admin.analytics.errors.desc")}
        />
      ) : (
        <ul className="space-y-3">
          {data.items.map((e, i) => (
            <li key={`${e.message.slice(0, 60)}-${i}`} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3 mb-2">
                <code className="text-xs font-mono break-all leading-snug flex-1">
                  {e.message}
                </code>
                <Badge
                  variant={e.count > 10 ? "destructive" : "secondary"}
                  className="shrink-0 font-mono tabular-nums"
                >
                  ×{e.count}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  {t("admin.analytics.errors.lastSeen", { when: timeAgo(e.lastSeen) })}
                </span>
                <span>·</span>
                <span>
                  {t("admin.analytics.errors.affected", {
                    paths: e.affectedPaths,
                    sessions: e.affectedSessions,
                  })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

