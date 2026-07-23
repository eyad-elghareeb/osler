"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Save, Send, Upload, Trash2, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/osler/ui-primitives";
import { adminApi, type ContentObject, type AdminCapabilities } from "@/components/osler/admin/admin-api";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLOR: Record<string, string> = {
  draft:     "text-muted-foreground",
  pending:   "text-warning",
  published: "text-success",
  rejected:  "text-destructive",
};

interface ContentEditorProps {
  id: string;
  capabilities: AdminCapabilities;
}

export function ContentEditor({ id, capabilities }: ContentEditorProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [obj, setObj] = useState<ContentObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    adminApi.getContent(id)
      .then((c) => { setObj(c); setBody(c.body ?? "{}"); })
      .catch(() => toast({ title: "Content not found", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleBodyChange(value: string) {
    setBody(value);
    setDirty(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => autoSave(value), 2000);
  }

  async function autoSave(value: string) {
    if (!obj) return;
    try {
      await adminApi.saveDraft(id, value);
    } catch {}
  }

  async function saveDraft() {
    haptic("light");
    setSaving(true);
    try {
      await adminApi.saveDraft(id, body);
      setDirty(false);
      toast({ title: t("admin.content.saved") });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    haptic("light");
    // Save first, then submit
    await adminApi.saveDraft(id, body).catch(() => {});
    try {
      const res = await adminApi.submitForReview(id);
      setObj((o) => o ? { ...o, status: res.status as any } : o);
      toast({ title: t("admin.content.submitted") });
    } catch {
      toast({ title: "Submit failed", variant: "destructive" });
    }
  }

  async function publishDirect() {
    haptic("light");
    await adminApi.saveDraft(id, body).catch(() => {});
    try {
      const res = await adminApi.publishDirect(id);
      setObj((o) => o ? { ...o, status: res.status as any } : o);
      toast({ title: t("admin.content.published") });
    } catch {
      toast({ title: "Publish failed", variant: "destructive" });
    }
  }

  async function deleteContent() {
    haptic("warning");
    try {
      await adminApi.deleteContent(id);
      router.push("/admin/content");
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  if (loading) return <LoadingState label={t("common.loading")} />;
  if (!obj) return null;

  const isPending = obj.status === "pending";

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-4 backdrop-blur-md safe-pt">
        <Button variant="ghost" size="iconSm" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm truncate">{obj.title ?? t("admin.content.untitled")}</span>
          <span className={cn("ml-2 text-xs font-medium", STATUS_COLOR[obj.status])}>
            {t(`admin.content.status.${obj.status}` as any)}
          </span>
          {dirty && <span className="ml-2 text-xs text-muted-foreground">●</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={saveDraft} disabled={saving}>
            <Save className="mr-1.5 size-3.5" />
            {t("admin.content.saveDraft")}
          </Button>
          {!isPending && (
            <Button variant="outline" size="sm" onClick={submit}>
              <Send className="mr-1.5 size-3.5" />
              {t("admin.content.submit")}
            </Button>
          )}
          {capabilities.publishDirect && (
            <Button size="sm" onClick={publishDirect}>
              <Upload className="mr-1.5 size-3.5" />
              {t("admin.content.publishDirect")}
            </Button>
          )}
          {capabilities.manageUsers && (
            <Button variant="ghost" size="iconSm" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Rejection notice */}
      {obj.status === "rejected" && obj.rejection_reason && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {t("admin.content.rejectedReason", { reason: obj.rejection_reason })}
        </div>
      )}

      {/* Editor */}
      <div className="flex flex-1 overflow-hidden">
        {/* Metadata sidebar */}
        <aside className="w-52 shrink-0 border-r border-border bg-card/40 p-4 text-xs space-y-3 hidden md:block">
          <div>
            <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">Type</div>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{obj.content_type}</span>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">Language</div>
            <span>{obj.language}</span>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">Created by</div>
            <span>@{obj.creator_username ?? obj.created_by.slice(0, 8)}</span>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">Updated</div>
            <span>{new Date(obj.updated_at).toLocaleString()}</span>
          </div>
        </aside>

        {/* JSON editor */}
        <textarea
          id="content-editor-body"
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          className={cn(
            "flex-1 resize-none bg-background p-4 font-mono text-sm text-foreground",
            "focus:outline-none",
            isPending ? "opacity-60 pointer-events-none" : "",
          )}
          readOnly={isPending}
          spellCheck={false}
          placeholder='{ "title": "…" }'
        />
      </div>

      {/* Delete dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.content.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.content.deleteConfirm", { title: obj.title ?? t("admin.content.untitled") })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={deleteContent} className="bg-destructive text-white hover:bg-destructive/90">
              {t("admin.content.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
