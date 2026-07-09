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
  ArrowRight,
} from "lucide-react";
import {
  loadArticleTree,
  loadArticleContent,
  listAllArticles,
  searchArticles as searchLibraryArticles,
  type ArticleMeta,
  type Article,
} from "@/lib/osler/articles";
import type { ContentTreeNode } from "@/lib/osler/types";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useArticleHighlighter } from "@/hooks/use-article-highlighter";
import { HighlighterToolbar } from "./highlighter-toolbar";
import { FolderTreeNav } from "./folder-tree-nav";
import { applyHighlightsToHtml } from "@/lib/osler/article-highlights";

interface LibraryProps {
  initialArticleId?: string;
}

type SidebarTab = "toc" | "bookmarks";

const BOOKMARKS_KEY = "osler-article-bookmarks";

export function Library({ initialArticleId }: LibraryProps) {
  const [tree, setTree] = React.useState<ContentTreeNode[]>([]);
  const [allArticles, setAllArticles] = React.useState<ArticleMeta[]>([]);
  const [activeFile, setActiveFile] = React.useState<string | null>(
    initialArticleId ?? null
  );
  const [activeArticle, setActiveArticle] = React.useState<Article | null>(null);
  const [bookmarks, setBookmarks] = React.useState<Set<string>>(new Set());
  const [zoom, setZoom] = React.useState(100);
  const [fontSize, setFontSize] = React.useState(15);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const isMobile = useIsMobile();

  React.useEffect(() => {
    if (isMobile && !activeFile) setSidebarOpen(true);
  }, [isMobile, activeFile]);

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
    articleId: activeFile,
    enabled: true,
  });

  // Load tree and all articles
  React.useEffect(() => {
    (async () => {
      try {
        const [treeData, articleData] = await Promise.all([
          loadArticleTree(),
          listAllArticles(),
        ]);
        setTree(treeData);
        setAllArticles(articleData);
      } catch (e) {
        console.error("Failed to load article data:", e);
      }
    })();
  }, []);

  // Enrich tree: turn leaf nodes with .md files into branch nodes with virtual children
  const displayTree = React.useMemo(() => {
    function enrich(nodes: ContentTreeNode[]): ContentTreeNode[] {
      return nodes.map((node) => {
        if (node.items.length === 0 && (node.files?.length ?? 0) > 0) {
          const fileChildren: ContentTreeNode[] = (node.files ?? []).map((file) => {
            const filePath = `${node.path}${file}`;
            const meta = allArticles.find((a) => a.file === filePath);
            return {
              uid: filePath,
              title: meta?.title ?? file.replace(/\.md$/, "").replace(/-/g, " "),
              type: "library" as const,
              path: node.path,
              items: [],
            };
          });
          return { ...node, items: fileChildren };
        }
        if (node.items.length > 0) {
          return { ...node, items: enrich(node.items) };
        }
        return node;
      });
    }
    return enrich(tree);
  }, [tree, allArticles]);

  // Load full article content when activeFile changes
  React.useEffect(() => {
    if (!activeFile) { setActiveArticle(null); return; }
    setLoading(true);
    loadArticleContent(activeFile)
      .then((article) => setActiveArticle(article))
      .catch(() => setActiveArticle(null))
      .finally(() => setLoading(false));
  }, [activeFile]);

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
      setActiveFile(initialArticleId);
      setSidebarOpen(false);
    }
  }, [initialArticleId]);

  const openArticleByFile = React.useCallback((filePath: string) => {
    setActiveFile(filePath);
    setSidebarOpen(false);
  }, []);

  const toggleBookmark = (filePath: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      if (typeof window !== "undefined") {
        localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(Array.from(next)));
      }
      return next;
    });
  };

  const [matchedArticleFiles, setMatchedArticleFiles] = React.useState<Set<string> | null>(null);

  React.useEffect(() => {
    if (!debouncedSearchQuery.trim()) { setMatchedArticleFiles(null); return; }
    searchLibraryArticles(debouncedSearchQuery).then((results) => {
      setMatchedArticleFiles(new Set(results.map((a) => a.file)));
    });
  }, [debouncedSearchQuery]);

  const articleContentRef = React.useRef<HTMLDivElement>(null);

  const processedArticleHtml = React.useMemo(() => {
    if (!activeArticle) return "";
    return applyHighlightsToHtml(activeArticle.html, hlCtrl.highlights as any);
  }, [activeArticle?.html, hlCtrl.highlights]);

  React.useEffect(() => {
    if (!hlCtrl.highlightMode || !activeFile) return;
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
  }, [hlCtrl.highlightMode, hlCtrl.highlightColor, activeFile, hlCtrl.onAdd]);

  React.useEffect(() => {
    if (!hlCtrl.highlightMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") hlCtrl.setHighlightMode(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hlCtrl.highlightMode, hlCtrl.setHighlightMode]);

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
    () => allArticles.filter((a) => bookmarks.has(a.file)),
    [bookmarks, allArticles]
  );

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {activeFile && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="md:hidden fixed bottom-20 right-4 z-30 size-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
          aria-label="Open contents"
        >
          <PanelLeft className="size-5" />
        </button>
      )}

      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              "md:hidden fixed z-40 bg-black/50",
              activeFile ? "inset-0" : "top-14 inset-x-0 bottom-14"
            )}
            onClick={() => { if (activeFile) setSidebarOpen(false); }}
          >
            <motion.div
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className={cn(
                "absolute left-0 top-0 bottom-0 bg-sidebar flex flex-col",
                activeFile ? "w-80 max-w-[85vw]" : "w-full"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <SidebarContent
                tree={displayTree}
                articleCount={allArticles.length}
                allArticles={allArticles}
                activeFile={activeFile}
                onOpenArticle={openArticleByFile}
                bookmarks={bookmarks}
                onToggleBookmark={toggleBookmark}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                matchedArticleFiles={matchedArticleFiles}
                sidebarTab={sidebarTab}
                onTabChange={setSidebarTab}
                bookmarkedArticles={bookmarkedArticles}
                fullScreen={!activeFile}
                onClose={activeFile ? () => setSidebarOpen(false) : undefined}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <aside className="hidden md:flex flex-col w-72 shrink-0 border-r border-border bg-sidebar">
        <SidebarContent
          tree={displayTree}
          articleCount={allArticles.length}
          allArticles={allArticles}
          activeFile={activeFile}
          onOpenArticle={openArticleByFile}
          bookmarks={bookmarks}
          onToggleBookmark={toggleBookmark}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          matchedArticleFiles={matchedArticleFiles}
          sidebarTab={sidebarTab}
          onTabChange={setSidebarTab}
          bookmarkedArticles={bookmarkedArticles}
        />
      </aside>

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {activeArticle ? (
          <>
            <ArticleHeader
              article={activeArticle}
              isBookmarked={bookmarks.has(activeFile!)}
              onToggleBookmark={() => activeFile && toggleBookmark(activeFile)}
              zoom={zoom}
              onZoomIn={() => setZoom((z) => Math.min(140, z + 10))}
              onZoomOut={() => setZoom((z) => Math.max(80, z - 10))}
              onResetZoom={() => setZoom(100)}
              fontSize={fontSize}
              onFontSizeChange={setFontSize}
              hlCtrl={hlCtrl}
            />
            <div className="flex-1 overflow-y-auto medos-scroll medos-tabbar-pad md:pb-0">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <motion.div
                  key={activeFile}
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
          <EmptyState
            onOpen={openArticleByFile}
            allArticles={allArticles}
          />
        )}
      </main>
    </div>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────────── */

function SidebarContent({
  tree,
  articleCount,
  allArticles,
  activeFile,
  onOpenArticle,
  bookmarks,
  onToggleBookmark,
  searchQuery,
  onSearchChange,
  matchedArticleFiles,
  sidebarTab,
  onTabChange,
  bookmarkedArticles,
  fullScreen,
  onClose,
}: {
  tree: ContentTreeNode[];
  articleCount: number;
  allArticles: ArticleMeta[];
  activeFile: string | null;
  onOpenArticle: (file: string) => void;
  bookmarks: Set<string>;
  onToggleBookmark: (file: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  matchedArticleFiles: Set<string> | null;
  sidebarTab: SidebarTab;
  onTabChange: (t: SidebarTab) => void;
  bookmarkedArticles: ArticleMeta[];
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
                <ArrowRight className="size-4" />
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
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
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

      <div className="flex-1 overflow-y-auto medos-scroll p-2 space-y-0.5 medos-tabbar-pad md:pb-2">
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
                key={a.file}
                onClick={() => onOpenArticle(a.file)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors text-left",
                  "hover:bg-muted/60",
                  a.file === activeFile && "bg-primary/10 text-primary font-medium"
                )}
              >
                <BookOpen className="size-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{a.title}</span>
                <BookmarkCheck className="size-3 text-primary shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <>
            <FolderTreeNav
              tree={tree}
              selected={activeFile}
              onSelect={(node) => onOpenArticle(node.uid)}
            />
            {/* Search results */}
            {searchQuery.trim() && matchedArticleFiles && (
              <div className="mt-2 pt-2 border-t border-border space-y-0.5">
                <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold">
                  Search Results
                </div>
                {allArticles
                  .filter((a) => matchedArticleFiles.has(a.file))
                  .slice(0, 20)
                  .map((a) => (
                    <button
                      key={a.file}
                      onClick={() => onOpenArticle(a.file)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors text-left",
                        "hover:bg-muted/60",
                        a.file === activeFile && "bg-primary/10 text-primary font-medium"
                      )}
                      style={{ paddingLeft: "12px" }}
                    >
                      <BookOpen className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{a.title}</span>
                    </button>
                  ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground flex items-center justify-between">
        <span>{articleCount} articles</span>
        <span>{bookmarks.size} bookmarked</span>
      </div>
    </div>
  );
}

/* ── Article Header ───────────────────────────────────────────────── */

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
        {article.system && (
          <>
            <ChevronRight className="size-3 opacity-50" />
            <span className="truncate">{article.system}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {article.readTimeMin && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mr-2">
            <Clock className="size-3.5" />
            <span>{article.readTimeMin} min</span>
          </div>
        )}

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
                  <span className="text-xs font-mono tabular-nums w-5 text-center">{fontSize}</span>
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

        <HighlighterToolbar ctrl={hlCtrl} compact />

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

/* ── Empty State ──────────────────────────────────────────────────── */

function EmptyState({
  onOpen,
  allArticles,
}: {
  onOpen: (file: string) => void;
  allArticles: ArticleMeta[];
}) {
  const popular = allArticles.slice(0, 6);
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
            key={a.file}
            onClick={() => onOpen(a.file)}
            className="text-left text-xs px-3 py-2 rounded-md border border-border bg-card hover:border-primary/40 transition-colors"
          >
            <div className="font-medium truncate">{a.title}</div>
            <div className="text-muted-foreground text-[10px] mt-0.5">
              {a.specialty} &middot; {a.readTimeMin} min
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
