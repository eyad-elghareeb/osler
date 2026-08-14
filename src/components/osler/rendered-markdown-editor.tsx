"use client";

/**
 * RenderedMarkdownEditor — backward-compatible re-export of the new
 * MilkdownEditor component.
 *
 * The original custom block editor (slash palette, manual cursor math,
 * textarea-switching) was replaced with Milkdown's Crepe WYSIWYG editor
 * (https://milkdown.dev/docs/recipes/react). Crepe is a batteries-included
 * markdown editor built on ProseMirror + Remark, providing real WYSIWYG
 * rendering, an inline selection toolbar, a slash command menu, tables,
 * code blocks, latex, image blocks, and link tooltips out of the box.
 *
 * The actual implementation lives in `milkdown-editor.tsx`. This file
 * preserves the old import path so existing call sites in
 * `qbank-studio.tsx` continue to work unchanged:
 *
 *   import { RenderedMarkdownEditor } from "@/components/osler/rendered-markdown-editor";
 *
 * The prop signature is identical to the previous version:
 *   • value: string
 *   • onChange: (next: string) => void
 *   • placeholder?: string
 *   • className?: string
 *   • readOnly?: boolean
 *
 * New code should import directly from `milkdown-editor.tsx` instead.
 */

export { MilkdownEditor as RenderedMarkdownEditor } from "./milkdown-editor";
export type { MilkdownEditorProps as RenderedMarkdownEditorProps } from "./milkdown-editor";
