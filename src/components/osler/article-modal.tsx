"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, X, Clock, ChevronRight, Search, Bookmark, BookmarkCheck } from "lucide-react";
import { ARTICLES, searchArticles, type Article } from "@/lib/osler/articles";
import { cn } from "@/lib/utils";
import { useArticleHighlighter } from "@/hooks/use-article-highlighter";
import { HighlighterToolbar } from "./highlighter-toolbar";
import { usePlatform } from "@/hooks/use-platform";

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
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [showSidebar, setShowSidebar] = React.useState(false);
  const [bookmarks, setBookmarks] = React.useState<Set<string>>(new Set());

  const hlCtrl = useArticleHighlighter({
    source: "library",
    articleId: activeId,
    enabled: true,
  });

  React.useEffect(() => {
    setActiveId(articleId);
    if (articleId) setShowSidebar(false);
  }, [articleId]);

  // Load bookmarks
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(BOOKMARKS_KEY);
      if (raw) setBookmarks(new Set(JSON.parse(raw)));
    } catch {}
  }, []);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const article: Article | null = activeId ? ARTICLES[activeId] : null;
  const searchResults = debouncedQuery ? searchArticles(debouncedQuery) : Object.values(ARTICLES);

  const handleOpen = (id: string) => {
    setActiveId(id);
    setQuery("");
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

  const platform = usePlatform();

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
            initial={platform.isPhone ? { y: "100%", opacity: 0 } : { scale: 0.95, opacity: 0, y: 12 }}
            animate={platform.isPhone ? { y: 0, opacity: 1 } : { scale: 1, opacity: 1, y: 0 }}
            exit={platform.isPhone ? { y: "100%", opacity: 0 } : { scale: 0.95, opacity: 0, y: 12 }}
            transition={platform.isPhone
              ? { type: "spring", damping: 32, stiffness: 320 }
              : { type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={platform.isPhone
              ? "bg-card flex flex-col overflow-hidden h-full w-full"
              : "bg-card border border-border rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden"
            }
          >
            {/* Header */}
            <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm px-4 py-2.5 flex items-center gap-3">
              <button
                onClick={() => setShowSidebar((s) => !s)}
                className="size-8 rounded-md hover:bg-muted flex items-center justify-center shrink-0"
                title="Toggle article list"
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
                <HighlighterToolbar ctrl={hlCtrl} compact />
                <button
                  onClick={toggleBookmark}
                  className={cn(
                    "size-8 rounded-md flex items-center justify-center transition-colors shrink-0",
                    activeId && bookmarks.has(activeId)
                      ? "text-primary bg-primary/10 hover:bg-primary/15"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                  title={activeId && bookmarks.has(activeId) ? "Remove bookmark" : "Bookmark article"}
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
                  title="Close"
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
                    transition={{ duration: 0.2 }}
                    className="border-r border-border bg-sidebar overflow-hidden flex flex-col"
                  >
                    <div className="p-3 border-b border-border">
                      <div className="flex items-center gap-2 px-2.5 h-8 rounded-md bg-muted/50">
                        <Search className="size-3.5 text-muted-foreground" />
                        <input
                          autoFocus
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search articles…"
                          className="flex-1 bg-transparent outline-none text-xs min-w-0"
                        />
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto medos-scroll p-2 space-y-0.5">
                      {searchResults.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => handleOpen(a.id)}
                          className={`w-full text-left px-2 py-2 rounded-md text-xs transition-colors flex items-start gap-2 ${
                            a.id === activeId
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
              <div className="flex-1 overflow-y-auto medos-scroll">
                {article ? (
                  <iframe
                    ref={hlCtrl.iframeRef}
                    title={article.title}
                    srcDoc={`<html><head><style>
                      body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; color: #1a1a1a; line-height: 1.7; font-size: 15px; }
                      h1 { font-size: 1.6rem; font-weight: 700; margin: 0 0 0.75rem; line-height: 1.3; }
                      h2 { font-size: 1.25rem; font-weight: 600; margin: 1.5rem 0 0.5rem; line-height: 1.35; }
                      h3 { font-size: 1.05rem; font-weight: 600; margin: 1.25rem 0 0.4rem; line-height: 1.4; }
                      p { margin: 0 0 0.75rem; line-height: 1.7; }
                      ul, ol { margin: 0 0 0.75rem; padding-left: 1.5rem; }
                      li { margin-bottom: 0.25rem; line-height: 1.6; }
                      strong { font-weight: 600; }
                      em { font-style: italic; }
                      a { color: #2563eb; text-decoration: underline; }
                      code { font-size: 0.85em; padding: 0.15rem 0.35rem; border-radius: 4px; background: #e5e7eb; }
                      blockquote { border-left: 3px solid #d1d5db; margin: 0.75rem 0; padding: 0.5rem 1rem; color: #6b7280; }
                      table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; }
                      th, td { border: 1px solid #d1d5db; padding: 0.5rem 0.75rem; text-align: left; }
                      th { font-weight: 600; background: #f3f4f6; }
                      .callout { background: #f9fafb; border-left: 4px solid #2563eb; padding: 0.75rem 1rem; border-radius: 6px; margin: 0.75rem 0; }
                      .warning { background: #fefce8; border-left: 4px solid #eab308; padding: 0.75rem 1rem; border-radius: 6px; margin: 0.75rem 0; }
                    </style></head><body>${article.html}</body></html>`}
                    className="w-full h-full border-0"
                    sandbox="allow-same-origin"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Article not found.
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


