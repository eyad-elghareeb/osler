"use client";

import dynamic from "next/dynamic";
import { BarChart3 } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { HubSkeleton } from "@/components/osler/ui-primitives";

/**
 * The analytics dashboard pulls in Recharts plus nine panels — the heaviest
 * chunk in the admin app. It loads lazily behind a structural skeleton so
 * the page frame (title, filters) paints first and stays interactive while
 * the chart code downloads.
 */
const AnalyticsDashboard = dynamic(
  () =>
    import("@/components/osler/admin/analytics/analytics-dashboard").then(
      (m) => m.AnalyticsDashboard,
    ),
  {
    ssr: false,
    loading: () => <HubSkeleton statCount={0} cardCount={3} />,
  },
);

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
