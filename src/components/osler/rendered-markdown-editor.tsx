"use client";

/**
 * RenderedMarkdownEditor — a Notion-style WYSIWYG markdown editor
 * for written answers in QBank.
 *
 * Key design decisions:
 *   • Content is split into "blocks" (paragraphs, headings, lists, etc.)
 *   • Blocks are rendered as formatted markdown by default
 *   • Clicking a block switches it to a textarea for editing
 *   • On blur, the block re-renders as formatted content
 *   • Slash commands (`/`) on an empty block open a palette
 *   • A formatting toolbar applies markdown syntax to selected text
 *   • No image upload, no mermaid diagrams — lightweight for student use
 *
 * The markdown is stored as a single string (the `value` prop) so it
 * integrates seamlessly with the existing writtenDrafts storage.
 */

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  Table,
  Link as LinkIcon,
  Plus,
  Minus,
  ChevronRight,
  Type,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";

// ── Block splitting ──────────────────────────────────────────────────────
// Split markdown into blocks. A block boundary is a blank line.
// Special blocks (code fences, tables) are kept together even if
// they contain internal blank lines.

function splitBlocks(md: string): string[] {
  if (!md.trim()) return [""];
  const lines = md.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    // Track code fences — content inside ``` is one block
    if (line.trimStart().startsWith("```")) {
      inCodeFence = !inCodeFence;
      current.push(line);
      if (!inCodeFence) {
        // End of code fence — flush block
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    if (inCodeFence) {
      current.push(line);
      continue;
    }

    // Table rows (starting with |) stay together
    const isTableLine = line.trimStart().startsWith("|");
    const prevIsTable = current.length > 0 && current[current.length - 1].trimStart().startsWith("|");
    if (isTableLine && (prevIsTable || current.length === 0)) {
      current.push(line);
      continue;
    }
    // If we hit a non-table line after table lines, flush the table block
    if (!isTableLine && prevIsTable && line.trim() === "") {
      blocks.push(current.join("\n"));
      current = [];
      continue;
    }

    // Blank line = block boundary
    if (line.trim() === "") {
      if (current.length > 0) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }

    current.push(line);
  }
  if (current.length > 0) {
    blocks.push(current.join("\n"));
  }
  return blocks.length > 0 ? blocks : [""];
}

function joinBlocks(blocks: string[]): string {
  return blocks.join("\n\n");
}

// ── Detect block type for icon ──────────────────────────────────────────

function blockTypeIcon(block: string): React.ReactNode {
  const trimmed = block.trimStart();
  if (trimmed.startsWith("### ")) return <Heading3 className="size-3" />;
  if (trimmed.startsWith("## ")) return <Heading2 className="size-3" />;
  if (trimmed.startsWith("# ")) return <Heading1 className="size-3" />;
  if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) return <List className="size-3" />;
  if (/^\d+\.\s/.test(trimmed)) return <ListOrdered className="size-3" />;
  if (trimmed.startsWith("> ")) return <Quote className="size-3" />;
  if (trimmed.startsWith("```")) return <Code className="size-3" />;
  if (trimmed.startsWith("|")) return <Table className="size-3" />;
  return <Type className="size-3" />;
}

// ── Slash command items ────────────────────────────────────────────────

interface SlashItem {
  icon: React.ReactNode;
  label: string;
  insert: string;
  cursorOffset?: number;
}

const SLASH_ITEMS: SlashItem[] = [
  { icon: <Heading1 className="size-3.5" />, label: "Heading 1", insert: "# " },
  { icon: <Heading2 className="size-3.5" />, label: "Heading 2", insert: "## " },
  { icon: <Heading3 className="size-3.5" />, label: "Heading 3", insert: "### " },
  { icon: <Bold className="size-3.5" />, label: "Bold", insert: "****", cursorOffset: -2 },
  { icon: <Italic className="size-3.5" />, label: "Italic", insert: "**", cursorOffset: -1 },
  { icon: <Strikethrough className="size-3.5" />, label: "Strikethrough", insert: "~~~~", cursorOffset: -2 },
  { icon: <List className="size-3.5" />, label: "Bullet list", insert: "- " },
  { icon: <ListOrdered className="size-3.5" />, label: "Numbered list", insert: "1. " },
  { icon: <Quote className="size-3.5" />, label: "Blockquote", insert: "> " },
  { icon: <Code className="size-3.5" />, label: "Code block", insert: "```\n\n```", cursorOffset: -4 },
  { icon: <Table className="size-3.5" />, label: "Table", insert: "| Col 1 | Col 2 |\n|-------|-------|\n|       |       |" },
  { icon: <LinkIcon className="size-3.5" />, label: "Link", insert: "[text](url)", cursorOffset: -6 },
  { icon: <Minus className="size-3.5" />, label: "Divider", insert: "---" },
];

// ── Formatting toolbar actions ─────────────────────────────────────────

interface FormatAction {
  icon: React.ReactNode;
  label: string;
  prefix: string;
  suffix: string;
  block?: boolean;
}

const FORMAT_ACTIONS: FormatAction[] = [
  { icon: <Bold className="size-3.5" />, label: "Bold", prefix: "**", suffix: "**" },
  { icon: <Italic className="size-3.5" />, label: "Italic", prefix: "*", suffix: "*" },
  { icon: <Strikethrough className="size-3.5" />, label: "Strikethrough", prefix: "~~", suffix: "~~" },
  { icon: <Code className="size-3.5" />, label: "Inline code", prefix: "`", suffix: "`" },
];

// ── Main component ──────────────────────────────────────────────────────

export interface RenderedMarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
}

export function RenderedMarkdownEditor({
  value,
  onChange,
  placeholder,
  className,
  readOnly = false,
}: RenderedMarkdownEditorProps) {
  const { t } = useI18n();
  const blocks = React.useMemo(() => splitBlocks(value), [value]);
  const [editingIdx, setEditingIdx] = React.useState<number | null>(null);
  const [editText, setEditText] = React.useState("");
  const [slashOpen, setSlashOpen] = React.useState(false);
  const [slashQuery, setSlashQuery] = React.useState("");
  const [slashIdx, setSlashIdx] = React.useState(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Track slash query while editing
  React.useEffect(() => {
    if (editingIdx === null) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const slashPos = before.lastIndexOf("/");
    if (slashPos >= 0 && (slashPos === 0 || before[slashPos - 1] === "\n" || before[slashPos - 1] === " ")) {
      const query = before.slice(slashPos + 1);
      if (!query.includes(" ") && query.length <= 20) {
        setSlashQuery(query);
        setSlashOpen(true);
        return;
      }
    }
    setSlashOpen(false);
    setSlashQuery("");
  }, [editText, editingIdx]);

  const filteredSlash = React.useMemo(
    () => SLASH_ITEMS.filter((item) => item.label.toLowerCase().includes(slashQuery.toLowerCase())),
    [slashQuery],
  );

  // Start editing a block
  const startEdit = React.useCallback((idx: number) => {
    if (readOnly) return;
    setEditingIdx(idx);
    setEditText(blocks[idx] ?? "");
    setSlashOpen(false);
  }, [blocks, readOnly]);

  // Save the current edit and close
  const saveEdit = React.useCallback(() => {
    if (editingIdx === null) return;
    const next = [...blocks];
    next[editingIdx] = editText;
    onChange(joinBlocks(next));
    setEditingIdx(null);
    setEditText("");
    setSlashOpen(false);
  }, [editingIdx, editText, blocks, onChange]);

  // Delete a block
  const deleteBlock = React.useCallback((idx: number) => {
    if (readOnly) return;
    const next = blocks.filter((_, i) => i !== idx);
    onChange(joinBlocks(next.length > 0 ? next : [""]));
  }, [blocks, onChange, readOnly]);

  // Add a new empty block after the given index
  const addBlockAfter = React.useCallback((idx: number) => {
    if (readOnly) return;
    const next = [...blocks];
    next.splice(idx + 1, 0, "");
    onChange(joinBlocks(next));
    // Start editing the new block
    setEditingIdx(idx + 1);
    setEditText("");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [blocks, onChange, readOnly]);

  // Apply slash command
  const applySlash = React.useCallback((item: SlashItem) => {
    if (editingIdx === null) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const slashPos = before.lastIndexOf("/");
    if (slashPos < 0) return;
    const after = ta.value.slice(ta.selectionStart);
    const newText = ta.value.slice(0, slashPos) + item.insert + after;
    setEditText(newText);
    setSlashOpen(false);
    setSlashQuery("");
    // Set cursor after insertion
    const cursorPos = slashPos + item.insert.length + (item.cursorOffset ?? 0);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = cursorPos;
        textareaRef.current.selectionEnd = cursorPos;
        textareaRef.current.focus();
      }
    }, 0);
  }, [editingIdx]);

  // Apply inline formatting to selection in the active textarea
  const applyFormat = React.useCallback((action: FormatAction) => {
    const ta = textareaRef.current;
    if (!ta || editingIdx === null) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.slice(start, end);
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const newText = before + action.prefix + selected + action.suffix + after;
    setEditText(newText);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = start + action.prefix.length;
        textareaRef.current.selectionEnd = end + action.prefix.length;
        textareaRef.current.focus();
      }
    }, 0);
  }, [editingIdx]);

  // Keyboard handler for the editing textarea
  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash palette navigation
    if (slashOpen && filteredSlash.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => (i + 1) % filteredSlash.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => (i - 1 + filteredSlash.length) % filteredSlash.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        applySlash(filteredSlash[slashIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }
    // Escape to close edit
    if (e.key === "Escape" && !slashOpen) {
      e.preventDefault();
      saveEdit();
      return;
    }
    // Ctrl+Enter to save
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEdit();
      return;
    }
    // Enter on empty block creates new block below
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const ta = textareaRef.current;
      if (ta && ta.value.trim() === "") {
        e.preventDefault();
        saveEdit();
        addBlockAfter(editingIdx!);
        return;
      }
    }
    // Formatting shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "b") { e.preventDefault(); applyFormat(FORMAT_ACTIONS[0]); }
      if (e.key === "i") { e.preventDefault(); applyFormat(FORMAT_ACTIONS[1]); }
    }
  }, [slashOpen, filteredSlash, slashIdx, applySlash, saveEdit, addBlockAfter, editingIdx, applyFormat]);

  // Focus textarea when editing starts
  React.useEffect(() => {
    if (editingIdx !== null) {
      setTimeout(() => textareaRef.current?.focus(), 30);
    }
  }, [editingIdx]);

  // ── Render ────────────────────────────────────────────────────────────

  const isEmpty = blocks.length === 1 && blocks[0].trim() === "";

  return (
    <div className={cn("rendered-md-editor", className)}>
      {/* Formatting toolbar — shown when a block is being edited */}
      <AnimatePresence>
        {editingIdx !== null && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-0.5 px-2 py-1.5 mb-2 rounded-lg border border-border bg-card shadow-sm"
          >
            {FORMAT_ACTIONS.map((action, i) => (
              <button
                key={i}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); applyFormat(action); }}
                className="size-7 rounded flex items-center justify-center hover:bg-muted transition-colors"
                title={action.label}
              >
                {action.icon}
              </button>
            ))}
            <div className="w-px h-4 bg-border mx-1" />
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); addBlockAfter(editingIdx); }}
              className="size-7 rounded flex items-center justify-center hover:bg-muted transition-colors"
              title="Add block below"
            >
              <Plus className="size-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Blocks */}
      <div className="space-y-1">
        {blocks.map((block, i) => {
          const isEditing = editingIdx === i;
          const isLast = i === blocks.length - 1;
          const isEmptyBlock = block.trim() === "";

          return (
            <div key={i} className="group relative">
              {/* Rendered block (click to edit) */}
              {!isEditing && (
                <div
                  onClick={() => startEdit(i)}
                  className={cn(
                    "relative rounded-md px-3 py-2 min-h-[2rem] cursor-text transition-colors",
                    "hover:bg-muted/30 border border-transparent hover:border-border/60",
                    isEmptyBlock && "text-muted-foreground/50 italic",
                  )}
                >
                  {/* Block type indicator — subtle, shown on hover */}
                  <span className="absolute -left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-60 transition-opacity text-muted-foreground">
                    {blockTypeIcon(block)}
                  </span>
                  {isEmptyBlock ? (
                    <span>{placeholder ?? "Type '/' for commands…"}</span>
                  ) : (
                    <div className="rendered-md-block prose prose-sm dark:prose-invert max-w-none [&_p]:my-0 [&_h1]:my-0 [&_h2]:my-0 [&_h3]:my-0 [&_ul]:my-0 [&_ol]:my-0 [&_blockquote]:my-0 [&_pre]:my-0 [&_table]:my-0">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{block}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}

              {/* Editing block (textarea) */}
              {isEditing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                  className="relative"
                >
                  <textarea
                    ref={textareaRef}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => saveEdit()}
                    placeholder={placeholder ?? "Type '/' for commands…"}
                    className={cn(
                      "w-full rounded-md border-2 border-primary/40 bg-primary/[0.03] px-3 py-2",
                      "text-sm leading-relaxed outline-none resize-y min-h-[2.5rem]",
                      "placeholder:text-muted-foreground/50 placeholder:italic",
                    )}
                    rows={Math.max(2, editText.split("\n").length)}
                  />
                  {/* Slash command palette */}
                  <AnimatePresence>
                    {slashOpen && filteredSlash.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.12 }}
                        className="absolute left-0 top-full z-20 mt-1 w-56 max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-lg py-1"
                      >
                        <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                          <Sparkles className="size-3" />
                          Commands
                        </div>
                        {filteredSlash.map((item, si) => (
                          <button
                            key={si}
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); applySlash(item); }}
                            className={cn(
                              "w-full flex items-center gap-2 px-2.5 py-1.5 text-xs transition-colors",
                              si === slashIdx ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
                            )}
                          >
                            <span className="size-4 shrink-0 flex items-center justify-center text-muted-foreground">
                              {item.icon}
                            </span>
                            <span className="font-medium">{item.label}</span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}

              {/* Block actions — add/delete, shown on hover */}
              {!readOnly && !isEditing && (
                <div className="absolute -right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 z-10">
                  <button
                    type="button"
                    onClick={() => addBlockAfter(i)}
                    className="size-5 rounded flex items-center justify-center bg-card border border-border hover:border-primary/40 shadow-sm"
                    title="Add block below"
                  >
                    <Plus className="size-3 text-muted-foreground" />
                  </button>
                  {blocks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => deleteBlock(i)}
                      className="size-5 rounded flex items-center justify-center bg-card border border-border hover:border-destructive/40 shadow-sm"
                      title="Delete block"
                    >
                      <Minus className="size-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add block button at the bottom */}
      {!readOnly && !isEmpty && (
        <button
          type="button"
          onClick={() => addBlockAfter(blocks.length - 1)}
          className="mt-2 w-full py-2 rounded-md border border-dashed border-border/60 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus className="size-3" />
          Add block
        </button>
      )}

      {/* Empty state — single click-to-start area */}
      {isEmpty && editingIdx === null && !readOnly && (
        <button
          type="button"
          onClick={() => startEdit(0)}
          className="w-full py-6 rounded-md border border-dashed border-border/60 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/[0.02] transition-colors flex items-center justify-center gap-2"
        >
          <span className="text-base">{placeholder ?? "Click to start writing…"}</span>
          <span className="text-[10px] text-muted-foreground/60">or type / for commands</span>
        </button>
      )}

      {/* Word count */}
      <div className="mt-1.5 text-[10px] text-muted-foreground/60 text-end tabular-nums">
        {value.trim().split(/\s+/).filter(Boolean).length} words
      </div>
    </div>
  );
}
