"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
  Link,
  Image,
  Table,
  Minus,
  Eye,
  Pencil,
} from "lucide-react";

/**
 * Lightweight markdown editor with a formatting toolbar.
 * Pure textarea + button approach — no heavy WYSIWYG dependencies.
 */

interface ToolbarAction {
  icon: React.ReactNode;
  label: string;
  prefix: string;
  suffix: string;
  placeholder?: string;
  block?: boolean; // insert on new line
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
  { icon: <Link className="size-4" />, label: "Link", prefix: "[", suffix: "](url)", placeholder: "link text" },
  // eslint-disable-next-line jsx-a11y/alt-text -- lucide icon, not an img element
  { icon: <Image className="size-4" />, label: "Image", prefix: "![", suffix: "](url)", placeholder: "alt text" },
  { icon: <Table className="size-4" />, label: "Table", prefix: "\n| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |\n", suffix: "", block: true },
  { icon: <Minus className="size-4" />, label: "Horizontal rule", prefix: "\n---\n", suffix: "", block: true },
];

export interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
  className,
  placeholder,
}: MarkdownEditorProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = React.useState(false);

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
      // Ensure we're on a new line for block-level elements
      const beforeLine = value.lastIndexOf("\n", start - 1) + 1;
      const needsNewline = start > 0 && value[start - 1] !== "\n";
      const prefix = needsNewline ? "\n" + action.prefix : action.prefix;
      newText = value.substring(0, start) + prefix + text + action.suffix + value.substring(end);
      newCursorPos = start + prefix.length + text.length;
    } else {
      newText = value.substring(0, start) + action.prefix + text + action.suffix + value.substring(end);
      newCursorPos = start + action.prefix.length + text.length;
    }

    onChange(newText);

    // Restore focus and selection
    requestAnimationFrame(() => {
      ta.focus();
      if (selected) {
        ta.setSelectionRange(start + action.prefix.length, newCursorPos);
      } else {
        ta.setSelectionRange(start + action.prefix.length, newCursorPos - action.suffix.length);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Tab → insert 2 spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = value.substring(0, start) + "  " + value.substring(end);
      onChange(newVal);
      requestAnimationFrame(() => {
        ta.setSelectionRange(start + 2, start + 2);
      });
    }
    // Ctrl+B → bold
    if ((e.metaKey || e.ctrlKey) && e.key === "b") {
      e.preventDefault();
      insertFormatting(ACTIONS[0]);
    }
    // Ctrl+I → italic
    if ((e.metaKey || e.ctrlKey) && e.key === "i") {
      e.preventDefault();
      insertFormatting(ACTIONS[1]);
    }
    // Ctrl+K → link
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      insertFormatting(ACTIONS[10]);
    }
  }

  // Simple markdown preview (basic rendering)
  const previewHtml = React.useMemo(() => {
    let html = value
      // Code blocks first (before other transforms)
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-muted/50 p-3 rounded-lg text-sm font-mono overflow-x-auto"><code>$2</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code class="bg-muted/50 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Strikethrough
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      // Images (before links)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full rounded-lg" />')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary underline" target="_blank">$1</a>')
      // Headings
      .replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold mt-4 mb-2">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-5 mb-2">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-3">$1</h1>')
      // Horizontal rules
      .replace(/^---$/gm, '<hr class="border-border my-4" />')
      // Blockquotes
      .replace(/^> (.+)$/gm, '<blockquote class="border-s-4 border-primary/40 ps-4 italic text-muted-foreground">$1</blockquote>')
      // Unordered lists
      .replace(/^- (.+)$/gm, '<li class="ms-4 list-disc">$1</li>')
      // Ordered lists
      .replace(/^\d+\. (.+)$/gm, '<li class="ms-4 list-decimal">$1</li>')
      // Paragraphs (double newlines)
      .replace(/\n\n/g, '</p><p class="mb-3">')
      // Single newlines → <br>
      .replace(/\n/g, "<br />");

    return html;
  }, [value]);

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const chars = value.length;
  const lines = value.split("\n").length;

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn("border border-border rounded-lg overflow-hidden bg-background", className)}>
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
                  <TooltipContent side="bottom">{action.label}</TooltipContent>
                </Tooltip>
              </React.Fragment>
            ))}
            <div className="flex-1" />
            <div className="w-px h-5 bg-border mx-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={preview ? "secondary" : "ghost"}
                  size="iconSm"
                  onClick={() => setPreview(!preview)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {preview ? <Pencil className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {preview ? "Edit" : "Preview"}
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Editor / Preview */}
        {preview ? (
          <div
            className="p-4 min-h-[400px] prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            readOnly={readOnly}
            onKeyDown={handleKeyDown}
            className="w-full min-h-[400px] p-4 font-mono text-sm bg-transparent resize-none focus:outline-none"
            placeholder={placeholder ?? "Write your article in **Markdown**…"}
            spellCheck={false}
          />
        )}

        {/* Status bar */}
        <div className="flex items-center gap-3 px-4 py-1.5 border-t border-border text-[11px] text-muted-foreground">
          <span>{words} words</span>
          <span>·</span>
          <span>{chars} chars</span>
          <span>·</span>
          <span>{lines} lines</span>
          <span className="flex-1" />
          <span className="font-mono">Markdown</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
