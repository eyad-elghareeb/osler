"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, FileText, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { EmptyState, LoadingState, SectionHeading } from "@/components/osler/ui-primitives";
import { adminApi, type ContentObject, type ContentType, type AdminCapabilities } from "@/components/osler/admin/admin-api";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";

const CONTENT_TYPES: ContentType[] = ["quiz", "bank", "flashcard", "written", "osce", "library", "video"];

const STATUS_COLOR: Record<string, string> = {
  draft:     "bg-muted text-muted-foreground border-border",
  pending:   "bg-warning/15 text-warning border-warning/30",
  published: "bg-success/15 text-success border-success/30",
  rejected:  "bg-destructive/15 text-destructive border-destructive/30",
};

type Tab = "published" | "draft" | "pending" | "rejected";

interface ContentBrowserProps {
  capabilities: AdminCapabilities;
}

export function ContentBrowser({ capabilities }: ContentBrowserProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("published");
  const [items, setItems] = useState<ContentObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [r2Missing, setR2Missing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.listContent(tab)
      .then((r) => { setItems(r.items); setR2Missing(false); })
      .catch((err) => {
        if (err?.status === 503) setR2Missing(true);
        else toast({ title: "Failed to load content", variant: "destructive" });
      })
      .finally(() => setLoading(false));
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const TABS: { id: Tab; label: string }[] = [
    { id: "published", label: t("admin.content.tab.published") },
    { id: "draft",     label: t("admin.content.tab.drafts") },
    { id: "pending",   label: t("admin.content.tab.pending") },
    { id: "rejected",  label: t("admin.content.tab.rejected") },
  ];

  if (r2Missing) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="mb-3 size-12 text-warning" />
        <h2 className="mb-1 text-base font-semibold">{t("admin.content.noR2")}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{t("admin.content.noR2Desc")}</p>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex gap-1 border-b border-border flex-1">
          {TABS.map((t_) => (
            <button
              key={t_.id}
              onClick={() => { haptic("selection"); setTab(t_.id); }}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                tab === t_.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t_.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 size-4" />
          {t("admin.content.new")}
        </Button>
      </div>

      {/* Content list */}
      {loading ? (
        <LoadingState label={t("common.loading")} />
      ) : items.length === 0 ? (
        <EmptyState icon={FileText} title={t("admin.content.empty")} />
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {[
                  t("admin.content.col.title"),
                  t("admin.content.col.type"),
                  t("admin.content.col.status"),
                  t("admin.content.col.author"),
                  t("admin.content.col.updated"),
                  "",
                ].map((col, i) => (
                  <th key={i} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <motion.tr
                  key={item.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.025 }}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => router.push(`/admin/content/${item.id}`)}
                >
                  <td className="px-4 py-3 font-medium">
                    {item.title ?? <span className="italic text-muted-foreground">{t("admin.content.untitled")}</span>}
                    {item.rejection_reason && (
                      <div className="mt-0.5 text-xs text-destructive">
                        {t("admin.content.rejectedReason", { reason: item.rejection_reason })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{item.content_type}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_COLOR[item.status] ?? "")}>
                      {t(`admin.content.status.${item.status}` as any)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {item.creator_username ? `@${item.creator_username}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(item.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push(`/admin/content/${item.id}`)}
                    >
                      {t("admin.content.edit")}
                    </Button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create dialog */}
      <CreateContentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => router.push(`/admin/content/${id}`)}
      />
    </>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateContentDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [contentType, setContentType] = useState<ContentType>("library");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!title.trim()) return;
    haptic("light");
    setBusy(true);
    try {
      const res = await adminApi.createContent({ contentType, title: title.trim(), language });
      toast({ title: t("admin.content.saved") });
      onCreated(res.id);
    } catch {
      toast({ title: "Failed to create content", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("admin.content.newTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("admin.content.titleField")}
            </label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} id="new-content-title" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("admin.content.type")}
            </label>
            <Select value={contentType} onValueChange={(v) => setContentType(v as ContentType)}>
              <SelectTrigger id="new-content-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONTENT_TYPES.map((ct) => (
                  <SelectItem key={ct} value={ct}>{ct}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("admin.content.language")}
            </label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="new-content-lang"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={create} disabled={busy || !title.trim()}>
            {busy ? t("common.loading") : t("admin.content.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
