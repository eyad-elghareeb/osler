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
  Loader2,
  Library as LibraryIcon,
  Type,
  Minus,
  Plus as PlusIcon,
  Search,
  BookmarkX,
  ArrowLeft,
  FileText,
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
import { useOslerTheme } from "./theme-provider";
import { useI18n } from "./i18n-provider";
import { useLightbox } from "./lightbox-provider";
import { HighlighterToolbar } from "./highlighter-toolbar";
import { ContentCacheButton } from "./content-cache-button";
import { FolderTreeNav } from "./folder-tree-nav";
import { applyHighlightsToHtml } from "@/lib/osler/article-highlights";
import { setImmersiveMode } from "./immersive-mode";

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

  // Immersive mode: hide mobile tab bar when reading an article
  React.useEffect(() => {
    if (isMobile) {
      setImmersiveMode(!!activeFile);
      return () => setImmersiveMode(false);
    }
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

  const closeArticle = React.useCallback(() => {
    setActiveFile(null);
    setActiveArticle(null);
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

  const { theme } = useOslerTheme();

  const processedArticleHtml = React.useMemo(() => {
    if (!activeArticle) return "";
    return applyHighlightsToHtml(activeArticle.html, hlCtrl.highlights as any);
  }, [activeArticle?.html, hlCtrl.highlights, theme]);

  React.useEffect(() => {
    if (!hlCtrl.highlightMode || !activeFile) return;
    const el = articleContentRef.current;
    if (!el) return;
    const applySelection = () => {
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
    // Desktop: mouseup fires after the selection is final.
    const onMouseUp = () => applySelection();
    // Touch: defer 150ms so iOS Safari has time to settle the selection
    // (the selection handles appear after touchend).
    const onTouchEnd = () => {
      setTimeout(applySelection, 150);
    };
    el.addEventListener("mouseup", onMouseUp);
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [hlCtrl.highlightMode, hlCtrl.highlightColor, activeFile, hlCtrl.onAdd]);

  React.useEffect(() => {
    if (!hlCtrl.highlightMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") hlCtrl.setHighlightMode(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hlCtrl.highlightMode, hlCtrl.setHighlightMode]);

  const { openLightbox } = useLightbox();

  React.useEffect(() => {
    const el = articleContentRef.current;
    if (!el) return;
    const isEraser = hlCtrl.tool === "eraser";
    el.classList.toggle("osler-hl-eraser", isEraser && !hlCtrl.highlightMode);
    if (hlCtrl.highlightMode) return;

    const handleTarget = (target: EventTarget | null, prevent: (e: Event) => void, e: Event) => {
      const t = target as HTMLElement;
      if (!t) return;
      if (t.tagName === "IMG") {
        prevent(e);
        const src = t.getAttribute("src");
        if (src) {
          openLightbox(src, t.getAttribute("alt") || "");
          return;
        }
      }
      if (!isEraser) return;
      const span = t.closest("[data-osler-hl-id]") as HTMLElement | null;
      if (span) {
        const id = span.getAttribute("data-osler-hl-id");
        if (id) {
          prevent(e);
          hlCtrl.onRemove(id);
        }
      }
    };
    const onClick = (e: MouseEvent) => handleTarget(e.target, (ev) => { ev.preventDefault(); ev.stopPropagation(); }, e);
    // Touch: handle eraser taps and image taps on touch devices. We use
    // elementFromPoint at the touch end coordinates so we get the right
    // element even if the finger moved slightly. preventDefault stops the
    // subsequent synthetic click from double-firing.
    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const t = document.elementFromPoint(touch.clientX, touch.clientY);
      if (t && (t.tagName === "IMG" || t.closest("[data-osler-hl-id]"))) {
        e.preventDefault();
        handleTarget(t, () => {}, e);
      }
    };
    el.addEventListener("click", onClick);
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("click", onClick);
      el.removeEventListener("touchend", onTouchEnd);
      el.classList.remove("osler-hl-eraser");
    };
  }, [hlCtrl.onRemove, hlCtrl.highlights, hlCtrl.highlightMode, hlCtrl.tool, openLightbox]);

  const bookmarkedArticles = React.useMemo(
    () => allArticles.filter((a) => bookmarks.has(a.file)),
    [bookmarks, allArticles]
  );

  // Mobile: full-screen reader when article is active
  if (isMobile && activeFile && activeArticle) {
    return (
      <MobileReader
        article={activeArticle}
        isBookmarked={bookmarks.has(activeFile)}
        onToggleBookmark={() => toggleBookmark(activeFile)}
        onBack={closeArticle}
        zoom={zoom}
        onZoomIn={() => setZoom((z) => Math.min(140, z + 10))}
        onZoomOut={() => setZoom((z) => Math.max(80, z - 10))}
        onResetZoom={() => setZoom(100)}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        loading={loading}
        articleContentRef={articleContentRef}
        processedHtml={processedArticleHtml}
        hlCtrl={hlCtrl}
      />
    );
  }

  // Mobile: hub view (article list) when no article is selected
  if (isMobile) {
    return (
      <MobileHub
        allArticles={allArticles}
        bookmarks={bookmarks}
        bookmarkedArticles={bookmarkedArticles}
        activeFile={activeFile}
        onOpenArticle={openArticleByFile}
        onToggleBookmark={toggleBookmark}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        matchedArticleFiles={matchedArticleFiles}
      />
    );
  }

  /* ── Desktop layout (unchanged) ─────────────────────────────────── */
  return (
    <div className="flex h-full overflow-hidden bg-background">
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="md:hidden fixed z-40 bg-black/50 inset-0"
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
                  className={cn(
                    "library-article relative",
                    activeArticle?.lang === "ar" ? "osler-content-ar" : "osler-content-en",
                  )}
                  dir={activeArticle?.lang === "ar" ? "rtl" : "ltr"}
                  lang={activeArticle?.lang ?? "en"}
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

/* ── Mobile Hub ──────────────────────────────────────────────────── */

function MobileHub({
  allArticles,
  bookmarks,
  bookmarkedArticles,
  activeFile,
  onOpenArticle,
  onToggleBookmark,
  searchQuery,
  onSearchChange,
  matchedArticleFiles,
}: {
  allArticles: ArticleMeta[];
  bookmarks: Set<string>;
  bookmarkedArticles: ArticleMeta[];
  activeFile: string | null;
  onOpenArticle: (file: string) => void;
  onToggleBookmark: (file: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  matchedArticleFiles: Set<string> | null;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = React.useState<"all" | "bookmarked">("all");

  const displayArticles = filter === "bookmarked" ? bookmarkedArticles : allArticles;

  // Group by specialty
  const grouped = React.useMemo(() => {
    const map = new Map<string, ArticleMeta[]>();
    for (const a of displayArticles) {
      const key = a.specialty ?? "General";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [displayArticles]);

  // Filter by search results
  const filteredGrouped = React.useMemo(() => {
    if (!matchedArticleFiles && !searchQuery.trim()) return grouped;
    if (!matchedArticleFiles) return grouped;
    return grouped
      .map(([specialty, articles]) => {
        const matched = articles.filter((a) => matchedArticleFiles.has(a.file));
        return [specialty, matched] as [string, ArticleMeta[]];
      })
      .filter(([, articles]) => articles.length > 0);
  }, [grouped, matchedArticleFiles, searchQuery]);

  return (
    <div className="h-full overflow-y-auto medos-scroll medos-tabbar-pad">
      {/* Search bar */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3">
        <div className="relative max-w-xl mx-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("library.search")}
            className="w-full h-10 rounded-xl border border-border bg-card pl-10 pr-3 text-sm outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/50"
          />
        </div>
        {/* Filter pills */}
        <div className="flex items-center gap-2 mt-3 max-w-xl mx-auto">
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium transition-colors",
              filter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:text-foreground"
            )}
          >
            {t("library.all")} ({allArticles.length})
          </button>
          <button
            onClick={() => setFilter("bookmarked")}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium transition-colors",
              filter === "bookmarked"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:text-foreground"
            )}
          >
            <BookmarkCheck className="size-3 inline me-1 -mt-0.5" />
            {t("library.bookmarked")} ({bookmarkedArticles.length})
          </button>
        </div>
      </div>

      <div className="px-4 pb-4 medos-tabbar-pad">
        {filteredGrouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="size-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {searchQuery.trim()
                ? t("library.noResults")
                : filter === "bookmarked"
                  ? t("library.noBookmarks")
                  : t("library.empty")}
            </p>
          </div>
        ) : (
          filteredGrouped.map(([specialty, articles]) => (
            <div key={specialty} className="mt-5 first:mt-3">
              <div className="flex items-center gap-2 mb-2.5 px-0.5">
                <FileText className="size-3.5 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {specialty}
                </h3>
                <span className="text-[10px] text-muted-foreground/40 ms-auto tabular-nums">
                  {articles.length === 1 ? t("library.oneArticle") : t("library.articlesCount", { n: articles.length })}
                </span>
              </div>
              <div className="space-y-1.5">
                {articles.map((a) => {
                  const isBookmarked = bookmarks.has(a.file);
                  return (
                    <div
                      key={a.file}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenArticle(a.file)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenArticle(a.file);
                        }
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-start transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        "bg-card border border-border hover:border-primary/30 hover:bg-primary/[0.02]",
                        a.file === activeFile && "border-primary/40 bg-primary/5",
                        a.lang === "ar" && "osler-content-ar",
                      )}
                      dir={a.lang === "ar" ? "rtl" : undefined}
                      lang={a.lang ?? undefined}
                    >
                      <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <BookOpen className="size-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{a.title}</div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                          {a.readTimeMin && (
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" />
                              {a.readTimeMin} min
                            </span>
                          )}
                          {a.system && (
                            <span className="truncate">{a.system}</span>
                          )}
                        </div>
                      </div>
                      <ContentCacheButton packId={`library:${a.file}`} urls={[`/osler-content/library/${a.file}`]} />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleBookmark(a.file);
                        }}
                        className={cn(
                          "size-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                          isBookmarked
                            ? "text-primary bg-primary/10"
                            : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/60"
                        )}
                        aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
                      >
                        {isBookmarked ? (
                          <BookmarkCheck className="size-4" />
                        ) : (
                          <Bookmark className="size-4" />
                        )}
                      </button>
                      <ChevronRight className="size-4 text-muted-foreground/30 shrink-0" />
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── Mobile Reader ────────────────────────────────────────────────── */

function MobileReader({
  article,
  isBookmarked,
  onToggleBookmark,
  onBack,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  fontSize,
  onFontSizeChange,
  loading,
  articleContentRef,
  processedHtml,
  hlCtrl,
}: {
  article: Article;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  onBack: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  fontSize: number;
  onFontSizeChange: (s: number) => void;
  loading: boolean;
  articleContentRef: React.RefObject<HTMLDivElement | null>;
  processedHtml: string;
  hlCtrl: ReturnType<typeof useArticleHighlighter>;
}) {
  const [fontPopoverOpen, setFontPopoverOpen] = React.useState(false);
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Top bar */}
      <header className="shrink-0 border-b border-border bg-card/40 backdrop-blur-sm safe-pt">
        <div className="flex items-center gap-2 px-3 h-12">
          <button
            onClick={onBack}
            className="size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors -ml-1"
            aria-label={t("library.backToLibrary")}
          >
            <ArrowLeft className="size-5" />
          </button>

          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{article.title}</h1>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{article.specialty}</span>
              {article.readTimeMin && (
                <>
                  <span className="opacity-40">&middot;</span>
                  <span className="flex items-center gap-0.5">
                    <Clock className="size-2.5" />
                    {article.readTimeMin} min
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-0.5">
            <div className="relative">
              <button
                onClick={() => setFontPopoverOpen(!fontPopoverOpen)}
                className="size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                title={t("library.fontSize")}
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
                      <span className="text-[11px] text-muted-foreground w-16">{t("library.fontSize")}</span>
                      <button
                        onClick={() => onFontSizeChange(Math.max(12, fontSize - 1))}
                        className="size-7 rounded bg-muted hover:bg-muted/70 flex items-center justify-center"
                      >
                        <Minus className="size-3" />
                      </button>
                      <span className="text-xs font-mono tabular-nums w-5 text-center">{fontSize}</span>
                      <button
                        onClick={() => onFontSizeChange(Math.min(22, fontSize + 1))}
                        className="size-7 rounded bg-muted hover:bg-muted/70 flex items-center justify-center"
                      >
                        <PlusIcon className="size-3" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

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
              onClick={onToggleBookmark}
              className={cn(
                "size-9 rounded-lg flex items-center justify-center transition-colors",
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
        </div>

        {/* Zoom controls row */}
        <div className="flex items-center justify-between px-3 pb-2 border-b border-border/40">
          <div className="flex items-center gap-0.5">
            <button
              onClick={onZoomOut}
              disabled={zoom <= 80}
              className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30"
              title="Zoom out"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <button
              onClick={onResetZoom}
              className="text-[10px] font-mono tabular-nums px-1.5 h-7 rounded-md hover:bg-muted text-muted-foreground min-w-[2.5rem]"
              title="Reset zoom"
            >
              {zoom}%
            </button>
            <button
              onClick={onZoomIn}
              disabled={zoom >= 140}
              className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30"
              title="Zoom in"
            >
              <ZoomIn className="size-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto medos-scroll safe-pb">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <motion.div
            key={article.file}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className={cn(
              "library-article px-4 py-5",
              article.lang === "ar" ? "osler-content-ar" : "osler-content-en",
            )}
            dir={article.lang === "ar" ? "rtl" : "ltr"}
            lang={article.lang ?? "en"}
            style={{
              fontSize: `${(zoom / 100) * fontSize}px`,
              lineHeight: 1.7,
            }}
          >
            {/* Title at top of content */}
            <h1 className="text-xl font-bold mb-1">{article.title}</h1>
            <div
              ref={articleContentRef}
              dangerouslySetInnerHTML={{ __html: processedHtml }}
            />
          </motion.div>
        )}
      </div>
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
    const { t } = useI18n();
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
                <ChevronRight className="size-4" />
              </button>
            )}
          </div>
        )}
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <BookOpen className="size-3.5" />
            {t("library.title")}
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
              title={t("library.tableOfContents")}
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
              title={t("library.bookmarks")}
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
            placeholder={t("library.search")}
            className="w-full h-8 rounded-md border border-border bg-card pl-8 pr-3 text-xs outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto medos-scroll p-2 space-y-0.5 medos-tabbar-pad md:pb-2">
        {sidebarTab === "bookmarks" && bookmarkedArticles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <BookmarkX className="size-8 text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">{t("library.noBookmarksYet")}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              {t("library.bookmarkHint")}
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
  const { t } = useI18n();

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
            title={t("library.fontSize")}
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
                  <span className="text-[11px] text-muted-foreground w-16">{t("library.fontSize")}</span>
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
