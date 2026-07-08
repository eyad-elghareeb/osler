"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  BookOpen,
  Clock,
  Bookmark,
  BookmarkCheck,
  ZoomIn,
  ZoomOut,
  PanelLeft,
  Loader2,
  Library as LibraryIcon,
  Type,
  Minus,
  Plus as PlusIcon,
  Search,
  BookmarkX,
  List,
  X,
} from "lucide-react";
import {
  loadArticleToc,
  loadArticleContent,
  listAllArticles,
  clearArticleCache,
  type ArticleTocNode,
  type Article,
} from "@/lib/osler/articles";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useArticleHighlighter } from "@/hooks/use-article-highlighter";
import { HighlighterToolbar } from "./highlighter-toolbar";
import { applyHighlightsToHtml } from "@/lib/osler/article-highlights";

interface LibraryProps {
  initialArticleId?: string;
}

const BOOKMARKS_KEY = "osler-article-bookmarks";

type SidebarTab = "toc" | "bookmarks";

function flattenToc(
  nodes: ArticleTocNode[]
): { id: string; label: string; articleId: string; path: string[] }[] {
  const result: { id: string; label: string; articleId: string; path: string[] }[] = [];
  const walk = (ns: ArticleTocNode[], parents: string[]) => {
    for (const n of ns) {
      if (n.articleId) {
        result.push({ id: n.id, label: n.label, articleId: n.articleId, path: [...parents, n.label] });
      }
      if (n.children) walk(n.children, [...parents, n.label]);
    }
  };
  walk(nodes, []);
  return result;
}

function searchArticles(
  query: string,
  flatArticles: { id: string; label: string; articleId: string; path: string[] }[],
  allArticles: Article[]
): Set<string> {
  const q = query.toLowerCase().trim();
  if (!q) return new Set(flatArticles.map((a) => a.articleId));
  const byToc = flatArticles
    .filter((a) => a.label.toLowerCase().includes(q) || a.path.some((p) => p.toLowerCase().includes(q)))
    .map((a) => a.articleId);
  const byArticle = allArticles.filter((a) => {
    const hay = (a.title + " " + a.specialty + " " + (a.tags ?? []).join(" ")).toLowerCase();
    return hay.includes(q);
  }).map((a) => a.id);
  return new Set([...byToc, ...byArticle]);
}

export function Library({ initialArticleId }: LibraryProps) {
  const [toc, setToc] = React.useState<ArticleTocNode[]>([]);
  const [articleList, setArticleList] = React.useState<Article[]>([]);
  const [expandedNodes, setExpandedNodes] = React.useState<Set<string>>(
    new Set(["cardiology", "pulmonology", "neurology"])
  );
  const [activeArticleId, setActiveArticleId] = React.useState<string | null>(
    initialArticleId ?? null
  );
  const [activeArticle, setActiveArticle] = React.useState<Article | null>(null);
  const [bookmarks, setBookmarks] = React.useState<Set<string>>(new Set());
  const [zoom, setZoom] = React.useState(100);
  const [fontSize, setFontSize] = React.useState(15);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const isMobile = useIsMobile();

  // On mobile, when no article is selected, force the sidebar open full-screen
  // so the user picks an article first.
  React.useEffect(() => {
    if (isMobile && !activeArticleId) setSidebarOpen(true);
  }, [isMobile, activeArticleId]);
  const [loading, setLoading] = React.useState(false);
  const [sidebarTab, setSidebarTab] = React.useState<SidebarTab>("toc");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery), 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const hlCtrl = useArticleHighlighter({
    source: "library",
    articleId: activeArticleId,
    enabled: true,
  });

  // Load TOC and article list
  React.useEffect(() => {
    (async () => {
      try {
        const [tocData, articleData] = await Promise.all([
          loadArticleToc(),
          listAllArticles(),
        ]);
        setToc(tocData);
        setArticleList(articleData);
      } catch (e) {
        console.error("Failed to load article data:", e);
      }
    })();
  }, []);

  // Load article content when activeArticleId changes
  React.useEffect(() => {
    if (!activeArticleId) {
      setActiveArticle(null);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const article = await loadArticleContent(activeArticleId);
        setActiveArticle(article);
      } catch (e) {
        console.error(`Failed to load article ${activeArticleId}:`, e);
        setActiveArticle(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeArticleId]);

  // Load bookmarks
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(BOOKMARKS_KEY);
      if (raw) setBookmarks(new Set(JSON.parse(raw)));
    } catch {}
  }, []);

  // Open initial article
  React.useEffect(() => {
    if (initialArticleId) {
      setActiveArticleId(initialArticleId);
      setSidebarOpen(false);
    }
  }, [initialArticleId]);

  const flatArticles = React.useMemo(() => flattenToc(toc), [toc]);

  // Expand TOC nodes to show bookmarked articles
  React.useEffect(() => {
    if (bookmarks.size === 0) return;
    const paths = flatArticles.filter((a) => bookmarks.has(a.articleId));
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        const parts = p.path.slice(0, -1);
        for (const name of parts) {
          const node = findNodeByLabel(name, toc);
          if (node) next.add(node.id);
        }
      }
      return next;
    });
  }, [bookmarks, flatArticles, toc]);

  const toggleExpand = (id: string) =>
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleBookmark = (id: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (typeof window !== "undefined") {
        localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(Array.from(next)));
      }
      return next;
    });
  };

  const openArticle = (id: string) => {
    setActiveArticleId(id);
    setSidebarOpen(false);
  };

  const searchHits = debouncedSearchQuery.trim() ? searchArticles(debouncedSearchQuery, flatArticles, articleList) : null;

  const matchedArticleIds = React.useMemo(() => {
    if (!searchHits) return null;
    return searchHits;
  }, [searchHits]);

  const articleContentRef = React.useRef<HTMLDivElement>(null);

  // Process article HTML with highlights applied
  const processedArticleHtml = React.useMemo(() => {
    if (!activeArticle) return "";
    return applyHighlightsToHtml(activeArticle.html, hlCtrl.highlights as any);
  }, [activeArticle?.html, hlCtrl.highlights]);

  // Direct DOM highlight mode: capture text selection on article content
  React.useEffect(() => {
    if (!hlCtrl.highlightMode || !activeArticleId) return;
    const el = articleContentRef.current;
    if (!el) return;
    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString().trim();
      if (!text) return;

      const range = sel.getRangeAt(0).cloneRange();
      const headRange = document.createRange();
      headRange.selectNodeContents(el);
      headRange.setEnd(range.startContainer, range.startOffset);
      const absStart = headRange.toString().length;
      const absEnd = absStart + text.length;

      hlCtrl.onAdd(text, hlCtrl.highlightColor, absStart >= 0 ? [{ start: absStart, end: absEnd }] : []);
      sel.removeAllRanges();
    };
    el.addEventListener("mouseup", handler);
    return () => el.removeEventListener("mouseup", handler);
  }, [hlCtrl.highlightMode, hlCtrl.highlightColor, activeArticleId, hlCtrl.onAdd]);

  // Escape exits highlight mode
  React.useEffect(() => {
    if (!hlCtrl.highlightMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") hlCtrl.setHighlightMode(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hlCtrl.highlightMode, hlCtrl.setHighlightMode]);

  // Click highlight spans to remove them (only when NOT in highlight mode)
  React.useEffect(() => {
    const el = articleContentRef.current;
    if (!el || hlCtrl.highlightMode) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const span = target.closest("[data-osler-hl-id]") as HTMLElement | null;
      if (span) {
        const id = span.getAttribute("data-osler-hl-id");
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          hlCtrl.onRemove(id);
        }
      }
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [hlCtrl.onRemove, hlCtrl.highlights, hlCtrl.highlightMode]);

  const bookmarkedArticles = React.useMemo(
    () => flatArticles.filter((a) => bookmarks.has(a.articleId)),
    [bookmarks, flatArticles]
  );

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* Mobile sidebar toggle */}
      {activeArticleId && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden fixed bottom-20 right-4 z-30 size-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
          aria-label="Open contents"
        >
          <PanelLeft className="size-5" />
        </button>
      )}

      {/* Mobile sidebar overlay — full screen when choosing an article, drawer otherwise */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              "md:hidden fixed z-40 bg-black/50",
              activeArticleId
                ? "inset-0"
                : "top-14 inset-x-0 bottom-14"
            )}
            onClick={() => {
              if (activeArticleId) setSidebarOpen(false);
            }}
          >
            <motion.div
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className={cn(
                "absolute left-0 top-0 bottom-0 bg-sidebar flex flex-col",
                activeArticleId
                  ? "w-80 max-w-[85vw]"
                  : "w-full"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <SidebarContent
                toc={toc}
                articleCount={articleList.length}
                expanded={expandedNodes}
                onToggle={toggleExpand}
                activeId={activeArticleId}
                onOpen={openArticle}
                bookmarks={bookmarks}
                onToggleBookmark={toggleBookmark}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                matchedArticleIds={matchedArticleIds}
                sidebarTab={sidebarTab}
                onTabChange={setSidebarTab}
                bookmarkedArticles={bookmarkedArticles}
                fullScreen={!activeArticleId}
                onClose={activeArticleId ? () => setSidebarOpen(false) : undefined}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-72 shrink-0 border-r border-border bg-sidebar">
        <SidebarContent
          toc={toc}
          articleCount={articleList.length}
          expanded={expandedNodes}
          onToggle={toggleExpand}
          activeId={activeArticleId}
          onOpen={openArticle}
          bookmarks={bookmarks}
          onToggleBookmark={toggleBookmark}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          matchedArticleIds={matchedArticleIds}
          sidebarTab={sidebarTab}
          onTabChange={setSidebarTab}
          bookmarkedArticles={bookmarkedArticles}
        />
      </aside>

      {/* Article panel */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {activeArticle ? (
          <>
            <ArticleHeader
              article={activeArticle}
              isBookmarked={bookmarks.has(activeArticle.id)}
              onToggleBookmark={() => toggleBookmark(activeArticle.id)}
              zoom={zoom}
              onZoomIn={() => setZoom((z) => Math.min(140, z + 10))}
              onZoomOut={() => setZoom((z) => Math.max(80, z - 10))}
              onResetZoom={() => setZoom(100)}
              fontSize={fontSize}
              onFontSizeChange={setFontSize}
              hlCtrl={hlCtrl}
            />
            <div className="flex-1 overflow-y-auto medos-scroll pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <motion.div
                  key={activeArticle.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="library-article relative"
                  style={{
                    fontSize: `${(zoom / 100) * fontSize}px`,
                    lineHeight: 1.7,
                  }}
                >
                  <div
                    ref={articleContentRef}
                    dangerouslySetInnerHTML={{ __html: processedArticleHtml }}
                  />
                </motion.div>
              )}
            </div>
          </>
        ) : (
          <EmptyState onOpen={openArticle} articleList={articleList} />
        )}
      </main>
    </div>
  );
}

function SidebarContent({
  toc,
  articleCount,
  expanded,
  onToggle,
  activeId,
  onOpen,
  bookmarks,
  onToggleBookmark,
  searchQuery,
  onSearchChange,
  matchedArticleIds,
  sidebarTab,
  onTabChange,
  bookmarkedArticles,
  fullScreen,
  onClose,
}: {
  toc: ArticleTocNode[];
  articleCount: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  activeId: string | null;
  onOpen: (id: string) => void;
  bookmarks: Set<string>;
  onToggleBookmark: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  matchedArticleIds: Set<string> | null;
  sidebarTab: SidebarTab;
  onTabChange: (t: SidebarTab) => void;
  bookmarkedArticles: { id: string; label: string; articleId: string }[];
  fullScreen?: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
        {fullScreen && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Choose an article</span>
            {onClose && (
              <button
                onClick={onClose}
                className="size-8 -mr-1 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted/60 transition-colors"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        )}
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <BookOpen className="size-3.5" />
            Article Library
          </h3>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => onTabChange("toc")}
              className={cn(
                "size-7 rounded-md flex items-center justify-center transition-colors",
                sidebarTab === "toc"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/60"
              )}
              title="Table of contents"
            >
              <List className="size-3.5" />
            </button>
            <button
              onClick={() => onTabChange("bookmarks")}
              className={cn(
                "size-7 rounded-md flex items-center justify-center transition-colors",
                sidebarTab === "bookmarks"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/60"
              )}
              title="Bookmarks"
            >
              <Bookmark className="size-3.5" />
            </button>
          </div>
        </div>
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              onSearchChange(e.target.value);
              if (e.target.value) onTabChange("toc");
            }}
            placeholder="Search articles…"
            className="w-full h-8 rounded-md border border-border bg-card pl-8 pr-3 text-xs outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/50"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto medos-scroll p-2 space-y-0.5 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-2">
        {sidebarTab === "bookmarks" && bookmarkedArticles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <BookmarkX className="size-8 text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">No bookmarks yet</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Bookmark articles by clicking the bookmark icon
            </p>
          </div>
        ) : sidebarTab === "bookmarks" ? (
          <div className="space-y-0.5">
            {bookmarkedArticles.map((a) => (
              <button
                key={a.articleId}
                onClick={() => onOpen(a.articleId)}
                className={cn(
                  "library-toc-item w-full",
                  a.articleId === activeId && "active"
                )}
              >
                <BookOpen className="size-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{a.label}</span>
                <BookmarkCheck className="size-3 text-primary shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          toc.map((node) => (
            <TocNode
              key={node.id}
              node={node}
              toc={toc}
              depth={0}
              expanded={expanded}
              onToggle={onToggle}
              activeId={activeId}
              onOpen={onOpen}
              bookmarks={bookmarks}
              onToggleBookmark={onToggleBookmark}
              searchQuery={searchQuery}
              matchedArticleIds={matchedArticleIds}
            />
          ))
        )}
      </div>
      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground flex items-center justify-between">
        <span>{articleCount} articles</span>
        <span>{bookmarks.size} bookmarked</span>
      </div>
    </div>
  );
}

function findNodeByLabel(label: string, nodes: ArticleTocNode[]): ArticleTocNode | null {
  const walk = (ns: ArticleTocNode[]): ArticleTocNode | null => {
    for (const n of ns) {
      if (n.label === label) return n;
      if (n.children) {
        const found = walk(n.children);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(nodes);
}

function TocNode({
  node,
  toc,
  depth,
  expanded,
  onToggle,
  activeId,
  onOpen,
  bookmarks,
  onToggleBookmark,
  searchQuery,
  matchedArticleIds,
}: {
  node: ArticleTocNode;
  toc: ArticleTocNode[];
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  activeId: string | null;
  onOpen: (id: string) => void;
  bookmarks: Set<string>;
  onToggleBookmark: (id: string) => void;
  searchQuery: string;
  matchedArticleIds: Set<string> | null;
}) {
  const isExpanded = expanded.has(node.id);
  const isLeaf = !!node.articleId;
  const isActive = node.articleId === activeId;
  const isBookmarked = node.articleId ? bookmarks.has(node.articleId) : false;

  // Filter based on search
  if (searchQuery.trim()) {
    if (isLeaf) {
      if (!matchedArticleIds?.has(node.articleId!)) return null;
    } else {
      const hasMatchBelow = node.children?.some((c) => {
        if (c.articleId && matchedArticleIds?.has(c.articleId)) return true;
        const walk = (ns: ArticleTocNode[]): boolean =>
          ns.some((n) => n.articleId && matchedArticleIds?.has(n.articleId) || (n.children && walk(n.children)));
        return c.children ? walk(c.children) : false;
      });
      if (!hasMatchBelow) return null;
    }
  }

  return (
    <div>
      <div className="flex items-center group">
        <button
          onClick={() => {
            if (isLeaf) {
              onOpen(node.articleId!);
            } else {
              onToggle(node.id);
            }
          }}
          className={cn("library-toc-item flex-1 min-w-0", isActive && "active")}
          style={{ paddingLeft: `${0.75 + depth * 1}rem` }}
        >
          {!isLeaf ? (
            <ChevronRight
              className={cn("library-toc-chevron", isExpanded && "expanded")}
            />
          ) : (
            <BookOpen className="size-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="flex-1 truncate">{node.label}</span>
          {isLeaf && isBookmarked && (
            <BookmarkCheck className="size-3 text-primary shrink-0 ml-1" />
          )}
        </button>
        {isLeaf && (
          <button
            onClick={() => onToggleBookmark(node.articleId!)}
            className="opacity-0 group-hover:opacity-100 size-6 rounded-md hover:bg-muted flex items-center justify-center shrink-0 mr-1 transition-opacity"
            title={isBookmarked ? "Remove bookmark" : "Bookmark"}
          >
            <Bookmark className={cn("size-3", isBookmarked ? "text-primary fill-primary" : "text-muted-foreground")} />
          </button>
        )}
      </div>
      {!isLeaf && isExpanded && node.children && (
        <div className="library-toc-children">
          {node.children.map((c) => (
            <TocNode
              key={c.id}
              node={c}
              toc={toc}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              activeId={activeId}
              onOpen={onOpen}
              bookmarks={bookmarks}
              onToggleBookmark={onToggleBookmark}
              searchQuery={searchQuery}
              matchedArticleIds={matchedArticleIds}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleHeader({
  article,
  isBookmarked,
  onToggleBookmark,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  fontSize,
  onFontSizeChange,
  hlCtrl,
}: {
  article: Article;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  fontSize: number;
  onFontSizeChange: (s: number) => void;
  hlCtrl: ReturnType<typeof useArticleHighlighter>;
}) {
  const [fontPopoverOpen, setFontPopoverOpen] = React.useState(false);

  return (
    <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm px-4 sm:px-6 py-2.5 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-1 min-w-0">
        <span className="font-medium">{article.specialty}</span>
        <ChevronRight className="size-3 opacity-50" />
        <span className="truncate">{article.system}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <div className="flex items-center gap-1 text-xs text-muted-foreground mr-2">
          <Clock className="size-3.5" />
          <span>{article.readTimeMin} min</span>
        </div>

        {/* Font size */}
        <div className="relative">
          <button
            onClick={() => setFontPopoverOpen(!fontPopoverOpen)}
            className="osler-icon-btn size-8"
            title="Font size"
          >
            <Type className="size-4" />
          </button>
          <AnimatePresence>
            {fontPopoverOpen && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute right-0 top-full mt-1 z-30 bg-card border border-border rounded-lg shadow-lg p-3 w-auto"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground w-16">Font size</span>
                  <button
                    onClick={() => onFontSizeChange(Math.max(12, fontSize - 1))}
                    className="size-6 rounded bg-muted hover:bg-muted/70 flex items-center justify-center"
                  >
                    <Minus className="size-3" />
                  </button>
                  <span className="text-xs font-mono tabular-nums w-5 text-center">
                    {fontSize}
                  </span>
                  <button
                    onClick={() => onFontSizeChange(Math.min(22, fontSize + 1))}
                    className="size-6 rounded bg-muted hover:bg-muted/70 flex items-center justify-center"
                  >
                    <PlusIcon className="size-3" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-0.5 mr-1">
          <button
            onClick={onZoomOut}
            disabled={zoom <= 80}
            className="osler-icon-btn size-8 disabled:opacity-40"
            title="Zoom out"
          >
            <ZoomOut className="size-4" />
          </button>
          <button
            onClick={onResetZoom}
            className="text-xs px-2 h-8 rounded-md hover:bg-muted text-muted-foreground font-mono tabular-nums min-w-[3rem]"
            title="Reset zoom"
          >
            {zoom}%
          </button>
          <button
            onClick={onZoomIn}
            disabled={zoom >= 140}
            className="osler-icon-btn size-8 disabled:opacity-40"
            title="Zoom in"
          >
            <ZoomIn className="size-4" />
          </button>
        </div>

        {/* Highlighter */}
        <HighlighterToolbar ctrl={hlCtrl} compact />

        {/* Bookmark */}
        <button
          onClick={onToggleBookmark}
          className={cn(
            "size-9 rounded-md flex items-center justify-center transition-colors shrink-0",
            isBookmarked
              ? "text-primary bg-primary/10 hover:bg-primary/15"
              : "text-muted-foreground hover:bg-muted/60"
          )}
          title={isBookmarked ? "Remove bookmark" : "Bookmark article"}
        >
          {isBookmarked ? (
            <BookmarkCheck className="size-4" />
          ) : (
            <Bookmark className="size-4" />
          )}
        </button>
      </div>
    </header>
  );
}

function EmptyState({ onOpen, articleList }: { onOpen: (id: string) => void; articleList: Article[] }) {
  const popular = articleList.slice(0, 6);
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-12">
      <div className="w-16 h-16 rounded-full bg-primary/15 text-primary flex items-center justify-center mb-4">
        <LibraryIcon className="size-8" />
      </div>
      <h2 className="text-xl font-semibold mb-1">Article Library</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Browse the medical article library by specialty and topic. Select an
        article from the sidebar to start reading.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-w-lg">
        {popular.map((a) => (
          <button
            key={a.id}
            onClick={() => onOpen(a.id)}
            className="text-left text-xs px-3 py-2 rounded-md border border-border bg-card hover:border-primary/40 transition-colors"
          >
            <div className="font-medium truncate">{a.title}</div>
            <div className="text-muted-foreground text-[10px] mt-0.5">
              {a.specialty} · {a.readTimeMin} min
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
