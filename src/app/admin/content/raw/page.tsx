"use client";

import { useSearchParams } from "next/navigation";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { ContentEditor } from "@/components/osler/admin/content-editor";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { useI18n } from "@/components/osler/i18n-provider";
import { AlertCircle } from "lucide-react";
import { EmptyState } from "@/components/osler/ui-primitives";

export default function AdminRawContentEditorPage() {
  const { t } = useI18n();
  const identity = useAdminIdentity();
  const params = useSearchParams();
  const key = params.get("key") ?? "";

  if (!key || !key.startsWith("content-files/")) {
    return (
      <AdminPageFrame title={t("admin.content.title")} subtitle={t("admin.content.rawInvalidKey")}>
        <EmptyState
          icon={AlertCircle}
          title={t("admin.content.rawInvalidKey")}
          description={t("admin.content.rawInvalidKeyDesc")}
        />
      </AdminPageFrame>
    );
  }

  return (
    <div className="h-full">
      <ContentEditor rawR2Key={key} capabilities={identity.capabilities} />
    </div>
  );
}
