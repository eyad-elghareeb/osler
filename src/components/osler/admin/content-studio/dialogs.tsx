"use client";

/**
 * Content Studio dialogs.
 *
 * Extracted from content-studio.tsx so the studio component is a slim
 * orchestrator. Four dialogs live here:
 *
 *   - PathInputDialog     — shared by New file / New folder / Rename (they
 *                           differ only in title, description, and submit
 *                           handler, so one component handles all three).
 *   - DeleteConfirmDialog — folder-vs-file aware confirmation.
 *   - CreateContentDialog — new managed content_object (title + type + lang).
 *   - UploadDialog        — drag-and-drop staging with destination picker.
 *
 * Each dialog is a controlled component: the parent owns the open state and
 * the data, the dialog just renders + calls back. This keeps the studio's
 * render tree shallow and makes the dialogs trivially testable.
 */

import * as React from "react";
import {
  Upload,
  FolderPlus,
  FilePlus,
  Pencil,
  Trash2,
  Loader2,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  adminApi,
  type ContentType,
} from "@/components/osler/admin/admin-api";
import {
  ContentDropzone,
  stagedKeyFor,
  uploadStagedFile,
  type DroppedFile,
} from "@/components/osler/admin/content-dropzone";
import { CATEGORIES, folderPathOf } from "./types";
import type { DialogState } from "./use-content-actions";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";

const CONTENT_TYPES: ContentType[] = ["quiz", "bank", "flashcard", "written", "osce", "library", "video"];

// ── PathInputDialog (New file / New folder / Rename) ────────────────────────

export function PathInputDialog({
  dialog,
  onPathChange,
  onClose,
  onSubmit,
  busy,
}: {
  dialog: DialogState;
  onPathChange: (path: string) => void;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const open = dialog.pathMode !== null;
  if (!open) return null;

  const mode = dialog.pathMode;
  const titleKey = mode === "newFile"
    ? "admin.content.newFileTitle"
    : mode === "newFolder"
      ? "admin.content.newFolderTitle"
      : "admin.content.renameTitle";
  const descKey = mode === "newFile"
    ? "admin.content.newFileDesc"
    : mode === "newFolder"
      ? "admin.content.newFolderDesc"
      : "admin.content.renameDesc";
  const Icon = mode === "newFile" ? FilePlus : mode === "newFolder" ? FolderPlus : Pencil;
  const actionKey = mode === "rename" ? "admin.content.rename" : "admin.content.create";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t(titleKey as any)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <p className="text-xs text-muted-foreground">{t(descKey as any)}</p>
          <Input
            value={dialog.pathInput}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder={mode === "newFile"
              ? "qbank/cardiology/acute-coronary/questions.json"
              : mode === "newFolder"
                ? "library/cardiology/new-topic"
                : ""}
            className="font-mono text-xs"
            autoFocus
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy && dialog.pathInput.trim()) onSubmit();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button size="sm" onClick={onSubmit} disabled={busy || !dialog.pathInput.trim()}>
            {busy ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : <Icon className="me-1.5 size-3.5" />}
            {t(actionKey as any)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── DeleteConfirmDialog ─────────────────────────────────────────────────────

export function DeleteConfirmDialog({
  node,
  open,
  onClose,
  onConfirm,
  busy,
}: {
  node: ContentTreeNode | null;
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  busy?: boolean;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        // Keep the dialog pinned while the delete request is in flight so a
        // stray Escape / backdrop click can't dismiss it mid-operation.
        if (!o && !busy) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {node?.kind === "folder"
              ? t("admin.content.deleteFolderTitle")
              : t("admin.content.deleteR2Title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {node?.kind === "folder"
              ? t("admin.content.confirmDeleteFolder", { key: folderPathOf(node) })
              : t("admin.content.confirmDeleteR2", { key: node?.r2Key ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={busy}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {busy ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : <Trash2 className="me-1.5 size-3.5" />}
            {t("admin.content.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── CreateContentDialog ─────────────────────────────────────────────────────

export function CreateContentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [contentType, setContentType] = React.useState<ContentType>("library");
  const [title, setTitle] = React.useState("");
  const [language, setLanguage] = React.useState("en");
  const [busy, setBusy] = React.useState(false);

  async function create() {
    if (!title.trim()) return;
    haptic("light");
    setBusy(true);
    try {
      const res = await adminApi.createContent({
        contentType,
        title: title.trim(),
        language,
      });
      toast({ title: t("admin.content.saved") });
      onCreated(res.id);
    } catch {
      toast({ title: t("admin.toast.failedCreateContent"), variant: "destructive" });
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
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("admin.content.type")}
              </label>
              <Select value={contentType} onValueChange={(v) => setContentType(v as ContentType)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
          <Button size="sm" onClick={create} disabled={busy || !title.trim()}>
            {busy ? t("common.loading") : t("admin.content.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── UploadDialog ────────────────────────────────────────────────────────────

export function UploadDialog({
  open,
  onClose,
  onStagedUploaded,
  canAdmin,
}: {
  open: boolean;
  onClose: () => void;
  onStagedUploaded: () => void;
  canAdmin: boolean;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [category, setCategory] = React.useState("qbank");
  const [subpath, setSubpath] = React.useState("");
  const [dropped, setDropped] = React.useState<DroppedFile[]>([]);
  const [uploading, setUploading] = React.useState(false);

  React.useEffect(() => {
    if (!open) setDropped([]);
  }, [open]);

  const destination = subpath.trim() ? `${category}/${subpath.trim().replace(/^\/+/, "")}` : category;
  const destinationLabel = `content-staging/${destination}/`;

  async function handleUpload() {
    if (dropped.length === 0) return;
    haptic("light");
    setUploading(true);
    let unique = dropped;
    try {
      unique = Array.from(
        new Map(dropped.map((d) => [stagedKeyFor(d, destination), d])).values(),
      );
    } catch {}
    let success = 0;
    for (const d of unique) {
      try {
        await uploadStagedFile(d, destination);
        success += 1;
      } catch (err) {
        toast({
          title: t("admin.content.browser.uploadFailed", { name: d.file.name }),
          description: String(err),
          variant: "destructive",
        });
      }
    }
    setUploading(false);
    if (success > 0) {
      toast({
        title: t("admin.content.dropzone.stagedUploaded", { n: success, dest: destinationLabel }),
      });
      onStagedUploaded();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("admin.content.dropzone.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">{t("admin.content.upload.stagedDesc")}</p>

          {canAdmin && (
            <div className="space-y-1.5 border border-border rounded-lg p-2.5 bg-card/60">
              <label className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("admin.content.upload.destination")}
              </label>
              <div className="flex items-center gap-2">
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-28 h-8 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat.folder} value={cat.folder}>
                        {t(cat.labelKey as any)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center flex-1 min-w-0 font-mono text-xs text-muted-foreground">
                  <span className="shrink-0">content-staging/</span>
                  <Input
                    value={subpath}
                    onChange={(e) => setSubpath(e.target.value)}
                    placeholder="qbank/cardiology/…"
                    className="flex-1 h-8 font-mono text-xs"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground/80 break-all">
                {t("admin.content.upload.destinationPreview", { dest: destinationLabel })}
              </p>
            </div>
          )}

          <ContentDropzone
            onFiles={(files) => {
              setDropped((prev) => {
                try {
                  const seen = new Set(prev.map((p) => stagedKeyFor(p, destination)));
                  const fresh = files.filter((f) => {
                    const k = stagedKeyFor(f, destination);
                    if (seen.has(k)) return false;
                    seen.add(k);
                    return true;
                  });
                  return fresh.length > 0 ? [...prev, ...fresh] : prev;
                } catch {
                  return [...prev, ...files];
                }
              });
            }}
          />

          {dropped.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("admin.content.queuedFiles", { n: dropped.length })}
              </p>
              <div className="max-h-40 overflow-y-auto osler-scroll-y space-y-1">
                {dropped.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2 py-1 border border-border rounded-md bg-card/60 text-xs"
                  >
                    <FilePlus className="size-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate font-mono">
                      {destinationLabel}{d.relativePath ?? d.file.name}
                    </span>
                    <button
                      onClick={() => setDropped((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive text-sm leading-none px-1"
                      aria-label={t("common.remove")}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{t("admin.content.dropzone.hint")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={uploading}>{t("common.cancel")}</Button>
          <Button size="sm" onClick={handleUpload} disabled={uploading || dropped.length === 0}>
            {uploading ? (
              <><Loader2 className="me-1.5 size-3.5 animate-spin" />{t("admin.content.dropzone.uploading", { n: dropped.length })}</>
            ) : (
              <><Upload className="me-1.5 size-3.5" />{t("admin.content.browser.upload")}{dropped.length > 0 ? ` (${dropped.length})` : ""}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
