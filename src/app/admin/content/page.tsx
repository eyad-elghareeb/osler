"use client";

import { FileText } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { ContentBrowser } from "@/components/osler/admin/content-browser";

export default function AdminContentPage() {
  const { t } = useI18n();
  const identity = useAdminIdentity();

  return (
    <AdminPageFrame
      title={t("admin.content.title")}
      subtitle={t("admin.content.subtitle")}
      inlineIcon={FileText}
    >
      <ContentBrowser capabilities={identity.capabilities} />
    </AdminPageFrame>
  );
}
