"use client";

import * as React from "react";
import { LayoutDashboard } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { StatsOverview } from "@/components/osler/admin/stats-overview";
import { HubSkeleton } from "@/components/osler/ui-primitives";

export default function AdminDashboardPage() {
  const { t } = useI18n();

  return (
    <AdminRouteGuard requireSuperAdmin>
      <AdminPageFrame
        title={t("admin.nav.dashboard")}
        subtitle={t("admin.dashboard.subtitle")}
        inlineIcon={LayoutDashboard}
      >
        {/* StatsOverview renders its own skeleton stat tiles while its
         * fetch is in flight, so the dashboard never shows a bare
         * spinner — the layout is stable from the first paint.
         * The HubSkeleton below is a fallback for the brief moment
         * before StatsOverview mounts (e.g. during route transition). */}
        <React.Suspense fallback={<HubSkeleton statCount={4} cardCount={0} />}>
          <StatsOverview />
        </React.Suspense>
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}
