"use client";

import { Eye, Users, AlertTriangle, Gauge, Server, Route, History } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { StatTile } from "@/components/osler/ui-primitives";
import type { AnalyticsOverview } from "@/components/osler/admin/admin-api";

interface AnalyticsOverviewTilesProps {
  data: AnalyticsOverview | null;
}

export function AnalyticsOverviewTiles({ data }: AnalyticsOverviewTilesProps) {
  const { t } = useI18n();

  const fmt = (n: number | null | undefined) =>
    n == null ? "—" : n.toLocaleString();

  const fmtSince = (ts: number | null | undefined) => {
    if (!ts) return "—";
    const diff = Date.now() - ts;
    if (diff < 60_000) return t("admin.analytics.justNow");
    if (diff < 3_600_000) return t("admin.analytics.minutesAgo", { n: Math.floor(diff / 60_000) });
    if (diff < 86_400_000) return t("admin.analytics.hoursAgo", { n: Math.floor(diff / 3_600_000) });
    return t("admin.analytics.daysAgo", { n: Math.floor(diff / 86_400_000) });
  };

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
      <StatTile
        label={t("admin.analytics.kpi.events")}
        value={fmt(data?.totalEvents)}
        icon={Server}
        color="primary"
      />
      <StatTile
        label={t("admin.analytics.kpi.allTimeEvents")}
        value={fmt(data?.allTimeEvents)}
        icon={History}
        color="info"
      />
      <StatTile
        label={t("admin.analytics.kpi.sessions")}
        value={fmt(data?.totalSessions)}
        icon={Users}
        color="info"
      />
      <StatTile
        label={t("admin.analytics.kpi.pageViews")}
        value={fmt(data?.pageViews)}
        icon={Eye}
        color="success"
      />
      <StatTile
        label={t("admin.analytics.kpi.webVitals")}
        value={fmt(data?.webVitals)}
        icon={Gauge}
        color="info"
      />
      <StatTile
        label={t("admin.analytics.kpi.apiCalls")}
        value={fmt(data?.apiCalls)}
        icon={Route}
        color="primary"
      />
      <StatTile
        label={t("admin.analytics.kpi.jsErrors")}
        value={fmt(data?.jsErrors)}
        icon={AlertTriangle}
        color={data?.jsErrors ? "destructive" : "success"}
      />
      <div className="col-span-2 lg:col-span-3 xl:col-span-6 -mt-1">
        <p className="text-xs text-muted-foreground">
          {t("admin.analytics.lastEvent", { when: fmtSince(data?.lastEventAt) })}
          {" · "}
          {t("admin.analytics.last24h", {
            events: fmt(data?.events24h),
            sessions: fmt(data?.sessions24h),
            errors: fmt(data?.jsErrors24h),
          })}
        </p>
      </div>
    </div>
  );
}
