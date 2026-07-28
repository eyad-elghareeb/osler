"use client";

import { Settings } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { AdminConfigEditor } from "@/components/osler/admin/admin-config-editor";

export default function AdminConfigPage() {
  const { t } = useI18n();

  return (
    <AdminRouteGuard requireSuperAdmin>
      <AdminPageFrame
        title={t("admin.config.title")}
        subtitle={t("admin.config.subtitle")}
        inlineIcon={Settings}
      >
        <AdminConfigEditor />
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}
