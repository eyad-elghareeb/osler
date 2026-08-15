"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { springSoft } from "@/lib/osler/motion";
import {
  ArrowLeft,
  Plus,
  Trash2,
  NotebookPen,
  Notebook,
  Eye,
  Pencil,
  Tag,
  X,
  Clock,
  Check,
  FileText,
  Folder,
  ExternalLink,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { usePlatform } from "@/hooks/use-platform";
import {
  useResizableSidebar,
  SidebarResizeHandle,
} from "@/hooks/use-resizable-sidebar";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";
import { notes as notesStore, type NoteRecord } from "@/lib/osler/storage";
import { useI18n } from "./i18n-provider";
import { MilkdownEditor } from "./milkdown-editor";

/* ── Markdown preview (lightweight, GFM, no raw HTML) ──────────────── */
/* The notes panel uses a lightweight read-only preview built on
 * react-markdown + remark-gfm, lazy-loaded on first use so it doesn't
 * bloat the initial bundle. The MilkdownEditor in `edit` mode handles all
 * the WYSIWYG editing — this is only used when the user toggles to
 * "preview" mode to read a finished note. */
let MarkdownRenderer: React.ComponentType<{
  remarkPlugins?: unknown[];
  children?: React.ReactNode;
}> | null = null;
let remarkGfmPlugin: unknown = null;
let markdownPromise: Promise<void> | null = null;

function ensureMarkdown(): Promise<void> {
  if (MarkdownRenderer && remarkGfmPlugin) return Promise.resolve();
  if (markdownPromise) return markdownPromise;
  markdownPromise = Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
  ]).then(([mdMod, gfmMod]) => {
    MarkdownRenderer = (mdMod as any).default;
    remarkGfmPlugin = (gfmMod as any).default;
  });
  return markdownPromise;
}

/* ── Markdown preview component ──────────────────────────────────────── */
function MarkdownPreview({ body }: { body: string }) {
  const { t } = useI18n();
  const [ready, setReady] = React.useState(!!MarkdownRenderer);
  React.useEffect(() => {
    if (!MarkdownRenderer) ensureMarkdown().then(() => setReady(true));
  }, []);
  if (!ready || !MarkdownRenderer) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
        {t("qbank.notes.preview.loading")}
      </div>
    );
  }
  const Comp = MarkdownRenderer!;
  return (
    <div className="uworld-prose text-sm">
      <Comp remarkPlugins={remarkGfmPlugin ? [remarkGfmPlugin] : []}>
        {body || `*${t("qbank.notes.preview.empty")}*`}
      </Comp>
    </div>
  );
}

/* ── Time-ago formatter ─────────────────────────────────────────────── */
function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

/* ── Main panel component ───────────────────────────────────────────── */

interface NotesPanelProps {
  /** When provided, the panel filters to notes for this pack. When undefined, all notes are shown. */
  packUid?: string;
  packTitle?: string;
  /** Optional question index for new notes (auto-set on the new note) */
  currentQuestionIdx?: number;
  /** "sidebar" (right side, fullscreen on mobile) | "embedded" (inline, used by Profile) */
  variant?: "sidebar" | "embedded";
  open?: boolean;
  onClose?: () => void;
  /** Optional callback fired when a note is opened in a separate view */
  onOpenNote?: (noteId: string) => void;
  /** Optional callback fired when user clicks "open in profile" */
  onOpenInProfile?: () => void;
  /** Optional callback fired when user clicks "open in qbank" (from profile) */
  onOpenInQBank?: (note: NoteRecord) => void;
}

type View = "list" | "editor";
type EditorMode = "edit" | "preview";

export function NotesPanel({
  packUid,
  packTitle,
  currentQuestionIdx,
  variant = "sidebar",
  open = true,
  onClose,
  onOpenInProfile,
  onOpenInQBank,
}: NotesPanelProps) {
  const platform = usePlatform();
  const { t, rtl } = useI18n();
  const isPhone = platform.isPhone;

  const [allNotes, setAllNotes] = React.useState<NoteRecord[]>([]);
  const [view, setView] = React.useState<View>("list");
  const [activeNote, setActiveNote] = React.useState<NoteRecord | null>(null);
  const [editorMode, setEditorMode] = React.useState<EditorMode>("edit");
  const [tagInput, setTagInput] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [showAllPacks, setShowAllPacks] = React.useState(!packUid);
  // Maximize toggle — only meaningful on desktop (sidebar variant). When true,
  // the panel takes the full viewport (like the mobile fullscreen experience)
  // to give a larger writing area.
  const [maximized, setMaximized] = React.useState(false);

  const resizable = useResizableSidebar({
    storageKey: "osler-notes-width",
    defaultWidth: 448,
    minWidth: 320,
    maxWidth: 900,
    // Disable resizing when: on phone, or in fullscreen (maximized) mode,
    // or when embedded (used inside Profile page — sized by parent).
    disabled: isPhone || maximized || variant === "embedded",
  });

  // ── Swipe-to-dismiss (mirrors Settings NavigationStack pattern) ──────
  // Only meaningful for the sidebar variant (embedded mode is rendered
  // inline, no overlay to dismiss). When the editor sub-view is open the
  // swipe-back dismisses the editor (back to list), not the whole panel —
  // that's handled separately via the inner back button + Escape key.
  // Here we wire the outer overlay: dragging the panel away closes it.
  // The editor → list transition uses the same hook in `inner` below.
  const useFullscreen = isPhone || maximized;
  const outerDismiss = useSwipeBackDismiss({
    onDismiss: () => onClose?.(),
    direction: useFullscreen ? "vertical" : "horizontal",
    rtl,
    disabled: variant === "embedded" || !onClose,
  });
  // Inner editor → list swipe-back (only enabled when in editor view).
  // We don't render this on a motion.div — it's used by the inner back
  // arrow button area only, but we expose the same gesture on the inner
  // motion.div via `drag` when the editor is active. For simplicity, we
  // only enable the outer dismiss here; the inner back arrow + Escape
  // already covers the editor → list transition.

  // Load notes from store + subscribe
  const refresh = React.useCallback(async () => {
    const list = await notesStore.list();
    setAllNotes(list);
  }, []);

  React.useEffect(() => {
    refresh();
    const unsub = notesStore.subscribe(() => refresh());
    return unsub;
  }, [refresh]);

  // Filtered notes
  const visibleNotes = React.useMemo(() => {
    if (!showAllPacks && packUid) {
      return allNotes.filter((n) => n.packUid === packUid);
    }
    return allNotes;
  }, [allNotes, packUid, showAllPacks]);

  const handleCreate = async () => {
    const note = await notesStore.create({
      title: "",
      body: "",
      tags: [],
      packUid,
      packTitle,
      questionIdx: currentQuestionIdx,
    });
    setActiveNote(note);
    setEditorMode("edit");
    setView("editor");
  };

  const handleOpen = (note: NoteRecord) => {
    setActiveNote(note);
    setEditorMode("edit");
    setView("editor");
  };

  // Debounced save for the active note
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateActive = React.useCallback(
    (patch: Partial<NoteRecord>) => {
      if (!activeNote) return;
      const next: NoteRecord = { ...activeNote, ...patch };
      setActiveNote(next);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaving(true);
      saveTimerRef.current = setTimeout(async () => {
        await notesStore.save(next);
        setSaving(false);
      }, 400);
    },
    [activeNote]
  );

  const handleDelete = async (id: string) => {
    await notesStore.delete(id);
    if (activeNote?.id === id) {
      setActiveNote(null);
      setView("list");
    }
  };

  const handleAddTag = () => {
    if (!activeNote) return;
    const tag = tagInput.trim();
    if (!tag) return;
    if (activeNote.tags.includes(tag)) {
      setTagInput("");
      return;
    }
    updateActive({ tags: [...activeNote.tags, tag] });
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    if (!activeNote) return;
    updateActive({ tags: activeNote.tags.filter((tt) => tt !== tag) });
  };

  // Subtitle text for the header
  const subtitleText = view === "list"
    ? packUid && !showAllPacks
      ? t("qbank.notes.subtitle.thisPack", { name: packTitle ?? t("qbank.notes.subtitle.thisPack").split(":")[0].trim() })
      : t("qbank.notes.subtitle.all")
    : t("qbank.notes.editing");

  /* ── Inner content (shared between sidebar and embedded variants) ── */
  const inner = (
    <div className="flex flex-col h-full bg-card text-foreground">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 md:px-6 py-3 border-b border-border bg-card shrink-0">
        <div className="size-9 rounded-full bg-primary/15 text-primary flex items-center justify-center">
          <NotebookPen className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{t("qbank.notes.title")}</h3>
          <p className="text-[11px] text-muted-foreground truncate">{subtitleText}</p>
        </div>
        {view === "editor" && (
          <button
            onClick={() => {
              setView("list");
              setActiveNote(null);
            }}
            className="size-7 rounded-lg hover:bg-muted flex items-center justify-center transition-colors text-muted-foreground"
            title={t("qbank.notes.back")}
            aria-label={t("qbank.notes.back")}
          >
            <ArrowLeft className="size-4 rtl-flip-x" />
          </button>
        )}
        {/* Maximize / restore button — only on desktop sidebar variant */}
        {variant === "sidebar" && !isPhone && (
          <button
            onClick={() => setMaximized((m) => !m)}
            className="size-7 rounded-lg hover:bg-muted flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground"
            title={maximized ? t("qbank.notes.minimize") : t("qbank.notes.maximize")}
            aria-label={maximized ? t("qbank.notes.minimize") : t("qbank.notes.maximize")}
            aria-pressed={maximized}
          >
            {maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="size-7 rounded-lg hover:bg-muted flex items-center justify-center transition-colors"
            aria-label={t("qbank.notes.close")}
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Body */}
      {view === "list" ? (
        <ListView
          notes={visibleNotes}
          onCreate={handleCreate}
          onOpen={handleOpen}
          onDelete={handleDelete}
          hasPack={!!packUid}
          showAllPacks={showAllPacks}
          onToggleScope={() => setShowAllPacks((s) => !s)}
          onOpenInProfile={onOpenInProfile}
          onOpenInQBank={onOpenInQBank}
        />
      ) : (
        <EditorView
          note={activeNote}
          editorMode={editorMode}
          onModeChange={setEditorMode}
          onUpdate={updateActive}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          tagInput={tagInput}
          onTagInputChange={setTagInput}
          onDelete={() => activeNote && handleDelete(activeNote.id)}
          saving={saving}
          // `wide` = the panel takes the full viewport (maximized / phone / embedded).
          // `maximized` = specifically the desktop "maximize" toggle — used to give
          // the editor a wider max-width on PC where the viewport is large.
          wide={maximized || isPhone || variant === "embedded"}
          maximized={maximized}
        />
      )}
    </div>
  );

  // Embedded variant: just render the inner content directly
  if (variant === "embedded") {
    return <div className="h-full">{inner}</div>;
  }

  // Sidebar variant: drawer behavior like AI Assistant
  // - Desktop default: resizable right sidebar (drag handle on inner edge)
  // - Desktop maximized: full-viewport overlay (same as mobile)
  // - Mobile: always full-viewport overlay
  // (useFullscreen was computed above alongside the swipe-back-dismiss hook.)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={useFullscreen ? { y: "100%", opacity: 0 } : { x: rtl ? -448 : 448, opacity: 0 }}
          animate={useFullscreen ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 }}
          exit={useFullscreen ? { y: "100%", opacity: 0 } : { x: rtl ? -448 : 448, opacity: 0 }}
          transition={springSoft}
          {...outerDismiss}
          className={
            useFullscreen
              ? "fixed inset-0 z-50 bg-card flex flex-col safe-screen"
              : cn(
                  "fixed top-0 bottom-0 z-50 border-l border-border bg-card shadow-xl flex flex-col",
                  rtl ? "left-0 border-r border-l-0" : "right-0",
                )
          }
          style={
            useFullscreen
              ? undefined
              : { width: resizable.width ? `${resizable.width}px` : "28rem" }
          }
          role="dialog"
          aria-label={t("qbank.notes.title")}
        >
          {/* Resize handle — only when in docked (non-fullscreen) sidebar mode */}
          {!useFullscreen && (
            <SidebarResizeHandle
              onMouseDown={resizable.onDragHandleMouseDown}
              onTouchStart={resizable.onDragHandleTouchStart}
              active={resizable.isResizing}
              ariaLabel={t("sidebar.resize")}
            />
          )}
          {inner}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── List view ──────────────────────────────────────────────────────── */

function ListView({
  notes,
  onCreate,
  onOpen,
  onDelete,
  hasPack,
  showAllPacks,
  onToggleScope,
  onOpenInProfile,
  onOpenInQBank,
}: {
  notes: NoteRecord[];
  onCreate: () => void;
  onOpen: (n: NoteRecord) => void;
  onDelete: (id: string) => void;
  hasPack: boolean;
  showAllPacks: boolean;
  onToggleScope: () => void;
  onOpenInProfile?: () => void;
  onOpenInQBank?: (n: NoteRecord) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-border space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={onCreate}
            className="h-9 rounded-lg shrink-0"
            title={t("qbank.notes.new")}
          >
            <Plus className="size-3.5 mr-1" />
            <span className="hidden sm:inline">{t("qbank.notes.new")}</span>
          </Button>
        </div>

        {hasPack && (
          <div className="flex items-center gap-1 text-[10px]">
            <button
              onClick={onToggleScope}
              className={`px-2 py-1 rounded-md font-medium transition-colors ${
                !showAllPacks
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {t("qbank.notes.scope.thisPack")}
            </button>
            <button
              onClick={onToggleScope}
              className={`px-2 py-1 rounded-md font-medium transition-colors ${
                showAllPacks
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {t("qbank.notes.scope.all")}
            </button>
            {onOpenInProfile && (
              <button
                onClick={onOpenInProfile}
                className="ms-auto px-2 py-1 rounded-md font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
                title={t("qbank.notes.openInProfile")}
              >
                <ExternalLink className="size-3" />
                {t("qbank.notes.openInProfile")}
              </button>
            )}
          </div>
        )}
        {!hasPack && onOpenInProfile && (
          <div className="flex justify-end">
            <button
              onClick={onOpenInProfile}
              className="px-2 py-1 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
              title={t("qbank.notes.openInProfile")}
            >
              <ExternalLink className="size-3" />
              {t("qbank.notes.openInProfile")}
            </button>
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto medos-scroll p-3 space-y-2">
        {notes.length === 0 ? (
          <EmptyNotesState onCreate={onCreate} searching={false} />
        ) : (
          notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onOpen={() => onOpen(note)}
              onDelete={() => onDelete(note.id)}
              onOpenInQBank={
                onOpenInQBank && note.packUid
                  ? () => onOpenInQBank(note)
                  : undefined
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyNotesState({
  onCreate,
  searching,
}: {
  onCreate: () => void;
  searching: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-12">
      <div className="size-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
        <Notebook className="size-7" />
      </div>
      <h3 className="text-sm font-semibold mb-1">
        {searching ? t("qbank.notes.empty.searching") : t("qbank.notes.empty.title")}
      </h3>
      <p className="text-xs text-muted-foreground max-w-xs mb-4">
        {searching
          ? t("qbank.notes.empty.searchingBody")
          : t("qbank.notes.empty.body")}
      </p>
      {!searching && (
        <Button onClick={onCreate} size="sm" className="rounded-lg">
          <Plus className="size-3.5 mr-1" />
          {t("qbank.notes.empty.createFirst")}
        </Button>
      )}
    </div>
  );
}

function NoteCard({
  note,
  onOpen,
  onDelete,
  onOpenInQBank,
}: {
  note: NoteRecord;
  onOpen: () => void;
  onDelete: () => void;
  onOpenInQBank?: () => void;
}) {
  const { t } = useI18n();
  const preview = React.useMemo(() => {
    const body = note.body || "";
    // Strip markdown for preview
    return body
      .replace(/^#+\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/`/g, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .replace(/^\s*[-+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^\s*>\s+/gm, "")
      .replace(/\n+/g, " ")
      .trim()
      .slice(0, 120);
  }, [note.body]);

  return (
    <div className="group rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors p-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <div onClick={onOpen} className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold truncate flex-1">
            {note.title || <span className="italic text-muted-foreground">{t("qbank.notes.card.untitled")}</span>}
          </h4>
          <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
            <Clock className="size-3" />
            <span>{timeAgo(note.updatedAt)}</span>
          </div>
        </div>
        {preview && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {preview}
          </p>
        )}
        {note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {note.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {note.tags.length > 4 && (
              <span className="text-[10px] text-muted-foreground">
                +{note.tags.length - 4}
              </span>
            )}
          </div>
        )}
        {note.packTitle && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground pt-1">
            <Folder className="size-3" />
            <span className="truncate">{note.packTitle}</span>
            {note.questionIdx !== undefined && (
              <>
                <span>·</span>
                <span>Q{note.questionIdx + 1}</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-border opacity-0 group-hover:opacity-100 transition-opacity">
        {onOpenInQBank && (
          <button
            onClick={onOpenInQBank}
            className="px-2 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
            title={t("qbank.notes.card.openInQBank")}
          >
            <ExternalLink className="size-3" />
            {t("qbank.notes.card.openInQBank")}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="px-2 py-0.5 rounded text-[10px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1"
          title={t("qbank.notes.card.delete")}
        >
          <Trash2 className="size-3" />
          {t("qbank.notes.card.delete")}
        </button>
      </div>
    </div>
  );
}

/* ── Editor view ────────────────────────────────────────────────────── */

function EditorView({
  note,
  editorMode,
  onModeChange,
  onUpdate,
  onAddTag,
  onRemoveTag,
  tagInput,
  onTagInputChange,
  onDelete,
  saving,
  wide,
  maximized,
}: {
  note: NoteRecord | null;
  editorMode: EditorMode;
  onModeChange: (m: EditorMode) => void;
  onUpdate: (patch: Partial<NoteRecord>) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  tagInput: string;
  onTagInputChange: (s: string) => void;
  onDelete: () => void;
  saving: boolean;
  wide?: boolean;
  maximized?: boolean;
}) {
  const { t } = useI18n();
  if (!note) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Title input + mode toggle */}
      <div className="px-4 py-3 border-b border-border space-y-2.5 shrink-0">
        <input
          value={note.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          placeholder={t("qbank.notes.editor.titlePlaceholder")}
          className="w-full bg-transparent outline-none text-base font-semibold placeholder:text-muted-foreground/60"
        />
        {/* Tags */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag className="size-3 text-muted-foreground" />
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[11px] text-foreground"
            >
              {tag}
              <button
                onClick={() => onRemoveTag(tag)}
                className="size-3 rounded hover:bg-muted-foreground/20 flex items-center justify-center"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => onTagInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                onAddTag();
              } else if (e.key === "Backspace" && !tagInput && note.tags.length > 0) {
                onRemoveTag(note.tags[note.tags.length - 1]);
              }
            }}
            placeholder={t("qbank.notes.editor.tagPlaceholder")}
            className="flex-1 min-w-[80px] bg-transparent outline-none text-[11px] placeholder:text-muted-foreground"
          />
        </div>
        {/* Mode toggle + status */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/60">
            <button
              onClick={() => onModeChange("edit")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
                editorMode === "edit"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Pencil className="size-3" />
              {t("qbank.notes.editor.edit")}
            </button>
            <button
              onClick={() => onModeChange("preview")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
                editorMode === "preview"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye className="size-3" />
              {t("qbank.notes.editor.preview")}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {saving ? (
              <span className="text-[10px] text-muted-foreground">{t("qbank.notes.editor.saving")}</span>
            ) : (
              <span className="text-[10px] text-success flex items-center gap-1">
                <Check className="size-3" />
                {t("qbank.notes.editor.saved")}
              </span>
            )}
            <button
              onClick={onDelete}
              className="size-7 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive flex items-center justify-center transition-colors"
              title={t("qbank.notes.editor.delete")}
              aria-label={t("qbank.notes.editor.delete")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Body — when `wide` (fullscreen / embedded), constrain to a comfortable
          max-width and center so long-form writing stays readable.
          When `maximized` (desktop maximize toggle), use a wider max-width so
          the editor fills more of the large viewport — useful on wide monitors. */}
      <div className={`flex-1 min-h-0 p-3 ${wide ? "flex justify-center" : ""}`}>
        <div
          className={`h-full w-full ${
            wide ? (maximized ? "max-w-6xl" : "max-w-3xl") : ""
          }`}
        >
          {editorMode === "edit" ? (
            <MilkdownEditor
              value={note.body}
              onChange={(v) => onUpdate({ body: v })}
              placeholder={t("qbank.notes.editor.placeholder")}
              className="h-full"
              // Notes is a long-form writing context — enable mermaid
              // diagrams and the persistent top formatting bar.
              // Image upload is DISABLED because notes don't have an R2
              // destination — uploads would silently fail.
              enableMermaid
              enableTopBar
              enableImageUpload={false}
              showCounters
            />
          ) : (
            <div className="h-full overflow-y-auto medos-scroll border border-border rounded-lg bg-background p-4">
              <MarkdownPreview body={note.body} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
