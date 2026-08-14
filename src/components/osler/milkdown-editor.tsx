"use client";

/**
 * MilkdownEditor — a reusable, controlled WYSIWYG markdown editor built on
 * Milkdown's Crepe flavor (https://milkdown.dev/docs/recipes/react).
 *
 * Component contract:
 *   • `value: string` — markdown content (controlled input).
 *   • `onChange(next: string)` — fires on every keystroke.
 *   • `placeholder?: string` — placeholder shown when the doc is empty.
 *   • `readOnly?: boolean` — toggles editable / read-only (live).
 *   • `className?: string` — wrapper class.
 *   • `r2KeyBase?: string` — managed content_object R2 base for image uploads.
 *   • `rawR2Key?: string` — raw content-files R2 key for in-place editing.
 *   • `showCounters?: boolean` — show minimal word count footer (default: true).
 *   • `enableMermaid?: boolean` — show mermaid chips + "insert diagram"
 *     (default: false — only enable for article editor + notes).
 *   • `enableTopBar?: boolean` — show Crepe's always-visible top formatting
 *     bar (default: false — only enable for article editor + notes where
 *     long-form writing benefits from persistent controls; compact answer
 *     fields use the inline selection bubble + slash menu instead).
 */

import * as React from "react";
import { Crepe } from "@milkdown/crepe";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { replaceAll } from "@milkdown/utils";
import { ImagePlus, Loader2, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";
import type { StringKey } from "@/lib/osler/i18n";
import { useToast } from "@/hooks/use-toast";
import {
  uploadImageForEditor,
  resolveImageForPreview,
  isImageFile,
  formatBytes,
  type UploadImageResult,
} from "@/components/osler/admin/editors/image-upload";
import { useMermaidModal } from "@/components/osler/admin/editors/mermaid-editor";

// ── Types ─────────────────────────────────────────────────────────────────

export interface MilkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  r2KeyBase?: string;
  rawR2Key?: string;
  /** Show minimal word count footer (default: true). */
  showCounters?: boolean;
  /** Show mermaid chips + "insert diagram" button (default: false).
   *  Enable only in long-form contexts that actually use mermaid diagrams
   *  (article editor, notes). Compact answer fields don't need it. */
  enableMermaid?: boolean;
  /** Show Crepe's always-visible top formatting bar (default: false).
   *  Enable only for long-form writing (article editor, notes). Compact
   *  answer fields use the inline selection bubble + slash menu instead. */
  enableTopBar?: boolean;
  /** Enable image upload via drag-drop, paste, file picker, and the
   *  Crepe ImageBlock slash command (default: true).
   *  Disable in contexts that use a different image flow — e.g. written
   *  answers have their own "Photo" camera capture mode, and notes have
   *  no R2 destination so image uploads would silently fail. When
   *  disabled, the ImageBlock feature is turned off entirely (no image
   *  button in slash menu, no drag-drop, no paste). */
  enableImageUpload?: boolean;
}

// ── Inner editor (must be a child of MilkdownProvider) ────────────────────

interface InnerEditorProps extends MilkdownEditorProps {
  registerCrepe: (crepe: Crepe | null) => void;
}

function InnerMilkdownEditor({
  value,
  onChange,
  placeholder,
  readOnly = false,
  r2KeyBase,
  rawR2Key,
  enableTopBar = false,
  enableImageUpload = true,
  registerCrepe,
}: InnerEditorProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const placeholderRef = React.useRef(placeholder);
  placeholderRef.current = placeholder;
  const lastAppliedRef = React.useRef<string>(value);
  const crepeRef = React.useRef<Crepe | null>(null);
  const r2Ref = React.useRef<{ r2KeyBase?: string; rawR2Key?: string }>({ r2KeyBase, rawR2Key });
  r2Ref.current = { r2KeyBase, rawR2Key };
  const [uploading, setUploading] = React.useState(false);

  // ── Image upload handler ──────────────────────────────────────────────
  const handleImageUpload = React.useCallback(
    async (file: File): Promise<string> => {
      if (!isImageFile(file)) {
        toast({ title: t("admin.markdown.notAnImage"), variant: "destructive" });
        return "";
      }
      const { r2KeyBase: kb, rawR2Key: rk } = r2Ref.current;
      if (!kb && !rk) {
        const ref = `images/${file.name}`;
        toast({ title: t("admin.markdown.insertedNoUpload") });
        return ref;
      }
      setUploading(true);
      try {
        const result: UploadImageResult = await uploadImageForEditor(file, { r2KeyBase: kb, rawR2Key: rk });
        toast({
          title: result.converted
            ? t("admin.markdown.optimized", {
                before: formatBytes(result.originalBytes),
                after: formatBytes(result.optimizedBytes),
              })
            : t("admin.markdown.uploaded", { name: file.name }),
          description: result.key,
        });
        const resolved = resolveImageForPreview(result.ref, { r2KeyBase: kb, rawR2Key: rk });
        if (resolved && resolved !== result.ref) return resolved;
        return result.dataUri || result.ref;
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        toast({ title: t("admin.markdown.uploadFailed"), description: msg, variant: "destructive" });
        return "";
      } finally {
        setUploading(false);
      }
    },
    [t, toast],
  );

  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue: value,
      features: {
        [Crepe.Feature.AI]: false,
        // TopBar (always-visible formatting bar) is opt-in via `enableTopBar`.
        // Default off — compact answer fields use the inline selection bubble
        // + slash menu instead. Long-form contexts (article editor, notes)
        // pass `enableTopBar` to get the persistent toolbar.
        [Crepe.Feature.TopBar]: enableTopBar,
        // ImageBlock is opt-out via `enableImageUpload`. Disabled in
        // contexts that use a different image flow (written answers have
        // a camera capture mode; notes have no R2 destination).
        [Crepe.Feature.ImageBlock]: enableImageUpload,
        [Crepe.Feature.CodeMirror]: true,
        [Crepe.Feature.ListItem]: true,
        [Crepe.Feature.LinkTooltip]: true,
        [Crepe.Feature.Cursor]: true,
        [Crepe.Feature.BlockEdit]: true,
        [Crepe.Feature.Toolbar]: true,
        [Crepe.Feature.Placeholder]: true,
        [Crepe.Feature.Table]: true,
        [Crepe.Feature.Latex]: true,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: placeholder ?? t("editor.placeholder.default"),
          mode: "block",
        },
        [Crepe.Feature.ImageBlock]: {
          blockOnUpload: handleImageUpload,
          inlineOnUpload: handleImageUpload,
          blockUploadPlaceholderText: t("editor.uploading"),
          inlineUploadPlaceholderText: t("editor.uploading"),
        },
        [Crepe.Feature.BlockEdit]: {
          // Minimize the block handle offset so it sits close to the
          // text (just inside the editor card's left padding). The
          // default offset of 16 pushes it too far left for a compact
          // card editor.
          blockHandle: {
            getOffset: () => 4,
          },
        },
      },
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        lastAppliedRef.current = markdown;
        onChangeRef.current(markdown);
      });
    });

    registerCrepe(crepe);
    crepeRef.current = crepe;

    return crepe;
  }, []);

  React.useEffect(() => {
    const crepe = crepeRef.current;
    if (!crepe) return;
    if (value === lastAppliedRef.current) return;
    try {
      crepe.editor.action(replaceAll(value));
      lastAppliedRef.current = value;
    } catch (error) {
      lastAppliedRef.current = value;
      console.warn("[MilkdownEditor] Failed to apply external value:", error);
    }
  }, [value]);

  React.useEffect(() => {
    const crepe = crepeRef.current;
    if (!crepe) return;
    crepe.setReadonly(readOnly);
  }, [readOnly]);

  return <Milkdown />;
}

// ── Mermaid chip overlay ──────────────────────────────────────────────────

interface MermaidBlock {
  index: number;
  startLine: number;
  endLine: number;
  code: string;
}

function findMermaidBlocks(md: string): MermaidBlock[] {
  const lines = md.split("\n");
  const out: MermaidBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```mermaid\s*$/.test(lines[i])) {
      const startLine = i;
      let endLine = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s*```\s*$/.test(lines[j])) {
          endLine = j;
          break;
        }
      }
      if (endLine === -1) continue;
      const code = lines.slice(startLine + 1, endLine).join("\n");
      out.push({ index: out.length, startLine, endLine, code });
      i = endLine;
    }
  }
  return out;
}

function MermaidChips({
  blocks,
  onEdit,
  onInsert,
  t,
}: {
  blocks: MermaidBlock[];
  onEdit: (block: MermaidBlock) => void;
  onInsert: () => void;
  t: (key: StringKey, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-2.5 py-1 border-t border-border bg-muted/20">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground me-1 inline-flex items-center gap-1">
        <Workflow className="size-3" />
        {t("editor.mermaid.label")}
      </span>
      {blocks.map((block) => (
        <button
          key={block.index}
          type="button"
          onClick={() => onEdit(block)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
          title={t("editor.mermaid.editDiagramN", { n: block.index + 1 })}
        >
          <Workflow className="size-2.5" />
          {block.index + 1}
        </button>
      ))}
      <button
        type="button"
        onClick={onInsert}
        className="ms-auto inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
        title={t("editor.mermaid.insertMermaidBlock")}
      >
        {t("editor.mermaid.insertDiagram")}
      </button>
    </div>
  );
}

// ── Outer wrapper ─────────────────────────────────────────────────────────

export function MilkdownEditor({
  value,
  onChange,
  placeholder,
  readOnly = false,
  className,
  r2KeyBase,
  rawR2Key,
  showCounters = true,
  enableMermaid = false,
  enableTopBar = false,
  enableImageUpload = true,
}: MilkdownEditorProps) {
  const { t, rtl } = useI18n();
  const crepeRef = React.useRef<Crepe | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { openModal, modal } = useMermaidModal();

  const registerCrepe = React.useCallback((crepe: Crepe | null) => {
    crepeRef.current = crepe;
  }, []);

  React.useEffect(() => {
    return () => {
      const crepe = crepeRef.current;
      if (!crepe) return;
      crepe.destroy().catch((error) => {
        console.warn("[MilkdownEditor] Failed to destroy editor:", error);
      });
      crepeRef.current = null;
    };
  }, []);

  const canUpload = enableImageUpload && !!(r2KeyBase || rawR2Key);

  const handleImageFiles = React.useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter(isImageFile);
      if (arr.length === 0) return;
      setUploading(true);
      try {
        for (const file of arr) {
          const result = await uploadImageForEditor(file, { r2KeyBase, rawR2Key });
          const altText = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "image";
          const insertion = `\n\n![${altText}](${result.ref})\n\n`;
          onChange(value + insertion);
          value = value + insertion;
        }
      } catch (err: any) {
        console.error("[MilkdownEditor] Image upload failed:", err);
      } finally {
        setUploading(false);
      }
    },
    [r2KeyBase, rawR2Key, onChange, value],
  );

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      if (readOnly || !enableImageUpload) return;
      if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
      const arr = Array.from(e.dataTransfer.files);
      if (!arr.some(isImageFile)) return;
      e.preventDefault();
      setDragActive(false);
      void handleImageFiles(arr);
    },
    [readOnly, enableImageUpload, handleImageFiles],
  );

  const handleDragOver = React.useCallback(
    (e: React.DragEvent) => {
      if (readOnly || !enableImageUpload) return;
      if (!e.dataTransfer) return;
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      setDragActive(true);
    },
    [readOnly, enableImageUpload],
  );

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDragActive(false);
  }, []);

  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent) => {
      if (readOnly || !enableImageUpload) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const images: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) images.push(f);
        }
      }
      if (images.length === 0) return;
      e.preventDefault();
      void handleImageFiles(images);
    },
    [readOnly, enableImageUpload, handleImageFiles],
  );

  const mermaidBlocks = React.useMemo(
    () => (enableMermaid ? findMermaidBlocks(value) : []),
    [value, enableMermaid],
  );

  const handleEditMermaid = React.useCallback(
    (block: MermaidBlock) => {
      openModal(block.code, (newCode: string) => {
        const lines = value.split("\n");
        const next = [
          ...lines.slice(0, block.startLine + 1),
          ...newCode.trim().split("\n"),
          ...lines.slice(block.endLine),
        ].join("\n");
        onChange(next);
      });
    },
    [openModal, value, onChange],
  );

  const handleInsertMermaid = React.useCallback(() => {
    const template = "flowchart TD\n    A([Start]) --> B{Decision?}\n    B -- Yes --> C[Process A]\n    B -- No  --> D[Process B]\n    C --> E([End])\n    D --> E";
    openModal(template, (newCode: string) => {
      const insertion = `\n\n\`\`\`mermaid\n${newCode.trim()}\n\`\`\`\n\n`;
      onChange(value + insertion);
    });
  }, [openModal, value, onChange]);

  // Minimal word count — just the number, no "words" suffix, no chars/lines.
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <div
      ref={wrapperRef}
      dir={rtl ? "rtl" : "ltr"}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onPaste={handlePaste}
      className={cn(
        "osler-milkdown-editor relative flex flex-col rounded-lg border border-border bg-card overflow-visible",
        "focus-within:border-primary/40 transition-colors",
        rtl && "osler-milkdown-editor--rtl",
        dragActive && "border-primary/60 ring-2 ring-primary/30",
        className,
      )}
    >
      {/* Compact image-upload button — only shown when R2 routing is
          available AND no top bar (top bar already has its own image
                  button). Hidden in read-only mode. */}
      {!readOnly && canUpload && !enableTopBar && (
        <div className="shrink-0 absolute end-1.5 top-1.5 z-10 flex items-center gap-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
            title={t("editor.uploadImage")}
            aria-label={t("editor.uploadImage")}
          >
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ImagePlus className="size-3.5" />
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void handleImageFiles(e.target.files);
                e.target.value = "";
              }
            }}
          />
        </div>
      )}

      {/* Editor body */}
      <div className="flex-1 min-h-[120px]">
        <MilkdownProvider>
          <InnerMilkdownEditor
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            readOnly={readOnly}
            r2KeyBase={r2KeyBase}
            rawR2Key={rawR2Key}
            enableTopBar={enableTopBar}
            enableImageUpload={enableImageUpload}
            registerCrepe={registerCrepe}
          />
        </MilkdownProvider>
      </div>

      {/* Mermaid chips — only when enableMermaid is true.
          shrink-0 prevents this bar from expanding to fill unused
          flex space when the editor body is short. */}
      {enableMermaid && !readOnly && (
        <MermaidChips
          blocks={mermaidBlocks}
          onEdit={handleEditMermaid}
          onInsert={handleInsertMermaid}
          t={t}
        />
      )}

      {/* Minimal word count — just the number, right-aligned, very subtle.
          shrink-0 prevents this from expanding. */}
      {showCounters && (
        <div className="shrink-0 flex items-center justify-end px-2.5 py-0.5 border-t border-border/60 text-[10px] text-muted-foreground/70 tabular-nums">
          {words}
        </div>
      )}

      {/* Drag overlay — minimal ring only, no text */}
      {dragActive && (
        <div className="absolute inset-0 z-20 bg-primary/5 border-2 border-dashed border-primary/50 rounded-lg pointer-events-none" />
      )}

      {/* Mermaid editor modal */}
      {modal}
    </div>
  );
}

export default MilkdownEditor;
