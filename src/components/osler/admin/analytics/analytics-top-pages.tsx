"use client";

import { Eye } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalyticsTopPages } from "@/components/osler/admin/admin-api";

interface AnalyticsTopPagesPanelProps {
  data: AnalyticsTopPages | null;
  loading: boolean;
}

export function AnalyticsTopPagesPanel({ data, loading }: AnalyticsTopPagesPanelProps) {
  const { t } = useI18n();

  const max = data?.items?.[0]?.views ?? 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Eye className="size-4 text-primary" />
          {t("admin.analytics.topPages.title")}
        </CardTitle>
        <CardDescription>{t("admin.analytics.topPages.desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[280px] w-full rounded-lg" />
        ) : !data || data.items.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
            {t("admin.analytics.noData")}
          </div>
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
                <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden ms-8">
                  <div
                    className="h-full bg-primary/60 rounded-full"
                    style={{ width: `${(p.views / max) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
