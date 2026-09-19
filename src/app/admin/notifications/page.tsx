"use client";

import { Megaphone } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { NotificationsAdmin } from "@/components/osler/admin/notifications-admin";

export default function AdminNotificationsPage() {
  const { t } = useI18n();

  return (
    <AdminRouteGuard requireSuperAdmin>
      <AdminPageFrame
        title={t("admin.nav.notifications")}
        subtitle={t("admin.notif.subtitle")}
        inlineIcon={Megaphone}
      >
        <NotificationsAdmin />
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}
