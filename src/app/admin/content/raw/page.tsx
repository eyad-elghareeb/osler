"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { useI18n } from "@/components/osler/i18n-provider";
import { AlertCircle, Loader2 } from "lucide-react";
import { EmptyState, LoadingState } from "@/components/osler/ui-primitives";
import { adminApi } from "@/components/osler/admin/admin-api";
import { Button } from "@/components/ui/button";

export default function AdminRawContentEditorPage() {
  const { t } = useI18n();
  const router = useRouter();
  const identity = useAdminIdentity();
  const params = useSearchParams();
  const key = params.get("key") ?? "";

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!key) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await adminApi.lookupByR2Key(key);
        if (!active) return;
        if (res.found && res.object) {
          router.replace(`/admin/content?id=${res.object.id}`);
        } else {
          // Adopt automatically into managed object
          const adoptRes = await adminApi.adoptR2Key(key);
          if (active && adoptRes.id) {
            router.replace(`/admin/content?id=${adoptRes.id}`);
          } else if (active) {
            setLoading(false);
          }
        }
      } catch (err: any) {
        if (active) {
          setError(String(err?.message ?? err));
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [key, router]);

  if (loading) {
    return <LoadingState className="h-full" label={t("admin.content.adopting")} />;
  }

  return (
    <AdminPageFrame title={t("admin.content.title")} subtitle={t("admin.content.managedWorkflowNotice")}>
      <EmptyState
        icon={AlertCircle}
        title={t("admin.content.managedWorkflowNotice")}
        description={error || t("admin.content.managedWorkflowNoticeDesc")}
        actions={
          <Button onClick={() => router.push("/admin/content")}>
            {t("admin.content.backToStudio")}
          </Button>
        }
      />
    </AdminPageFrame>
  );
}
