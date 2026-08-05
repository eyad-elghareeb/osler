"use client";

/**
 * Markdown editor — React port of tauri-admin/frontend/views/markdown-editor.js.
 *
 * Features ported from the tauri-admin EasyMDE editor:
 *  · Formatting toolbar (bold/italic/headings/lists/quote/code/link/image/table/hr)
 *  · Slash command palette (type `/` to open)
 *  · Mermaid chip overlay (auto-detects ```mermaid blocks and adds an "Edit
 *    Diagram" button that opens the MermaidEditorModal)
 *  · Image upload to `<r2KeyBase>/images/<name>` (or fallback to local file
 *    picker when r2KeyBase is not provided)
 *  · Edit/preview toggle (preview uses react-markdown + remark-gfm so all
 *    GFM features work, including tables and code blocks)
 *  · Word/char/line counters
 *  · Keyboard shortcuts: Ctrl+B/I/K, Tab → 2 spaces
 *
 * Uses a plain textarea (not EasyMDE) so we don't pull in a CDN dep.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  Image as ImageIcon,
  Table,
  Minus,
  Eye,
  Pencil,
  Columns2,
  ImagePlus,
  Workflow,
  Loader2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMermaidModal } from "./mermaid-editor";
import { useToast } from "@/hooks/use-toast";
import {
  uploadImageForEditor,
  resolveImageForPreview,
  isImageFile,
  formatBytes,
} from "./image-upload";

interface ToolbarAction {
  icon: React.ReactNode;
  label: string;
  prefix: string;
  suffix: string;
  placeholder?: string;
  block?: boolean;
}

const ACTIONS: ToolbarAction[] = [
  { icon: <Bold className="size-4" />, label: "Bold", prefix: "**", suffix: "**", placeholder: "bold text" },
  { icon: <Italic className="size-4" />, label: "Italic", prefix: "*", suffix: "*", placeholder: "italic text" },
  { icon: <Strikethrough className="size-4" />, label: "Strikethrough", prefix: "~~", suffix: "~~", placeholder: "strikethrough" },
  { icon: <Code className="size-4" />, label: "Inline code", prefix: "`", suffix: "`", placeholder: "code" },
  { icon: <Heading1 className="size-4" />, label: "Heading 1", prefix: "# ", suffix: "", placeholder: "Heading 1", block: true },
  { icon: <Heading2 className="size-4" />, label: "Heading 2", prefix: "## ", suffix: "", placeholder: "Heading 2", block: true },
  { icon: <Heading3 className="size-4" />, label: "Heading 3", prefix: "### ", suffix: "", placeholder: "Heading 3", block: true },
  { icon: <List className="size-4" />, label: "Bullet list", prefix: "- ", suffix: "", placeholder: "List item", block: true },
  { icon: <ListOrdered className="size-4" />, label: "Numbered list", prefix: "1. ", suffix: "", placeholder: "List item", block: true },
  { icon: <Quote className="size-4" />, label: "Blockquote", prefix: "> ", suffix: "", placeholder: "Quote", block: true },
  { icon: <LinkIcon className="size-4" />, label: "Link", prefix: "[", suffix: "](url)", placeholder: "link text" },
  { icon: <ImageIcon className="size-4" />, label: "Image", prefix: "![", suffix: "](url)", placeholder: "alt text" },
  { icon: <Table className="size-4" />, label: "Table", prefix: "\n| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |\n", suffix: "", block: true },
  { icon: <Minus className="size-4" />, label: "Horizontal rule", prefix: "\n---\n", suffix: "", block: true },
];

// ── Slash palette items ────────────────────────────────────────────────────

interface SlashItem {
  icon: React.ReactNode;
  label: string;
  insert: string;
  cursorOffset?: number;
}

const SLASH_GROUPS: Array<{ name: string; items: SlashItem[] }> = [
  {
    name: "Format",
    items: [
      { icon: <Heading1 className="size-3.5" />, label: "Heading 1", insert: "# " },
      { icon: <Heading2 className="size-3.5" />, label: "Heading 2", insert: "## " },
      { icon: <Heading3 className="size-3.5" />, label: "Heading 3", insert: "### " },
    ],
  },
  {
    name: "Style",
    items: [
      { icon: <Bold className="size-3.5" />, label: "Bold", insert: "****", cursorOffset: -2 },
      { icon: <Italic className="size-3.5" />, label: "Italic", insert: "**", cursorOffset: -1 },
      { icon: <Strikethrough className="size-3.5" />, label: "Strikethrough", insert: "~~~~", cursorOffset: -2 },
    ],
  },
  {
    name: "Block",
    items: [
      { icon: <Quote className="size-3.5" />, label: "Blockquote", insert: "> " },
      { icon: <List className="size-3.5" />, label: "Bullet list", insert: "- " },
      { icon: <ListOrdered className="size-3.5" />, label: "Ordered list", insert: "1. " },
      { icon: <Code className="size-3.5" />, label: "Code block", insert: "```\n\n```", cursorOffset: -4 },
      { icon: <Table className="size-3.5" />, label: "Table", insert: "| Col 1 | Col 2 |\n|-------|-------|\n|       |       |" },
      { icon: <Minus className="size-3.5" />, label: "Horizontal rule", insert: "\n---\n" },
    ],
  },
  {
    name: "Insert",
    items: [
      { icon: <LinkIcon className="size-3.5" />, label: "Link", insert: "[](url)", cursorOffset: -6 },
      { icon: <ImageIcon className="size-3.5" />, label: "Image", insert: "![]()", cursorOffset: -1 },
    ],
  },
  {
    name: "Diagram",
    items: [
      { icon: <Workflow className="size-3.5" />, label: "Mermaid diagram", insert: "```mermaid\ngraph TD\n  A --> B\n```", cursorOffset: -4 },
    ],
  },
];

// ── Component ──────────────────────────────────────────────────────────────

export interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
  /** R2 key base for the content_object. When provided, shows an "Upload image"
   *  button that uploads to `<r2KeyBase>/images/<name>` and inserts the
   *  `![](images/<name>)` reference at the cursor. */
  r2KeyBase?: string;
  /** Raw R2 key for in-place editing of a content-files/... file. Used to
   *  resolve image uploads when there's no managed content_object backing
   *  the editor. */
  rawR2Key?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
  className,
  placeholder,
  r2KeyBase,
  rawR2Key,
}: MarkdownEditorProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState<"edit" | "preview" | "split">("edit");
  const { toast } = useToast();
  const { t } = useI18n();
  const { openModal, modal: mermaidModal } = useMermaidModal();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const lastUploadedRef = React.useRef<{ ref: string; key: string; dataUri: string } | null>(null);

  const canUpload = !!(r2KeyBase || rawR2Key);

  // ── Slash palette state ──────────────────────────────────────────────
  const [slashOpen, setSlashOpen] = React.useState(false);
  const [slashQuery, setSlashQuery] = React.useState("");
  const [slashPos, setSlashPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [slashSelected, setSlashSelected] = React.useState(0);
  const slashAnchorRef = React.useRef<{ line: number; ch: number } | null>(null);

  const flatSlashItems = React.useMemo(() => {
    const q = slashQuery.toLowerCase();
    const out: SlashItem[] = [];
    for (const g of SLASH_GROUPS) {
      const matched = g.items.filter((i) => i.label.toLowerCase().includes(q));
      out.push(...matched);
    }
    return out;
  }, [slashQuery]);

  // Reset selected index when query changes
  React.useEffect(() => {
    setSlashSelected(0);
  }, [slashQuery]);

  // ── Formatting helpers ────────────────────────────────────────────────
  function insertFormatting(action: ToolbarAction) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.substring(start, end);
    const text = selected || (action.placeholder ?? "");
    let newText: string;
    let newCursorPos: number;
    if (action.block) {
      const needsNewline = start > 0 && value[start - 1] !== "\n";
      const prefix = needsNewline ? "\n" + action.prefix : action.prefix;
      newText = value.substring(0, start) + prefix + text + action.suffix + value.substring(end);
      newCursorPos = start + prefix.length + text.length;
    } else {
      newText = value.substring(0, start) + action.prefix + text + action.suffix + value.substring(end);
      newCursorPos = start + action.prefix.length + text.length;
    }
    onChange(newText);
    requestAnimationFrame(() => {
      ta.focus();
      if (selected) {
        ta.setSelectionRange(start + action.prefix.length, newCursorPos);
      } else {
        ta.setSelectionRange(start + action.prefix.length, newCursorPos - action.suffix.length);
      }
    });
  }

  function insertAtCursor(text: string, cursorOffset = 0) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newText = value.substring(0, start) + text + value.substring(end);
    onChange(newText);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length + cursorOffset;
      ta.setSelectionRange(pos, pos);
    });
  }

  // ── Slash palette logic ──────────────────────────────────────────────
  function openSlashPalette() {
    const ta = textareaRef.current;
    if (!ta) return;
    // Compute approximate cursor position relative to the textarea wrapper.
    // We use the textarea's bounding rect + a rough line/col estimate.
    const rect = ta.getBoundingClientRect();
    const wrapRect = wrapperRef.current?.getBoundingClientRect();
    if (!wrapRect) return;
    // Approximate cursor coordinates using a mirror div technique is heavy;
    // for simplicity, anchor the palette to the bottom-left of the textarea.
    setSlashPos({
      top: rect.bottom - wrapRect.top - 100,  // approx cursor line
      left: Math.max(8, rect.left - wrapRect.left + 30),
    });
    slashAnchorRef.current = { line: ta.selectionStart, ch: ta.selectionEnd };
    setSlashQuery("");
    setSlashSelected(0);
    setSlashOpen(true);
  }

  function closeSlashPalette() {
    setSlashOpen(false);
    slashAnchorRef.current = null;
  }

  function applySlashItem(item: SlashItem) {
    const ta = textareaRef.current;
    if (!ta) {
      insertAtCursor(item.insert, item.cursorOffset ?? 0);
      closeSlashPalette();
      return;
    }
    // Find the slash that triggered the palette (last `/` before cursor).
    const cursor = ta.selectionStart;
    const before = value.slice(0, cursor);
    const slashIdx = before.lastIndexOf("/");
    if (slashIdx >= 0) {
      const newText = value.slice(0, slashIdx) + item.insert + value.slice(cursor);
      onChange(newText);
      requestAnimationFrame(() => {
        ta.focus();
        const pos = slashIdx + item.insert.length + (item.cursorOffset ?? 0);
        ta.setSelectionRange(pos, pos);
      });
    } else {
      insertAtCursor(item.insert, item.cursorOffset ?? 0);
    }
    closeSlashPalette();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Slash palette key handlers
    if (slashOpen) {
      if (e.key === "Escape") { e.preventDefault(); closeSlashPalette(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelected((s) => Math.min(flatSlashItems.length - 1, s + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelected((s) => Math.max(0, s - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (flatSlashItems[slashSelected]) {
          e.preventDefault();
          applySlashItem(flatSlashItems[slashSelected]);
          return;
        }
      }
    }
    // Tab → 2 spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = value.substring(0, start) + "  " + value.substring(end);
      onChange(newVal);
      requestAnimationFrame(() => ta.setSelectionRange(start + 2, start + 2));
      return;
    }
    // Ctrl+B / I / K
    if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); insertFormatting(ACTIONS[0]); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "i") { e.preventDefault(); insertFormatting(ACTIONS[1]); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); insertFormatting(ACTIONS[10]); return; }
    // `/` opens the palette
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Defer to let the `/` land
      setTimeout(() => openSlashPalette(), 0);
    }
  }

  function handleKeyUp(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!slashOpen) return;
    // Update filter from the text after the slash
    const ta = e.currentTarget;
    const cursor = ta.selectionStart;
    const before = value.slice(0, cursor);
    const m = before.match(/\/(\w*)$/);
    if (m) {
      setSlashQuery(m[1]);
    } else {
      closeSlashPalette();
    }
  }

  // ── Image upload ──────────────────────────────────────────────────────
  //
  // Supports three input paths:
  //   1. The toolbar "Upload image" button (file picker).
  //   2. Dragging image files onto the textarea.
  //   3. Pasting an image (clipboard, screenshot, copied image) into the
  //      textarea.
  //
  // All three funnel through handleImageUpload(), which:
  //   · sanitises the filename (lowercase, hyphenated, ASCII-only)
  //   · adds a short uniqueness suffix so re-uploads don't clobber
  //   · computes the right R2 key for managed OR raw mode
  //   · uploads via adminApi.uploadFile
  //   · inserts `![alt](images/<name>)` at the cursor with the file's
  //     base name as the alt text

  async function handleImageUpload(file: File): Promise<void> {
    if (!isImageFile(file)) {
      toast({ title: t("admin.markdown.notAnImage"), variant: "destructive" });
      return;
    }
    if (!canUpload) {
      // No R2 destination — just insert a relative reference. The user
      // will need to upload the file out-of-band.
      const ref = `images/${file.name}`;
      insertAtCursor(`![${file.name}](${ref})`);
      toast({ title: t("admin.markdown.insertedNoUpload") });
      return;
    }
    setUploading(true);
    try {
      const result = await uploadImageForEditor(file, { r2KeyBase, rawR2Key });
      lastUploadedRef.current = result;
      // Use the file's base name as alt text (strip extension + sanitise visually)
      const altText = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "image";
      insertAtCursor(`![${altText}](${result.ref})`);
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
      const msg = err?.message ?? String(err);
      toast({ title: t("admin.markdown.uploadFailed"), description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleImageFiles(files: File[] | FileList): Promise<void> {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const images = arr.filter(isImageFile);
    if (images.length === 0) {
      toast({ title: t("admin.markdown.notAnImage"), variant: "destructive" });
      return;
    }
    for (const f of images) {
      await handleImageUpload(f);
    }
  }

  function handleDrop(e: React.DragEvent) {
    if (readOnly || view === "preview") return;
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
    // Only intercept image drops — let other drops (e.g. text) fall through
    // to the browser default.
    const arr = Array.from(e.dataTransfer.files);
    if (!arr.some(isImageFile)) return;
    e.preventDefault();
    setDragActive(false);
    void handleImageFiles(arr);
  }

  function handleDragOver(e: React.DragEvent) {
    if (readOnly || view === "preview") return;
    if (!e.dataTransfer) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only clear when leaving the wrapper, not when moving between children.
    if (e.currentTarget === e.target) setDragActive(false);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (readOnly) return;
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
    e.preventDefault(); // stop the browser from inserting a binary blob
    void handleImageFiles(images);
  }

  // ── Mermaid chip overlay ──────────────────────────────────────────────
  //
  // Scans the textarea content for ```mermaid blocks and renders a chip
  // button below each one (using a portal into the textarea wrapper). Clicking
  // the chip opens the MermaidEditorModal.
  const [mermaidChips, setMermaidChips] = React.useState<Array<{ startLine: number; endLine: number; code: string }>>([]);
  React.useEffect(() => {
    if (view === "preview") return;
    const lines = value.split("\n");
    const chips: Array<{ startLine: number; endLine: number; code: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```mermaid\s*$/.test(lines[i])) {
        const startLine = i;
        let endLine = -1;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\s*```\s*$/.test(lines[j])) { endLine = j; break; }
        }
        if (endLine === -1) continue;
        const code = lines.slice(startLine + 1, endLine).join("\n");
        chips.push({ startLine, endLine, code });
        i = endLine;
      }
    }
    setMermaidChips(chips);
  }, [value, view]);

  function replaceMermaidBlock(startLine: number, endLine: number, newCode: string) {
    const lines = value.split("\n");
    const next = [
      ...lines.slice(0, startLine + 1),
      ...newCode.trim().split("\n"),
      ...lines.slice(endLine),
    ].join("\n");
    onChange(next);
  }

  // ── Counters ──────────────────────────────────────────────────────────
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const chars = value.length;
  const lines = value.split("\n").length;

  // Rendered markdown preview (shared between preview + split views).
  const renderedPreview = (
    <div className="min-h-0 flex-1 overflow-y-auto medos-scroll-y p-4 prose prose-sm dark:prose-invert max-w-none osler-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Render mermaid code blocks as inline SVG via the mermaid dep
          code({ inline, className, children, ...props }: any) {
            const text = String(children);
            if (!inline && className === "language-mermaid") {
              return <MermaidBlock code={text} />;
            }
            return <code className={className} {...props}>{children}</code>;
          },
          // Resolve relative image refs (images/foo.png, foo.png) to
          // URLs the admin can preview via the local R2 proxy.
          img({ src, alt, ...props }: any) {
            const resolved = resolveImageForPreview(String(src ?? ""), { r2KeyBase, rawR2Key });
            return (
              <img
                src={resolved}
                alt={alt}
                {...props}
                onError={(e) => {
                  // Hide broken images rather than showing the browser
                  // broken-image icon — the user can still see the alt text
                  // and the markdown source.
                  (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                }}
              />
            );
          },
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div ref={wrapperRef} className={cn("border border-border rounded-lg overflow-hidden bg-background relative flex flex-col h-full", className)}>
        {/* Toolbar */}
        {!readOnly && (
          <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/30 flex-wrap">
            {ACTIONS.map((action, i) => (
              <React.Fragment key={action.label}>
                {(i === 3 || i === 6 || i === 9 || i === 13) && (
                  <div className="w-px h-5 bg-border mx-1" />
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      onClick={() => insertFormatting(action)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {action.icon}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t(`admin.markdown.toolbar.${action.label}` as any)}</TooltipContent>
                </Tooltip>
              </React.Fragment>
            ))}
            {/* Image upload */}
            {canUpload && (
              <>
                <div className="w-px h-5 bg-border mx-1" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {uploading
                        ? <Loader2 className="size-4 animate-spin" />
                        : <ImagePlus className="size-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t("admin.markdown.uploadImage")}</TooltipContent>
                </Tooltip>
              </>
            )}
            <div className="flex-1" />
            <div className="w-px h-5 bg-border mx-1" />
            {([
              { key: "edit", icon: <Pencil className="size-4" />, label: t("admin.markdown.edit") },
              { key: "split", icon: <Columns2 className="size-4" />, label: t("admin.markdown.split") },
              { key: "preview", icon: <Eye className="size-4" />, label: t("admin.markdown.preview") },
            ] as const).map(({ key, icon, label }) => (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={view === key ? "secondary" : "ghost"}
                    size="iconSm"
                    onClick={() => setView(key)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {icon}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}

        {/* Editor / Preview / Split */}
        {view === "preview" ? (
          renderedPreview
        ) : view === "split" ? (
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
            <div
              className={cn("relative min-h-0", dragActive && "ring-2 ring-inset ring-primary/60")}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                readOnly={readOnly}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                onPaste={handlePaste}
                onBlur={() => setTimeout(() => setSlashOpen(false), 100)}
                className="w-full h-full min-h-[200px] p-4 font-mono text-sm bg-transparent resize-none focus:outline-none"
                placeholder={placeholder ?? t("admin.markdown.placeholder")}
                spellCheck={false}
              />
              {/* Drag overlay hint */}
              {dragActive && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary/60 rounded pointer-events-none">
                  <div className="flex flex-col items-center gap-1 text-primary">
                    <ImagePlus className="size-6" />
                    <span className="text-xs font-medium">{t("admin.markdown.dropToUpload")}</span>
                  </div>
                </div>
              )}
              {/* Mermaid chip overlays */}
              {mermaidChips.map((chip, i) => (
                <MermaidChip
                  key={i}
                  chip={chip}
                  totalLines={lines}
                  onEdit={() => {
                    openModal(chip.code, (newCode) => replaceMermaidBlock(chip.startLine, chip.endLine, newCode));
                  }}
                />
              ))}
            </div>
            {renderedPreview}
          </div>
        ) : (
          <div
            className={cn("relative flex-1 min-h-0", dragActive && "ring-2 ring-inset ring-primary/60")}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              readOnly={readOnly}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onPaste={handlePaste}
              onBlur={() => setTimeout(() => setSlashOpen(false), 100)}
              className="w-full h-full min-h-[200px] p-4 font-mono text-sm bg-transparent resize-none focus:outline-none"
              placeholder={placeholder ?? t("admin.markdown.placeholder")}
              spellCheck={false}
            />
            {/* Drag overlay hint */}
            {dragActive && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary/60 rounded pointer-events-none">
                <div className="flex flex-col items-center gap-1 text-primary">
                  <ImagePlus className="size-6" />
                  <span className="text-xs font-medium">{t("admin.markdown.dropToUpload")}</span>
                </div>
              </div>
            )}
            {/* Mermaid chip overlays */}
            {mermaidChips.map((chip, i) => (
              <MermaidChip
                key={i}
                chip={chip}
                totalLines={lines}
                onEdit={() => {
                  openModal(chip.code, (newCode) => replaceMermaidBlock(chip.startLine, chip.endLine, newCode));
                }}
              />
            ))}
          </div>
        )}

        {/* Hidden file input for image uploads (accepts multiple so the
            user can pick several at once — they all get inserted at the
            cursor in order) */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              void handleImageFiles(e.target.files);
            }
            e.target.value = "";
          }}
        />

        {/* Slash palette */}
        {slashOpen && (
          <SlashPalette
            items={flatSlashItems}
            selected={slashSelected}
            onSelect={applySlashItem}
            position={slashPos}
            query={slashQuery}
          />
        )}

        {/* Status bar */}
        <div className="flex items-center gap-3 px-4 py-1.5 border-t border-border text-[11px] text-muted-foreground">
          <span>{t("admin.markdown.words", { n: String(words) })}</span>
          <span>·</span>
          <span>{t("admin.markdown.chars", { n: String(chars) })}</span>
          <span>·</span>
          <span>{t("admin.markdown.lines", { n: String(lines) })}</span>
          <span className="flex-1" />
          <span className="font-mono">{t("admin.markdown.hint")}</span>
        </div>

        {mermaidModal}
      </div>
    </TooltipProvider>
  );
}

// ── Slash palette ──────────────────────────────────────────────────────────

function SlashPalette({
  items,
  selected,
  onSelect,
  position,
  query,
}: {
  items: SlashItem[];
  selected: number;
  onSelect: (item: SlashItem) => void;
  position: { top: number; left: number };
  query: string;
}) {
  const { t } = useI18n();
  if (items.length === 0) {
    return (
      <div
        className="absolute z-50 bg-popover border border-border rounded-lg shadow-xl p-2 text-xs text-muted-foreground"
        style={{ top: position.top, left: position.left }}
      >
        {t("admin.markdown.noCommands")}
      </div>
    );
  }
  return (
    <div
      className="absolute z-50 bg-popover border border-border rounded-lg shadow-xl max-h-72 overflow-y-auto medos-scroll-y min-w-[200px]"
      style={{ top: position.top, left: position.left }}
    >
      {SLASH_GROUPS.map((g) => {
        const matched = g.items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()));
        if (matched.length === 0) return null;
        return (
          <div key={g.name}>
            <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/30 sticky top-0">
              {g.name}
            </div>
            {matched.map((item) => {
              const idx = items.indexOf(item);
              return (
                <button
                  key={`${g.name}-${item.label}`}
                  type="button"
                  onMouseEnter={() => { /* hover handled via CSS */ }}
                  onClick={() => onSelect(item)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 text-xs text-start",
                    idx === selected ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
                  )}
                >
                  <span className="text-muted-foreground">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Mermaid chip ────────────────────────────────────────────────────────────
//
// Renders an "Edit Diagram" chip button positioned just below the mermaid
// fence line. Since textarea doesn't expose per-line coords, we approximate
// the position by computing the line height and counting rows.

function MermaidChip({
  chip,
  totalLines,
  onEdit,
}: {
  chip: { startLine: number; endLine: number; code: string };
  totalLines: number;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  // The chip is positioned absolutely within the textarea wrapper. We
  // approximate the y-offset by line-height * startLine.
  const lineHeight = 20; // px, matches `text-sm font-mono` line height
  const paddingTop = 16; // matches p-4
  const top = paddingTop + chip.startLine * lineHeight + lineHeight; // below the fence line

  return (
    <button
      type="button"
      onClick={onEdit}
      className="absolute z-10 right-3 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors"
      style={{ top }}
      title={t("admin.markdown.openMermaid")}
    >
      <Workflow className="size-3" />
      {t("admin.markdown.editDiagram")}
    </button>
  );
}

// ── Mermaid block (rendered in preview mode) ──────────────────────────────

function MermaidBlock({ code }: { code: string }) {
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
        const id = `mermaid-md-${Math.random().toString(36).slice(2, 10)}`;
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
    return <pre className="bg-destructive/10 text-destructive p-2 rounded text-xs">{t("admin.mermaid.error", { error, code })}</pre>;
  }
  if (!svg) return <div className="text-xs text-muted-foreground">{t("admin.mermaid.loading")}</div>;
  return <div dangerouslySetInnerHTML={{ __html: svg }} className="[&_svg]:max-w-full [&_svg]:h-auto" />;
}
