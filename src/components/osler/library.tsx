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
  Highlighter,
  X,
  Trash2,
  Type,
  Minus,
  Plus as PlusIcon,
} from "lucide-react";
import {
  ARTICLE_TOC,
  ARTICLES,
  type ArticleTocNode,
  type Article,
} from "@/lib/osler/articles";
import { articleHighlights, type HighlightItem } from "@/lib/osler/storage";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const HIGHLIGHT_COLORS = ["#fef08a", "#86efac", "#93c5fd", "#fbcfe8", "#c4b5fd", "#fdba74"];

interface LibraryProps {
  initialArticleId?: string;
}

const BOOKMARKS_KEY = "osler-article-bookmarks";

export function Library({ initialArticleId }: LibraryProps) {
  const [expandedNodes, setExpandedNodes] = React.useState<Set<string>>(
    new Set(["cardiology", "pulmonology", "neurology"])
  );
  const [activeArticleId, setActiveArticleId] = React.useState<string | null>(
    initialArticleId ?? null
  );
  const [bookmarks, setBookmarks] = React.useState<Set<string>>(new Set());
  const [zoom, setZoom] = React.useState(100);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  // Highlighter state
  const [highlightMode, setHighlightMode] = React.useState(false);
  const [highlightColor, setHighlightColor] = React.useState(HIGHLIGHT_COLORS[0]);
  const [colorPickerOpen, setColorPickerOpen] = React.useState(false);
  const [currentHighlights, setCurrentHighlights] = React.useState<HighlightItem[]>([]);
  const [fontSize, setFontSize] = React.useState(15);
  const articleRef = React.useRef<HTMLDivElement>(null);

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

  const activeArticle = activeArticleId ? ARTICLES[activeArticleId] : null;

  // Load highlights when article changes
  React.useEffect(() => {
    if (activeArticleId) {
      setCurrentHighlights(articleHighlights.get(activeArticleId));
    } else {
      setCurrentHighlights([]);
    }
  }, [activeArticleId]);

  // Simulated article load
  React.useEffect(() => {
    if (!activeArticleId) return;
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 200);
    return () => clearTimeout(t);
  }, [activeArticleId]);

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

  // Highlight mode: auto-apply on text selection
  React.useEffect(() => {
    if (!highlightMode || !activeArticleId) return;
    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString().trim();
      if (!text) return;
      // Check selection is within the article
      const range = sel.getRangeAt(0);
      if (!articleRef.current?.contains(range.commonAncestorContainer)) return;

      const hl: HighlightItem = {
        id: crypto.randomUUID(),
        color: highlightColor,
        text,
        target: "article",
      };
      const updated = [...currentHighlights, hl];
      setCurrentHighlights(updated);
      articleHighlights.save(activeArticleId, updated);
      window.getSelection()?.removeAllRanges();
    };
    document.addEventListener("mouseup", handler);
    return () => document.removeEventListener("mouseup", handler);
  }, [highlightMode, highlightColor, activeArticleId, currentHighlights]);

  const clearHighlights = () => {
    if (!activeArticleId) return;
    if (window.confirm(`Clear all ${currentHighlights.length} highlights?`)) {
      articleHighlights.clear(activeArticleId);
      setCurrentHighlights([]);
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-background">
      {/* Mobile sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="md:hidden fixed bottom-20 right-4 z-30 size-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
        aria-label="Open contents"
      >
        <PanelLeft className="size-5" />
      </button>

      {/* Mobile sidebar overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="md:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          >
            <motion.div
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-sidebar"
              onClick={(e) => e.stopPropagation()}
            >
              <TocSidebar
                expanded={expandedNodes}
                onToggle={toggleExpand}
                activeId={activeArticleId}
                onOpen={openArticle}
                bookmarks={bookmarks}
                onToggleBookmark={toggleBookmark}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-72 shrink-0 border-r border-border bg-sidebar">
        <TocSidebar
          expanded={expandedNodes}
          onToggle={toggleExpand}
          activeId={activeArticleId}
          onOpen={openArticle}
          bookmarks={bookmarks}
          onToggleBookmark={toggleBookmark}
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
              highlightMode={highlightMode}
              onToggleHighlightMode={() => setHighlightMode((m) => !m)}
              colorPickerOpen={colorPickerOpen}
              onColorPickerOpenChange={(o) => {
                setColorPickerOpen(o);
                if (o) setHighlightMode(true);
              }}
              highlightColor={highlightColor}
              onColorChange={setHighlightColor}
              highlightCount={currentHighlights.length}
              onClearHighlights={clearHighlights}
              fontSize={fontSize}
              onFontSizeChange={setFontSize}
            />
            <div className="flex-1 overflow-y-auto medos-scroll">
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
                  className="library-article"
                  ref={articleRef}
                  style={{
                    fontSize: `${(zoom / 100) * fontSize}px`,
                    lineHeight: 1.7,
                  }}
                  dangerouslySetInnerHTML={{ __html: activeArticle.html }}
                />
              )}
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}

function TocSidebar({
  expanded,
  onToggle,
  activeId,
  onOpen,
  bookmarks,
  onToggleBookmark,
}: {
  expanded: Set<string>;
  onToggle: (id: string) => void;
  activeId: string | null;
  onOpen: (id: string) => void;
  bookmarks: Set<string>;
  onToggleBookmark: (id: string) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <BookOpen className="size-3.5" />
          Article Library
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto medos-scroll p-2 space-y-0.5">
        {ARTICLE_TOC.map((node) => (
          <TocNode
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={onToggle}
            activeId={activeId}
            onOpen={onOpen}
            bookmarks={bookmarks}
            onToggleBookmark={onToggleBookmark}
          />
        ))}
      </div>
      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground">
        {Object.keys(ARTICLES).length} articles · {bookmarks.size} bookmarked
      </div>
    </div>
  );
}

function TocNode({
  node,
  depth,
  expanded,
  onToggle,
  activeId,
  onOpen,
  bookmarks,
  onToggleBookmark,
}: {
  node: ArticleTocNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  activeId: string | null;
  onOpen: (id: string) => void;
  bookmarks: Set<string>;
  onToggleBookmark: (id: string) => void;
}) {
  const isExpanded = expanded.has(node.id);
  const isLeaf = !!node.articleId;
  const isActive = node.articleId === activeId;
  const isBookmarked = node.articleId
    ? bookmarks.has(node.articleId)
    : false;

  return (
    <div>
      <button
        onClick={() => {
          if (isLeaf) {
            onOpen(node.articleId!);
          } else {
            onToggle(node.id);
          }
        }}
        className={cn("library-toc-item w-full", isActive && "active")}
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
          <BookmarkCheck className="size-3 text-primary shrink-0" />
        )}
      </button>
      {!isLeaf && isExpanded && node.children && (
        <div className="library-toc-children">
          {node.children.map((c) => (
            <TocNode
              key={c.id}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              activeId={activeId}
              onOpen={onOpen}
              bookmarks={bookmarks}
              onToggleBookmark={onToggleBookmark}
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
  highlightMode,
  onToggleHighlightMode,
  colorPickerOpen,
  onColorPickerOpenChange,
  highlightColor,
  onColorChange,
  highlightCount,
  onClearHighlights,
  fontSize,
  onFontSizeChange,
}: {
  article: Article;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  highlightMode: boolean;
  onToggleHighlightMode: () => void;
  colorPickerOpen: boolean;
  onColorPickerOpenChange: (o: boolean) => void;
  highlightColor: string;
  onColorChange: (c: string) => void;
  highlightCount: number;
  onClearHighlights: () => void;
  fontSize: number;
  onFontSizeChange: (s: number) => void;
}) {
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
        <Popover>
          <PopoverTrigger asChild>
            <button className="osler-icon-btn size-8" title="Font size">
              <Type className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-3">
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
          </PopoverContent>
        </Popover>

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
        <Popover open={colorPickerOpen} onOpenChange={onColorPickerOpenChange}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "osler-icon-btn size-8",
                highlightMode && "bg-amber-400 text-amber-950"
              )}
              title="Highlight text"
            >
              <Highlighter className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Highlighter className="size-3 text-amber-500" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Highlight Color
                  </span>
                </div>
                <button
                  onClick={() => {
                    onColorPickerOpenChange(false);
                    onToggleHighlightMode();
                  }}
                  className="size-5 rounded flex items-center justify-center hover:bg-muted"
                >
                  <X className="size-3" />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => onColorChange(c)}
                    className={cn(
                      "size-6 rounded-full border-2 transition-all",
                      highlightColor === c
                        ? "border-foreground scale-110"
                        : "border-transparent hover:scale-110"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground">
                Select text to highlight. {highlightCount} highlights.
              </div>
              {highlightCount > 0 && (
                <button
                  onClick={onClearHighlights}
                  className="text-[10px] text-destructive hover:underline flex items-center gap-1"
                >
                  <Trash2 className="size-3" />
                  Clear all highlights
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>

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

function EmptyState() {
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
        {Object.values(ARTICLES)
          .slice(0, 6)
          .map((a) => (
            <div
              key={a.id}
              className="text-xs px-3 py-2 rounded-md border border-border bg-card"
            >
              <div className="font-medium truncate">{a.title}</div>
              <div className="text-muted-foreground text-[10px] mt-0.5">
                {a.specialty} · {a.readTimeMin} min
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
