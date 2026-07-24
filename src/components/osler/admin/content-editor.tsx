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
  const [mode, setMode] = React.useState<EditorMode>("form");
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
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-pick the best initial editor mode for the content type.
  React.useEffect(() => {
    if (!obj) return;
    if (obj.content_type === "library") {
      setMode("form");
      return;
    }
    // For JSON content, try form mode first if it parses.
    try {
      const parsed = JSON.parse(body || "{}");
      if (isFormSupported(obj.content_type, parsed)) {
        setMode("form");
      } else {
        setMode("code");
      }
    } catch {
      setMode("code");
    }
  }, [obj]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleBodyChange(value: string) {
    setBody(value);
    setDirty(true);
    if (!settings.autoSaveDrafts) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => autoSave(value), 2500);
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

  async function publishDirect() {
    haptic("light");
    await adminApi.saveDraft(id, body).catch(() => {});
    try {
      const res = await adminApi.publishDirect(id);
      setObj((o) => (o ? { ...o, status: res.status as any } : o));
      toast({ title: t("admin.content.published") });
    } catch {
      toast({ title: t("admin.toast.publishFailed"), variant: "destructive" });
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

  // For form mode, parse the JSON body once. If parse fails we fall back to code.
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
      handleBodyChange(typeof next === "string" ? next : next?.body ?? "");
    } else {
      handleBodyChange(JSON.stringify(next, null, 2));
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3 sm:px-4 backdrop-blur-md safe-pt">
        <Button variant="ghost" size="iconSm" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm truncate">{obj.title ?? t("admin.content.untitled")}</span>
          <span className={cn("ml-2 text-xs font-medium", STATUS_COLOR[obj.status])}>
            {t(`admin.content.status.${obj.status}` as any)}
          </span>
          {dirty && (
            <span
              className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground"
              title={t("admin.content.editor.dirty")}
            >
              <span className="size-1.5 rounded-full bg-warning" />
              {t("admin.content.editor.dirty")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!isPending && (
            <Button variant="outline" size="sm" onClick={saveDraft} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 size-3.5" />
              )}
              {t("admin.content.saveDraft")}
            </Button>
          )}
          {!isPending && (
            <Button variant="outline" size="sm" onClick={submit}>
              <Send className="mr-1.5 size-3.5" />
              {t("admin.content.submit")}
            </Button>
          )}
          {capabilities.publishDirect && !isPending && (
            <Button size="sm" onClick={publishDirect}>
              <Upload className="mr-1.5 size-3.5" />
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

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
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
                <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">ID</div>
                <span className="font-mono text-xs break-all">{obj.id}</span>
              </div>
              <div>
                <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">R2 key</div>
                <span className="font-mono text-xs break-all">{obj.r2_key_base}</span>
              </div>
              <div>
                <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">Created</div>
                <span>{new Date(obj.created_at).toLocaleString()}</span>
              </div>
              {obj.submitted_at && (
                <div>
                  <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">Submitted</div>
                  <span>{new Date(obj.submitted_at).toLocaleString()}</span>
                </div>
              )}
              {obj.reviewed_at && (
                <div>
                  <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">Reviewed</div>
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
                />
              ) : parseError ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6">
                  <XCircle className="size-8 text-destructive mb-2" />
                  <p className="text-sm font-medium">{t("admin.content.cannotShowForm")}</p>
                  <p className="text-xs text-muted-foreground mt-1 mb-3 max-w-sm">
                    {t("admin.content.invalidJsonHint")}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setMode("code")}>
                    <Code2 className="size-3.5 mr-1.5" />
                    {t("admin.content.editor.code")}
                  </Button>
                </div>
              ) : (
                <FormEditorSwitch
                  contentType={obj.content_type}
                  parsed={parsed}
                  onChange={handleFormChange}
                  readOnly={isPending}
                />
              )}
            </div>
          ) : mode === "preview" && isLibrary ? (
            <div className="flex-1 overflow-y-auto medos-scroll-y p-6">
              <article className="osler-prose max-w-3xl mx-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
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
    </div>
  );
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
    (parsed.front != null && parsed.back != null)
  );
}

function FormEditorSwitch({
  contentType,
  parsed,
  onChange,
  readOnly,
}: {
  contentType: ContentType;
  parsed: any;
  onChange: (next: any) => void;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  // Detect the right editor based on the shape (not just the declared type)
  if (Array.isArray(parsed?.stations)) {
    return <OsceEditor value={parsed} onChange={onChange} readOnly={readOnly} />;
  }
  if (Array.isArray(parsed?.videos)) {
    return <VideoEditor value={parsed} onChange={onChange} readOnly={readOnly} />;
  }
  if (Array.isArray(parsed?.cards) || Array.isArray(parsed?.decks) || parsed?.front != null) {
    return <FlashcardEditor value={parsed} onChange={onChange} readOnly={readOnly} />;
  }
  if (Array.isArray(parsed?.passages)) {
    return <BankEditor value={parsed} onChange={onChange} readOnly={readOnly} />;
  }
  if (Array.isArray(parsed?.prompts)) {
    return <WrittenEditor value={parsed} onChange={onChange} readOnly={readOnly} />;
  }
  if (Array.isArray(parsed?.questions)) {
    return <QuizEditor value={parsed} onChange={onChange} readOnly={readOnly} />;
  }
  // Fallback: show a hint that no form is available, switch to code
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
