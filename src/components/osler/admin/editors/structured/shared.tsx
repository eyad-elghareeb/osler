"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { ChevronUp, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Plus, Trash2, ImagePlus, GripVertical, Upload, Eye, Loader2 } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { ImageLightbox } from "@/components/osler/admin/image-lightbox";
import { uploadImageForEditor, resolveImageForPreview, isImageFile, formatBytes } from "@/components/osler/admin/editors/image-upload";


/**
 * Structured content editors — full React port of
 * tauri-admin/frontend/views/content-editor.js.
 *
 * Each editor matches the full content schema (per-choice images, cloze
 * flashcards, OSCE patient/hiddenProfile/rubric, video YouTube-URL extraction
 * + chapters, written prompt children). Image references use the same
 * `images/<name>` convention as the student app — uploads land in the
 * content_object's R2 folder via the adminApi.uploadFile helper.
 */














// Milkdown is a heavyweight WYSIWYG framework that this module only needs
// for rich-text fields. Loading it lazily keeps the entire @milkdown/* stack
// out of the admin content route's initial bundle — it streams in on first
// use instead.
export const MilkdownEditor = dynamic(
  () => import("@/components/osler/milkdown-editor").then((m) => ({ default: m.MilkdownEditor })),
  {
    ssr: false,
    loading: () => <div className="h-24 rounded-lg bg-muted/40 animate-pulse" />,
  },
);






// ── Shared types ───────────────────────────────────────────────────────────

export interface StructuredEditorProps {
  /** Current parsed object. */
  value: any;
  /** Called whenever the user mutates the object. The parent is responsible
   *  for serializing back to JSON and persisting via the admin API. */
  onChange: (next: any) => void;
  /** Whether the editor is read-only (e.g. content is in "pending" state). */
  readOnly?: boolean;
  /** Optional R2 key base for the content_object — used to resolve image
   *  uploads. When provided, the ImageField component shows an "Upload" button
   *  that uploads to `<r2_key_base>/images/<name>` and inserts the reference. */
  r2KeyBase?: string;
  /** Optional raw R2 key for in-place editing of a content-files/.../file
   *  without a managed content_object. Used to resolve image uploads when
   *  `r2KeyBase` is not provided. */
  rawR2Key?: string;
  /** Library article sidecar metadata (`.meta.json` merged view). Only used
   *  by LibraryArticleEditor; edited through the Metadata panel and persisted
   *  by the parent alongside the body. */
  meta?: Record<string, unknown> | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        {hint && <span className="text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 mb-1 text-[11px] font-bold uppercase tracking-wider text-primary/70 border-b border-primary/15 pb-1">
      {children}
    </div>
  );
}

// Shared collapse state context for structured editors.
// Allows "Collapse All" / "Expand All" to work across all items.
export const CollapseContext = React.createContext<{
  collapsed: Record<number, boolean>;
  toggle: (i: number) => void;
  collapseAll: () => void;
  expandAll: () => void;
  total: number;
}>({ collapsed: {}, toggle: () => {}, collapseAll: () => {}, expandAll: () => {}, total: 0 });

/** Lists longer than this start fully collapsed. Each expanded item mounts
 *  several inputs plus rich-text editors — a 600+ question bank expanded by
 *  default mounts well over a thousand editor instances and freezes the
 *  page. Admins can still "Expand" all explicitly (their call, their wait). */
export const LARGE_LIST = 30;

/** Collapsed-row title suffix: a short single-line preview of the question
 *  text, so a bank with hundreds of collapsed rows is still navigable. */
export function questionSnippet(q: any): string {
  const text = String(q?.question ?? q?.stem ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return `: ${text.length > 60 ? text.slice(0, 60) + "…" : text}`;
}

export function useCollapseState(total: number) {
  const [collapsed, setCollapsed] = React.useState<Record<number, boolean>>(() => {
    if (total <= LARGE_LIST) return {};
    const next: Record<number, boolean> = {};
    for (let i = 0; i < total; i++) next[i] = true;
    return next;
  });
  const toggle = React.useCallback((i: number) => {
    setCollapsed((prev) => ({ ...prev, [i]: !prev[i] }));
  }, []);
  const collapseAll = React.useCallback(() => {
    const next: Record<number, boolean> = {};
    for (let i = 0; i < total; i++) next[i] = true;
    setCollapsed(next);
  }, [total]);
  const expandAll = React.useCallback(() => {
    setCollapsed({});
  }, []);
  return { collapsed, toggle, collapseAll, expandAll, total };
}

export function ListToolbar({
  onAdd,
  addLabel,
  readOnly,
  showCollapseControls,
}: {
  onAdd: () => void;
  addLabel: string;
  readOnly?: boolean;
  showCollapseControls?: boolean;
}) {
  const ctx = React.useContext(CollapseContext);
  return (
    <div className="flex items-center justify-between mb-1.5 gap-2">
      {showCollapseControls && ctx.total > 1 && (
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={ctx.collapseAll} title="Collapse all">
            <ChevronsDown className="size-3 me-0.5" />
            <span className="text-[11px]">Collapse</span>
          </Button>
          <Button size="xs" variant="ghost" onClick={ctx.expandAll} title="Expand all">
            <ChevronsUp className="size-3 me-0.5" />
            <span className="text-[11px]">Expand</span>
          </Button>
        </div>
      )}
      <div className="ms-auto">
        {!readOnly && (
          <Button size="xs" variant="outline" onClick={onAdd}>
            <Plus className="size-3 me-1" />
            {addLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/** In-flight HTML5 drag, shared module-level so sibling rows (and only
 *  rows in the same list — see `dragScope`) can coordinate without lifting
 *  state into every editor. Null when no drag is active. */
let itemDrag: { scope: string; index: number } | null = null;

/** Pure reorder: move arr[from] to insertion slot `to`. */
export function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function ItemRow({
  index,
  total,
  onMove,
  onRemove,
  readOnly,
  children,
  title,
  collapsible,
  dragScope,
  onDragReorder,
}: {
  index: number;
  total: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
  readOnly?: boolean;
  children: React.ReactNode;
  title: string;
  /** If true, show a collapse/expand toggle. */
  collapsible?: boolean;
  /** Scope token identifying the list this row belongs to — drops are only
   *  accepted between rows of the same list (e.g. questions can't be dragged
   *  into a different passage's question list). */
  dragScope?: string;
  /** Drag-and-drop reorder callback (insertion index after removal). */
  onDragReorder?: (from: number, to: number) => void;
}) {
  const { t } = useI18n();
  const ctx = React.useContext(CollapseContext);
  const isCollapsed = collapsible ? (ctx.collapsed[index] ?? false) : false;
  const toggleCollapse = () => ctx.toggle(index);

  // The row is only draggable while the grip handle is held — otherwise
  // selecting text inside an expanded row's inputs would start a drag.
  const [gripHeld, setGripHeld] = React.useState(false);
  const [dropEdge, setDropEdge] = React.useState<"top" | "bottom" | null>(null);
  const canDrag = !!dragScope && !!onDragReorder && !readOnly;

  function handleDragStart(e: React.DragEvent) {
    if (!canDrag || !dragScope) { e.preventDefault(); return; }
    itemDrag = { scope: dragScope, index };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.dropEffect = "move";
    // Firefox requires data for the drag to start.
    e.dataTransfer.setData("text/plain", String(index));
  }
  function handleDragOver(e: React.DragEvent) {
    if (!canDrag || !itemDrag || itemDrag.scope !== dragScope || itemDrag.index === index) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    setDropEdge(e.clientY < rect.top + rect.height / 2 ? "top" : "bottom");
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const edge = dropEdge;
    setDropEdge(null);
    if (!canDrag || !itemDrag || itemDrag.scope !== dragScope || edge == null) return;
    const from = itemDrag.index;
    let to = edge === "bottom" ? index + 1 : index;
    if (from < to) to -= 1; // removing the source shifts later slots down
    itemDrag = null;
    if (from !== to) {
      haptic("selection");
      onDragReorder?.(from, to);
    }
  }
  function handleDragEnd() {
    itemDrag = null;
    setGripHeld(false);
    setDropEdge(null);
  }

  return (
    <div
      draggable={canDrag && gripHeld}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragLeave={(e) => {
        // Only clear when actually leaving the row — dragleave also fires
        // when the pointer crosses between the row's own children.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropEdge(null);
      }}
      onDragEnd={handleDragEnd}
      className={`border border-border rounded-lg bg-card/60 ${isCollapsed ? "" : "p-2.5 space-y-2.5"} ${
        dropEdge === "top" ? "border-t-2 border-t-primary" : dropEdge === "bottom" ? "border-b-2 border-b-primary" : ""
      } ${canDrag && gripHeld ? "opacity-80" : ""}`}
    >
      <div className={`flex items-center gap-1.5 ${isCollapsed ? "p-2" : ""}`}>
        {collapsible && (
          <button
            type="button"
            onClick={toggleCollapse}
            className="size-5 rounded flex items-center justify-center hover:bg-muted transition-colors shrink-0"
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            <ChevronRight className={`size-3.5 text-muted-foreground transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
          </button>
        )}
        {canDrag ? (
          <span
            // The drag source is armed while the grip is pressed (mousedown),
            // then disarmed on mouseup / drag end.
            onMouseDown={() => setGripHeld(true)}
            onMouseUp={() => setGripHeld(false)}
            title={t("admin.structured.dragReorder")}
            className="shrink-0 cursor-grab active:cursor-grabbing flex items-center"
            aria-hidden
          >
            <GripVertical className="size-3 text-muted-foreground/70" />
          </span>
        ) : (
          <GripVertical className="size-3 text-muted-foreground/40" />
        )}
        <Badge
          variant="outline"
          className={`font-mono text-[11px] px-1.5 py-0 ${collapsible ? "cursor-pointer" : ""}`}
          onClick={collapsible ? toggleCollapse : undefined}
        >
          {title}
        </Badge>
        {!readOnly && (
          <div className="ms-auto flex items-center gap-0.5">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="iconXs"
                    variant="ghost"
                    onClick={() => onMove(-1)}
                    disabled={index === 0}
                  >
                    <ChevronUp className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("admin.structured.moveUp")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="iconXs"
                    variant="ghost"
                    onClick={() => onMove(1)}
                    disabled={index === total - 1}
                  >
                    <ChevronDown className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("admin.structured.moveDown")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="iconXs"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={onRemove}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("common.remove")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
      {!isCollapsed && children}
    </div>
  );
}

// ── Tag list (chips) ───────────────────────────────────────────────────────

export function TagListField({
  label,
  tags,
  onChange,
  readOnly,
  placeholder = "Add tag…",
}: {
  label: string;
  tags: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = React.useState("");
  function commit(v: string) {
    const t = v.trim();
    if (!t) return;
    if (tags.includes(t)) { setDraft(""); return; }
    onChange([...tags, t]);
    setDraft("");
  }
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1.5 p-1.5 border border-border rounded-xl bg-background min-h-9">
        {tags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/30 px-2 py-0.5 text-xs"
          >
            {tag}
            {!readOnly && (
              <button
                type="button"
                onClick={() => onChange(tags.filter((_, idx) => idx !== i))}
                className="text-primary/70 hover:text-destructive"
                aria-label={`Remove ${tag}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit(draft);
              } else if (e.key === "Backspace" && !draft && tags.length) {
                onChange(tags.slice(0, -1));
              }
            }}
            onBlur={() => commit(draft)}
            placeholder={placeholder}
            className="flex-1 min-w-[100px] bg-transparent text-xs px-1 outline-none"
          />
        )}
      </div>
    </Field>
  );
}

// ── Image list ─────────────────────────────────────────────────────────────

export function ImageListField({
  label,
  images,
  onChange,
  readOnly,
  r2KeyBase,
  rawR2Key,
  hint,
}: {
  label: string;
  images: any;
  onChange: (next: any) => void;
  readOnly?: boolean;
  r2KeyBase?: string;
  rawR2Key?: string;
  hint?: string;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  // Normalize: accept string | { src, alt, caption } | array of either
  const arr: Array<{ src: string; alt?: string; caption?: string }> = React.useMemo(() => {
    if (!images) return [];
    if (Array.isArray(images)) {
      return images.map((im: any) => (typeof im === "string" ? { src: im } : { ...im }));
    }
    if (typeof images === "string") return [{ src: images }];
    if (typeof images === "object") return [{ ...images }];
    return [];
  }, [images]);

  const [previewIdx, setPreviewIdx] = React.useState<number | null>(null);

  function commit(next: Array<{ src: string; alt?: string; caption?: string }>) {
    if (next.length === 0) onChange(undefined);
    else if (next.length === 1) onChange(next[0]);
    else onChange(next);
  }

  const fileRef = React.useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);

  const canUpload = !!(r2KeyBase || rawR2Key);

  async function handleUpload(file: File): Promise<void> {
    if (!isImageFile(file)) {
      toast({ title: t("admin.markdown.notAnImage"), variant: "destructive" });
      return;
    }
    if (!canUpload) {
      toast({ title: t("admin.structured.cannotUpload"), variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const result = await uploadImageForEditor(file, { r2KeyBase, rawR2Key });
      commit([...arr, { src: result.ref, alt: file.name.replace(/\.[^.]+$/, "") }]);
      toast({
        title: result.converted
          ? t("admin.markdown.optimized", {
              before: formatBytes(result.originalBytes),
              after: formatBytes(result.optimizedBytes),
            })
          : t("admin.markdown.uploaded", { name: file.name }),
        description: result.key,
      });
    } catch (err: any) {
      toast({
        title: t("admin.markdown.uploadFailed"),
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleFiles(files: File[] | FileList): Promise<void> {
    const arr2 = Array.from(files);
    const imgs = arr2.filter(isImageFile);
    if (imgs.length === 0) {
      toast({ title: t("admin.markdown.notAnImage"), variant: "destructive" });
      return;
    }
    for (const f of imgs) await handleUpload(f);
  }

  function handleDrop(e: React.DragEvent) {
    if (readOnly) return;
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
    const arr2 = Array.from(e.dataTransfer.files);
    if (!arr2.some(isImageFile)) return;
    e.preventDefault();
    setDragActive(false);
    void handleFiles(arr2);
  }

  function handleDragOver(e: React.DragEvent) {
    if (readOnly) return;
    if (!e.dataTransfer) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (e.currentTarget === e.target) setDragActive(false);
  }

  function handlePaste(e: React.ClipboardEvent) {
    if (readOnly) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (imgs.length === 0) return;
    e.preventDefault();
    void handleFiles(imgs);
  }

  return (
    <Field label={label} hint={hint}>
      <div
        className={cn(
          "space-y-1.5 relative rounded transition-colors",
          dragActive && "ring-2 ring-inset ring-primary/60 bg-primary/5",
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onPaste={handlePaste}
      >
        {arr.map((img, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-start">
            <Input
              value={img.src ?? ""}
              onChange={(e) => commit(arr.map((a, idx) => (idx === i ? { ...a, src: e.target.value } : a)))}
              readOnly={readOnly}
              placeholder="ecg.png or images/ecg.png"
              className="text-xs"
            />
            <Input
              value={img.alt ?? ""}
              onChange={(e) => commit(arr.map((a, idx) => (idx === i ? { ...a, alt: e.target.value } : a)))}
              readOnly={readOnly}
              placeholder="alt"
              className="text-xs"
            />
            <Input
              value={img.caption ?? ""}
              onChange={(e) => commit(arr.map((a, idx) => (idx === i ? { ...a, caption: e.target.value } : a)))}
              readOnly={readOnly}
              placeholder="caption"
              className="text-xs"
            />
            {!readOnly && (
              <Button
                size="iconSm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => commit(arr.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
            {img.src && (
              <div className="col-span-4 -mt-1 mb-1">
                <button
                  type="button"
                  onClick={() => setPreviewIdx(i)}
                  disabled={readOnly}
                  className="group relative block h-20 w-full overflow-hidden rounded-xl border border-border bg-muted/40"
                  aria-label={t("admin.preview.previewImage")}
                  title={t("admin.preview.previewImage")}
                >
                  <img
                    src={resolveImageForPreview(img.src, { r2KeyBase, rawR2Key })}
                    alt={img.alt ?? ""}
                    className="h-full w-full object-contain transition-transform group-hover:scale-105"
                    onError={(e) => {
                      // Don't hide the whole <img> — show a muted fallback
                      // rectangle so the user can still see something is there.
                      const el = e.currentTarget as HTMLImageElement;
                      el.style.opacity = "0.3";
                      el.style.background = "oklch(0.92 0 0)";
                    }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-primary/0 text-primary opacity-0 transition-opacity group-hover:bg-primary/10 group-hover:opacity-100">
                    <Eye className="size-5" />
                  </span>
                </button>
              </div>
            )}
          </div>
        ))}
        {!readOnly && (
          <div className="flex gap-1.5 flex-wrap items-center">
            <Button size="sm" variant="ghost" onClick={() => commit([...arr, { src: "" }])} className="text-xs">
              <Plus className="size-3 me-1" /> {t("admin.structured.addImage")}
            </Button>
            {canUpload && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="text-xs"
                >
                  {uploading
                    ? <Loader2 className="size-3 me-1 animate-spin" />
                    : <ImagePlus className="size-3 me-1" />}
                  {t("admin.structured.uploadImage")}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {t("admin.structured.dropOrPasteHint")}
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      void handleFiles(e.target.files);
                    }
                    e.target.value = "";
                  }}
                />
              </>
            )}
          </div>
        )}
        {dragActive && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary/60 rounded pointer-events-none">
            <div className="flex flex-col items-center gap-1 text-primary">
              <ImagePlus className="size-5" />
              <span className="text-[11px] font-medium">{t("admin.markdown.dropToUpload")}</span>
            </div>
          </div>
        )}
      </div>

      {previewIdx != null && arr[previewIdx]?.src && (
        <ImageLightbox
          open={previewIdx != null}
          onOpenChange={(open) => { if (!open) setPreviewIdx(null); }}
          src={resolveImageForPreview(arr[previewIdx].src, { r2KeyBase, rawR2Key })}
          alt={arr[previewIdx].alt}
          fileName={arr[previewIdx].src.split("/").pop()}
        />
      )}
    </Field>
  );
}

// ── String list (one per line) ─────────────────────────────────────────────

export function StringListField({
  label,
  items,
  onChange,
  readOnly,
  placeholder,
  hint,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={item}
              onChange={(e) => onChange(items.map((it, idx) => (idx === i ? e.target.value : it)))}
              readOnly={readOnly}
              placeholder={placeholder}
            />
            {!readOnly && (
              <Button
                size="iconSm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
        {!readOnly && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange([...items, ""])}
            className="text-xs"
          >
            <Plus className="size-3 me-1" />
            Add {label.toLowerCase()}
          </Button>
        )}
      </div>
    </Field>
  );
}

// ── Quiz editor (questions + passages) ─────────────────────────────────────
//
// Supports the rich shape from tauri-admin:
//   { questions: [{ id, question, options[], correct, explanation, images,
//                   choiceImages[], explanationImages, tags[], difficulty }] }
// Also handles bank-style passages: { passages: [{ id, content, questions: [...] }] }