"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { FileText } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { ContentBrowser } from "@/components/osler/admin/content-browser";
import { ContentEditor } from "@/components/osler/admin/content-editor";

/**
 * Admin content hub + editor, driven by `?id=<content-uuid>`.
 * Static export friendly: no dynamic route, no `_redirects` fallback needed.
 * `useSearchParams` is wrapped in `<Suspense>` so the page prerenders cleanly.
 */
export default function AdminContentPage() {
  return (
    <Suspense fallback={null}>
      <AdminContentView />
    </Suspense>
  );
}

function AdminContentView() {
  const { t } = useI18n();
  const identity = useAdminIdentity();
  const params = useSearchParams();
  const id = params.get("id");

  if (id) {
    return (
      <div className="h-full">
        <ContentEditor id={id} capabilities={identity.capabilities} />
      </div>
    );
  }

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
