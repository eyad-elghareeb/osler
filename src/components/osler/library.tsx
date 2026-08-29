"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  BookOpen,
  NotebookPen,
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
  BookmarkX,
  ArrowLeft,
  FileText,
  Printer,
  ExternalLink,
  MessageSquareWarning,
  Share2,
  Link2,
} from "lucide-react";
import {
  loadArticleTree,
  loadArticleContent,
  listAllArticles,
  articlesFromManifestTree,
  type ArticleMeta,
  type Article,
} from "@/lib/osler/articles";
import { contentFileUrl } from "@/lib/osler/content-url";
import type { ContentTreeNode } from "@/lib/osler/types";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SkeletonText, EmptyState as SharedEmptyState, ComingSoonState } from "./ui-primitives";
import { useIsMobile } from "@/hooks/use-mobile";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";
import { useArticleHighlighter } from "@/hooks/use-article-highlighter";
import { useOslerTheme } from "./theme-provider";
import { useI18n } from "./i18n-provider";
import { useLightbox } from "./lightbox-provider";
import { HighlighterToolbar } from "./highlighter-toolbar";
import { ContentCacheButton } from "./content-cache-button";
import { FolderTreeNav } from "./folder-tree-nav";
import { NavigationStack } from "./navigation-stack";
import { applyHighlightsToHtml } from "@/lib/osler/article-highlights";
import { MilkdownArticleView, articleDirOf } from "./milkdown-article-view";
import { setArticleViewContext, clearArticleViewContext } from "@/lib/osler/article-view-registry";
import { setImmersiveMode } from "./immersive-mode";
import { haptic } from "@/lib/osler/native";
import { useToast } from "@/hooks/use-toast";
import { type PdfExportOptions } from "./pdf-export-dialog";
import { PdfExportDialog } from "./lazy-tools";
import { generateArticlePdf, downloadPdf } from "@/lib/osler/pdf";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";
import { useShortcutListener } from "@/hooks/use-shortcuts";
import { NotesPanel } from "./lazy-tools";
import { ReportTicketDialog } from "@/components/osler/report-ticket-dialog";
import type { TicketContext } from "@/lib/osler/support";

import { useOslerRouter, routeFor } from "@/lib/osler/navigation";
import { ctxLinkAttrs, absoluteDeepLink } from "@/lib/osler/deep-link";
import { MOTION_TRANSITION, MOTION_SPRING } from "@/lib/osler/motion";
import { PdfViewer } from "./pdf-viewer";

interface LibraryProps {
  initialArticleId?: string;
  /** Called when the user swipes back to navigate to the Learn hub. */
  onNavigateBack?: () => void;
}

type SidebarTab = "toc" | "bookmarks";

const BOOKMARKS_KEY = "osler-article-bookmarks";

/* ── Reader display preferences ──────────────────────────────────── */
/* Zoom + text size + typeface + line spacing + reading width — one
 * persisted bundle edited through the unified display menu. */

type FontFamilyPref = "serif" | "sans";
type LineSpacingPref = "compact" | "cozy" | "relaxed";
type WidthPref = "normal" | "wide";

interface ReaderDisplayPrefs {
  fontSize: number;
  zoom: number;
  fontFamily: FontFamilyPref;
  lineSpacing: LineSpacingPref;
  width: WidthPref;
}

const LINE_HEIGHTS: Record<LineSpacingPref, number> = {
  compact: 1.35,
  cozy: 1.7,
  relaxed: 2,
};

const DISPLAY_STORAGE_KEY = "osler-reader-display";

const DEFAULT_DISPLAY: ReaderDisplayPrefs = {
  fontSize: 15,
  zoom: 100,
  fontFamily: "serif",
  lineSpacing: "cozy",
  width: "normal",
};

function loadDisplayPrefs(): ReaderDisplayPrefs {
  try {
    const raw = window.localStorage.getItem(DISPLAY_STORAGE_KEY);
    return raw ? { ...DEFAULT_DISPLAY, ...JSON.parse(raw) } : { ...DEFAULT_DISPLAY };
  } catch {
    return { ...DEFAULT_DISPLAY };
  }
}

function saveDisplayPrefs(prefs: ReaderDisplayPrefs): void {
  try {
    window.localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage failures (private mode)
  }
}

export function Library({ initialArticleId, onNavigateBack: propOnNavigateBack }: LibraryProps = {}) {
  const { rtl, t } = useI18n();
  const { navigate } = useOslerRouter();
  const onNavigateBack = propOnNavigateBack || (() => navigate("learn"));

  const [tree, setTree] = React.useState<ContentTreeNode[]>([]);
  const [allArticles, setAllArticles] = React.useState<ArticleMeta[]>([]);
  const [activeFile, setActiveFile] = React.useState<string | null>(
    initialArticleId ?? null
  );
  const [activeArticle, setActiveArticle] = React.useState<Article | null>(null);
  const [bookmarks, setBookmarks] = React.useState<Set<string>>(new Set());
  const [display, setDisplay] = React.useState<ReaderDisplayPrefs>(() => {
    if (typeof window === "undefined") return { ...DEFAULT_DISPLAY };
    return loadDisplayPrefs();
  });
  const updateDisplay = React.useCallback((patch: Partial<ReaderDisplayPrefs>) => {
    setDisplay((d) => ({ ...d, ...patch }));
  }, []);

  React.useEffect(() => {
    saveDisplayPrefs(display);
  }, [display]);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  // Notes panel — opened from the reader header button or the reader.notes
  // shortcut ("n"). Shows all notes (no pack scoping on the articles page).
  const [notesOpen, setNotesOpen] = React.useState(false);

  // Register the open article for the global context menu (share / copy
  // link / export PDF). md readers own the export flow; pdf/html articles
  // register only their title.
  React.useEffect(() => {
    if (!activeArticle) return;
    const ctx = {
      title: activeArticle.title,
      specialty: activeArticle.specialty,
      link: routeFor("library", { article: activeFile ?? "" }),
      requestExportPdf: activeArticle.contentType === "md" ? () => setPdfDialogOpen(true) : undefined,
    };
    setArticleViewContext(ctx);
    return () => clearArticleViewContext(ctx);
  }, [activeArticle, activeFile]);
  const isMobile = useIsMobile();

  useShortcutListener((actionId) => {
    if (actionId === "reader.notes") {
      haptic("selection");
      setNotesOpen((o) => !o);
    }
  });

  const hlCtrl = useArticleHighlighter({
    source: "library",
    articleId: activeFile,
    enabled: true,
  });

  // Swipe-back gesture to navigate to Learn hub (disabled when an article is
  // open on mobile, or whenever a highlighter tool is active — the drag-to-
  // select gesture of text selection must never dismiss the page).
  const swipeDismissProps = useSwipeBackDismiss({
    onDismiss: () => onNavigateBack?.(),
    direction: "horizontal",
    rtl,
    disabled: (isMobile ? !!activeFile : false) || hlCtrl.tool !== null,
  });

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

  // Paint the folder tree from the manifest immediately; article metadata
  // (titles, read times) enriches the file list in the background.
  const loadLibraryData = React.useCallback(() => {
    loadArticleTree()
      .then((treeData) => {
        setTree(treeData);
        setAllArticles(articlesFromManifestTree(treeData));
      })
      .catch((e) => console.error("Failed to load article tree:", e));
    listAllArticles()
      .then(setAllArticles)
      .catch((e) => console.error("Failed to load article metadata:", e));
  }, []);

  React.useEffect(() => {
    loadLibraryData();
    const handler = () => loadLibraryData();
    window.addEventListener("osler-content-invalidated", handler);
    return () => window.removeEventListener("osler-content-invalidated", handler);
  }, [loadLibraryData]);

  // Enrich tree: turn leaf nodes with files into branch nodes with virtual children
  const displayTree = React.useMemo(() => {
    function enrich(nodes: ContentTreeNode[]): ContentTreeNode[] {
      const out: ContentTreeNode[] = [];
      for (const node of nodes) {
        // Cloud manifests group articles uploaded at the category ROOT into
        // one catch-all node titled after the category ("library", path="")
        // — explode it into individual article entries so nothing nests
        // under a pseudo folder. Real subfolders stay top-level siblings.
        if (!node.path && (node.files?.length ?? 0) > 0) {
          for (const file of node.files ?? []) {
            const meta = allArticles.find((a) => a.file === file);
            out.push({
              uid: file,
              title: meta?.title ?? file.replace(/\.(md|pdf|html)$/, "").replace(/-/g, " "),
              type: "library" as const,
              path: "",
              items: [],
            });
          }
          if (node.items.length > 0) out.push(...enrich(node.items));
          continue;
        }
        if (node.items.length === 0 && (node.files?.length ?? 0) > 0) {
          const fileChildren: ContentTreeNode[] = (node.files ?? []).map((file) => {
            const filePath = `${node.path}${file}`;
            const meta = allArticles.find((a) => a.file === filePath);
            return {
              uid: filePath,
              title: meta?.title ?? file.replace(/\.(md|pdf|html)$/, "").replace(/-/g, " "),
              type: "library" as const,
              path: node.path,
              items: [],
            };
          });
          out.push({ ...node, items: fileChildren });
          continue;
        }
        if (node.items.length > 0) {
          out.push({ ...node, items: enrich(node.items) });
          continue;
        }
        out.push(node);
      }
      return out;
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
        window.dispatchEvent(new CustomEvent("osler-bookmarks-changed"));
      }
      return next;
    });
  };

  const articleContentRef = React.useRef<HTMLDivElement>(null);

  const { theme } = useOslerTheme();

  const processedArticleHtml = React.useMemo(() => {
    if (!activeArticle) return "";
    return applyHighlightsToHtml(activeArticle.html, hlCtrl.highlights as any);
  }, [activeArticle?.html, hlCtrl.highlights, theme]);

  const [pdfDialogOpen, setPdfDialogOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);
  const reportContext: TicketContext | undefined = activeArticle
    ? { articleTitle: activeArticle.title, articleFile: activeFile ?? activeArticle.file }
    : undefined;
  const reportDialog = (
    <ReportTicketDialog open={reportOpen} onOpenChange={setReportOpen} source="library" context={reportContext} />
  );
  const onReportProblem = React.useCallback(() => {
    haptic("light");
    setReportOpen(true);
  }, []);
  const { toast } = useToast();

  // Share / copy link — canonical deep link so the URL opens this exact
  // article (`/library?article=…`). Web Share falls back to the clipboard
  // where unavailable; cancelling the share sheet is not an error.
  const articleDeepLink = React.useCallback(
    () => absoluteDeepLink(routeFor("library", { article: activeFile ?? "" })),
    [activeFile],
  );
  const handleCopyArticleLink = React.useCallback(async () => {
    haptic("light");
    try {
      await navigator.clipboard.writeText(articleDeepLink());
      toast({ title: t("contextMenu.linkCopied") });
    } catch {
      toast({ title: t("contextMenu.actionFailed"), variant: "destructive" });
    }
  }, [articleDeepLink, toast, t]);
  const handleShareArticle = React.useCallback(async () => {
    haptic("light");
    const url = articleDeepLink();
    try {
      if (navigator.share) {
        await navigator.share({ title: activeArticle?.title ?? document.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: t("contextMenu.linkCopied") });
      }
    } catch (err) {
      // Dismissing the share sheet throws AbortError — not a failure.
      if ((err as DOMException | undefined)?.name !== "AbortError") {
        toast({ title: t("contextMenu.actionFailed"), variant: "destructive" });
      }
    }
  }, [activeArticle, articleDeepLink, toast, t]);

  const handleExportArticlePdf = React.useCallback(async (opts: PdfExportOptions) => {
    if (!activeArticle) return;
    try {
      const doc = await generateArticlePdf({
        title: activeArticle.title,
        subtitle: activeArticle.specialty,
        author: opts.author,
        content: processedArticleHtml,
        opts,
      });
      downloadPdf(doc, activeArticle.title);
      toast({ title: t("pdf.pdfReady"), description: t("pdf.pdfReadyDesc") });
    } catch (err) {
      console.error("[osler/pdf] article export failed:", err);
      toast({ title: t("pdf.exportFailed"), description: String(err), variant: "destructive" });
    }
  }, [activeArticle, processedArticleHtml, toast, t]);

  // Reliable cross-platform (mouse + touch) auto-highlighting.
  //
  // We listen to `selectionchange` (debounced 350ms) instead of mouseup/
  // touchend, because `touchend` fires before iOS Safari finalises the
  // selection (the handles appear after the finger lifts), which made the
  // old 150ms-delay approach unreliable on mobile. `selectionchange` fires
  // on every selection change (mouse or touch), and the debounce ensures
  // we only act when the user has stopped adjusting — by which point the
  // selection is final.
  React.useEffect(() => {
    if (!hlCtrl.highlightMode || !activeFile) return;
    const el = articleContentRef.current;
    if (!el) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const applySelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return;

      const text = sel.toString().trim();
      if (!text) return;

      const clonedRange = range.cloneRange();
      const headRange = document.createRange();
      headRange.selectNodeContents(el);
      headRange.setEnd(clonedRange.startContainer, clonedRange.startOffset);
      const absStart = headRange.toString().length;
      const absEnd = absStart + text.length;

      hlCtrl.onAdd(
        text,
        hlCtrl.highlightColor,
        absStart >= 0 ? [{ start: absStart, end: absEnd }] : [],
      );
      sel.removeAllRanges();
    };

    const onSelectionChange = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applySelection, 350);
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      document.removeEventListener("selectionchange", onSelectionChange);
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

  const notesPanel = (
    <NotesPanel open={notesOpen} onClose={() => setNotesOpen(false)} variant="sidebar" />
  );

  // Mobile: NavigationStack with MobileHub underneath and MobileReader
  // sliding in on top when an article is open. Drag the reader back
  // (iOS-style) to close the article and return to the hub — the exact
  // same gesture as Settings, Flashcards, and QBank. The hub stays
  // mounted underneath so going back is instant (no reload).
  const mobileLayout = isMobile ? (
    <NavigationStack
      className="h-full"
      homeClassName=""
      subpageClassName=""
      rtl={rtl}
      home={
        <MobileHub
          allArticles={allArticles}
          bookmarks={bookmarks}
          bookmarkedArticles={bookmarkedArticles}
          activeFile={activeFile}
          onOpenArticle={openArticleByFile}
          onToggleBookmark={toggleBookmark}
        />
      }
      subpage={
        activeFile && activeArticle ? (
          <MobileReader
            article={activeArticle}
            articlePath={activeFile ?? ""}
            isBookmarked={bookmarks.has(activeFile)}
            onToggleBookmark={() => toggleBookmark(activeFile)}
            onBack={closeArticle}
            display={display}
            onDisplayChange={updateDisplay}
            onToggleNotes={() => setNotesOpen((o) => !o)}
            loading={loading}
            articleContentRef={articleContentRef}
            processedHtml={processedArticleHtml}
            hlCtrl={hlCtrl}
            onExportPdf={() => setPdfDialogOpen(true)}
            onReport={onReportProblem}
            onShare={handleShareArticle}
          />
        ) : null
      }
      onBack={closeArticle}
      swipeDisabled={hlCtrl.tool !== null}
    />
  ) : null;

  /* ── Render ─────────────────────────────────────────────────────────── */
  if (isMobile) {
    return (
      <>
        <motion.div
          {...swipeDismissProps}
          className="h-full"
        >
          {mobileLayout}
        </motion.div>
        <PdfExportDialog
          open={pdfDialogOpen}
          onOpenChange={setPdfDialogOpen}
          defaultTitle={activeArticle?.title ?? t("pdf.tpl.article")}
          defaultSubtitle={activeArticle?.specialty}
          variant="article"
          onExport={handleExportArticlePdf}
        />
        {notesPanel}
        {reportDialog}
      </>
    );
  }

  /* ── Desktop layout (unchanged) ─────────────────────────────────── */
  return (
    <motion.div {...swipeDismissProps} className="flex h-full overflow-hidden bg-background">
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
              transition={MOTION_SPRING.soft}
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
              display={display}
              onDisplayChange={updateDisplay}
              onToggleNotes={() => setNotesOpen((o) => !o)}
              hlCtrl={hlCtrl}
              onExportPdf={() => setPdfDialogOpen(true)}
              onReport={onReportProblem}
              onShare={handleShareArticle}
              onCopyLink={handleCopyArticleLink}
            />
            <div className="flex-1 overflow-y-auto osler-scroll osler-tabbar-pad md:pb-0 relative flex flex-col">
              {loading ? (
                <div className="flex-1 flex flex-col gap-4 p-6 max-w-3xl mx-auto w-full">
                  <Skeleton className="h-8 w-2/3 mb-2" />
                  <Skeleton className="h-4 w-1/3 mb-6" />
                  <SkeletonText lines={6} />
                  <Skeleton className="h-4 w-full mt-4" />
                  <SkeletonText lines={4} />
                </div>
              ) : activeArticle.contentType === "pdf" ? (
                <PdfViewer url={activeArticle.fileUrl!} title={activeArticle.title} />
              ) : activeArticle.contentType === "html" ? (
                <div className="flex-1 flex flex-col bg-muted/20">
                  <iframe
                    srcDoc={activeArticle.content}
                    sandbox="allow-scripts allow-same-origin allow-modals allow-popups"
                    className="w-full flex-1 border-0 bg-background"
                    title={activeArticle.title}
                  />
                </div>
              ) : (
                <motion.div
                  key={activeFile}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={MOTION_TRANSITION.normal}
                  className="relative"
                >
                  <MilkdownArticleView
                    markdown={activeArticle.content}
                    articleDir={articleDirOf(activeFile ?? "")}
                    highlights={hlCtrl.highlights}
                    contentRef={articleContentRef}
                    className={cn(
                      "library-article",
                      display.lineSpacing === "compact" && "osler-compact-spacing",
                      activeArticle?.lang === "ar" ? "osler-content-ar" : "osler-content-en",
                    )}
                    dir={activeArticle?.lang === "ar" ? "rtl" : "ltr"}
                    lang={activeArticle?.lang ?? "en"}
                    style={{
                      fontSize: `${(display.zoom / 100) * display.fontSize}px`,
                      lineHeight: LINE_HEIGHTS[display.lineSpacing],
                      fontFamily:
                        display.fontFamily === "sans"
                          ? "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
                          : undefined,
                      // Sans mode carries into headings via the CSS var
                      // (an explicit stack — CSS-wide keywords like
                      // `inherit` are invalid as custom-property values);
                      // serif mode falls back to the Playfair default.
                      "--osler-reader-heading-font":
                        display.fontFamily === "sans"
                          ? "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
                          : undefined,
                      maxWidth: display.width === "wide" ? "1200px" : undefined,
                    } as React.CSSProperties}
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

      <PdfExportDialog
        open={pdfDialogOpen}
        onOpenChange={setPdfDialogOpen}
        defaultTitle={activeArticle?.title ?? t("pdf.tpl.article")}
        defaultSubtitle={activeArticle?.specialty}
        variant="article"
        onExport={handleExportArticlePdf}
      />
      {notesPanel}
      {reportDialog}
    </motion.div>
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
}: {
  allArticles: ArticleMeta[];
  bookmarks: Set<string>;
  bookmarkedArticles: ArticleMeta[];
  activeFile: string | null;
  onOpenArticle: (file: string) => void;
  onToggleBookmark: (file: string) => void;
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

  return (
    <div className="osler-page">
      {/* Filter pills */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 max-w-xl mx-auto">
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

      <div className="px-4 pb-4">
        {filter === "all" && allArticles.length === 0 ? (
          <ComingSoonState icon={BookOpen} className="py-16" />
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="size-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {filter === "bookmarked" ? t("library.noBookmarks") : t("library.empty")}
            </p>
          </div>
        ) : (
          grouped.map(([specialty, articles]) => (
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
                      {...ctxLinkAttrs(routeFor("library", { article: a.file }), a.title)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-start transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        "bg-card border border-border hover:border-primary/30 hover:bg-primary/[0.02]",
                        a.file === activeFile && "border-primary/40 bg-primary/5",
                        a.lang === "ar" && "osler-content-ar",
                      )}
                      dir={a.lang === "ar" ? "rtl" : undefined}
                      lang={a.lang ?? undefined}
                    >
                      <div className={cn(
                        "size-10 rounded-lg flex items-center justify-center shrink-0",
                        a.contentType === "pdf"
                          ? "bg-warning-soft text-warning"
                          : "bg-primary/10 text-primary"
                      )}>
                        {a.contentType === "pdf" ? <FileText className="size-5" /> : <BookOpen className="size-5" />}
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
                      <ContentCacheButton packId={`library:${a.file}`} urls={[contentFileUrl("library", a.file)]} />
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

function MobileReader({
  article,
  articlePath,
  isBookmarked,
  onToggleBookmark,
  onBack,
  display,
  onDisplayChange,
  onToggleNotes,
  loading,
  articleContentRef,
  processedHtml,
  hlCtrl,
  onExportPdf,
  onReport,
  onShare,
}: {
  article: Article;
  articlePath: string;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  onBack: () => void;
  display: ReaderDisplayPrefs;
  onDisplayChange: (patch: Partial<ReaderDisplayPrefs>) => void;
  onToggleNotes: () => void;
  loading: boolean;
  articleContentRef: React.RefObject<HTMLDivElement | null>;
  processedHtml: string;
  hlCtrl: ReturnType<typeof useArticleHighlighter>;
  onExportPdf: () => void;
  onReport: () => void;
  onShare: () => void;
}) {
  const { t } = useI18n();
  // NOTE: The swipe-to-go-back gesture is now handled by the parent
  // NavigationStack (which wraps MobileReader as its subpage). MobileReader
  // itself no longer needs its own edge-swipe ref — the NavigationStack's
  // topmost subpage is draggable via the shared useSwipeBackDismiss hook.
  // The `rtl` prop is also no longer needed here since the parent passes
  // it to NavigationStack directly.

  // All reader actions live in the floating bottom toolbar; the top bar
  // stays title-only. The toolbar hides on scroll down and returns on
  // scroll up through the shared hide-on-scroll controller — as fixed
  // chrome it reclaims no layout space (reservePx 0).
  const toolbarHidden = useHideOnScroll(articlePath, { reservePx: 0 });
  const toolbarBtn =
    "size-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors";

  return (
    <div className="absolute inset-0 bg-background flex flex-col">
      {/* Top bar — title only; every action moved to the floating toolbar */}
      <header className="shrink-0 border-b border-border bg-card backdrop-blur-sm safe-pt relative z-20">
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
        </div>
      </header>

      {/* Content — `osler-page` puts the scroller on the shared hide-on-scroll
          controller; the bottom padding clears the floating toolbar (plus the
          safe area) so the pill never covers the end of the article. */}
      <div
        className="flex-1 osler-page osler-scroll flex flex-col"
        style={{
          touchAction: "pan-y",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5.25rem)",
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : article.contentType === "pdf" ? (
          <PdfViewer url={article.fileUrl!} title={article.title} />
        ) : article.contentType === "html" ? (
          <div className="flex-1 flex flex-col bg-muted/20">
            <iframe
              srcDoc={article.content}
              sandbox="allow-scripts allow-same-origin allow-modals allow-popups"
              className="w-full flex-1 border-0 bg-background"
              title={article.title}
            />
          </div>
        ) : (
          <motion.div
            key={article.file}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={MOTION_TRANSITION.normal}
            className="py-5"
          >
            {/* Title at top of content */}
            <h1 className="text-xl font-bold mb-1">{article.title}</h1>
            <MilkdownArticleView
              markdown={article.content}
              articleDir={articleDirOf(articlePath)}
              highlights={hlCtrl.highlights}
              contentRef={articleContentRef}
              className={cn(
                "library-article px-4",
                display.lineSpacing === "compact" && "osler-compact-spacing",
                article.lang === "ar" ? "osler-content-ar" : "osler-content-en",
              )}
              dir={article.lang === "ar" ? "rtl" : "ltr"}
              lang={article.lang ?? "en"}
              style={{
                fontSize: `${(display.zoom / 100) * display.fontSize}px`,
                lineHeight: LINE_HEIGHTS[display.lineSpacing],
                fontFamily:
                  display.fontFamily === "sans"
                    ? "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
                    : undefined,
                "--osler-reader-heading-font":
                  display.fontFamily === "sans"
                    ? "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
                    : undefined,
              } as React.CSSProperties}
            />
          </motion.div>
        )}
      </div>

      {/* Floating reader toolbar — every action in one thumb-reachable pill
          while the top bar stays title-only. Slides away on scroll down and
          returns on scroll up (the platform-standard reading pattern); the
          outer frame only centers, so the pill's enter/exit transform never
          fights the centering. */}
      <AnimatePresence>
        {!toolbarHidden && (
          <motion.div
            initial={{ y: 64, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 64, opacity: 0 }}
            transition={MOTION_TRANSITION.quick}
            className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+0.625rem)] z-30 flex justify-center pointer-events-none"
          >
            <nav
              aria-label={t("library.readerToolbar")}
              className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-card/95 backdrop-blur-md shadow-e3 p-1"
            >
              <DisplayMenu display={display} onChange={onDisplayChange} buttonClassName={toolbarBtn} />

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

              <button onClick={onShare} className={toolbarBtn} title={t("contextMenu.share")} aria-label={t("contextMenu.share")}>
                <Share2 className="size-4" />
              </button>

              <button onClick={onToggleNotes} className={toolbarBtn} title={t("qbank.notes.title")} aria-label={t("qbank.notes.title")}>
                <NotebookPen className="size-4" />
              </button>

              {article.contentType === "md" && (
                <button onClick={onExportPdf} className={toolbarBtn} title={t("pdf.exportResults")} aria-label={t("pdf.exportResults")}>
                  <Printer className="size-4" />
                </button>
              )}

              {article.fileUrl && article.contentType === "pdf" && (
                <a
                  href={article.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={toolbarBtn}
                  title={t("library.pdfOpen")}
                  aria-label={t("library.pdfOpen")}
                >
                  <ExternalLink className="size-4" />
                </a>
              )}

              <button onClick={onReport} className={toolbarBtn} title={t("support.reportProblem")} aria-label={t("support.reportProblem")}>
                <MessageSquareWarning className="size-4" />
              </button>

              <button
                onClick={onToggleBookmark}
                className={cn(
                  "size-9 rounded-full flex items-center justify-center transition-colors",
                  isBookmarked
                    ? "text-primary bg-primary/15 hover:bg-primary/25"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
                title={isBookmarked ? t("article.bookmarkRemove") : t("article.bookmarkAdd")}
                aria-label={isBookmarked ? t("article.bookmarkRemove") : t("article.bookmarkAdd")}
                aria-pressed={isBookmarked}
              >
                {isBookmarked ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
              </button>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
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
      </div>

      <div className="flex-1 overflow-y-auto osler-scroll p-2 space-y-0.5 osler-tabbar-pad md:pb-2">
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
                {...ctxLinkAttrs(routeFor("library", { article: a.file }), a.title)}
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
          <FolderTreeNav
            tree={tree}
            selected={activeFile}
            onSelect={(node) => onOpenArticle(node.uid)}
          />
        )}
      </div>

      <div className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground flex items-center justify-between">
        <span>{articleCount} articles</span>
        <span>{bookmarks.size} bookmarked</span>
      </div>
    </div>
  );
}

/* ── Unified display menu ────────────────────────────────────────── */
/* One popover for everything that shapes the article reading surface:
 * text size, zoom, typeface, line spacing and reading width. */

function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function StepperButton({
  onClick,
  disabled,
  children,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="size-7 rounded-md bg-muted hover:bg-muted/70 disabled:opacity-40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function DisplayPills<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="flex gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => {
            if (opt.value === value) return;
            haptic("selection");
            onChange(opt.value);
          }}
          className={cn(
            "flex-1 h-7 rounded-md text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-primary/15 text-primary border border-primary/30"
              : "bg-muted/60 text-muted-foreground hover:text-foreground border border-transparent",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function DisplayMenu({
  display,
  onChange,
  buttonClassName = "osler-icon-btn size-8",
}: {
  display: ReaderDisplayPrefs;
  onChange: (patch: Partial<ReaderDisplayPrefs>) => void;
  /** Button styling override (mobile header uses a larger touch target). */
  buttonClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const { t } = useI18n();
  // Reading width is a desktop-only control — on phones the column is the
  // viewport, so the option does nothing.
  const isMobile = useIsMobile();

  // Radix Popover portals the panel to <body>, so it escapes the header's
  // backdrop-blur stacking context — the article body can no longer paint
  // over the menu (the old absolute-positioned panel sat underneath it).
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          onClick={() => haptic("selection")}
          className={buttonClassName}
          title={t("library.display")}
          aria-label={t("library.display")}
          aria-expanded={open}
        >
          <Type className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-64 space-y-3.5 rounded-xl p-3.5"
        role="dialog"
        aria-label={t("library.display")}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Text size */}
        <div className="space-y-1.5">
          <MenuLabel>{t("library.fontSize")}</MenuLabel>
          <div className="flex items-center gap-2">
            <StepperButton
              onClick={() => { haptic("selection"); onChange({ fontSize: Math.max(12, display.fontSize - 1) }); }}
              disabled={display.fontSize <= 12}
              label={t("library.textSizeDecrease")}
            >
              <Minus className="size-3.5" />
            </StepperButton>
            <span className="text-xs font-mono tabular-nums flex-1 text-center">
              {display.fontSize}px
            </span>
            <StepperButton
              onClick={() => { haptic("selection"); onChange({ fontSize: Math.min(22, display.fontSize + 1) }); }}
              disabled={display.fontSize >= 22}
              label={t("library.textSizeIncrease")}
            >
              <PlusIcon className="size-3.5" />
            </StepperButton>
          </div>
        </div>

        {/* Zoom */}
        <div className="space-y-1.5">
          <MenuLabel>{t("library.zoom")}</MenuLabel>
          <div className="flex items-center gap-2">
            <StepperButton
              onClick={() => { haptic("selection"); onChange({ zoom: Math.max(80, display.zoom - 10) }); }}
              disabled={display.zoom <= 80}
              label={t("library.zoomOut")}
            >
              <ZoomOut className="size-3.5" />
            </StepperButton>
            <button
              type="button"
              onClick={() => { haptic("selection"); onChange({ zoom: 100 }); }}
              disabled={display.zoom === 100}
              className="flex-1 h-7 rounded-md text-xs font-mono tabular-nums hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:hover:bg-transparent"
              title={t("library.zoomReset")}
            >
              {display.zoom}%
            </button>
            <StepperButton
              onClick={() => { haptic("selection"); onChange({ zoom: Math.min(140, display.zoom + 10) }); }}
              disabled={display.zoom >= 140}
              label={t("library.zoomIn")}
            >
              <ZoomIn className="size-3.5" />
            </StepperButton>
          </div>
        </div>

        {/* Typeface */}
        <div className="space-y-1.5">
          <MenuLabel>{t("library.fontFamily")}</MenuLabel>
          <DisplayPills
            value={display.fontFamily}
            onChange={(v) => onChange({ fontFamily: v })}
            options={[
              { value: "serif" as const, label: t("library.fontSerif") },
              { value: "sans" as const, label: t("library.fontSans") },
            ]}
          />
        </div>

        {/* Line spacing */}
        <div className="space-y-1.5">
          <MenuLabel>{t("library.lineSpacing")}</MenuLabel>
          <DisplayPills
            value={display.lineSpacing}
            onChange={(v) => onChange({ lineSpacing: v })}
            options={[
              { value: "compact" as const, label: t("library.lineSpacing.compact") },
              { value: "cozy" as const, label: t("library.lineSpacing.cozy") },
              { value: "relaxed" as const, label: t("library.lineSpacing.relaxed") },
            ]}
          />
        </div>

        {/* Reading width — desktop only (on phones the column is the viewport) */}
        {!isMobile && (
          <div className="space-y-1.5">
            <MenuLabel>{t("library.readingWidth")}</MenuLabel>
            <DisplayPills
              value={display.width}
              onChange={(v) => onChange({ width: v })}
              options={[
                { value: "normal" as const, label: t("library.readingWidth.normal") },
                { value: "wide" as const, label: t("library.readingWidth.wide") },
              ]}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ArticleHeader({
  article,
  isBookmarked,
  onToggleBookmark,
  display,
  onDisplayChange,
  onToggleNotes,
  hlCtrl,
  onExportPdf,
  onReport,
  onShare,
  onCopyLink,
}: {
  article: Article;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  display: ReaderDisplayPrefs;
  onDisplayChange: (patch: Partial<ReaderDisplayPrefs>) => void;
  onToggleNotes: () => void;
  hlCtrl: ReturnType<typeof useArticleHighlighter>;
  onExportPdf: () => void;
  onReport: () => void;
  onShare: () => void;
  onCopyLink: () => void;
}) {
  const { t } = useI18n();

  return (
    <header className="shrink-0 h-12 flex items-center px-3 sm:px-4 gap-2 border-b border-border bg-card/60 backdrop-blur-md safe-pt relative z-20">
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

        {article.contentType === "md" && (
          <>
            <DisplayMenu display={display} onChange={onDisplayChange} />

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
          </>
        )}

        <button
          onClick={onShare}
          className="osler-icon-btn size-8"
          title={t("contextMenu.share")}
          aria-label={t("contextMenu.share")}
        >
          <Share2 className="size-4" />
        </button>

        <button
          onClick={onCopyLink}
          className="osler-icon-btn size-8"
          title={t("contextMenu.copyLink")}
          aria-label={t("contextMenu.copyLink")}
        >
          <Link2 className="size-4" />
        </button>

        <button
          onClick={onToggleNotes}
          className="osler-icon-btn size-8"
          title={t("qbank.notes.title")}
          aria-label={t("qbank.notes.title")}
        >
          <NotebookPen className="size-4" />
        </button>

        {article.contentType === "md" && (
          <button
            onClick={onExportPdf}
            className="osler-icon-btn size-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={t("pdf.exportResults")}
          >
            <Printer className="size-4" />
          </button>
        )}

        {article.fileUrl && article.contentType === "pdf" && (
          <a
            href={article.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="osler-icon-btn size-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={t("library.pdfOpen")}
          >
            <ExternalLink className="size-4" />
          </a>
        )}

        <button
          onClick={onReport}
          className="osler-icon-btn size-8"
          title={t("support.reportProblem")}
          aria-label={t("support.reportProblem")}
        >
          <MessageSquareWarning className="size-4" />
        </button>

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
/* Composes the shared `EmptyState` primitive (icon + title + body +
 * staggered entrance, same as QBank/Flashcards) and adds a Library-specific
 * "popular articles" quick-open grid via the `actions` slot, per the
 * roadmap's rule that product-specific compositions extend the shared
 * primitive rather than re-implementing it locally. */

function EmptyState({
  onOpen,
  allArticles,
}: {
  onOpen: (file: string) => void;
  allArticles: ArticleMeta[];
}) {
  const { t } = useI18n();
  const popular = allArticles.slice(0, 6);
  if (allArticles.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <ComingSoonState icon={LibraryIcon} />
      </div>
    );
  }
  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <SharedEmptyState
        icon={LibraryIcon}
        title={t("library.emptyTitle")}
        description={t("library.emptyDesc")}
        actions={
          popular.length > 0 && (
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
          )
        }
      />
    </div>
  );
}
