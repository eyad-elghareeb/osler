"use client";

import * as React from "react";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { FileX2 } from "lucide-react";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { EmptyState, LoadingState } from "@/components/osler/ui-primitives";
import { useI18n } from "@/components/osler/i18n-provider";
import { Button } from "@/components/ui/button";

// The structured-editor dependency tree only loads once a raw key is
// actually opened — landing on the studio pulls nothing extra.
const ContentEditor = dynamic(
  () => import("@/components/osler/admin/content-editor").then((m) => ({ default: m.ContentEditor })),
  { ssr: false, loading: () => <LoadingState className="h-full" /> },
);

/**
 * Raw R2 file editor — `/admin/content/raw?key=<r2-key>`.
 *
 * Edits the loose file in place (save via upload-file, optional explicit
 * "Promote to managed" via the adopt button in the editor sidebar). It
 * deliberately does NOT auto-adopt: opening a file must never create a
 * managed draft as a side effect — promotion is a user decision.
 */
function AdminRawContentView() {
  const identity = useAdminIdentity();
  const params = useSearchParams();
  const key = params.get("key") ?? "";

  if (!key) return <MissingKeyView />;

  return <ContentEditor rawR2Key={key} capabilities={identity.capabilities} />;
}

export default function AdminRawContentEditorPage() {
  return (
    <Suspense fallback={<LoadingState className="h-full" />}>
      <AdminRawContentView />
    </Suspense>
  );
}

function MissingKeyView() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <div className="h-full flex items-center justify-center">
      <EmptyState
        icon={FileX2}
        title={t("admin.content.raw.missingKeyTitle")}
        description={t("admin.content.raw.missingKeyDesc")}
        actions={<Button onClick={() => router.push("/admin/content")}>{t("admin.content.backToStudio")}</Button>}
      />
    </div>
  );
}
