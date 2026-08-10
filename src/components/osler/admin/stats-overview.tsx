"use client";

import { useEffect, useState } from "react";
import { Users, Activity, FileText, ClipboardList } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { EmptyState, StatTile } from "@/components/osler/ui-primitives";
import { adminApi, type AdminStats } from "@/components/osler/admin/admin-api";

export function StatsOverview() {
  const { t } = useI18n();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    adminApi.stats()
      .then(setStats)
      .catch(() => setError(true));
  }, []);

  const v = (key: keyof AdminStats) => stats ? String(stats[key]) : "…";

  if (error) {
    return (
      <EmptyState
        icon={Activity}
        title={t("admin.stats.loadFailed")}
        description={t("admin.stats.loadFailedDesc")}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label={t("admin.stats.users")}
        value={v("userCount")}
        icon={Users}
        color="primary"
      />
      <StatTile
        label={t("admin.stats.sessions")}
        value={v("sessionCount")}
        icon={Activity}
        color="info"
      />
      <StatTile
        label={t("admin.stats.content")}
        value={v("contentCount")}
        icon={FileText}
        color="success"
      />
      <StatTile
        label={t("admin.stats.pending")}
        value={v("pendingCount")}
        icon={ClipboardList}
        color={stats?.pendingCount ? "warning" : "primary"}
      />
    </div>
  );
}
