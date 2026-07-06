"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, X, Clock, ChevronRight, Search } from "lucide-react";
import { ARTICLES, searchArticles, type Article } from "@/lib/osler/articles";

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
  const [showSidebar, setShowSidebar] = React.useState(false);

  React.useEffect(() => {
    setActiveId(articleId);
    if (articleId) setShowSidebar(false);
  }, [articleId]);

  const article: Article | null = activeId ? ARTICLES[activeId] : null;
  const searchResults = query ? searchArticles(query) : Object.values(ARTICLES);

  const handleOpen = (id: string) => {
    setActiveId(id);
    setQuery("");
    setShowSidebar(false);
    onOpenArticle?.(id);
  };

  return (
    <AnimatePresence>
      {articleId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 12 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden"
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
              <button
                onClick={onClose}
                className="size-8 rounded-md hover:bg-muted flex items-center justify-center shrink-0"
                title="Close"
              >
                <X className="size-4" />
              </button>
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
                  <div
                    className="library-article"
                    dangerouslySetInnerHTML={{ __html: article.html }}
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
