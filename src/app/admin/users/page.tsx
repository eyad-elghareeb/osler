"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Users, User } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { UsersTable } from "@/components/osler/admin/users-table";
import { UserDetailView } from "@/components/osler/admin/user-detail-view";

/**
 * Admin users hub + user detail, driven by `?id=<user-uuid>`.
 * Static export friendly: no dynamic route, no `_redirects` fallback needed.
 * `useSearchParams` is wrapped in `<Suspense>` so the page prerenders cleanly.
 */
export default function AdminUsersPage() {
  return (
    <Suspense fallback={null}>
      <AdminUsersView />
    </Suspense>
  );
}

function AdminUsersView() {
  const { t } = useI18n();
  const params = useSearchParams();
  const id = params.get("id");

  if (id) {
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
