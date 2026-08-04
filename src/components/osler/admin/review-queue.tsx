"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, CheckCircle2, XCircle, UploadCloud, Layers, FolderOpen } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { EmptyState, LoadingState, SectionHeading } from "@/components/osler/ui-primitives";
import { adminApi, type ContentObject } from "@/components/osler/admin/admin-api";
import { formatSize } from "@/components/osler/admin/content-tree-pane";
import { useToast } from "@/hooks/use-toast";

/** Category folders surfaced in the review queue's staged-uploads section.
 *  Mirrors the Content hub's unified browser so both views agree on the
 *  student-facing keyspaces. */
const REVIEW_CATEGORIES = ["library", "qbank", "flashcard", "osce", "videos"];

interface StagedFile {
  key: string;
  size: number;
  uploaded: string | null;
}

/** A folder of staged files awaiting a single Publish / Discard decision. */
interface StagedGroup {
  dir: string;
  keys: StagedFile[];
  totalBytes: number;
}

export function ReviewQueue() {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();

  // Pending content_object submissions (draft → pending → approve/reject).
  const [items, setItems] = useState<ContentObject[]>([]);
  const [loading, setLoading] = useState(true);

  // Staged uploads (content-staging/ keyspace) — the bulk-upload workflow
  // that never creates a content_object row, so it has to be listed directly
  // from R2 instead of going through the pending content query.
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [stagedLoading, setStagedLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.pendingQueue()
      .then((r) => setItems(r.items))
      .catch(() => toast({ title: t("admin.toast.failedLoadQueue"), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast, t]);

  const loadStaged = useCallback(() => {
    setStagedLoading(true);
    Promise.allSettled(
      REVIEW_CATEGORIES.map((folder) => adminApi.listR2Keys(folder, undefined, "content-staging")),
    )
      .then((results) => {
        setStaged(
          results.flatMap((r) => (r.status === "fulfilled" ? r.value.items ?? [] : [])),
        );
      })
      .catch(() => toast({ title: t("admin.toast.failedLoadQueue"), variant: "destructive" }))
      .finally(() => setStagedLoading(false));
  }, [toast, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStaged(); }, [loadStaged]);

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

  async function publishStagedGroup(group: StagedGroup) {
    haptic("light");
    try {
      const res = await adminApi.publishStaged(group.keys.map((k) => k.key));
      toast({ title: t("admin.toast.publishedStaged", { n: String(res.published.length) }) });
      loadStaged();
    } catch (err) {
      toast({ title: t("admin.toast.publishStagedFailed", { error: String(err) }), variant: "destructive" });
    }
  }

  async function discardStagedGroup(group: StagedGroup) {
    haptic("warning");
    try {
      const res = await adminApi.discardStaged(group.keys.map((k) => k.key));
      toast({ title: t("admin.toast.discardedStaged", { n: String(res.deleted) }) });
      loadStaged();
    } catch (err) {
      toast({ title: t("admin.toast.discardStagedFailed", { error: String(err) }), variant: "destructive" });
    }
  }

  // Group staged keys by their parent folder (category-relative), so each
  // folder can be reviewed + published/discarded as one unit.
  const stagedGroups = useMemo<StagedGroup[]>(() => {
    const map = new Map<string, StagedGroup>();
    for (const f of staged) {
      const rel = f.key.replace(/^content-staging\//, "");
      const parts = rel.split("/");
      const dir = parts.slice(0, -1).join("/");
      const group = map.get(dir) ?? { dir, keys: [], totalBytes: 0 };
      group.keys.push(f);
      group.totalBytes += f.size ?? 0;
      map.set(dir, group);
    }
    return [...map.values()].sort((a, b) => a.dir.localeCompare(b.dir));
  }, [staged]);

  if (loading) return <LoadingState label={t("common.loading")} />;

  const empty = items.length === 0 && !stagedLoading && stagedGroups.length === 0;
  if (empty) {
    return (
      <EmptyState
        icon={ClipboardList}
        title={t("admin.review.empty")}
        description={t("admin.review.emptyDesc")}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Pending content_object submissions */}
      {items.length > 0 && (
        <section className="space-y-3">
          <SectionHeading icon={ClipboardList}>{t("admin.review.pendingTitle")}</SectionHeading>
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
                  {item.title ?? <span className="italic text-muted-foreground">{t("admin.review.untitled")}</span>}
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
                <Button variant="outline" size="sm" onClick={() => router.push(`/admin/review?id=${encodeURIComponent(item.id)}`)}>
                  {t("admin.review.diff")}
                </Button>
                <Button
                  size="sm"
                  className="bg-success/20 text-success border border-success/30 hover:bg-success/30"
                  onClick={() => approve(item)}
                >
                  <CheckCircle2 className="me-1.5 size-3.5" />
                  {t("admin.review.approve")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  onClick={() => router.push(`/admin/review?id=${encodeURIComponent(item.id)}`)}
                >
                  <XCircle className="me-1.5 size-3.5" />
                  {t("admin.review.reject")}
                </Button>
              </div>
            </motion.div>
          ))}
        </section>
      )}

      {/* Staged uploads (content-staging/ workflow) */}
      <section className="space-y-3">
        <SectionHeading icon={UploadCloud}>{t("admin.review.stagedTitle")}</SectionHeading>
        {stagedLoading ? (
          <LoadingState size="sm" />
        ) : stagedGroups.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={t("admin.review.stagedEmpty")}
            description={t("admin.review.stagedEmptyDesc")}
          />
        ) : (
          <div className="space-y-3">
            {stagedGroups.map((group, i) => (
              <motion.div
                key={group.dir}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="rounded-xl border border-border bg-card p-4 flex items-start gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="size-4 text-muted-foreground shrink-0" />
                    <span className="font-semibold text-sm font-mono truncate">
                      {group.dir || t("admin.review.stagedRoot")}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {group.keys.length > 0 && (
                      <span className="flex flex-wrap gap-1.5">
                        {group.keys.slice(0, 4).map((f) => (
                          <span key={f.key} className="rounded bg-muted px-1.5 py-0.5 font-mono">
                            {f.key.split("/").pop()}
                          </span>
                        ))}
                        {group.keys.length > 4 && <span>+{group.keys.length - 4}</span>}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("admin.review.stagedFilesCount", { n: String(group.keys.length), size: formatSize(group.totalBytes) })}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    className="bg-success/20 text-success border border-success/30 hover:bg-success/30"
                    onClick={() => publishStagedGroup(group)}
                  >
                    <CheckCircle2 className="me-1.5 size-3.5" />
                    {t("admin.review.publish")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => discardStagedGroup(group)}
                  >
                    <XCircle className="me-1.5 size-3.5" />
                    {t("admin.review.discard")}
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
