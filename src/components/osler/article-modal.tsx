"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, X, Clock, ChevronRight, Bookmark, BookmarkCheck } from "lucide-react";
import { loadArticleContent, listAllArticles, type Article, type ArticleMeta } from "@/lib/osler/articles";
import { cn } from "@/lib/utils";
import { useArticleHighlighter } from "@/hooks/use-article-highlighter";
import { MilkdownArticleView, articleDirOf } from "./milkdown-article-view";
import { PdfViewer } from "./pdf-viewer";
import { setArticleViewContext, clearArticleViewContext } from "@/lib/osler/article-view-registry";
import { routeFor } from "@/lib/osler/navigation";
import { useI18n } from "@/components/osler/i18n-provider";
import { HighlighterToolbar } from "./highlighter-toolbar";
import { usePlatform } from "@/hooks/use-platform";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";
import { MOTION_TRANSITION, MOTION_SPRING } from "@/lib/osler/motion";

const BOOKMARKS_KEY = "osler-article-bookmarks";

interface FloatingArticleModalProps {
  articleId: string | null;
  onClose: () => void;
  onOpenArticle?: (id: string) => void;
}

export function FloatingArticleModal({
  articleId,
  onClose,
  onOpenArticle,
}: FloatingArticleModalProps) {
  const [activeId, setActiveId] = React.useState(articleId);
  const [showSidebar, setShowSidebar] = React.useState(false);
  const [bookmarks, setBookmarks] = React.useState<Set<string>>(new Set());
  const [article, setArticle] = React.useState<Article | null>(null);
  const [allArticles, setAllArticles] = React.useState<ArticleMeta[]>([]);

  const hlCtrl = useArticleHighlighter({
    source: "library",
    articleId: activeId,
    enabled: true,
  });

  // Article body ref — selection capture + eraser need a stable container.
  const bodyRef = React.useRef<HTMLDivElement | null>(null);

  // Capture text selections while a highlight tool is active. Mirrors the
  // library reader: `selectionchange` debounced so mouse and touch both
  // land after the OS finalises the range.
  React.useEffect(() => {
    if (!hlCtrl.highlightMode || !activeId) return;
    const el = bodyRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const applySelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return;
      const text = sel.toString().trim();
      if (!text) return;

      const headRange = document.createRange();
      headRange.selectNodeContents(el);
      const endRange = range.cloneRange();
      endRange.collapse(false);
      headRange.setEnd(endRange.startContainer, endRange.startOffset);
      const absEnd = headRange.toString().length;
      const ranges = [{ start: absEnd - text.length, end: absEnd }];

      hlCtrl.onAdd(text, hlCtrl.highlightColor, ranges);
      sel.removeAllRanges();
    };

    const onSelectionChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(applySelection, 350);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [hlCtrl.highlightMode, hlCtrl.highlightColor, hlCtrl.onAdd, activeId]);

  // Eraser: click/tap a highlight span to remove it.
  React.useEffect(() => {
    if (!activeId) return;
    const el = bodyRef.current;
    if (!el) return;
    el.classList.toggle("osler-hl-eraser", hlCtrl.tool === "eraser" && !hlCtrl.highlightMode);

    const handleTarget = (t: EventTarget | null): boolean => {
      const span = (t as HTMLElement)?.closest?.("[data-osler-hl-id]") as HTMLElement | null;
      const id = span?.getAttribute("data-osler-hl-id");
      if (id) { hlCtrl.onRemove(id); return true; }
      return false;
    };
    const onClick = (e: MouseEvent) => {
      if (hlCtrl.highlightMode) return;
      if (handleTarget(e.target)) { e.preventDefault(); e.stopPropagation(); }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (hlCtrl.highlightMode) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const t = document.elementFromPoint(touch.clientX, touch.clientY);
      if (t && handleTarget(t)) e.preventDefault();
    };
    el.addEventListener("click", onClick);
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("click", onClick);
      el.removeEventListener("touchend", onTouchEnd);
      el.classList.remove("osler-hl-eraser");
    };
  }, [hlCtrl.tool, hlCtrl.highlightMode, hlCtrl.onRemove, activeId]);

  React.useEffect(() => {
    setActiveId(articleId);
    if (articleId) setShowSidebar(false);
  }, [articleId]);

  // Context-menu registration: the modal contributes its title + deep link
  // for share/copy-link while it is open (no PDF export flow here).
  React.useEffect(() => {
    if (!article || !activeId) return;
    const ctx = {
      title: article.title,
      specialty: article.specialty,
      link: routeFor("library", { article: activeId }),
    };
    setArticleViewContext(ctx);
    return () => clearArticleViewContext(ctx);
  }, [article, activeId]);

  // Load article content when activeId changes
  React.useEffect(() => {
    if (!activeId) {
      setArticle(null);
      return;
    }
    (async () => {
      const loaded = await loadArticleContent(activeId);
      setArticle(loaded);
    })();
  }, [activeId]);

  // Load bookmarks
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(BOOKMARKS_KEY);
      if (raw) setBookmarks(new Set(JSON.parse(raw)));
    } catch {}
  }, []);

  // Load all articles for sidebar
  React.useEffect(() => {
    listAllArticles().then(setAllArticles);
  }, []);

  const handleOpen = (id: string) => {
    setActiveId(id);
    setShowSidebar(false);
    onOpenArticle?.(id);
  };

  const toggleBookmark = React.useCallback(() => {
    if (!activeId) return;
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(activeId)) next.delete(activeId);
      else next.add(activeId);
      if (typeof window !== "undefined") {
        localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(Array.from(next)));
        window.dispatchEvent(new CustomEvent("osler-bookmarks-changed"));
      }
      return next;
    });
  }, [activeId]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showSidebar) { setShowSidebar(false); return; }
        if (hlCtrl.highlightMode) { hlCtrl.setHighlightMode(false); return; }
        onClose();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        toggleBookmark();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, showSidebar, hlCtrl.highlightMode, hlCtrl.setHighlightMode, toggleBookmark]);

  // Sync activeId with articleId when closed
  React.useEffect(() => {
    if (!articleId) {
      hlCtrl.setHighlightMode(false);
    }
  }, [articleId]);

  const { t, rtl } = useI18n();
  const platform = usePlatform();
  const isPhone = platform.isPhone;

  // ── Swipe-to-dismiss (mirrors Settings NavigationStack pattern) ──────
  // On phones the article modal slides up from the bottom → vertical
  // drag-down dismisses. On desktop the modal is a centered scale-in
  // overlay, so a horizontal swipe doesn't map cleanly to a "back"
  // direction — we disable swipe on desktop and rely on the X button /
  // Escape / backdrop-click instead.
  const dismissProps = useSwipeBackDismiss({
    onDismiss: () => onClose(),
    direction: "vertical",
    rtl,
    disabled: !isPhone || showSidebar,
  });

  return (
    <AnimatePresence>
      {articleId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => {
            if (hlCtrl.highlightMode) { hlCtrl.setHighlightMode(false); }
            else { onClose(); }
          }}
        >
          <motion.div
            initial={isPhone ? { y: "100%", opacity: 0 } : { scale: 0.95, opacity: 0, y: 12 }}
            animate={isPhone ? { y: 0, opacity: 1 } : { scale: 1, opacity: 1, y: 0 }}
            exit={isPhone ? { y: "100%", opacity: 0 } : { scale: 0.95, opacity: 0, y: 12 }}
            transition={isPhone ? MOTION_SPRING.snappy : MOTION_SPRING.soft}
            onClick={(e) => e.stopPropagation()}
            {...dismissProps}
            className={isPhone
              ? "bg-card flex flex-col overflow-hidden h-full w-full"
              : "bg-card border border-border rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden"
            }
          >
            {/* Header */}
            <header className="shrink-0 border-b border-border bg-card backdrop-blur-sm px-4 py-2.5 flex items-center gap-3">
              <button
                onClick={() => setShowSidebar((s) => !s)}
                className="size-8 rounded-md hover:bg-muted flex items-center justify-center shrink-0"
                title={t("article.toggleList")}
              >
                <BookOpen className="size-4" />
              </button>
              {article && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-1 min-w-0">
                  <span className="font-medium">{article.specialty}</span>
                  <ChevronRight className="size-3 opacity-50" />
                  <span className="truncate">{article.system}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {article.readTimeMin} min
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1 shrink-0">
                <HighlighterToolbar
                  control={{
                    tool: hlCtrl.tool,
                    color: hlCtrl.color,
                    count: hlCtrl.highlights.length,
                    onToolChange: hlCtrl.setTool,
                    onColorChange: hlCtrl.setColor,
                    onClearAll: hlCtrl.clearAll,
                  }}
                />
                <button
                  onClick={toggleBookmark}
                  className={cn(
                    "size-8 rounded-md flex items-center justify-center transition-colors shrink-0",
                    activeId && bookmarks.has(activeId)
                      ? "text-primary bg-primary/10 hover:bg-primary/15"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                  title={activeId && bookmarks.has(activeId) ? t("article.bookmarkRemove") : t("article.bookmarkAdd")}
                >
                  {activeId && bookmarks.has(activeId) ? (
                    <BookmarkCheck className="size-4" />
                  ) : (
                    <Bookmark className="size-4" />
                  )}
                </button>
                <button
                  onClick={onClose}
                  className="size-8 rounded-md hover:bg-muted flex items-center justify-center shrink-0"
                  title={t("common.close")}
                >
                  <X className="size-4" />
                </button>
              </div>
            </header>

            <div className="flex-1 flex min-h-0">
              {/* Sidebar with article list / search */}
              <AnimatePresence>
                {showSidebar && (
                  <motion.aside
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 280, opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={MOTION_TRANSITION.quick}
                    className="border-r border-border bg-sidebar overflow-hidden flex flex-col"
                  >
                    <div className="flex-1 overflow-y-auto osler-scroll p-2 space-y-0.5">
                      {allArticles.map((a) => (
                        <button
                          key={a.file}
                          onClick={() => handleOpen(a.file)}
                          className={`w-full text-left px-2 py-2 rounded-md text-xs transition-colors flex items-start gap-2 ${
                            a.file === activeId
                              ? "bg-primary/10 text-primary font-medium"
                              : "hover:bg-muted/60 text-foreground"
                          }`}
                        >
                          <BookOpen className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="truncate">{a.title}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {a.specialty} · {a.readTimeMin} min
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.aside>
                )}
              </AnimatePresence>

              {/* Article content */}
              <div className="flex-1 overflow-y-auto osler-scroll">
                {article ? (
                  article.contentType === "pdf" ? (
                    <PdfViewer url={article.fileUrl!} title={article.title} />
                  ) : article.contentType === "html" ? (
                    <iframe
                      srcDoc={article.content}
                      sandbox="allow-scripts allow-same-origin allow-modals allow-popups"
                      className="w-full h-full border-0 bg-background"
                      title={article.title}
                    />
                  ) : (
                    <div className="library-article p-8 max-w-[920px] mx-auto">
                      <MilkdownArticleView
                        markdown={article.content}
                        articleDir={articleDirOf(activeId ?? "")}
                        highlights={hlCtrl.highlights}
                        contentRef={bodyRef}
                        dir={article.lang === "ar" ? "rtl" : "ltr"}
                        lang={article.lang ?? "en"}
                      />
                    </div>
                  )
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    {t("article.notFound")}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


