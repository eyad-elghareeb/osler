"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { springSoft } from "@/lib/osler/motion";
import {
  Plus,
  Trash2,
  NotebookPen,
  Notebook,
  Tag,
  X,
  Clock,
  Check,
  CheckCheck,
  Download,
  Folder,
  ExternalLink,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlatform } from "@/hooks/use-platform";
import {
  useResizableSidebar,
  SidebarResizeHandle,
} from "@/hooks/use-resizable-sidebar";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";
import { notes as notesStore, type NoteRecord } from "@/lib/osler/storage";
import { isTextInput } from "@/lib/osler/shortcuts";
import { haptic } from "@/lib/osler/native";
import { useI18n } from "./i18n-provider";
import { MilkdownEditor } from "./milkdown-editor";

/* ── Time-ago formatter ─────────────────────────────────────────────── */
function timeAgo(ts: number, t: (k: any, p?: any) => string): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("qbank.notes.time.now");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("qbank.notes.time.minAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("qbank.notes.time.hourAgo", { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t("qbank.notes.time.dayAgo", { n: day });
  return new Date(ts).toLocaleDateString();
}

/* ── Sort modes for the notes list ──────────────────────────── */
type SortMode = "recent" | "oldest" | "title";

/* ── Markdown export ────────────────────────────────────────── */

/** Slugify a note title into a safe `.md` filename (falls back to a date). */
function noteFileName(note: NoteRecord): string {
  const base = (note.title || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
  return `${base || `note-${new Date(note.updatedAt).toISOString().slice(0, 10)}`}.md`;
}

/** Serialize a note to a portable markdown file (title heading + body). */
function noteToMarkdown(note: NoteRecord): string {
  const title = note.title.trim();
  const body = note.body ?? "";
  return title ? `# ${title}\n\n${body}` : body;
}

/** Download a note as a `.md` file (used by the editor + list card buttons). */
function downloadNoteMarkdown(note: NoteRecord): void {
  const blob = new Blob([noteToMarkdown(note)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = noteFileName(note);
  a.click();
  URL.revokeObjectURL(url);
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
  /** Incremented by the parent to request "create a note now" (wired to the
   *  qbank.notesNew shortcut: opens the panel and immediately starts a note). */
  createSignal?: number;
}

type View = "list" | "editor";

export function NotesPanel({
  packUid,
  packTitle,
  currentQuestionIdx,
  variant = "sidebar",
  open = true,
  onClose,
  onOpenInProfile,
  onOpenInQBank,
  createSignal,
}: NotesPanelProps) {
  const platform = usePlatform();
  const { t, rtl } = useI18n();
  const isPhone = platform.isPhone;

  const [allNotes, setAllNotes] = React.useState<NoteRecord[]>([]);
  const [view, setView] = React.useState<View>("list");
  const [activeNote, setActiveNote] = React.useState<NoteRecord | null>(null);
  const [tagInput, setTagInput] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [showAllPacks, setShowAllPacks] = React.useState(!packUid);
  // Maximize toggle — only meaningful on desktop (sidebar variant). When true,
  // the panel takes the full viewport (like the mobile fullscreen experience)
  // to give a larger writing area.
  const [maximized, setMaximized] = React.useState(false);

  // ── List controls: tag filter / sort ─────────────────────────
  const [tagFilter, setTagFilter] = React.useState<string | null>(null);
  const [sortMode, setSortMode] = React.useState<SortMode>("recent");

  // ── Inline delete confirmation (click again within 2.5s to confirm) ──
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const confirmTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // Inner editor → list transition (Done button, Escape, Ctrl/⌘+Enter) is
  // handled separately; the outer dismiss here only closes the whole panel.

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

  // Filtered notes — the tag filter applies within the pack scope.
  const visibleNotes = React.useMemo(() => {
    let list = showAllPacks || !packUid
      ? allNotes
      : allNotes.filter((n) => n.packUid === packUid);
    if (tagFilter) list = list.filter((n) => n.tags.includes(tagFilter));
    const sorted = [...list];
    if (sortMode === "recent") sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    else if (sortMode === "oldest") sorted.sort((a, b) => a.updatedAt - b.updatedAt);
    else sorted.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    return sorted;
  }, [allNotes, packUid, showAllPacks, tagFilter, sortMode]);

  // Tag chips — the most-used tags within the current scope (pre-search).
  const scopeTags = React.useMemo(() => {
    const scoped = showAllPacks || !packUid
      ? allNotes
      : allNotes.filter((n) => n.packUid === packUid);
    const counts = new Map<string, number>();
    for (const n of scoped) for (const tag of n.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag);
  }, [allNotes, packUid, showAllPacks]);

  const handleCreate = async () => {
    haptic("light");
    const note = await notesStore.create({
      title: "",
      body: "",
      tags: tagFilter ? [tagFilter] : [],
      packUid,
      packTitle,
      questionIdx: currentQuestionIdx,
    });
    setActiveNote(note);
    setView("editor");
  };

  // Parent-requested creation (qbank.notesNew shortcut): the signal only
  // ever increments, so compare against the last-seen value.
  const lastCreateSignalRef = React.useRef(createSignal);
  React.useEffect(() => {
    if (createSignal === undefined || createSignal === lastCreateSignalRef.current) return;
    lastCreateSignalRef.current = createSignal;
    if (open) void handleCreate();
  }, [createSignal, open]);

  const handleOpen = (note: NoteRecord) => {
    haptic("selection");
    setActiveNote(note);
    setView("editor");
  };

  // Debounced save for the active note
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNoteRef = React.useRef<NoteRecord | null>(null);
  activeNoteRef.current = activeNote;
  const updateActive = React.useCallback(
    (patch: Partial<NoteRecord>) => {
      if (!activeNote) return;
      const next: NoteRecord = { ...activeNote, ...patch };
      setActiveNote(next);
      activeNoteRef.current = next;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaving(true);
      saveTimerRef.current = setTimeout(async () => {
        await notesStore.save(next);
        setSaving(false);
      }, 400);
    },
    [activeNote]
  );

  /** Persist any pending debounced edit immediately (used before leaving the
   *  editor — Escape, Done, Ctrl+Enter — so nothing is ever lost mid-flight). */
  const flushSave = React.useCallback(() => {
    if (!saveTimerRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const note = activeNoteRef.current;
    if (!note) return;
    setSaving(true);
    void notesStore.save(note).then(() => setSaving(false));
  }, []);

  const backToList = React.useCallback(() => {
    flushSave();
    setView("list");
    setActiveNote(null);
  }, [flushSave]);

  const handleDelete = async (id: string) => {
    haptic("warning");
    await notesStore.delete(id);
    if (activeNote?.id === id) {
      setActiveNote(null);
      setView("list");
    }
  };

  /** Two-step delete: first click arms the button, second click within 2.5s
   *  confirms. Prevents accidental data loss with no modal in the way. */
  const requestDelete = (id: string) => {
    if (confirmDeleteId === id) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmDeleteId(null);
      void handleDelete(id);
      return;
    }
    haptic("light");
    setConfirmDeleteId(id);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => {
      confirmTimerRef.current = null;
      setConfirmDeleteId((cur) => (cur === id ? null : cur));
    }, 2500);
  };
  React.useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
  }, []);

  // ── Keyboard shortcuts (panel-scoped; only while the panel is open) ──
  //   Escape  → editor: back to list (flushing the save) · list: close panel
  //   Ctrl/⌘+Enter → done editing (flush + back to list)
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (view === "editor") backToList();
        else onClose?.();
        return;
      }
      if (isTextInput(e.target)) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && view === "editor") {
        e.preventDefault();
        backToList();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, view, onClose, backToList]);

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
        {view === "editor" && activeNote && (
          <>
            {saving ? (
              <span className="text-[11px] text-muted-foreground shrink-0">{t("qbank.notes.editor.saving")}</span>
            ) : (
              <span className="text-[11px] text-success flex items-center gap-1 shrink-0">
                <Check className="size-3" />
                {t("qbank.notes.editor.saved")}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={backToList}
              className="h-7 px-2 text-[11px] rounded-md shrink-0"
              title={t("qbank.notes.editor.doneHint")}
            >
              <CheckCheck className="size-3.5 me-1" />
              <span className="hidden sm:inline">{t("qbank.notes.editor.done")}</span>
            </Button>
            <button
              onClick={() => {
                haptic("light");
                downloadNoteMarkdown(activeNote);
              }}
              className="size-7 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors shrink-0"
              title={t("qbank.notes.export")}
              aria-label={t("qbank.notes.export")}
            >
              <Download className="size-3.5" />
            </button>
            <button
              onClick={() => handleDelete(activeNote.id)}
              className="size-7 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive flex items-center justify-center transition-colors shrink-0"
              title={t("qbank.notes.editor.delete")}
              aria-label={t("qbank.notes.editor.delete")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
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
          onRequestDelete={requestDelete}
          confirmDeleteId={confirmDeleteId}
          hasPack={!!packUid}
          showAllPacks={showAllPacks}
          onToggleScope={() => setShowAllPacks((s) => !s)}
          onOpenInProfile={onOpenInProfile}
          onOpenInQBank={onOpenInQBank}
          controls={{
            tagFilter,
            onTagFilterChange: setTagFilter,
            sortMode,
            onSortChange: setSortMode,
            scopeTags,
          }}
        />
      ) : (
        <EditorView
          note={activeNote}
          onUpdate={updateActive}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          tagInput={tagInput}
          onTagInputChange={setTagInput}
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
              ? "fixed inset-0 z-[60] bg-card flex flex-col safe-screen"
              : cn(
                  "fixed top-0 bottom-0 z-50 border-l border-border bg-card shadow-e4 flex flex-col",
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

interface ListControls {
  tagFilter: string | null;
  onTagFilterChange: (tag: string | null) => void;
  sortMode: SortMode;
  onSortChange: (m: SortMode) => void;
  scopeTags: string[];
}

function ListView({
  notes,
  onCreate,
  onOpen,
  onRequestDelete,
  confirmDeleteId,
  hasPack,
  showAllPacks,
  onToggleScope,
  onOpenInProfile,
  onOpenInQBank,
  controls,
}: {
  notes: NoteRecord[];
  onCreate: () => void;
  onOpen: (n: NoteRecord) => void;
  onRequestDelete: (id: string) => void;
  confirmDeleteId: string | null;
  hasPack: boolean;
  showAllPacks: boolean;
  onToggleScope: () => void;
  onOpenInProfile?: () => void;
  onOpenInQBank?: (n: NoteRecord) => void;
  controls: ListControls;
}) {
  const { t } = useI18n();
  const { tagFilter, onTagFilterChange, sortMode, onSortChange, scopeTags } = controls;
  const filtering = !!tagFilter;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-border space-y-2.5 shrink-0">
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
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {t("qbank.notes.count", { n: notes.length })}
          </span>
          <div className="ms-auto flex items-center gap-2 shrink-0">
            {onOpenInProfile && (
              <button
                onClick={onOpenInProfile}
                className="px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
                title={t("qbank.notes.openInProfile")}
              >
                <ExternalLink className="size-3" />
                {t("qbank.notes.openInProfile")}
              </button>
            )}
            <Select value={sortMode} onValueChange={(v) => onSortChange(v as SortMode)}>
              <SelectTrigger
                className="h-8 w-[110px] text-[11px] rounded-lg"
                aria-label={t("qbank.notes.sort.label")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">{t("qbank.notes.sort.recent")}</SelectItem>
                <SelectItem value="oldest">{t("qbank.notes.sort.oldest")}</SelectItem>
                <SelectItem value="title">{t("qbank.notes.sort.title")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tag filter chips */}
        {scopeTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {scopeTags.map((tag) => {
              const active = tagFilter === tag;
              return (
                <button
                  key={tag}
                  onClick={() => onTagFilterChange(active ? null : tag)}
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                    active
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "text-muted-foreground border-border hover:text-foreground hover:bg-muted",
                  )}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}

        {/* Pack scope toggle */}
        {hasPack && (
          <div className="flex items-center gap-1 text-[11px]">
            <button
              onClick={onToggleScope}
              className={cn(
                "px-2 py-1 rounded-md font-medium transition-colors",
                !showAllPacks ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t("qbank.notes.scope.thisPack")}
            </button>
            <button
              onClick={onToggleScope}
              className={cn(
                "px-2 py-1 rounded-md font-medium transition-colors",
                showAllPacks ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t("qbank.notes.scope.all")}
            </button>
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto osler-scroll p-3 space-y-2">
        {notes.length === 0 ? (
          <EmptyNotesState onCreate={onCreate} searching={filtering} />
        ) : (
          notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onOpen={() => onOpen(note)}
              onRequestDelete={() => onRequestDelete(note.id)}
              confirming={confirmDeleteId === note.id}
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
  onRequestDelete,
  confirming,
  onOpenInQBank,
}: {
  note: NoteRecord;
  onOpen: () => void;
  onRequestDelete: () => void;
  confirming: boolean;
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
    <div className={cn(
      "group rounded-xl border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors p-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      confirming ? "border-destructive/40" : "border-border",
    )}>
      <div onClick={onOpen} className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold truncate flex-1">
            {note.title || <span className="italic text-muted-foreground">{t("qbank.notes.card.untitled")}</span>}
          </h4>
          <div className="flex items-center gap-0.5 text-[11px] text-muted-foreground shrink-0">
            <Clock className="size-3" />
            <span>{timeAgo(note.updatedAt, t)}</span>
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
                className="px-1.5 py-0.5 rounded text-[11px] bg-muted text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {note.tags.length > 4 && (
              <span className="text-[11px] text-muted-foreground">
                +{note.tags.length - 4}
              </span>
            )}
          </div>
        )}
        {note.packTitle && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground pt-1">
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
      <div className={cn(
        "flex items-center justify-end gap-1 mt-2 pt-2 border-t border-border transition-opacity",
        confirming ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
      )}>
        {onOpenInQBank && (
          <button
            onClick={onOpenInQBank}
            className="px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
            title={t("qbank.notes.card.openInQBank")}
          >
            <ExternalLink className="size-3" />
            {t("qbank.notes.card.openInQBank")}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            haptic("light");
            downloadNoteMarkdown(note);
          }}
          className="px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
          title={t("qbank.notes.export")}
        >
          <Download className="size-3" />
          {t("qbank.notes.exportShort")}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete();
          }}
          className={cn(
            "px-2 py-0.5 rounded text-[11px] transition-colors flex items-center gap-1",
            confirming
              ? "bg-destructive/10 text-destructive font-medium"
              : "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
          )}
          title={t("qbank.notes.card.delete")}
        >
          <Trash2 className="size-3" />
          {confirming ? t("qbank.notes.card.confirmDelete") : t("qbank.notes.card.delete")}
        </button>
      </div>
    </div>
  );
}

/* ── Editor view ────────────────────────────────────────────────────── */

function EditorView({
  note,
  onUpdate,
  onAddTag,
  onRemoveTag,
  tagInput,
  onTagInputChange,
  wide,
  maximized,
}: {
  note: NoteRecord | null;
  onUpdate: (patch: Partial<NoteRecord>) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  tagInput: string;
  onTagInputChange: (s: string) => void;
  wide?: boolean;
  maximized?: boolean;
}) {
  const { t } = useI18n();
  if (!note) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Title input + tags */}
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
        </div>
      </div>
    </div>
  );
}
