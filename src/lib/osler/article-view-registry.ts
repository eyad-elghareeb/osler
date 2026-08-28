/**
 * Article-view registry — a tiny stack of the currently open article
 * reader contexts, consumed by the global content context menu.
 *
 * The library reader and the floating article modal register themselves
 * while an article is open and deregister on close. The stack semantics
 * matter because the modal can open on top of the library reader: when
 * the modal closes, the reader's context is restored automatically.
 *
 * `requestExportPdf` is only provided by readers that actually own a PDF
 * export flow — the context menu shows its "Export PDF" item only when
 * the top-of-stack context has one.
 */

export interface ArticleViewContext {
  /** Article title (used for Web Share). */
  title: string;
  specialty?: string;
  /** Opens the reader's PDF export dialog, if it has one. */
  requestExportPdf?: () => void;
}

const stack: ArticleViewContext[] = [];

export function setArticleViewContext(ctx: ArticleViewContext): void {
  stack.push(ctx);
}

/** Deregister a context (only clears when `ctx` is the registered one). */
export function clearArticleViewContext(ctx: ArticleViewContext): void {
  const idx = stack.lastIndexOf(ctx);
  if (idx >= 0) stack.splice(idx, 1);
}

/** The context the context menu should act on (null when no article is open). */
export function getArticleViewContext(): ArticleViewContext | null {
  return stack[stack.length - 1] ?? null;
}
