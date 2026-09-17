"use client";

import dynamic from "next/dynamic";
import { LayoutDashboard } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { StatsOverview } from "@/components/osler/admin/stats-overview";
import { ContentInventory } from "@/components/osler/admin/content-inventory";
import { AdminQuickActions } from "@/components/osler/admin/admin-quick-actions";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The 24h analytics digest pulls in Recharts — the heaviest dependency in
 * the admin bundle. It loads lazily (own chunk + own skeleton) so the KPI
 * tiles and shortcut cards paint and stay interactive first; the chart
 * chunk and its Worker fetch follow right after.
 */
const DashboardAnalyticsPreview = dynamic(
  () =>
    import("@/components/osler/admin/dashboard-analytics").then(
      (m) => m.DashboardAnalyticsPreview,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border p-3.5 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-12" />
            </div>
          ))}
        </div>
        <Skeleton className="h-[200px] w-full rounded-lg" />
      </div>
    ),
  },
);

export default function AdminDashboardPage() {
  const { t } = useI18n();

  return (
    <AdminRouteGuard requireSuperAdmin>
      <AdminPageFrame
        title={t("admin.nav.dashboard")}
        subtitle={t("admin.dashboard.subtitle")}
        inlineIcon={LayoutDashboard}
      >
        <div className="space-y-6">
          {/* StatsOverview renders its own skeleton stat tiles while its
           * fetch is in flight, so the dashboard never shows a bare
           * spinner — the layout is stable from the first paint. */}
          <StatsOverview />
          <ContentInventory />
          <DashboardAnalyticsPreview />
          <AdminQuickActions />
        </div>
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}
