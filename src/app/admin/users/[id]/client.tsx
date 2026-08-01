"use client";

import { User } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { UserDetailView } from "@/components/osler/admin/user-detail-view";

export default function AdminUserDetailClient({ id }: { id: string }) {
  const { t } = useI18n();

  return (
    <AdminRouteGuard requireSuperAdmin>
      <AdminPageFrame
        title={t("admin.userDetail.title")}
        subtitle={t("admin.userDetail.subtitle")}
        inlineIcon={User}
      >
        <UserDetailView userId={id} />
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}
