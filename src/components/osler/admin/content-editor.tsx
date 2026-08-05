"use client";

import * as React from "react";
import {
  Save,
  Send,
  Upload,
  Trash2,
  ArrowLeft,
  Code2,
  FormInput,
  Eye,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  PackagePlus,
  AlertTriangle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useI18n } from "@/components/osler/i18n-provider";
import { useAdminSettings } from "@/components/osler/admin/admin-settings-context";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/osler/ui-primitives";
import {
  adminApi,
  type ContentObject,
  type AdminCapabilities,
  type ContentType,
} from "@/components/osler/admin/admin-api";
import { useToast } from "@/hooks/use-toast";
import { JsonCodeEditor } from "@/components/osler/admin/editors/json-code-editor";
import {
  QuizEditor,
  FlashcardEditor,
  OsceEditor,
  VideoEditor,
  LibraryArticleEditor,
  WrittenEditor,
  BankEditor,
} from "@/components/osler/admin/editors/structured-editors";
import { resolveImageForPreview, r2KeyToWorkerUrl } from "@/components/osler/admin/editors/image-upload";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const STATUS_COLOR: Record<string, string> = {
  draft: "text-muted-foreground",
  pending: "text-warning",
  published: "text-success",
  rejected: "text-destructive",
};

interface ContentEditorProps {
  /** Managed content_object id. Mutually exclusive with `rawR2Key`. */
  id?: string;
  /** Raw R2 key (e.g. "content-files/library/asthma.md") to edit in place
   *  without a backing content_object. When set, the editor loads the body
   *  directly from the Worker's /v1/content/* endpoint and saves via
   *  /v1/admin/content/upload-file. */
  rawR2Key?: string;
  capabilities: AdminCapabilities;
}

type EditorMode = "form" | "code" | "preview";

export function ContentEditor({ id, rawR2Key, capabilities }: ContentEditorProps) {
  const { t } = useI18n();
  const { settings } = useAdminSettings();
  const { toast } = useToast();
  const router = useRouter();

  const isRawMode = !id && !!rawR2Key;

  const [obj, setObj] = React.useState<ContentObject | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [publishTargetPath, setPublishTargetPath] = React.useState("");
  // Unsaved-changes-on-back confirmation — replaces the old `confirm()` so
  // the prompt is a proper modal (dismissible, focus-trapped, keyboard-
  // accessible) rather than a blocking native dialog.
  const [unsavedBackOpen, setUnsavedBackOpen] = React.useState(false);
  const [validating, setValidating] = React.useState(false);
  const [validationErrors, setValidationErrors] = React.useState<string[] | null>(null);
  const [showValidation, setShowValidation] = React.useState(false);
  const [mode, setMode] = React.useState<EditorMode>("form");
  const [artifactContentType, setArtifactContentType] = React.useState<"md" | "pdf" | "html">("md");
  const [adopting, setAdopting] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest body, kept in a ref so the debounced autosave and a manual save
  // always write the most recent content — never a stale snapshot captured
  // when the timer was scheduled (which could otherwise land AFTER a newer
  // save and revert the draft).
  const bodyRef = React.useRef(body);
  const savingRef = React.useRef(false);

  function inferModeFromBody(text: string, key: string) {
    // Infer artifact content type from the key extension.
    if (key.endsWith(".md")) setArtifactContentType("md");
    else if (key.endsWith(".pdf") || text.startsWith("data:application/pdf;base64,")) setArtifactContentType("pdf");
    else if (key.endsWith(".html") || (text.startsWith("<") && !text.startsWith("---"))) setArtifactContentType("html");
    // Default to code mode for raw files (no form mapping unless we
    // can recognise the shape).
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed.questions) || Array.isArray(parsed.passages) || Array.isArray(parsed.cards) ||
          Array.isArray(parsed.stations) || Array.isArray(parsed.videos) || Array.isArray(parsed.prompts)) {
        setMode("form");
      } else {
        setMode("code");
      }
    } catch {
      // Not JSON — if it's markdown, use form (LibraryArticleEditor); otherwise code.
      if (artifactContentType === "md" || key.endsWith(".md")) setMode("form");
      else setMode("code");
    }
  }

  // ── Load body ──
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (isRawMode && rawR2Key) {
          // Raw mode — fetch the body. Public keys (content-files/) are
          // served directly by the Worker's public content endpoint; staged
          // keys (content-staging/) are private and go through the
          // admin-gated endpoint instead.
          if (rawR2Key.startsWith("content-staging/")) {
            const res = await adminApi.getR2Content(rawR2Key);
            if (cancelled) return;
            const text = res.body;
            bodyRef.current = text;
            setBody(text);
            inferModeFromBody(text, rawR2Key);
            return;
          }
          const url = r2KeyToWorkerUrl(rawR2Key);
          if (!url) throw new Error("Cloud not configured");
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${res.status}`);
          const text = await res.text();
          if (cancelled) return;
          bodyRef.current = text;
          setBody(text);
          inferModeFromBody(text, rawR2Key);
        } else if (id) {
          // Managed mode — fetch the content_object + body from the admin API.
          const c = await adminApi.getContent(id);
          if (cancelled) return;
          setObj(c);
          bodyRef.current = c.body ?? "{}";
          setBody(c.body ?? "{}");
        }
      } catch {
        if (!cancelled) toast({ title: t("admin.toast.contentNotFound"), variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, rawR2Key, isRawMode, t, toast]);

  // Auto-pick the best initial editor mode for managed library content.
  React.useEffect(() => {
    if (isRawMode || !obj) return;
    if (obj.content_type === "library") {
      setMode("form");
      const b = obj.body ?? "";
      if (b.startsWith("data:application/pdf;base64,")) setArtifactContentType("pdf");
      else if (b.startsWith("<") && !b.startsWith("---")) setArtifactContentType("html");
      else setArtifactContentType("md");
      return;
    }
    try {
      const parsed = JSON.parse(body || "{}");
      if (isFormSupported(obj.content_type, parsed)) setMode("form");
      else setMode("code");
    } catch {
      setMode("code");
    }
  }, [obj, isRawMode, body]);

  function handleBodyChange(value: string) {
    bodyRef.current = value;
    setBody(value);
    setDirty(true);
    if (validationErrors !== null) setValidationErrors(null);
    if (isRawMode) return; // no autosave in raw mode (would be confusing without explicit save)
    if (!settings.autoSaveDrafts) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => autoSave(), 2500);
  }

  async function autoSave() {
    if (!obj || !id) return;
    if (savingRef.current) return; // a manual save is in flight and writes the latest body
    if (!dirty) return;            // nothing unsaved — a manual save already persisted it
    try {
      await adminApi.saveDraft(id, bodyRef.current);
      setLastSavedAt(Date.now());
    } catch {}
  }

  async function saveDraft() {
    haptic("light");
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    setSaving(true);
    savingRef.current = true;
    const latest = bodyRef.current;
    try {
      if (isRawMode && rawR2Key) {
        // Save raw R2 key directly. The upload-file endpoint accepts a text
        // body or a data URI for binary assets — text is the common case.
        await adminApi.uploadFile(rawR2Key, latest);
      } else if (id) {
        await adminApi.saveDraft(id, latest);
      } else {
        throw new Error("Nothing to save");
      }
      setDirty(false);
      setLastSavedAt(Date.now());
      toast({ title: t("admin.content.saved") });
    } catch {
      toast({ title: t("admin.toast.saveFailed"), variant: "destructive" });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // ── Ctrl/Cmd+S keyboard shortcut ──
  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!saving) saveDraft();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saving, body, isRawMode, rawR2Key, id]);

  // ── Unsaved-changes guard ──
  React.useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  async function promoteToManaged() {
    if (!rawR2Key) return;
    setAdopting(true);
    try {
      const res = await adminApi.adoptR2Key(rawR2Key);
      toast({
        title: res.alreadyExisted
          ? t("admin.toast.adoptAlreadyManaged")
          : t("admin.toast.adopted", { id: res.id.slice(0, 8) }),
      });
      // Route to the managed editor. `adopt` reads the last-saved body from
      // R2, so push any unsaved edits into the (new or existing) managed
      // draft — otherwise they'd be lost on re-adopt of an already-managed
      // file, or stale after a fresh adopt.
      if (dirty) await adminApi.saveDraft(res.id, bodyRef.current).catch(() => {});
      router.replace(`/admin/content?id=${encodeURIComponent(res.id)}`);
    } catch (err: any) {
      toast({ title: t("admin.toast.adoptFailed", { error: String(err?.message ?? err) }), variant: "destructive" });
    } finally {
      setAdopting(false);
    }
  }

  async function submit() {
    if (!id) return;
    haptic("light");
    await adminApi.saveDraft(id, bodyRef.current).catch(() => {});
    try {
      const res = await adminApi.submitForReview(id);
      setObj((o) => (o ? { ...o, status: res.status as any } : o));
      setDirty(false);
      setLastSavedAt(Date.now());
      toast({ title: t("admin.content.submitted") });
    } catch {
      toast({ title: t("admin.toast.submitFailed"), variant: "destructive" });
    }
  }

  async function doPublish(targetPath?: string) {
    if (!id) return;
    haptic("light");
    await adminApi.saveDraft(id, bodyRef.current).catch(() => {});
    try {
      const res = await adminApi.publishDirect(id, targetPath ? { targetPath } : {});
      setObj((o) => (o ? { ...o, status: res.status as any } : o));
      setDirty(false);
      setLastSavedAt(Date.now());
      toast({
        title: t("admin.content.published"),
        description: res.hybridKeys.length
          ? t("admin.content.syncedToStudent", { count: res.hybridKeys.length })
          : undefined,
      });
    } catch {
      toast({ title: t("admin.toast.publishFailed"), variant: "destructive" });
    }
  }

  async function runValidation() {
    if (!obj && !isRawMode) return;
    setValidating(true);
    setShowValidation(true);
    try {
      let res: { errors: string[] };
      if (isRawMode) {
        // No content_object — use the standalone validator. Infer
        // contentType from the raw key shape.
        const ct = inferContentTypeFromR2Key(rawR2Key ?? "", body);
        if (!ct) {
          // Library articles can't be validated standalone.
          res = { errors: [] };
        } else {
          res = await adminApi.validateStandalone(ct, body);
        }
      } else if (id) {
        res = await adminApi.validateContent(id, body);
      } else {
        res = { errors: [] };
      }
      setValidationErrors(res.errors);
      if (res.errors.length === 0) toast({ title: t("admin.content.valid") });
      else toast({ title: t("admin.content.validationIssues", { n: String(res.errors.length) }), variant: "destructive" });
    } catch {
      toast({ title: t("admin.toast.saveFailed"), variant: "destructive" });
    } finally {
      setValidating(false);
    }
  }

  async function deleteContent() {
    if (!id) return;
    haptic("warning");
    try {
      await adminApi.deleteContent(id);
      router.push("/admin/content");
    } catch {
      toast({ title: t("admin.toast.deleteFailed"), variant: "destructive" });
    }
  }

  if (loading) return <LoadingState label={t("common.loading")} />;
  if (!isRawMode && !obj) return null;

  const isPending = !isRawMode && obj?.status === "pending";
  const isLibrary = isRawMode
    ? (rawR2Key?.endsWith(".md") ?? false)
      || (rawR2Key?.endsWith(".html") ?? false)
      || (rawR2Key?.endsWith(".pdf") ?? false)
    : obj?.content_type === "library";

  let parsed: any = null;
  let parseError: string | null = null;
  if (!isLibrary) {
    try {
      parsed = JSON.parse(body || "{}");
    } catch (err) {
      parseError = String(err).replace(/^SyntaxError:\s*/, "");
    }
  }

  function handleFormChange(next: any) {
    if (isLibrary) {
      // next can be a string (markdown) or { body, contentType }
      const nextBody = typeof next === "string" ? next : (next?.body ?? "");
      // Route through handleBodyChange so dirty state, autosave, and the
      // unsaved-changes guard all fire for library edits too (raw mode's
      // Save button depends on `dirty` being set).
      handleBodyChange(nextBody);
      // Store contentType on the component for publish path logic
      if (typeof next === "object" && next?.contentType) {
        setArtifactContentType(next.contentType);
      } else {
        // Detect from body
        if (nextBody.startsWith("data:application/pdf;base64,")) setArtifactContentType("pdf");
        else if (nextBody.startsWith("<") && !nextBody.startsWith("---")) setArtifactContentType("html");
        else setArtifactContentType("md");
      }
    } else {
      handleBodyChange(JSON.stringify(next, null, 2));
    }
  }

  // Compute a suggested target path for publishing (used as the default in
  // the publish dialog). Based on the content type and (if available) the
  // title. For library articles uses the selected artifact content type extension.
  const suggestedPath = (() => {
    if (isRawMode) return rawR2Key?.replace(/^content-files\//, "") ?? "";
    if (!obj) return "";
    const slug = (obj.title ?? obj.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    switch (obj.content_type) {
      case "library": {
        const ext = artifactContentType === "pdf" ? ".pdf" : artifactContentType === "html" ? ".html" : ".md";
        return `library/${slug}${ext}`;
      }
      case "flashcard": return `flashcard/${slug}/cards.json`;
      case "osce": return `osce/${slug}/stations.json`;
      case "video": return `videos/${slug}/videos.json`;
      case "bank": return `qbank/${slug}/passages.json`;
      case "written": return `qbank/${slug}/prompts.json`;
      case "quiz":
      default: return `qbank/${slug}/questions.json`;
    }
  })();

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-card/60 px-3 sm:px-4 backdrop-blur-md safe-pt">
        <Button variant="ghost" size="iconXs" onClick={() => {
          if (dirty) {
            // Defer the navigation to the confirmation modal so the user
            // can still change their mind after seeing the prompt.
            setUnsavedBackOpen(true);
            return;
          }
          router.back();
        }}>
          <ArrowLeft className="size-3.5" />
        </Button>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm truncate">
            {isRawMode ? (rawR2Key ?? "").replace(/^content-files\//, "") : (obj?.title ?? t("admin.content.untitled"))}
          </span>
          {isRawMode ? (
            <span className="ms-2 inline-flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="size-3" />
              {t("admin.content.editor.rawBadge")}
            </span>
          ) : (
            <span className={cn("ms-2 text-xs font-medium", STATUS_COLOR[obj?.status ?? "draft"])}>
              {t(`admin.content.status.${obj?.status ?? "draft"}` as any)}
            </span>
          )}
          {dirty && (
            <span
              className="ms-2 inline-flex items-center gap-1 text-xs text-muted-foreground"
              title={t("admin.content.editor.dirty")}
            >
              <span className="size-1.5 rounded-full bg-warning" />
              {t("admin.content.editor.dirty")}
            </span>
          )}
          {!dirty && lastSavedAt && (
            <span className="ms-2 inline-flex items-center gap-1 text-xs text-muted-foreground/70">
              <CheckCircle2 className="size-3" />
              {t("admin.content.editor.lastSaved", { time: new Date(lastSavedAt).toLocaleTimeString() })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Raw mode: Save + Promote to managed. No submit/publish/delete
              (those require a backing content_object). */}
          {isRawMode && (
            <>
              <Button variant="outline" size="xs" onClick={runValidation} disabled={validating} title={t("admin.content.editor.validate")}>
                {validating ? <Loader2 className="me-1 size-3 animate-spin" /> : <ShieldCheck className="me-1 size-3" />}
                {t("admin.content.editor.validate")}
              </Button>
              <Button variant="outline" size="xs" onClick={saveDraft} disabled={saving || !dirty}>
                {saving ? <Loader2 className="me-1 size-3 animate-spin" /> : <Save className="me-1 size-3" />}
                {t("admin.content.saveDraft")}
              </Button>
              {capabilities.manageContent && (
                <Button size="xs" onClick={promoteToManaged} disabled={adopting}>
                  {adopting ? <Loader2 className="me-1 size-3 animate-spin" /> : <PackagePlus className="me-1 size-3" />}
                  {t("admin.content.editor.promote")}
                </Button>
              )}
            </>
          )}
          {/* Managed mode: full workflow buttons */}
          {!isRawMode && !isPending && (
            <>
              <Button variant="outline" size="xs" onClick={runValidation} disabled={validating} title={t("admin.content.editor.validate")}>
                {validating ? <Loader2 className="me-1 size-3 animate-spin" /> : <ShieldCheck className="me-1 size-3" />}
                {t("admin.content.editor.validate")}
              </Button>
              <Button variant="outline" size="xs" onClick={saveDraft} disabled={saving}>
                {saving ? <Loader2 className="me-1 size-3 animate-spin" /> : <Save className="me-1 size-3" />}
                {t("admin.content.saveDraft")}
              </Button>
              <Button variant="outline" size="xs" onClick={submit}>
                <Send className="me-1 size-3" />
                {t("admin.content.submit")}
              </Button>
              {capabilities.publishDirect && (
                <Button size="xs" onClick={() => { setPublishTargetPath(suggestedPath); setPublishOpen(true); }}>
                  <Upload className="me-1 size-3" />
                  {t("admin.content.publishDirect")}
                </Button>
              )}
            </>
          )}
          {!isRawMode && isPending && (
            <span className="text-xs text-muted-foreground px-2">{t("admin.content.pendingNotice")}</span>
          )}
          {!isRawMode && capabilities.manageUsers && (
            <Button
              variant="ghost"
              size="iconXs"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Raw-mode banner */}
      {isRawMode && (
        <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">{t("admin.content.editor.rawBannerTitle")}</p>
            <p className="text-warning/80 mt-0.5">{t("admin.content.editor.rawBannerDesc")}</p>
          </div>
        </div>
      )}

      {/* Rejection notice */}
      {!isRawMode && obj?.status === "rejected" && obj.rejection_reason && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {t("admin.content.rejectedReason", { reason: obj.rejection_reason })}
        </div>
      )}

      {/* Validation panel */}
      {showValidation && validationErrors !== null && (
        <div className={cn(
          "border-b px-4 py-2 text-sm flex items-center gap-2",
          validationErrors.length === 0
            ? "border-success/30 bg-success/10 text-success"
            : "border-warning/30 bg-warning/10 text-warning"
        )}>
          {validationErrors.length === 0 ? (
            <><ShieldCheck className="size-4" /> {t("admin.content.validDesc")}</>
          ) : (
            <details className="flex-1">
              <summary className="cursor-pointer flex items-center gap-2">
                <ShieldAlert className="size-4" />
                {t("admin.content.validationIssues", { n: String(validationErrors.length) })}
              </summary>
              <ul className="mt-1 ms-6 list-disc text-xs space-y-0.5">
                {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
          <Button variant="ghost" size="iconSm" onClick={() => setShowValidation(false)}>×</Button>
        </div>
      )}

      {/* Mode switcher */}
      <div className="flex items-center gap-2 border-b border-border px-3 sm:px-4 py-1.5 bg-muted/20">
        <ModeButton
          active={mode === "form"}
          onClick={() => setMode("form")}
          icon={FormInput}
          label={t("admin.content.editor.form")}
          disabled={isLibrary ? false : !!parseError}
        />
        <ModeButton
          active={mode === "code"}
          onClick={() => setMode("code")}
          icon={Code2}
          label={t("admin.content.editor.code")}
        />
        {isLibrary && (
          <ModeButton
            active={mode === "preview"}
            onClick={() => setMode("preview")}
            icon={Eye}
            label={t("admin.content.editor.preview")}
          />
        )}

        <div className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
          {parseError ? (
            <span className="flex items-center gap-1 text-destructive">
              <XCircle className="size-3.5" />
              <span className="truncate max-w-[200px]">{parseError}</span>
            </span>
          ) : !isLibrary ? (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="size-3.5" />
              {t("admin.content.editor.valid")}
            </span>
          ) : null}
        </div>
      </div>

      {/* Editor body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Metadata sidebar — managed mode only */}
        {!isRawMode && obj && (
        <aside className="hidden lg:flex w-56 shrink-0 border-e border-border bg-card/40 p-4 text-xs space-y-3 flex-col overflow-y-auto medos-scroll-y">
          <div>
            <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t("admin.content.col.type")}
            </div>
            <Badge variant="outline" className="font-mono">
              {obj.content_type}
            </Badge>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t("admin.content.language")}
            </div>
            <span>{obj.language}</span>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t("admin.content.col.author")}
            </div>
            <span>@{obj.creator_username ?? obj.created_by.slice(0, 8)}</span>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t("admin.content.col.updated")}
            </div>
            <span>{new Date(obj.updated_at).toLocaleString()}</span>
          </div>

          {settings.showAdvancedFields && (
            <>
              <div className="border-t border-border pt-2 mt-2">
                <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  {t("admin.content.editor.advanced")}
                </div>
              </div>
              <div>
                <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t("admin.content.metadata.id")}</div>
                <span className="font-mono text-xs break-all">{obj.id}</span>
              </div>
              <div>
                <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t("admin.content.metadata.r2Key")}</div>
                <span className="font-mono text-xs break-all">{obj.r2_key_base}</span>
              </div>
              <div>
                <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t("admin.content.metadata.created")}</div>
                <span>{new Date(obj.created_at).toLocaleString()}</span>
              </div>
              {obj.submitted_at && (
                <div>
                  <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t("admin.content.metadata.submitted")}</div>
                  <span>{new Date(obj.submitted_at).toLocaleString()}</span>
                </div>
              )}
              {obj.reviewed_at && (
                <div>
                  <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t("admin.content.metadata.reviewed")}</div>
                  <span>{new Date(obj.reviewed_at).toLocaleString()}</span>
                </div>
              )}
            </>
          )}
        </aside>
        )}

        {/* Metadata sidebar — raw mode */}
        {isRawMode && (
        <aside className="hidden lg:flex w-56 shrink-0 border-e border-warning/20 bg-warning/5 p-4 text-xs space-y-3 flex-col overflow-y-auto medos-scroll-y">
          <div>
            <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t("admin.content.editor.rawSidebarTitle")}
            </div>
            <p className="text-warning leading-relaxed">{t("admin.content.editor.rawSidebarDesc")}</p>
          </div>
          <div className="border-t border-border pt-2 mt-2">
            <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t("admin.content.metadata.r2Key")}
            </div>
            <span className="font-mono text-xs break-all">{rawR2Key}</span>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t("admin.content.editor.rawSize")}
            </div>
            <span className="font-mono text-xs">{body.length.toLocaleString()} chars</span>
          </div>
          {capabilities.manageContent && (
            <div className="border-t border-border pt-3 mt-2">
              <Button size="sm" className="w-full" onClick={promoteToManaged} disabled={adopting}>
                {adopting ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : <PackagePlus className="me-1.5 size-3.5" />}
                {t("admin.content.editor.promote")}
              </Button>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                {t("admin.content.editor.promoteHint")}
              </p>
            </div>
          )}
        </aside>
        )}

        {/* Editor main pane */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {isPending ? (
            <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
              <div>
                <p className="mb-2">{t("admin.content.pendingNotice")}</p>
                <Button variant="outline" size="sm" onClick={() => router.push("/admin/review")}>
                  {t("admin.content.goToReview")}
                </Button>
              </div>
            </div>
          ) : mode === "form" ? (
            <div className="flex-1 overflow-y-auto medos-scroll-y p-3 sm:p-4">
              {isLibrary ? (
                <LibraryArticleEditor
                  value={body}
                  onChange={handleFormChange}
                  readOnly={isPending}
                  r2KeyBase={isRawMode ? undefined : obj?.r2_key_base}
                  rawR2Key={isRawMode ? rawR2Key : undefined}
                />
              ) : parseError ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6">
                  <XCircle className="size-8 text-destructive mb-2" />
                  <p className="text-sm font-medium">{t("admin.content.cannotShowForm")}</p>
                  <p className="text-xs text-muted-foreground mt-1 mb-3 max-w-sm">
                    {t("admin.content.invalidJsonHint")}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setMode("code")}>
                    <Code2 className="size-3.5 me-1.5" />
                    {t("admin.content.editor.code")}
                  </Button>
                </div>
              ) : (
                <FormEditorSwitch
                  contentType={obj?.content_type ?? inferContentTypeFromR2Key(rawR2Key ?? "", body) ?? "quiz"}
                  parsed={parsed}
                  onChange={handleFormChange}
                  readOnly={isPending}
                  r2KeyBase={isRawMode ? undefined : obj?.r2_key_base}
                  rawR2Key={isRawMode ? rawR2Key : undefined}
                />
              )}
            </div>
          ) : mode === "preview" && isLibrary ? (
            <div className="flex-1 overflow-y-auto medos-scroll-y p-6">
              <style>{PREVIEW_MARKDOWN_STYLES}</style>
              <article className="preview-md max-w-3xl mx-auto">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ inline, className, children, ...props }: any) {
                      const text = String(children);
                      if (!inline && className === "language-mermaid") {
                        return <MermaidPreviewBlock code={text} />;
                      }
                      return <code className={className} {...props}>{children}</code>;
                    },
                    img({ src, alt, ...props }: any) {
                      // Resolve relative image refs to admin-previewable URLs
                      // so the user can see their uploaded images inline
                      // without leaving the editor.
                      const resolved = resolveImageForPreview(
                        String(src ?? ""),
                        {
                          r2KeyBase: isRawMode ? undefined : obj?.r2_key_base,
                          rawR2Key: isRawMode ? rawR2Key : undefined,
                        },
                      );
                      return (
                        <img
                          src={resolved}
                          alt={alt}
                          {...props}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                          }}
                        />
                      );
                    },
                  }}
                >
                  {parseFrontmatter(body).body}
                </ReactMarkdown>
              </article>
            </div>
          ) : (
            <JsonCodeEditor
              value={body}
              onChange={handleBodyChange}
              readOnly={isPending}
              className="flex-1"
            />
          )}
        </div>
      </div>

      {/* Delete dialog — managed mode only (raw mode has no delete button) */}
      {!isRawMode && (
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.content.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.content.deleteConfirm", {
                title: obj?.title ?? t("admin.content.untitled"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteContent}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t("admin.content.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      )}

      {/* Publish dialog — lets admin choose the target path */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.content.publishDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {t("admin.content.publishDialogDesc")}
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("admin.content.publishDialogTargetPath")}
              </label>
              <Input
                value={publishTargetPath}
                onChange={(e) => setPublishTargetPath(e.target.value)}
                placeholder={suggestedPath}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("admin.content.publishDialogAutoPath")} <code>{suggestedPath}</code>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                setPublishOpen(false);
                doPublish(publishTargetPath.trim() || undefined);
              }}
            >
              <Upload className="size-3.5 me-1.5" />
              {t("admin.content.publishButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsaved-changes-on-back confirmation — replaces the old
          `confirm()` so the prompt is a proper modal that supports
          backdrop-dismiss, Esc-to-cancel, and tab-trapped focus. */}
      <AlertDialog open={unsavedBackOpen} onOpenChange={setUnsavedBackOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.content.editor.unsavedTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.content.editor.unsavedConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setUnsavedBackOpen(false);
                // Mark as not-dirty so the beforeunload guard doesn't
                // re-prompt on the way out.
                setDirty(false);
                router.back();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t("admin.content.editor.unsavedDiscard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Preview helpers ─────────────────────────────────────────────────────────

function parseFrontmatter(md: string): { body: string } {
  const lines = md.split("\n");
  if (lines[0]?.trim() !== "---") return { body: md };
  let end = 1;
  while (end < lines.length && lines[end]?.trim() !== "---") end++;
  return { body: lines.slice(end + 1).join("\n").trim() };
}

export const PREVIEW_MARKDOWN_STYLES = `
  .preview-md { color: var(--foreground); font-size: 0.9rem; line-height: 1.65; }
  .preview-md h1 { font-size: 1.75rem; font-weight: 700; margin: 1.5rem 0 0.75rem; color: var(--foreground); }
  .preview-md h2 { font-size: 1.4rem; font-weight: 600; margin: 1.25rem 0 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25rem; color: var(--foreground); }
  .preview-md h3 { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.4rem; color: var(--foreground); }
  .preview-md p { margin: 0.6rem 0; line-height: 1.7; }
  .preview-md ul, .preview-md ol { padding-inline-start: 1.5rem; margin: 0.5rem 0; }
  .preview-md li { margin: 0.2rem 0; }
  .preview-md blockquote { border-inline-start: 3px solid var(--info); background: color-mix(in oklch, var(--info) 10%, transparent); margin: 0.75rem 0; padding: 0.5rem 1rem; border-radius: 0 0.25rem 0.25rem 0; }
  .preview-md code { font-family: var(--font-geist-mono), ui-monospace, monospace; background: var(--muted); color: var(--foreground); padding: 0.15rem 0.35rem; border-radius: 0.25rem; font-size: 0.85em; }
  .preview-md pre { background: var(--muted); color: var(--foreground); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.75rem 0; }
  .preview-md pre code { background: transparent; padding: 0; }
  .preview-md table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; }
  .preview-md th, .preview-md td { border: 1px solid var(--border); padding: 0.4rem 0.6rem; text-align: start; font-size: 0.9em; color: var(--foreground); }
  .preview-md th { background: var(--muted); font-weight: 600; color: var(--foreground); }
  .preview-md img { max-width: 100%; border-radius: 0.5rem; margin: 0.75rem 0; }
  .preview-md hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
  .preview-md a { color: var(--primary); text-decoration: underline; }
`;

function MermaidPreviewBlock({ code }: { code: string }) {
  const { t } = useI18n();
  const [svg, setSvg] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("mermaid");
        const m = mod.default;
        m.initialize({
          startOnLoad: false,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
          securityLevel: "loose",
        });
        const id = `preview-md-${Math.random().toString(36).slice(2, 10)}`;
        const { svg: out } = await m.render(id, code.trim());
        if (!cancelled) { setSvg(out); setError(""); }
        document.getElementById(id)?.remove();
      } catch (err: any) {
        if (!cancelled) setError(String(err?.message ?? err));
      }
    })();
    return () => { cancelled = true; };
  }, [code]);
  if (error) {
    return <pre className="bg-destructive/10 text-destructive p-2 rounded text-xs">{t("admin.content.mermaidError", { error, code })}</pre>;
  }
  if (!svg) return <div className="text-xs text-muted-foreground p-4 text-center">{t("admin.content.renderingDiagram")}</div>;
  return <div dangerouslySetInnerHTML={{ __html: svg }} className="my-4 [&_svg]:max-w-full [&_svg]:h-auto" />;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary border border-primary/30"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-transparent",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function isFormSupported(contentType: ContentType, parsed: any): boolean {
  if (contentType === "library") return true;
  if (!parsed || typeof parsed !== "object") return false;
  return (
    Array.isArray(parsed.questions) ||
    Array.isArray(parsed.passages) ||
    Array.isArray(parsed.cards) ||
    Array.isArray(parsed.decks) ||
    Array.isArray(parsed.stations) ||
    Array.isArray(parsed.videos) ||
    Array.isArray(parsed.prompts) ||
    Array.isArray(parsed.subdecks) ||
    (parsed.front != null && parsed.back != null)
  );
}

/** Best-effort contentType inference for raw R2 keys (used in raw editor mode).
 *  Returns undefined for library articles (.md, .html, .pdf) — those can't
 *  be validated standalone, the validator returns no errors for them. */
function inferContentTypeFromR2Key(key: string, body: string): ContentType | null {
  if (key.endsWith(".md") || key.endsWith(".html") || key.endsWith(".pdf")) return "library";
  if (!key.endsWith(".json")) return null;
  try {
    const j = JSON.parse(body);
    if (Array.isArray(j.questions)) return "quiz";
    if (Array.isArray(j.passages)) return "bank";
    if (Array.isArray(j.prompts)) return "written";
    if (Array.isArray(j.cards) || Array.isArray(j.decks) || Array.isArray(j.subdecks)) return "flashcard";
    if (Array.isArray(j.stations)) return "osce";
    if (Array.isArray(j.videos)) return "video";
  } catch {}
  return null;
}

function FormEditorSwitch({
  contentType,
  parsed,
  onChange,
  readOnly,
  r2KeyBase,
  rawR2Key,
}: {
  contentType: ContentType;
  parsed: any;
  onChange: (next: any) => void;
  readOnly?: boolean;
  r2KeyBase?: string;
  rawR2Key?: string;
}) {
  const { t } = useI18n();
  if (Array.isArray(parsed?.stations)) {
    return <OsceEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
  }
  if (Array.isArray(parsed?.videos)) {
    return <VideoEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
  }
  if (Array.isArray(parsed?.cards) || Array.isArray(parsed?.decks) || Array.isArray(parsed?.subdecks) || parsed?.front != null) {
    return <FlashcardEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
  }
  if (Array.isArray(parsed?.passages)) {
    // Distinguish bank vs quiz-by-passages: bank passages have `content`,
    // quiz passages have `stem`. We pass to BankEditor which handles both.
    return <BankEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
  }
  if (Array.isArray(parsed?.prompts)) {
    return <WrittenEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
  }
  if (Array.isArray(parsed?.questions)) {
    return <QuizEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
  }
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
      <FormInput className="size-8 text-muted-foreground mb-2" />
      <p className="text-sm font-medium">{t("admin.content.noStructuredForm")}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm">
        {t("admin.content.switchToCode")}
      </p>
    </div>
  );
}
