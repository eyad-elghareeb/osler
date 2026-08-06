"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, CheckCircle2, XCircle, UploadCloud, Layers, FolderOpen } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { EmptyState, LoadingState, SectionHeading } from "@/components/osler/ui-primitives";
import { adminApi, type ContentObject } from "@/components/osler/admin/admin-api";
import { formatSize } from "@/components/osler/admin/content-tree-pane";
import {
  ReviewPreview,
  type StagedFile,
  type StagedGroup,
  type ReviewPreviewTarget,
} from "@/components/osler/admin/review-preview";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** Category folders surfaced in the review queue's staged-uploads section.
 *  Mirrors the Content hub's unified browser so both views agree on the
 *  student-facing keyspaces. */
const REVIEW_CATEGORIES = ["library", "qbank", "flashcard", "osce", "videos"];

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

  // Selection state for bulk actions.
  const [selectedPending, setSelectedPending] = useState<Set<string>>(new Set());
  const [selectedStaged, setSelectedStaged] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Preview panel target.
  const [preview, setPreview] = useState<ReviewPreviewTarget | null>(null);

  // Shared bulk-reject reason dialog.
  const [rejectTargets, setRejectTargets] = useState<string[] | null>(null);
  const [rejectReason, setRejectReason] = useState("");

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

  // Drop stale selections when the underlying lists shrink.
  useEffect(() => {
    const ids = new Set(items.map((i) => i.id));
    setSelectedPending((prev) => (prev.size === 0 ? prev : new Set([...prev].filter((id) => ids.has(id)))));
  }, [items]);

  useEffect(() => {
    const dirs = new Set(stagedGroups.map((g) => g.dir));
    setSelectedStaged((prev) => (prev.size === 0 ? prev : new Set([...prev].filter((d) => dirs.has(d)))));
  }, [stagedGroups]);

  // ── Bulk actions ────────────────────────────────────────────────────────

  async function approveMany(ids: string[]) {
    if (ids.length === 0) return;
    haptic("success");
    setBusy(true);
    const results = await Promise.allSettled(ids.map((id) => adminApi.approveContent(id)));
    const ok = ids.filter((_, i) => results[i]?.status === "fulfilled");
    if (ok.length > 0) {
      const okSet = new Set(ok);
      setItems((prev) => prev.filter((i) => !okSet.has(i.id)));
      setSelectedPending((prev) => new Set([...prev].filter((id) => !okSet.has(id))));
      setPreview((p) => (p?.kind === "pending" && okSet.has(p.item.id) ? null : p));
      toast({ title: t("admin.toast.approvedSelected", { n: String(ok.length) }) });
    }
    if (ok.length < ids.length) {
      toast({ title: t("admin.toast.approveFailed"), variant: "destructive" });
    }
    setBusy(false);
  }

  async function rejectMany(ids: string[], reason: string) {
    if (ids.length === 0) return;
    haptic("warning");
    setBusy(true);
    const results = await Promise.allSettled(ids.map((id) => adminApi.rejectContent(id, reason)));
    const ok = ids.filter((_, i) => results[i]?.status === "fulfilled");
    if (ok.length > 0) {
      const okSet = new Set(ok);
      setItems((prev) => prev.filter((i) => !okSet.has(i.id)));
      setSelectedPending((prev) => new Set([...prev].filter((id) => !okSet.has(id))));
      setPreview((p) => (p?.kind === "pending" && okSet.has(p.item.id) ? null : p));
      toast({ title: t("admin.toast.rejectedSelected", { n: String(ok.length) }) });
    }
    if (ok.length < ids.length) {
      toast({ title: t("admin.toast.rejectFailed"), variant: "destructive" });
    }
    setRejectTargets(null);
    setRejectReason("");
    setBusy(false);
  }

  function groupsForDirs(dirs: string[]): StagedGroup[] {
    const set = new Set(dirs);
    return stagedGroups.filter((g) => set.has(g.dir));
  }

  async function publishMany(dirs: string[]) {
    const groups = groupsForDirs(dirs);
    const keys = groups.flatMap((g) => g.keys.map((k) => k.key));
    if (keys.length === 0) return;
    haptic("light");
    setBusy(true);
    try {
      const res = await adminApi.publishStaged(keys);
      toast({ title: t("admin.toast.publishedStaged", { n: String(res.published.length) }) });
      setSelectedStaged((prev) => {
        const keep = new Set(prev);
        groups.forEach((g) => keep.delete(g.dir));
        return keep;
      });
      setPreview((p) => (p?.kind === "stagedGroup" && groups.some((g) => g.dir === p.group.dir) ? null : p));
      loadStaged();
    } catch (err) {
      toast({ title: t("admin.toast.publishStagedFailed", { error: String(err) }), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function discardMany(dirs: string[]) {
    const groups = groupsForDirs(dirs);
    const keys = groups.flatMap((g) => g.keys.map((k) => k.key));
    if (keys.length === 0) return;
    haptic("warning");
    setBusy(true);
    try {
      const res = await adminApi.discardStaged(keys);
      toast({ title: t("admin.toast.discardedStaged", { n: String(res.deleted) }) });
      setSelectedStaged((prev) => {
        const keep = new Set(prev);
        groups.forEach((g) => keep.delete(g.dir));
        return keep;
      });
      setPreview((p) => (p?.kind === "stagedGroup" && groups.some((g) => g.dir === p.group.dir) ? null : p));
      loadStaged();
    } catch (err) {
      toast({ title: t("admin.toast.discardStagedFailed", { error: String(err) }), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  // ── Selection helpers ───────────────────────────────────────────────────

  const allPendingSelected = items.length > 0 && items.every((i) => selectedPending.has(i.id));
  const allStagedSelected = stagedGroups.length > 0 && stagedGroups.every((g) => selectedStaged.has(g.dir));

  function togglePending(id: string) {
    setSelectedPending((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function toggleStaged(dir: string) {
    setSelectedStaged((prev) => {
      const n = new Set(prev);
      if (n.has(dir)) n.delete(dir); else n.add(dir);
      return n;
    });
  }

  function toggleAllPending(checked: boolean | "indeterminate") {
    setSelectedPending(checked ? new Set(items.map((i) => i.id)) : new Set());
  }

  function toggleAllStaged(checked: boolean | "indeterminate") {
    setSelectedStaged(checked ? new Set(stagedGroups.map((g) => g.dir)) : new Set());
  }

  function previewGroup(group: StagedGroup) {
    setPreview({ kind: "stagedGroup", group, fileKey: group.keys[0]?.key ?? "" });
  }

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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-6">
        {/* Pending content_object submissions */}
        {items.length > 0 && (
          <section className="space-y-3">
            <SectionHeading icon={ClipboardList}>{t("admin.review.pendingTitle")}</SectionHeading>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={allPendingSelected}
                  onCheckedChange={toggleAllPending}
                  aria-label={t("admin.review.selectAll")}
                />
                {t("admin.review.selectAll")}
              </label>
              <span className="text-xs text-muted-foreground">
                {t("admin.review.selectedCount", { n: String(selectedPending.size) })}
              </span>
              <div className="ms-auto flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  className="bg-success/20 text-success border border-success/30 hover:bg-success/30"
                  disabled={busy || selectedPending.size === 0}
                  onClick={() => approveMany([...selectedPending])}
                >
                  <CheckCircle2 className="me-1.5 size-3.5" />
                  {t("admin.review.approveSelected")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={busy || selectedPending.size === 0}
                  onClick={() => setRejectTargets([...selectedPending])}
                >
                  <XCircle className="me-1.5 size-3.5" />
                  {t("admin.review.rejectSelected")}
                </Button>
                <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                <Button
                  size="sm"
                  className="bg-success/20 text-success border border-success/30 hover:bg-success/30"
                  disabled={busy || items.length === 0}
                  onClick={() => approveMany(items.map((i) => i.id))}
                >
                  <CheckCircle2 className="me-1.5 size-3.5" />
                  {t("admin.review.approveAll")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={busy || items.length === 0}
                  onClick={() => setRejectTargets(items.map((i) => i.id))}
                >
                  <XCircle className="me-1.5 size-3.5" />
                  {t("admin.review.rejectAll")}
                </Button>
              </div>
            </div>

            {items.map((item, i) => {
              const active = preview?.kind === "pending" && preview.item.id === item.id;
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={cn(
                    "rounded-xl border bg-card p-4 flex items-start gap-3 transition-colors",
                    active ? "border-primary/40 ring-1 ring-primary/20" : "border-border",
                  )}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={selectedPending.has(item.id)}
                    onCheckedChange={() => togglePending(item.id)}
                    aria-label={`${t("admin.review.selectAll")} ${item.title ?? item.id}`}
                  />

                  {/* Meta — click to preview */}
                  <button
                    type="button"
                    onClick={() => setPreview({ kind: "pending", item })}
                    className="min-w-0 flex-1 text-start"
                  >
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
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => router.push(`/admin/review?id=${encodeURIComponent(item.id)}`)}>
                      {t("admin.review.diff")}
                    </Button>
                    <Button
                      size="sm"
                      className="bg-success/20 text-success border border-success/30 hover:bg-success/30"
                      disabled={busy}
                      onClick={() => approveMany([item.id])}
                    >
                      <CheckCircle2 className="me-1.5 size-3.5" />
                      {t("admin.review.approve")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive border-destructive/30 hover:bg-destructive/10"
                      disabled={busy}
                      onClick={() => setRejectTargets([item.id])}
                    >
                      <XCircle className="me-1.5 size-3.5" />
                      {t("admin.review.reject")}
                    </Button>
                  </div>
                </motion.div>
              );
            })}
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
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox
                    checked={allStagedSelected}
                    onCheckedChange={toggleAllStaged}
                    aria-label={t("admin.review.selectAll")}
                  />
                  {t("admin.review.selectAll")}
                </label>
                <span className="text-xs text-muted-foreground">
                  {t("admin.review.selectedCount", { n: String(selectedStaged.size) })}
                </span>
                <div className="ms-auto flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    className="bg-success/20 text-success border border-success/30 hover:bg-success/30"
                    disabled={busy || selectedStaged.size === 0}
                    onClick={() => publishMany([...selectedStaged])}
                  >
                    <CheckCircle2 className="me-1.5 size-3.5" />
                    {t("admin.review.publishSelected")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    disabled={busy || selectedStaged.size === 0}
                    onClick={() => discardMany([...selectedStaged])}
                  >
                    <XCircle className="me-1.5 size-3.5" />
                    {t("admin.review.discardSelected")}
                  </Button>
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                  <Button
                    size="sm"
                    className="bg-success/20 text-success border border-success/30 hover:bg-success/30"
                    disabled={busy || stagedGroups.length === 0}
                    onClick={() => publishMany(stagedGroups.map((g) => g.dir))}
                  >
                    <CheckCircle2 className="me-1.5 size-3.5" />
                    {t("admin.review.publishAll")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    disabled={busy || stagedGroups.length === 0}
                    onClick={() => discardMany(stagedGroups.map((g) => g.dir))}
                  >
                    <XCircle className="me-1.5 size-3.5" />
                    {t("admin.review.discardAll")}
                  </Button>
                </div>
              </div>

              {stagedGroups.map((group, i) => {
                const active = preview?.kind === "stagedGroup" && preview.group.dir === group.dir;
                return (
                  <motion.div
                    key={group.dir}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className={cn(
                      "rounded-xl border bg-card p-4 flex items-start gap-3 transition-colors",
                      active ? "border-primary/40 ring-1 ring-primary/20" : "border-border",
                    )}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedStaged.has(group.dir)}
                      onCheckedChange={() => toggleStaged(group.dir)}
                      aria-label={`${t("admin.review.selectAll")} ${group.dir}`}
                    />

                    {/* Meta — click to preview */}
                    <button
                      type="button"
                      onClick={() => previewGroup(group)}
                      className="min-w-0 flex-1 text-start"
                    >
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
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        className="bg-success/20 text-success border border-success/30 hover:bg-success/30"
                        disabled={busy}
                        onClick={() => publishMany([group.dir])}
                      >
                        <CheckCircle2 className="me-1.5 size-3.5" />
                        {t("admin.review.publish")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        disabled={busy}
                        onClick={() => discardMany([group.dir])}
                      >
                        <XCircle className="me-1.5 size-3.5" />
                        {t("admin.review.discard")}
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Preview panel */}
      <div className="min-w-0">
        <div className="lg:sticky lg:top-6">
          <ReviewPreview
            target={preview}
            onSelectFile={(group, key) => setPreview({ kind: "stagedGroup", group, fileKey: key })}
          />
        </div>
      </div>

      {/* Bulk reject reason dialog */}
      <AlertDialog open={rejectTargets !== null} onOpenChange={(o) => { if (!o) setRejectTargets(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.review.confirmBulkReject", { n: String(rejectTargets?.length ?? 0) })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("admin.review.reason")}</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            id="reject-reason"
            placeholder={t("admin.review.reasonPlaceholder")}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="mt-2 min-h-[80px]"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rejectTargets && rejectMany(rejectTargets, rejectReason)}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t("admin.review.confirmReject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
