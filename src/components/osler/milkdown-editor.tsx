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
 *   • `enableMermaid?: boolean` — enable mermaid diagram support
 *     (default: false — only enable for article editor + notes). When
 *     `enableTopBar` is also set, a mermaid button appears in the top
 *     bar's Insert group. Mermaid code blocks render inline as diagrams
 *     inside the editor (via the CodeMirror preview); click a rendered
 *     diagram to open the visual flow builder. A mermaid item also appears
 *     in the slash menu ("/" menu) to open the builder and insert the
 *     diagram at the cursor. Editing is GUI-driven only — the standalone
 *     mermaid code editor is not available (see MermaidEditorModal).
 *   • `enableTopBar?: boolean` — show Crepe's always-visible top formatting
 *     bar (default: false — only enable for article editor + notes where
 *     long-form writing benefits from persistent controls; compact answer
 *     fields use the inline selection bubble + slash menu instead).
 */

import * as React from "react";
import { Crepe } from "@milkdown/crepe";
import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import { clearTextInCurrentBlockCommand } from "@milkdown/kit/preset/commonmark";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { insert, replaceAll } from "@milkdown/utils";
import { $prose } from "@milkdown/kit/utils";
import { Plugin as ProseMirrorPlugin } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { ImagePlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";
import { useToast } from "@/hooks/use-toast";
import { CALLOUT_DEFAULT_TITLES, parseCalloutMarker } from "@/lib/osler/callouts";
import { CALLOUT_MENU_TYPES, calloutIconSvg } from "@/lib/osler/callout-icons";
import {
  uploadImageForEditor,
  resolveImageForPreview,
  isImageFile,
  formatBytes,
  type UploadImageResult,
} from "@/components/osler/admin/editors/image-upload";
import {
  useMermaidModal,
  renderMermaidToSvg,
} from "@/components/osler/admin/editors/mermaid-editor";

// ── Callout authoring helpers ────────────────────────────────────────────

const CALLOUT_MARKER_PREFIX_RE = /^\[![a-zA-Z-]+\][+-]?\s*/;

/** The callout wrapping the cursor, if any. */
function currentCallout(ctx: Ctx): { blockquoteFrom: number; text: string } | null {
  const view = ctx.get(editorViewCtx);
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== "blockquote") continue;
    const first = $from.node(d).firstChild;
    const textNode = first?.firstChild;
    return {
      blockquoteFrom: $from.before(d),
      text: textNode?.isText ? textNode.text ?? "" : "",
    };
  }
  return null;
}

/**
 * Apply a callout type at the cursor: inside a blockquote, swap (or inject)
 * the `[!type]` marker of its first paragraph; outside one, insert a fresh
 * callout blockquote with the type's default title. Pure markdown-round-trip
 * — the source keeps a standard blockquote so serialization stays lossless.
 */
function applyCalloutType(ctx: Ctx, typeId: string): void {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const callout = currentCallout(ctx);
  if (!callout) {
    const title = CALLOUT_DEFAULT_TITLES[typeId] ?? typeId;
    insert(`> [!${typeId}] ${title}\n> `)(ctx);
    return;
  }
  const paragraphContentFrom = callout.blockquoteFrom + 2;
  const marker = CALLOUT_MARKER_PREFIX_RE.exec(callout.text);
  if (marker) {
    view.dispatch(
      state.tr.insertText(`[!${typeId}] `, paragraphContentFrom, paragraphContentFrom + marker[0].length),
    );
  } else {
    view.dispatch(state.tr.insertText(`[!${typeId}] `, paragraphContentFrom));
  }
}

// ── Callout decorations ──────────────────────────────────────────────────

// Obsidian-style callouts: a blockquote whose first paragraph starts with
// `[!type]` is painted with the shared .osler-callout classes so notes get
// the same admonition styling as rendered articles (see globals.css and
// lib/osler/callouts.ts). Decorations are presentation-only — the markdown
// source keeps the raw `[!type]` marker, so round-tripping is lossless.
// Pure function of the doc, recomputed on every transaction.
function calloutBlockquoteDecorations(doc: import("@milkdown/kit/prose/model").Node): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "blockquote") return;
    const first = node.firstChild;
    if (!first || first.type.name !== "paragraph") return;
    const parsed = parseCalloutMarker(first.textContent);
    if (!parsed) return;
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `osler-callout osler-callout--${parsed.type}`,
      }),
    );
    // Style only the title RUN — lazy-continuation lines share this
    // paragraph, so a paragraph-level decoration would wrap the whole body
    // in the title's uppercase accent styling. The marker stays visible in
    // the editor (authors need the raw `[!type]` text).
    const paragraphStart = pos + 1;
    let titleEnd = paragraphStart + first.content.size;
    let breakAt = -1;
    first.forEach((child, offset) => {
      if (breakAt < 0 && child.type.name === "hardbreak") {
        breakAt = offset;
        titleEnd = paragraphStart + offset;
      }
    });
    decorations.push(
      Decoration.inline(paragraphStart, titleEnd, { class: "osler-callout-title" }),
    );
    if (breakAt >= 0) {
      decorations.push(
        Decoration.inline(titleEnd, titleEnd + 1, { class: "osler-callout-title-break" }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

const calloutProsePlugin = $prose(
  () =>
    new ProseMirrorPlugin({
      props: {
        decorations(state) {
          return calloutBlockquoteDecorations(state.doc);
        },
      },
    }),
);

// ── Mermaid top-bar icon ─────────────────────────────────────────────────

// Material "account tree" glyph — nodes connected in a flowchart, the
// universal mermaid/diagram affordance. Matches Crepe's icon format
// (fill comes from CSS, `currentColor` via the top-bar item rule).
const mermaidIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <path
      d="M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3z"
    />
  </svg>
`;

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
  /** Opens the mermaid modal to insert a new diagram. Wired into the
   *  top-bar Insert group when `enableMermaid` + `enableTopBar` are set. */
  onTopBarInsertMermaid?: () => void;
  /** Opens the mermaid modal and inserts the authored diagram as a mermaid
   *  code block at the cursor. Wired into the slash menu ("/" menu) when
   *  `enableMermaid` is set. */
  onSlashInsertMermaid?: (ctx: Ctx) => void;
}

function InnerMilkdownEditor({
  value,
  onChange,
  placeholder,
  readOnly = false,
  r2KeyBase,
  rawR2Key,
  enableTopBar = false,
  enableMermaid = false,
  enableImageUpload = true,
  registerCrepe,
  onTopBarInsertMermaid,
  onSlashInsertMermaid,
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
  const onTopBarInsertRef = React.useRef(onTopBarInsertMermaid);
  onTopBarInsertRef.current = onTopBarInsertMermaid;
  const onSlashInsertRef = React.useRef(onSlashInsertMermaid);
  onSlashInsertRef.current = onSlashInsertMermaid;
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
    // Inline mermaid preview: renders `mermaid` code blocks to SVG via the
    // CodeMirror block preview hook (same pattern as the built-in Latex
    // feature). Debounced + sequence-guarded so rapid edits cancel stale
    // renders instead of racing. Only the last render applies.
    let previewSeq = 0;
    let previewTimer: number | null = null;
    const renderMermaidPreview = (
      language: string,
      content: string,
      applyPreview: (value: null | string | HTMLElement) => void,
    ) => {
      if (language !== "mermaid" || !content.trim()) return null;
      const seq = ++previewSeq;
      if (previewTimer) window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(() => {
        void renderMermaidToSvg(content)
          .then((svg) => {
            if (seq !== previewSeq) return;
            applyPreview(`<div class="osler-mermaid-render">${svg}</div>`);
          })
          .catch(() => {
            if (seq === previewSeq) applyPreview(null);
          });
      }, 200);
      return undefined;
    };

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
        // Mermaid code blocks render inline as diagrams. Only enabled when
        // mermaid support is on; for every other language renderPreview
        // returns null so the default code-block rendering is untouched.
        [Crepe.Feature.CodeMirror]: enableMermaid
          ? {
              previewOnlyByDefault: true,
              renderPreview: renderMermaidPreview,
              previewLabel: t("editor.mermaid.previewLabel"),
              previewLoading: t("editor.mermaid.previewLoading"),
              previewToggleText: (previewOnlyMode: boolean) =>
                previewOnlyMode
                  ? t("editor.mermaid.previewEdit")
                  : t("editor.mermaid.previewHide"),
            }
          : undefined,
        // When the top bar is enabled, surface the callout type selector
        // (a dropdown, like the heading picker) plus a mermaid button in
        // the Insert group when mermaid support is on.
        [Crepe.Feature.TopBar]: enableTopBar
          ? {
              buildTopBar: (builder) => {
                if (enableMermaid) {
                  builder.getGroup("insert").addItem("mermaid", {
                    icon: mermaidIcon,
                    active: () => false,
                    onRun: () => onTopBarInsertRef.current?.(),
                  });
                }
                const calloutGroup = builder.addGroup("callout", t("editor.callout.group"));
                calloutGroup.addItem("callout-selector", {
                  icon: calloutIconSvg("note"),
                  active: (ctx) => currentCallout(ctx) !== null,
                  selector: {
                    activeLabel: (ctx) => {
                      const parsed = parseCalloutMarker(currentCallout(ctx)?.text ?? "");
                      return parsed ? t(`editor.callout.${parsed.type}` as "editor.callout.note") : t("editor.callout.topbarDefault");
                    },
                    options: CALLOUT_MENU_TYPES.map((typeId) => ({
                      label: t(`editor.callout.${typeId}` as "editor.callout.note"),
                      onSelect: (ctx) => applyCalloutType(ctx, typeId),
                    })),
                  },
                });
              },
            }
          : undefined,
        [Crepe.Feature.BlockEdit]: {
          // Minimize the block handle offset so it sits close to the
          // text (just inside the editor card's left padding). The
          // default offset of 16 pushes it too far left for a compact
          // card editor.
          blockHandle: {
            getOffset: () => 4,
          },
          // Position the slash menu against the viewport instead of the
          // editor's scroll container. The editor scrolls internally
          // (overflow-y: auto), so a default `absolute` popover gets
          // clipped at the container edge — a `fixed` popover floats
          // above it and stays fully visible while typing.
          slashMenu: {
            floatingUIOptions: { strategy: "fixed" },
          },
          // Slash menu: a dedicated "Callouts" group (one item per type —
          // runs applyCalloutType, which inserts a fresh callout or converts
          // the enclosing blockquote), plus the mermaid item in Advanced
          // when mermaid support is on.
          buildMenu: (builder) => {
            const calloutGroup = builder.addGroup("callouts", t("editor.callout.group"));
            for (const typeId of CALLOUT_MENU_TYPES) {
              calloutGroup.addItem(`callout-${typeId}`, {
                label: t(`editor.callout.${typeId}` as "editor.callout.note"),
                icon: calloutIconSvg(typeId),
                onRun: (ctx) => applyCalloutType(ctx, typeId),
              });
            }
            if (enableMermaid) {
              builder.getGroup("advanced").addItem("mermaid", {
                label: t("editor.mermaid.insertSlash"),
                icon: mermaidIcon,
                onRun: (ctx) => onSlashInsertRef.current?.(ctx),
              });
            }
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

    // Callout decorations (Obsidian `[!type]` blockquotes) — presentation
    // only, works across every editor context (notes, answers, admin).
    crepe.editor.use(calloutProsePlugin);

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

  const handleEditMermaidBlock = React.useCallback(
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

  // Click a rendered diagram to edit it. Rendered previews carry the
  // .osler-mermaid-render class; delegate clicks on the wrapper to the
  // matching markdown block by document order.
  const handleMermaidClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (readOnly || !enableMermaid) return;
      const renderEl = (e.target as HTMLElement).closest<HTMLElement>(".osler-mermaid-render");
      if (!renderEl || !wrapperRef.current) return;
      const all = Array.from(wrapperRef.current.querySelectorAll<HTMLElement>(".osler-mermaid-render"));
      const idx = all.indexOf(renderEl);
      if (idx < 0) return;
      const block = findMermaidBlocks(value)[idx];
      if (!block) return;
      handleEditMermaidBlock(block);
    },
    [readOnly, enableMermaid, handleEditMermaidBlock, value],
  );

  const handleInsertMermaid = React.useCallback(() => {
    openModal("", (newCode: string) => {
      const insertion = `\n\n\`\`\`mermaid\n${newCode.trim()}\n\`\`\`\n\n`;
      onChange(value + insertion);
    });
  }, [openModal, value, onChange]);

  // Slash-menu ("/" menu) variant: insert the authored diagram as a mermaid
  // code block at the cursor. Clears the "/" trigger text first, then inserts
  // the fenced block via the milkdown parser (replaces the empty paragraph).
  const handleSlashInsertMermaid = React.useCallback(
    (ctx: Ctx) => {
      openModal("", (newCode: string) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        insert(`\`\`\`mermaid\n${newCode.trim()}\n\`\`\``)(ctx);
      });
    },
    [openModal],
  );

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
      onClick={handleMermaidClick}
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
            enableMermaid={enableMermaid}
            enableImageUpload={enableImageUpload}
            onTopBarInsertMermaid={handleInsertMermaid}
            onSlashInsertMermaid={handleSlashInsertMermaid}
            registerCrepe={registerCrepe}
          />
        </MilkdownProvider>
</div>

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
