"use client";

/**
 * Admin MarkdownEditor — now a thin re-export of the shared MilkdownEditor.
 *
 * The previous implementation (852-line custom textarea + slash palette +
 * mermaid chip overlay + image upload handlers) has been replaced by the
 * reusable MilkdownEditor component at
 * `src/components/osler/milkdown-editor.tsx`. That component preserves
 * every feature the admin editor had:
 *
 *   • Real WYSIWYG via Milkdown Crepe (ProseMirror + Remark).
 *   • Image upload via drag-drop, paste, file picker, or the Crepe
 *     ImageBlock slash command — wired to `uploadImageForEditor` with
 *     the same R2 routing (`r2KeyBase` / `rawR2Key`).
 *   • Mermaid diagram editing — GUI-driven visual flow builder
 *     (`MermaidEditorModal`); the top-bar button and slash menu open it.
 *     Clicking a rendered diagram re-opens it for editing.
 *   • Word / char / line counters in the footer.
 *   • Read-only mode.
 *
 * The props contract is identical to the old admin editor, so all
 * existing call sites (LibraryArticleEditor in structured-editors.tsx)
 * continue to work without changes:
 *
 *   interface MarkdownEditorProps {
 *     value: string;
 *     onChange: (next: string) => void;
 *     readOnly?: boolean;
 *     className?: string;
 *     placeholder?: string;
 *     r2KeyBase?: string;
 *     rawR2Key?: string;
 *   }
 *
 * New code should import MilkdownEditor directly from
 * `@/components/osler/milkdown-editor` instead of going through this file.
 */

export { MilkdownEditor as MarkdownEditor } from "@/components/osler/milkdown-editor";
export type { MilkdownEditorProps as MarkdownEditorProps } from "@/components/osler/milkdown-editor";
