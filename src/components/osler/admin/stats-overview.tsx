"use client";

import { useEffect, useState } from "react";
import { Users, Activity, FileText, ClipboardList, type LucideIcon } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { EmptyState, StatTile, MetricBar } from "@/components/osler/ui-primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi, type AdminStats } from "@/components/osler/admin/admin-api";

/**
 * StatsOverview — admin dashboard KPI row.
 *
 * Premium recipe: while the stats fetch is in flight, render a row of
 * skeleton stat tiles that mirror the real tile layout (label + value
 * + icon) so the transition to populated content is seamless. When the
 * stats land, each tile shows its value plus a `MetricBar` that relates
 * the stat to the max across the row — giving an instant visual sense
 * of relative scale without a separate chart.
 */
export function StatsOverview() {
  const { t } = useI18n();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    adminApi.stats()
      .then(setStats)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <EmptyState
        icon={Activity}
        title={t("admin.stats.loadFailed")}
        description={t("admin.stats.loadFailedDesc")}
      />
    );
  }

  // Loading skeleton — 4 placeholder tiles mirroring the real layout.
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="osler-stat-tile">
            <div className="flex items-center justify-between mb-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="size-4 rounded" />
            </div>
            <Skeleton className="h-7 w-16 mb-3" />
            <Skeleton className="h-1 w-full rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  // Compute the max numeric value across the four stats so each tile's
  // MetricBar shows relative scale (0..max). All four stats are counts,
  // so the comparison is meaningful.
  const values = [
    stats.userCount,
    stats.sessionCount,
    stats.contentCount,
    stats.pendingCount,
  ];
  const max = Math.max(...values, 1);

  const tiles: Array<{
    label: string;
    value: number;
    icon: LucideIcon;
    color: "primary" | "success" | "warning" | "destructive" | "info";
  }> = [
    { label: t("admin.stats.users"), value: stats.userCount, icon: Users, color: "primary" },
    { label: t("admin.stats.sessions"), value: stats.sessionCount, icon: Activity, color: "info" },
    { label: t("admin.stats.content"), value: stats.contentCount, icon: FileText, color: "success" },
    {
      label: t("admin.stats.pending"),
      value: stats.pendingCount,
      icon: ClipboardList,
      color: stats.pendingCount ? "warning" : "primary",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="osler-stat-tile">
          <StatTile
            label={tile.label}
            value={tile.value}
            icon={tile.icon}
            color={tile.color}
          />
          <MetricBar
            value={tile.value}
            max={max}
            color={tile.color}
            label={tile.label}
            className="mt-3"
          />
        </div>
      ))}
    </div>
  );
}
