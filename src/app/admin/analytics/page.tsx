"use client";

import { BarChart3 } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { AnalyticsDashboard } from "@/components/osler/admin/analytics/analytics-dashboard";

export default function AdminAnalyticsPage() {
  const { t } = useI18n();

  return (
    <AdminRouteGuard requireSuperAdmin>
      <AdminPageFrame
        title={t("admin.analytics.title")}
        subtitle={t("admin.analytics.subtitle")}
        inlineIcon={BarChart3}
      >
        <AnalyticsDashboard />
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}
