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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const STATUS_COLOR: Record<string, string> = {
  draft: "text-muted-foreground",
  pending: "text-warning",
  published: "text-success",
  rejected: "text-destructive",
};

interface ContentEditorProps {
  id: string;
  capabilities: AdminCapabilities;
}

type EditorMode = "form" | "code" | "preview";

export function ContentEditor({ id, capabilities }: ContentEditorProps) {
  const { t } = useI18n();
  const { settings } = useAdminSettings();
  const { toast } = useToast();
  const router = useRouter();

  const [obj, setObj] = React.useState<ContentObject | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [body, setBody] = React.useState("");
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [publishTargetPath, setPublishTargetPath] = React.useState("");
  const [validating, setValidating] = React.useState(false);
  const [validationErrors, setValidationErrors] = React.useState<string[] | null>(null);
  const [showValidation, setShowValidation] = React.useState(false);
  const [mode, setMode] = React.useState<EditorMode>("form");
  const [artifactContentType, setArtifactContentType] = React.useState<"md" | "pdf" | "html">("md");
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    adminApi
      .getContent(id)
      .then((c) => {
        setObj(c);
        setBody(c.body ?? "{}");
      })
      .catch(() => toast({ title: t("admin.toast.contentNotFound"), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [id]);

  // Auto-pick the best initial editor mode for the content type.
  React.useEffect(() => {
    if (!obj) return;
    if (obj.content_type === "library") {
      setMode("form");
      // Detect content type from body
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
  }, [obj]);

  function handleBodyChange(value: string) {
    setBody(value);
    setDirty(true);
    if (validationErrors !== null) setValidationErrors(null);
    if (!settings.autoSaveDrafts) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => autoSave(value), 2500);
  }

  async function autoSave(value: string) {
    if (!obj) return;
    try { await adminApi.saveDraft(id, value); } catch {}
  }

  async function saveDraft() {
    haptic("light");
    setSaving(true);
    try {
      await adminApi.saveDraft(id, body);
      setDirty(false);
      toast({ title: t("admin.content.saved") });
    } catch {
      toast({ title: t("admin.toast.saveFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    haptic("light");
    await adminApi.saveDraft(id, body).catch(() => {});
    try {
      const res = await adminApi.submitForReview(id);
      setObj((o) => (o ? { ...o, status: res.status as any } : o));
      toast({ title: t("admin.content.submitted") });
    } catch {
      toast({ title: t("admin.toast.submitFailed"), variant: "destructive" });
    }
  }

  async function doPublish(targetPath?: string) {
    haptic("light");
    await adminApi.saveDraft(id, body).catch(() => {});
    try {
      const res = await adminApi.publishDirect(id, targetPath ? { targetPath } : {});
      setObj((o) => (o ? { ...o, status: res.status as any } : o));
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
    if (!obj) return;
    setValidating(true);
    setShowValidation(true);
    try {
      const res = await adminApi.validateContent(id, body);
      setValidationErrors(res.errors);
      if (res.errors.length === 0) toast({ title: t("admin.content.valid") });
      else toast({ title: t("admin.content.validationIssues", { n: String(res.errors.length) }), variant: "destructive" });
    } catch (err) {
      toast({ title: t("admin.toast.saveFailed"), variant: "destructive" });
    } finally {
      setValidating(false);
    }
  }

  async function deleteContent() {
    haptic("warning");
    try {
      await adminApi.deleteContent(id);
      router.push("/admin/content");
    } catch {
      toast({ title: t("admin.toast.deleteFailed"), variant: "destructive" });
    }
  }

  if (loading) return <LoadingState label={t("common.loading")} />;
  if (!obj) return null;

  const isPending = obj.status === "pending";
  const isLibrary = obj.content_type === "library";

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
      setBody(nextBody);
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
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3 sm:px-4 backdrop-blur-md safe-pt">
        <Button variant="ghost" size="iconSm" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm truncate">{obj.title ?? t("admin.content.untitled")}</span>
          <span className={cn("ms-2 text-xs font-medium", STATUS_COLOR[obj.status])}>
            {t(`admin.content.status.${obj.status}` as any)}
          </span>
          {dirty && (
            <span
              className="ms-2 inline-flex items-center gap-1 text-xs text-muted-foreground"
              title={t("admin.content.editor.dirty")}
            >
              <span className="size-1.5 rounded-full bg-warning" />
              {t("admin.content.editor.dirty")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!isPending && (
            <Button variant="outline" size="sm" onClick={runValidation} disabled={validating} title={t("admin.content.editor.validate")}>
              {validating ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : <ShieldCheck className="me-1.5 size-3.5" />}
              {t("admin.content.editor.validate")}
            </Button>
          )}
          {!isPending && (
            <Button variant="outline" size="sm" onClick={saveDraft} disabled={saving}>
              {saving ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : <Save className="me-1.5 size-3.5" />}
              {t("admin.content.saveDraft")}
            </Button>
          )}
          {!isPending && (
            <Button variant="outline" size="sm" onClick={submit}>
              <Send className="me-1.5 size-3.5" />
              {t("admin.content.submit")}
            </Button>
          )}
          {capabilities.publishDirect && !isPending && (
            <Button size="sm" onClick={() => { setPublishTargetPath(suggestedPath); setPublishOpen(true); }}>
              <Upload className="me-1.5 size-3.5" />
              {t("admin.content.publishDirect")}
            </Button>
          )}
          {capabilities.manageUsers && (
            <Button
              variant="ghost"
              size="iconSm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
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
        {/* Metadata sidebar */}
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
                  r2KeyBase={obj.r2_key_base}
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
                  contentType={obj.content_type}
                  parsed={parsed}
                  onChange={handleFormChange}
                  readOnly={isPending}
                  r2KeyBase={obj.r2_key_base}
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

      {/* Delete dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.content.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.content.deleteConfirm", {
                title: obj.title ?? t("admin.content.untitled"),
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

const PREVIEW_MARKDOWN_STYLES = `
  .preview-md h1 { font-size: 1.75rem; font-weight: 700; margin: 1.5rem 0 0.75rem; }
  .preview-md h2 { font-size: 1.4rem; font-weight: 600; margin: 1.25rem 0 0.5rem; border-bottom: 1px solid oklch(0.87 0 0); padding-bottom: 0.25rem; }
  .preview-md h3 { font-size: 1.1rem; font-weight: 600; margin: 1rem 0 0.4rem; }
  .preview-md p { margin: 0.6rem 0; line-height: 1.7; }
  .preview-md ul, .preview-md ol { padding-inline-start: 1.5rem; margin: 0.5rem 0; }
  .preview-md li { margin: 0.2rem 0; }
  .preview-md blockquote { border-inline-start: 3px solid oklch(0.6 0.1 250); background: oklch(0.97 0.01 250); margin: 0.75rem 0; padding: 0.5rem 1rem; border-radius: 0 0.25rem 0.25rem 0; }
  .preview-md code { font-family: monospace; background: oklch(0.95 0 0); padding: 0.15rem 0.35rem; border-radius: 0.25rem; font-size: 0.85em; }
  .preview-md pre { background: oklch(0.15 0 0); color: oklch(0.92 0 0); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.75rem 0; }
  .preview-md pre code { background: transparent; padding: 0; }
  .preview-md table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; }
  .preview-md th, .preview-md td { border: 1px solid oklch(0.85 0 0); padding: 0.4rem 0.6rem; text-align: start; font-size: 0.9em; }
  .preview-md th { background: oklch(0.95 0 0); font-weight: 600; }
  .preview-md img { max-width: 100%; border-radius: 0.5rem; margin: 0.75rem 0; }
  .preview-md hr { border: none; border-top: 1px solid oklch(0.85 0 0); margin: 1.5rem 0; }
  .preview-md a { color: oklch(0.4 0.15 260); text-decoration: underline; }
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

function FormEditorSwitch({
  contentType,
  parsed,
  onChange,
  readOnly,
  r2KeyBase,
}: {
  contentType: ContentType;
  parsed: any;
  onChange: (next: any) => void;
  readOnly?: boolean;
  r2KeyBase?: string;
}) {
  const { t } = useI18n();
  if (Array.isArray(parsed?.stations)) {
    return <OsceEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} />;
  }
  if (Array.isArray(parsed?.videos)) {
    return <VideoEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} />;
  }
  if (Array.isArray(parsed?.cards) || Array.isArray(parsed?.decks) || Array.isArray(parsed?.subdecks) || parsed?.front != null) {
    return <FlashcardEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} />;
  }
  if (Array.isArray(parsed?.passages)) {
    // Distinguish bank vs quiz-by-passages: bank passages have `content`,
    // quiz passages have `stem`. We pass to BankEditor which handles both.
    return <BankEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} />;
  }
  if (Array.isArray(parsed?.prompts)) {
    return <WrittenEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} />;
  }
  if (Array.isArray(parsed?.questions)) {
    return <QuizEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} />;
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
