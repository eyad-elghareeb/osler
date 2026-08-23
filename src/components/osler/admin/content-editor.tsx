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
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  PackagePlus,
  AlertTriangle,
  X,
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
import { clearSidecarCache } from "@/lib/osler/articles";
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
import { r2KeyToWorkerUrl } from "@/components/osler/admin/editors/image-upload";

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

type EditorMode = "form" | "code";

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
  /**
   * Article sidecar metadata (library .md only). Lives OUTSIDE the markdown
   * body — persisted as `<article>.meta.json` (raw / published) or the
   * object's `assets/meta.json` draft asset (managed), so the WYSIWYG editor
   * never has to touch frontmatter.
   */
  const [articleMeta, setArticleMeta] = React.useState<Record<string, unknown> | null>(null);
  const articleMetaRef = React.useRef<Record<string, unknown> | null>(null);
  articleMetaRef.current = articleMeta;
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest body, kept in a ref so the debounced autosave and a manual save
  // always write the most recent content — never a stale snapshot captured
  // when the timer was scheduled (which could otherwise land AFTER a newer
  // save and revert the draft).
  const bodyRef = React.useRef(body);
  const savingRef = React.useRef(false);

  // ── Large-file handling ──────────────────────────────────────────────
  // Three rules keep 400KB+ documents responsive:
  //   1. Parse once per body — the parse result is cached against the exact
  //      text it came from (parsedSourceRef) and reused by mode inference.
  //   2. In form mode the parsed object is the live source of truth — it
  //      updates synchronously so controlled inputs never lag, while the
  //      serialized body follows on a short debounce (a 400KB stringify per
  //      keystroke is what freezes typing).
  //   3. Code-mode re-parses debounce ~300ms after typing pauses.
  const LARGE_BODY = 150_000;
  const [parseState, setParseState] = React.useState<{
    parsed: any;
    error: string | null;
    parsing: boolean;
  }>({ parsed: null, error: null, parsing: false });
  const parseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const formSyncTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const parsedRef = React.useRef<any>(null);
  /** The exact body text that parsedRef/parseState came from. */
  const parsedSourceRef = React.useRef<string | null>(null);

  const computeParse = React.useCallback((text: string) => {
    parsedSourceRef.current = text;
    try {
      const parsed = JSON.parse(text);
      parsedRef.current = parsed;
      setParseState({ parsed, error: null, parsing: false });
    } catch (err) {
      parsedRef.current = null;
      setParseState({
        parsed: null,
        error: String(err).replace(/^SyntaxError:\s*/, ""),
        parsing: false,
      });
    }
  }, []);

  /** Serialize the latest parsed document into the body (ref + state). */
  function syncBodyFromParsed() {
    const s = JSON.stringify(parsedRef.current ?? {}, null, 2);
    parsedSourceRef.current = s;
    bodyRef.current = s;
    setBody(s);
  }

  // Flush any pending debounced form-mode serialization so saves,
  // validation, and mode switches always see the latest text.
  function flushFormBody() {
    if (formSyncTimerRef.current) {
      clearTimeout(formSyncTimerRef.current);
      formSyncTimerRef.current = null;
      syncBodyFromParsed();
    }
  }

  /** Parse the latest text right now, cancelling any pending debounced
   *  parse. Used when switching to Form mode so the structured editors
   *  never render a stale snapshot of a large body. */
  function forceParseNow() {
    if (parseTimerRef.current) {
      clearTimeout(parseTimerRef.current);
      parseTimerRef.current = null;
    }
    if (parsedSourceRef.current !== bodyRef.current) computeParse(bodyRef.current);
  }

  function inferModeFromBody(text: string, parsed: any, key: string) {
    // Infer artifact content type from the key extension.
    if (key.endsWith(".md")) setArtifactContentType("md");
    else if (key.endsWith(".pdf") || text.startsWith("data:application/pdf;base64,")) setArtifactContentType("pdf");
    else if (key.endsWith(".html") || (text.startsWith("<") && !text.startsWith("---"))) setArtifactContentType("html");
    // Default to code mode for raw files (no form mapping unless we
    // can recognise the shape) — `parsed` comes from the single load-time
    // parse, never a second JSON.parse here.
    if (parsed != null) {
      if (Array.isArray(parsed.questions) || Array.isArray(parsed.passages) || Array.isArray(parsed.cards) ||
          Array.isArray(parsed.stations) || Array.isArray(parsed.videos) || Array.isArray(parsed.prompts)) {
        setMode("form");
      } else {
        setMode("code");
      }
    } else {
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
          const loadSidecar = async () => {
            const sideKey = sidecarKeyForR2Key(rawR2Key);
            try {
              let text: string | null = null;
              if (rawR2Key.startsWith("content-staging/")) {
                text = (await adminApi.getR2Content(sideKey)).body;
              } else {
                const url = r2KeyToWorkerUrl(sideKey);
                if (url) {
                  const res = await fetch(url);
                  if (res.ok) text = await res.text();
                }
              }
              if (!cancelled && text) setArticleMeta(JSON.parse(text));
            } catch {}
          };
          if (rawR2Key.startsWith("content-staging/")) {
            const res = await adminApi.getR2Content(rawR2Key);
            if (cancelled) return;
            const text = res.body;
            bodyRef.current = text;
            setBody(text);
            if (!rawR2Key.endsWith(".md") && !rawR2Key.endsWith(".html") && !rawR2Key.endsWith(".pdf")) {
              computeParse(text);
            }
            inferModeFromBody(text, parsedRef.current, rawR2Key);
            await loadSidecar();
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
          if (!rawR2Key.endsWith(".md") && !rawR2Key.endsWith(".html") && !rawR2Key.endsWith(".pdf")) {
            computeParse(text);
          }
          inferModeFromBody(text, parsedRef.current, rawR2Key);
          if (rawR2Key.endsWith(".md")) await loadSidecar();
        } else if (id) {
          // Managed mode — fetch the content_object + body from the admin API.
          const c = await adminApi.getContent(id);
          if (cancelled) return;
          setObj(c);
          const text = c.body ?? "{}";
          bodyRef.current = text;
          setBody(text);
          if (c.content_type !== "library") computeParse(text);
          // Library sidecar: draft asset first, then the published copy.
          if (c.content_type === "library") {
            try {
              let sideText: string | null = null;
              try {
                sideText = await (await adminApi.getAssetBlob(id, "assets/meta.json")).text();
              } catch {}
              if (!sideText && c.published_r2_key) {
                const pubUrl = r2KeyToWorkerUrl(sidecarKeyForR2Key(c.published_r2_key));
                if (pubUrl) {
                  const res = await fetch(pubUrl);
                  if (res.ok) sideText = await res.text();
                }
              }
              if (!cancelled && sideText) setArticleMeta(JSON.parse(sideText));
            } catch {}
          }
        }
      } catch {
        if (!cancelled) toast({ title: t("admin.toast.contentNotFound"), variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, rawR2Key, isRawMode, t, toast, computeParse]);

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
    // Reuse the load-time parse when it matches the current body; fall back
    // to a synchronous parse only if the cache is cold (e.g. a mode pick
    // raced ahead of the load). Never re-parse per keystroke.
    if (parsedSourceRef.current === bodyRef.current) {
      if (parsedRef.current != null) {
        setMode(isFormSupported(obj.content_type, parsedRef.current) ? "form" : "code");
      } else {
        setMode("code");
      }
    } else {
      try {
        const parsed = JSON.parse(bodyRef.current || "{}");
        if (isFormSupported(obj.content_type, parsed)) setMode("form");
        else setMode("code");
      } catch {
        setMode("code");
      }
    }
    // Runs once when the object loads — later edits must not re-run this.
  }, [obj, isRawMode]);

  // Debounced JSON parse — see LARGE_BODY above. Skips text that has
  // already been parsed (load path, form-mode sync).
  React.useEffect(() => {
    // Inline `isLibrary` (the render-time const is declared after the
    // loading early-return, so it isn't initialized on the first render).
    const isLib = isRawMode
      ? (rawR2Key?.endsWith(".md") ?? false)
        || (rawR2Key?.endsWith(".html") ?? false)
        || (rawR2Key?.endsWith(".pdf") ?? false)
      : obj?.content_type === "library";
    if (isLib) return;
    if (parsedSourceRef.current === body) return; // already parsed this exact text
    if (parseTimerRef.current) {
      clearTimeout(parseTimerRef.current);
      parseTimerRef.current = null;
    }
    if (body.length <= LARGE_BODY) {
      computeParse(body);
      return;
    }
    setParseState((s) => ({ ...s, parsing: true }));
    parseTimerRef.current = setTimeout(() => {
      parseTimerRef.current = null;
      computeParse(bodyRef.current);
    }, 300);
    return () => {
      if (parseTimerRef.current) {
        clearTimeout(parseTimerRef.current);
        parseTimerRef.current = null;
      }
    };
  }, [body, isRawMode, rawR2Key, obj, computeParse]);

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
    flushFormBody();
    try {
      await adminApi.saveDraft(id, bodyRef.current);
      await persistArticleMeta();
      setLastSavedAt(Date.now());
    } catch {}
  }

  /**
   * Persist the sidecar metadata alongside the body. Raw mode writes the
   * `.meta.json` next to the article file; managed mode writes the draft
   * asset and mirrors it next to the published copy when one exists.
   * Best-effort — a metadata write failure must not fail the body save.
   */
  async function persistArticleMeta(): Promise<void> {
    const meta = articleMetaRef.current;
    if (meta === null) return;
    const json = JSON.stringify(meta);
    try {
      if (isRawMode && rawR2Key) {
        await adminApi.uploadFile(sidecarKeyForR2Key(rawR2Key), json);
        clearSidecarCache();
      } else if (id) {
        await adminApi.uploadAsset(id, "assets/meta.json", json, "application/json");
        const pub = obj?.published_r2_key;
        if (pub) {
          await adminApi.uploadFile(sidecarKeyForR2Key(pub), json);
          clearSidecarCache();
        }
      }
    } catch {}
  }

  async function saveDraft() {
    haptic("light");
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    setSaving(true);
    savingRef.current = true;
    flushFormBody();
    const latest = bodyRef.current;
    try {
      if (isRawMode && rawR2Key) {
        // Save raw R2 key directly. The upload-file endpoint accepts a text
        // body or a data URI for binary assets — text is the common case.
        await adminApi.uploadFile(rawR2Key, latest);
        await persistArticleMeta();
      } else if (id) {
        await adminApi.saveDraft(id, latest);
        await persistArticleMeta();
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

  /** Best-effort manifest rebuild for the category a published key belongs
   *  to — keeps student-facing manifests in sync after editor-side deletes
   *  and publishes. */
  const autoRebuildForCategory = React.useCallback((categoryOrKey: string) => {
    const clean = categoryOrKey
      .replace(/^content-files\//, "")
      .replace(/^content-staging\//, "")
      .replace(/^content\//, "")
      .replace(/^\/+/, "");
    const cat = clean.split("/")[0];
    if (cat && ["library", "qbank", "flashcard", "osce", "videos"].includes(cat)) {
      adminApi.regenerateManifest(cat).catch(() => {});
    }
  }, []);

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
      flushFormBody();
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
    flushFormBody();
    await adminApi.saveDraft(id, bodyRef.current).catch(() => {});
    await persistArticleMeta();
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
    flushFormBody();
    await adminApi.saveDraft(id, bodyRef.current).catch(() => {});
    await persistArticleMeta();
    try {
      const res = await adminApi.publishDirect(id, targetPath ? { targetPath } : {});
      // Mirror the sidecar next to the freshly published article so the
      // student app merges it over frontmatter without a republish.
      const pubKey = obj?.published_r2_key ?? null;
      if (pubKey && articleMetaRef.current !== null && obj?.content_type === "library" && artifactContentType === "md") {
        await adminApi.uploadFile(sidecarKeyForR2Key(pubKey), JSON.stringify(articleMetaRef.current)).catch(() => {});
        clearSidecarCache();
      }
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
    flushFormBody();
    setValidating(true);
    setShowValidation(true);
    try {
      let res: { errors: string[] };
      if (isRawMode) {
        // No content_object — use the standalone validator. Infer
        // contentType from the raw key shape. Always validate the latest
        // body from the ref, never the (possibly debounced) state.
        const ct = inferContentTypeFromR2Key(rawR2Key ?? "", bodyRef.current);
        if (!ct) {
          // Library articles can't be validated standalone.
          res = { errors: [] };
        } else {
          res = await adminApi.validateStandalone(ct, bodyRef.current);
        }
      } else if (id) {
        res = await adminApi.validateContent(id, bodyRef.current);
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
      // Snapshot the hybrid key before deletion so we can rebuild that
      // category's manifest after the object (and its student-facing copy)
      // is gone.
      const pubKey = obj?.published_r2_key ?? null;
      await adminApi.deleteContent(id);
      if (pubKey) autoRebuildForCategory(pubKey);
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

  // Parsed JSON comes from the debounced parse effect — never a synchronous
  // JSON.parse in the render body (that re-parsed the full document on every
  // keystroke and unrelated re-render).
  const parsed = parseState.parsed;
  const parseError = parseState.error;

  function handleFormChange(next: any) {
    if (isLibrary) {
      // next can be a string (legacy) or { body, contentType, meta? } —
      // `meta` carries the sidecar metadata for markdown articles.
      const nextBody = typeof next === "string" ? next : (next?.body ?? "");
      // Route through handleBodyChange so dirty state, autosave, and the
      // unsaved-changes guard all fire for library edits too (raw mode's
      // Save button depends on `dirty` being set).
      handleBodyChange(nextBody);
      if (typeof next === "object") setArticleMeta(next.meta ?? null);
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
      // Form mode: the parsed document is the source of truth. It updates
      // synchronously so the controlled inputs stay live, while the
      // serialized body follows on a short debounce — serializing a 400KB
      // document on every keystroke is what freezes typing on big packs.
      parsedRef.current = next;
      setParseState({ parsed: next, error: null, parsing: false });
      setDirty(true);
      if (validationErrors !== null) setValidationErrors(null);
      if (settings.autoSaveDrafts) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => autoSave(), 2500);
      }
      if ((bodyRef.current?.length ?? 0) <= LARGE_BODY) {
        syncBodyFromParsed();
      } else if (!formSyncTimerRef.current) {
        formSyncTimerRef.current = setTimeout(() => {
          formSyncTimerRef.current = null;
          syncBodyFromParsed();
        }, 400);
      }
    }
  }

  // Compute a suggested target path for publishing (used as the default in
  // the publish dialog). Prefers the object's existing student-facing
  // location (published_r2_key) so re-publishing keeps the file in its
  // original folder; falls back to a title-slug path for never-published
  // drafts. Library articles use the selected artifact extension.
  const suggestedPath = (() => {
    if (isRawMode) return rawR2Key?.replace(/^content-files\//, "") ?? "";
    if (!obj) return "";
    // Strip the leading category — the worker re-prepends it from
    // content_type. Keeps "qbank/cardiology/questions.json" as
    // "cardiology/questions.json".
    const fromPublished = (obj.published_r2_key ?? "").replace(/^content-files\//, "").split("/").slice(1).join("/");
    if (fromPublished) return fromPublished;
    // Category-relative slugs — hybridPublish() already prepends the
    // category folder from content_type.
    const slug = (obj.title ?? obj.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    switch (obj.content_type) {
      case "library": {
        const ext = artifactContentType === "pdf" ? ".pdf" : artifactContentType === "html" ? ".html" : ".md";
        return `${slug}${ext}`;
      }
      case "flashcard": return `${slug}/cards.json`;
      case "osce": return `${slug}/stations.json`;
      case "video": return `${slug}/videos.json`;
      case "bank": return `${slug}/passages.json`;
      case "written": return `${slug}/prompts.json`;
      case "quiz":
      default: return `${slug}/questions.json`;
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
            <span className="ms-2 hidden items-center gap-1 text-xs text-warning sm:inline-flex">
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
              <span className="hidden sm:inline">{t("admin.content.editor.dirty")}</span>
            </span>
          )}
          {!dirty && lastSavedAt && (
            <span className="ms-2 hidden items-center gap-1 text-xs text-muted-foreground/70 sm:inline-flex">
              <CheckCircle2 className="size-3" />
              {t("admin.content.editor.lastSaved", { time: new Date(lastSavedAt).toLocaleTimeString() })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Raw mode: Save + Promote to managed. No submit/publish/delete
              (those require a backing content_object). Labels collapse to
              icons below sm so the toolbar fits a phone. */}
          {isRawMode && (
            <>
              <Button variant="outline" size="xs" onClick={runValidation} disabled={validating} title={t("admin.content.editor.validate")}>
                {validating ? <Loader2 className="size-3 sm:me-1 animate-spin" /> : <ShieldCheck className="size-3 sm:me-1" />}
                <span className="hidden sm:inline">{t("admin.content.editor.validate")}</span>
              </Button>
              <Button variant="outline" size="xs" onClick={saveDraft} disabled={saving || !dirty}>
                {saving ? <Loader2 className="size-3 sm:me-1 animate-spin" /> : <Save className="size-3 sm:me-1" />}
                <span className="hidden sm:inline">{t("admin.content.saveDraft")}</span>
              </Button>
              {capabilities.manageContent && (
                <Button size="xs" onClick={promoteToManaged} disabled={adopting} title={t("admin.content.editor.promote")}>
                  {adopting ? <Loader2 className="size-3 sm:me-1 animate-spin" /> : <PackagePlus className="size-3 sm:me-1" />}
                  <span className="hidden sm:inline">{t("admin.content.editor.promote")}</span>
                </Button>
              )}
            </>
          )}
          {/* Managed mode: full workflow buttons */}
          {!isRawMode && !isPending && (
            <>
              <Button variant="outline" size="xs" onClick={runValidation} disabled={validating} title={t("admin.content.editor.validate")}>
                {validating ? <Loader2 className="size-3 sm:me-1 animate-spin" /> : <ShieldCheck className="size-3 sm:me-1" />}
                <span className="hidden sm:inline">{t("admin.content.editor.validate")}</span>
              </Button>
              <Button variant="outline" size="xs" onClick={saveDraft} disabled={saving} title={t("admin.content.saveDraft")}>
                {saving ? <Loader2 className="size-3 sm:me-1 animate-spin" /> : <Save className="size-3 sm:me-1" />}
                <span className="hidden sm:inline">{t("admin.content.saveDraft")}</span>
              </Button>
              <Button variant="outline" size="xs" onClick={submit} title={t("admin.content.submit")}>
                <Send className="size-3 sm:me-1" />
                <span className="hidden sm:inline">{t("admin.content.submit")}</span>
              </Button>
              {capabilities.publishDirect && (
                <Button size="xs" onClick={() => { setPublishTargetPath(suggestedPath); setPublishOpen(true); }} title={t("admin.content.publishDirect")}>
                  <Upload className="size-3 sm:me-1" />
                  <span className="hidden sm:inline">{t("admin.content.publishDirect")}</span>
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
          <Button variant="ghost" size="iconSm" onClick={() => setShowValidation(false)} aria-label={t("common.close")}>
            <X className="size-3.5" />
          </Button>
        </div>
      )}

      {/* Mode switcher — hidden for library articles (their MarkdownEditor has
          its own edit/split/preview toggle, so form/code/preview here would be
          redundant) */}
      {!isLibrary && (
        <div className="flex items-center gap-2 border-b border-border px-3 sm:px-4 py-1.5 bg-muted/20">
          <ModeButton
            active={mode === "form"}
            onClick={() => {
              // Parse the latest text right now so the structured editors
              // never render a stale snapshot of a large debounced body.
              forceParseNow();
              setMode("form");
            }}
            icon={FormInput}
            label={t("admin.content.editor.form")}
            disabled={!!parseError && !parseState.parsing}
          />
          <ModeButton
            active={mode === "code"}
            onClick={() => {
              // Sync any pending debounced form edit into the body state so
              // the code textarea shows the latest text.
              flushFormBody();
              setMode("code");
            }}
            icon={Code2}
            label={t("admin.content.editor.code")}
          />

          <div className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
            {parseState.parsing ? (
              <span className="flex items-center gap-1">
                <Loader2 className="size-3.5 animate-spin" />
                {t("admin.content.editor.parsing")}
              </span>
            ) : parseError ? (
              <span className="flex items-center gap-1 text-destructive">
                <XCircle className="size-3.5" />
                <span className="truncate max-w-[200px]">{parseError}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-success">
                <CheckCircle2 className="size-3.5" />
                {t("admin.content.editor.valid")}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Editor body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Metadata sidebar — managed mode only */}
        {!isRawMode && obj && (
        <aside className="hidden lg:flex w-56 shrink-0 border-e border-border bg-card p-4 text-xs space-y-3 flex-col overflow-y-auto osler-scroll-y">
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
        <aside className="hidden lg:flex w-56 shrink-0 border-e border-warning/20 bg-warning/5 p-4 text-xs space-y-3 flex-col overflow-y-auto osler-scroll-y">
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
            <div className={cn(
              "flex-1",
              isLibrary ? "min-h-0 p-3 sm:p-4 flex flex-col overflow-hidden" : "overflow-y-auto osler-scroll-y p-3 sm:p-4"
            )}>
              {isLibrary ? (
                <LibraryArticleEditor
                  value={body}
                  onChange={handleFormChange}
                  readOnly={isPending}
                  r2KeyBase={isRawMode ? undefined : obj?.r2_key_base}
                  rawR2Key={isRawMode ? rawR2Key : undefined}
                  meta={articleMeta}
                />
              ) : parseState.parsing ? (
                <LoadingState label={t("admin.content.editor.parsing")} />
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

// ── Helpers ────────────────────────────────────────────────────────────────

/** R2 key of an article's sidecar metadata file
 *  ("content-files/library/a/b.md" → "content-files/library/a/b.meta.json"). */
function sidecarKeyForR2Key(r2Key: string): string {
  const slash = r2Key.lastIndexOf("/");
  const dir = slash >= 0 ? r2Key.slice(0, slash + 1) : "";
  const base = slash >= 0 ? r2Key.slice(slash + 1) : r2Key;
  const dot = base.lastIndexOf(".");
  return `${dir}${dot > 0 ? base.slice(0, dot) : base}.meta.json`;
}

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
 *  Returns null for library articles (.md, .html, .pdf) — those can't be
 *  validated standalone; returning a truthy type here made the validator
 *  JSON.parse markdown and report bogus syntax errors. */
function inferContentTypeFromR2Key(key: string, body: string): ContentType | null {
  if (key.endsWith(".md") || key.endsWith(".html") || key.endsWith(".pdf")) return null;
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
    // Bank files may have a flat questions[] array without passages.
    // If the content type is explicitly "bank", use BankEditor;
    // otherwise use QuizEditor for regular quiz packs.
    if (contentType === "bank") {
      return <BankEditor value={parsed} onChange={onChange} readOnly={readOnly} r2KeyBase={r2KeyBase} rawR2Key={rawR2Key} />;
    }
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
