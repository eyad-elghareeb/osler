"use client";

import { LifeBuoy } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { SupportTicketsTable } from "@/components/osler/admin/support-tickets-table";

export default function AdminTicketsPage() {
  const { t } = useI18n();

  return (
    <AdminRouteGuard>
      <AdminPageFrame
        title={t("admin.nav.tickets")}
        subtitle={t("admin.tickets.subtitle")}
        inlineIcon={LifeBuoy}
      >
        <SupportTicketsTable />
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}
