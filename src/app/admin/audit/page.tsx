"use client";

import { ScrollText } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { AuditLogTable } from "@/components/osler/admin/audit-log-table";

export default function AdminAuditPage() {
  const { t } = useI18n();

  return (
    <AdminRouteGuard requireSuperAdmin>
      <AdminPageFrame
        title={t("admin.nav.audit")}
        subtitle={t("admin.audit.subtitle")}
        inlineIcon={ScrollText}
      >
        <AuditLogTable />
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}
