"use client";

import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-destructive" />
          {t("admin.analytics.errors.title")}
        </CardTitle>
        <CardDescription>{t("admin.analytics.errors.desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full rounded-lg" />
        ) : !data || data.items.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            {t("admin.analytics.errors.none")}
          </div>
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
      </CardContent>
    </Card>
  );
}
