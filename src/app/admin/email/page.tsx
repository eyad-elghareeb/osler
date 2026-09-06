"use client";

import { Mail } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import { EmailAdmin } from "@/components/osler/admin/email-admin";

export default function AdminEmailPage() {
  const { t } = useI18n();

  return (
    <AdminRouteGuard>
      <AdminPageFrame
        title={t("admin.nav.email")}
        subtitle={t("admin.email.subtitle")}
        inlineIcon={Mail}
      >
        <EmailAdmin />
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}
