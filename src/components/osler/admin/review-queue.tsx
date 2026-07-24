"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, CheckCircle2, XCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { EmptyState, LoadingState } from "@/components/osler/ui-primitives";
import { adminApi, type ContentObject } from "@/components/osler/admin/admin-api";
import { useToast } from "@/hooks/use-toast";

export function ReviewQueue() {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [items, setItems] = useState<ContentObject[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.pendingQueue()
      .then((r) => setItems(r.items))
      .catch(() => toast({ title: t("admin.toast.failedLoadQueue"), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function approve(item: ContentObject) {
    haptic("success");
    try {
      await adminApi.approveContent(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      toast({ title: t("admin.review.approve") + ` — ${item.title}` });
    } catch {
      toast({ title: t("admin.toast.approveFailed"), variant: "destructive" });
    }
  }

  if (loading) return <LoadingState label={t("common.loading")} />;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title={t("admin.review.empty")}
      />
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
          className="rounded-xl border border-border bg-card p-4 flex items-start gap-4"
        >
          {/* Meta */}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">
              {item.title ?? <span className="italic text-muted-foreground">Untitled</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{item.content_type}</span>
              {item.creator_username && (
                <span>{t("admin.review.submittedBy", { name: `@${item.creator_username}` })}</span>
              )}
              {item.submitted_at && (
                <span>{t("admin.review.submittedAt", { date: new Date(item.submitted_at).toLocaleDateString() })}</span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Button variant="outline" size="sm" onClick={() => router.push(`/admin/review/${item.id}`)}>
              Diff
            </Button>
            <Button
              size="sm"
              className="bg-success/20 text-success border border-success/30 hover:bg-success/30"
              onClick={() => approve(item)}
            >
              <CheckCircle2 className="mr-1.5 size-3.5" />
              {t("admin.review.approve")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => router.push(`/admin/review/${item.id}`)}
            >
              <XCircle className="mr-1.5 size-3.5" />
              {t("admin.review.reject")}
            </Button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
