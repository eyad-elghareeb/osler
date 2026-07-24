"use client";

import { LayoutDashboard } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { StatsOverview } from "@/components/osler/admin/stats-overview";

export default function AdminDashboardPage() {
  const { t } = useI18n();

  return (
    <AdminRouteGuard requireSuperAdmin>
      <AdminPageFrame
        title={t("admin.nav.dashboard")}
        subtitle={t("admin.dashboard.subtitle")}
        inlineIcon={LayoutDashboard}
      >
        <StatsOverview />
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}
