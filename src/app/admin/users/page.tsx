"use client";

import { Users } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { UsersTable } from "@/components/osler/admin/users-table";

export default function AdminUsersPage() {
  const { t } = useI18n();

  return (
    <AdminRouteGuard requireSuperAdmin>
      <AdminPageFrame
        title={t("admin.users.title")}
        subtitle={t("admin.users.subtitle")}
        inlineIcon={Users}
      >
        <UsersTable />
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}
