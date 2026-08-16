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
  BookmarkX,
  ArrowLeft,
  FileText,
  Printer,
  Maximize2,
  Minimize2,
  Code2,
  ExternalLink,
  Download,
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
import { SkeletonText, EmptyState as SharedEmptyState } from "./ui-primitives";
import { useIsMobile } from "@/hooks/use-mobile";
import { useArticleHighlighter } from "@/hooks/use-article-highlighter";
import { useOslerTheme } from "./theme-provider";
import { useI18n } from "./i18n-provider";
import { useLightbox } from "./lightbox-provider";
import { HighlighterToolbar } from "./highlighter-toolbar";
import { ContentCacheButton } from "./content-cache-button";
import { FolderTreeNav } from "./folder-tree-nav";
import { NavigationStack } from "./navigation-stack";
import { applyHighlightsToHtml } from "@/lib/osler/article-highlights";
import { setImmersiveMode } from "./immersive-mode";
import { MermaidModal } from "./mermaid-modal";
import { haptic } from "@/lib/osler/native";
import { useToast } from "@/hooks/use-toast";
import { PdfExportDialog, type PdfExportOptions } from "./pdf-export-dialog";
import { generateArticlePdf, downloadPdf } from "@/lib/osler/pdf";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";

import { useOslerRouter } from "@/lib/osler/navigation";

interface LibraryProps {
  initialArticleId?: string;
  /** Called when the user swipes back to navigate to the Learn hub. */
  onNavigateBack?: () => void;
}

type SidebarTab = "toc" | "bookmarks";

const BOOKMARKS_KEY = "osler-article-bookmarks";

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
  const [zoom, setZoom] = React.useState(100);
  const [fontSize, setFontSize] = React.useState(15);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const isMobile = useIsMobile();

  // Swipe-back gesture to navigate to Learn hub (disabled when an article is open on mobile)
  const swipeDismissProps = useSwipeBackDismiss({
    onDismiss: () => onNavigateBack?.(),
    direction: "horizontal",
    rtl,
    disabled: isMobile ? !!activeFile : false,
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

  const hlCtrl = useArticleHighlighter({
    source: "library",
    articleId: activeFile,
    enabled: true,
  });

  // Paint the folder tree from the manifest immediately; article metadata
  // (titles, read times) enriches the file list in the background.
  React.useEffect(() => {
    loadArticleTree()
      .then((treeData) => {
        setTree(treeData);
        // Seed the list from the manifest so it paints instantly, then the
        // background metadata load replaces it with real frontmatter titles.
        setAllArticles(articlesFromManifestTree(treeData));
      })
      .catch((e) => console.error("Failed to load article tree:", e));
    listAllArticles()
      .then(setAllArticles)
      .catch((e) => console.error("Failed to load article metadata:", e));
  }, []);

  // Enrich tree: turn leaf nodes with files into branch nodes with virtual children
  const displayTree = React.useMemo(() => {
    function enrich(nodes: ContentTreeNode[]): ContentTreeNode[] {
      return nodes.map((node) => {
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

  // Mermaid modal state
  const [mermaidModal, setMermaidModal] = React.useState<{ svg: string; title?: string } | null>(null);

  // Print article handler — opens a clean print window
  const printArticle = React.useCallback(() => {
    if (!activeArticle) return;
    haptic("light");
    // Inject a minimal print-only page that shows just the article title block + content
    const printHtml = `<!DOCTYPE html>
<html lang="${activeArticle.lang ?? "en"}" dir="${activeArticle.lang === "ar" ? "rtl" : "ltr"}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${activeArticle.title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11pt; color: #1a1a1a; background: #fff; }
    body { max-width: 760px; margin: 0 auto; padding: 1.5cm 1cm; }
    .title-block { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 2px solid #1a1a1a; }
    .title-block h1 { font-size: 22pt; font-weight: 700; margin-bottom: 0.3rem; }
    .title-block .meta { font-size: 9pt; color: #555; }
    .title-block .meta span + span::before { content: ' · '; }
    h1 { font-size: 18pt; font-weight: 700; margin: 1.2rem 0 0.5rem; page-break-after: avoid; }
    h2 { font-size: 14pt; font-weight: 600; margin: 1rem 0 0.4rem; page-break-after: avoid; border-bottom: 1px solid #ddd; padding-bottom: 3pt; }
    h3 { font-size: 12pt; font-weight: 600; margin: 0.8rem 0 0.3rem; page-break-after: avoid; }
    p { margin: 0.55rem 0; line-height: 1.6; }
    ul, ol { padding-left: 1.4rem; margin: 0.5rem 0; }
    li { margin: 0.2rem 0; }
    strong { font-weight: 600; }
    em { font-style: italic; color: #333; }
    a { color: #1a1a1a; text-decoration: underline; }
    code { font-family: monospace; background: #f4f4f4; border: 1px solid #ddd; padding: 1px 4px; font-size: 9pt; border-radius: 3px; }
    pre { background: #f4f4f4; border: 1px solid #ddd; padding: 0.5rem; margin: 0.5rem 0; white-space: pre-wrap; font-size: 9pt; page-break-inside: avoid; border-radius: 4px; }
    blockquote { border-left: 3px solid #555; background: #f8f8f8; margin: 0.75rem 0; padding: 0.5rem 1rem; page-break-inside: avoid; }
    table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; page-break-inside: avoid; }
    th, td { border: 1px solid #ccc; padding: 4pt 6pt; font-size: 9pt; text-align: left; }
    th { background: #f0f0f0; font-weight: 600; }
    img { max-width: 100%; page-break-inside: avoid; }
    .osler-mermaid-toolbar { display: none; }
    @page { margin: 1.5cm; }
  </style>
</head>
<body>
  <div class="title-block">
    <h1>${activeArticle.title}</h1>
    <div class="meta">
      ${activeArticle.specialty ? `<span>${activeArticle.specialty}</span>` : ""}
      ${activeArticle.system ? `<span>${activeArticle.system}</span>` : ""}
      ${activeArticle.readTimeMin ? `<span>${activeArticle.readTimeMin} min read</span>` : ""}
      ${activeArticle.tags?.length ? `<span>${activeArticle.tags.join(", ")}</span>` : ""}
      <span>Printed ${new Date().toLocaleDateString()}</span>
    </div>
  </div>
  <div class="article-body">${processedArticleHtml}</div>
</body>
</html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(printHtml);
    win.document.close();
    win.focus();
    // Small delay so images load before print dialog
    setTimeout(() => { win.print(); win.close(); }, 400);
  }, [activeArticle, processedArticleHtml]);

  const [pdfDialogOpen, setPdfDialogOpen] = React.useState(false);
  const { toast } = useToast();
  const handleExportArticlePdf = React.useCallback(async (opts: PdfExportOptions) => {
    if (!activeArticle) return;
    const doc = generateArticlePdf({
      title: activeArticle.title,
      subtitle: activeArticle.specialty,
      author: opts.author,
      content: processedArticleHtml,
      opts,
    });
    downloadPdf(doc, activeArticle.title);
    toast({ title: t("pdf.pdfReady"), description: t("pdf.pdfReadyDesc") });
  }, [activeArticle, processedArticleHtml, toast]);

  // Mermaid post-processing: find placeholders, dynamically render SVG
  React.useEffect(() => {
    if (!activeArticle || activeArticle.contentType !== "md") return;
    const el = articleContentRef.current;
    if (!el) return;

    const placeholders = Array.from(el.querySelectorAll<HTMLElement>(".osler-mermaid[data-diagram]"));
    if (placeholders.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const isDark = document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? "dark" : "default",
          securityLevel: "loose",
          fontFamily: "inherit",
        });

        for (let i = 0; i < placeholders.length; i++) {
          if (cancelled) break;
          const placeholder = placeholders[i];
          const encoded = placeholder.getAttribute("data-diagram");
          if (!encoded) continue;
          const diagram = decodeURIComponent(encoded);

          // Build the card structure
          const inner = document.createElement("div");
          inner.className = "osler-mermaid-inner";
          const toolbar = document.createElement("div");
          toolbar.className = "osler-mermaid-toolbar";

          try {
            const id = `osler-mermaid-${i}-${Date.now()}`;
            const { svg } = await mermaid.render(id, diagram);
            inner.innerHTML = svg;

            // Expand button
            const expandBtn = document.createElement("button");
            expandBtn.className = "osler-icon-btn size-7 text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors";
            expandBtn.title = "Explore diagram";
            expandBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg><span style="font-size:11px">Explore</span>`;
            const svgSnapshot = svg;
            expandBtn.addEventListener("click", () => {
              setMermaidModal({ svg: svgSnapshot });
            });
            toolbar.appendChild(expandBtn);
          } catch {
            inner.innerHTML = `<div class="osler-mermaid-error">Failed to render diagram</div>`;
          }

          placeholder.innerHTML = "";
          placeholder.appendChild(inner);
          placeholder.appendChild(toolbar);
          // Remove the data-diagram attr so re-renders don't re-process
          placeholder.removeAttribute("data-diagram");
        }
      } catch {
        // mermaid import failed — silently skip
      }
    })();

    return () => { cancelled = true; };
  }, [processedArticleHtml, theme]);

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
            onPrint={printArticle}
            onExportPdf={() => setPdfDialogOpen(true)}
          />
        ) : null
      }
      onBack={closeArticle}
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
          <AnimatePresence>
            {mermaidModal && (
              <MermaidModal
                svg={mermaidModal.svg}
                title={mermaidModal.title || activeArticle?.title}
                onClose={() => setMermaidModal(null)}
              />
            )}
          </AnimatePresence>
        </motion.div>
        <PdfExportDialog
          open={pdfDialogOpen}
          onOpenChange={setPdfDialogOpen}
          defaultTitle={activeArticle?.title ?? "Article"}
          defaultSubtitle={activeArticle?.specialty}
          variant="quiz"
          onExport={handleExportArticlePdf}
        />
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
              zoom={zoom}
              onZoomIn={() => setZoom((z) => Math.min(140, z + 10))}
              onZoomOut={() => setZoom((z) => Math.max(80, z - 10))}
              onResetZoom={() => setZoom(100)}
              fontSize={fontSize}
              onFontSizeChange={setFontSize}
              hlCtrl={hlCtrl}
              onPrint={printArticle}
              onExportPdf={() => setPdfDialogOpen(true)}
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

      <AnimatePresence>
        {mermaidModal && (
          <MermaidModal
            svg={mermaidModal.svg}
            title={mermaidModal.title || activeArticle?.title}
            onClose={() => setMermaidModal(null)}
          />
        )}
      </AnimatePresence>

      <PdfExportDialog
        open={pdfDialogOpen}
        onOpenChange={setPdfDialogOpen}
        defaultTitle={activeArticle?.title ?? "Article"}
        defaultSubtitle={activeArticle?.specialty}
        variant="quiz"
        onExport={handleExportArticlePdf}
      />
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
        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="size-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {filter === "bookmarked"
                ? t("library.noBookmarks")
                : t("library.empty")}
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
  onPrint,
  onExportPdf,
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
  onPrint: () => void;
  onExportPdf: () => void;
}) {
  const [fontPopoverOpen, setFontPopoverOpen] = React.useState(false);
  const { t } = useI18n();
  // NOTE: The swipe-to-go-back gesture is now handled by the parent
  // NavigationStack (which wraps MobileReader as its subpage). MobileReader
  // itself no longer needs its own edge-swipe ref — the NavigationStack's
  // topmost subpage is draggable via the shared useSwipeBackDismiss hook.
  // The `rtl` prop is also no longer needed here since the parent passes
  // it to NavigationStack directly.

  return (
    <div className="absolute inset-0 bg-background flex flex-col">
      {/* Top bar */}
      <header className="shrink-0 border-b border-border bg-card backdrop-blur-sm safe-pt">
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
            
            {article.contentType === "md" && (
              <>
                <button
                  onClick={onPrint}
                  className="size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  title={t("library.print")}
                >
                  <Printer className="size-4" />
                </button>
                <button
                  onClick={onExportPdf}
                  className="size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  title={t("pdf.exportResults")}
                >
                  <FileText className="size-4" />
                </button>
              </>
            )}

            {article.fileUrl && article.contentType === "pdf" && (
              <a
                href={article.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                title={t("library.pdfOpen")}
              >
                <ExternalLink className="size-4" />
              </a>
            )}

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

        {/* Zoom controls row — only for markdown articles */}
        {article.contentType === "md" && (
          <div className="flex items-center justify-between px-3 pb-2 border-b border-border">
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
        )}
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto osler-scroll safe-pb flex flex-col" style={{ touchAction: "pan-y" }}>
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
  onPrint,
  onExportPdf,
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
  onPrint: () => void;
  onExportPdf: () => void;
}) {
  const [fontPopoverOpen, setFontPopoverOpen] = React.useState(false);
  const { t } = useI18n();

  return (
    <header className="shrink-0 h-12 flex items-center px-3 sm:px-4 gap-2 border-b border-border bg-card/60 backdrop-blur-md safe-pt">
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
          </>
        )}

        {article.contentType === "md" && (
          <>
            <button
              onClick={onPrint}
              className="osler-icon-btn size-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title={t("library.print")}
            >
              <Printer className="size-4" />
            </button>
            <button
              onClick={onExportPdf}
              className="osler-icon-btn size-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title={t("pdf.exportResults")}
            >
              <FileText className="size-4" />
            </button>
          </>
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

/* ── PDF Viewer ──────────────────────────────────────────────────── */

function PdfViewer({ url, title }: { url: string; title: string }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();

  if (isMobile) {
    // iOS Safari and most mobile browsers don't render PDFs in iframes.
    // Show a clear CTA to open/download instead.
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 gap-6 bg-muted/20">
        <div className="w-20 h-20 rounded-2xl bg-warning-soft text-warning flex items-center justify-center">
          <FileText className="size-10" />
        </div>
        <div className="text-center max-w-xs">
          <h2 className="text-base font-semibold mb-1">{title}</h2>
          <p className="text-sm text-muted-foreground">{t("library.pdfOpenDesc")}</p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90"
            onClick={() => haptic("light")}
          >
            <ExternalLink className="size-4" />
            {t("library.pdfOpen")}
          </a>
          <a
            href={url}
            download
            className="flex items-center justify-center gap-2 h-11 rounded-xl bg-muted text-foreground text-sm font-medium transition-colors hover:bg-muted/70"
            onClick={() => haptic("light")}
          >
            <Download className="size-4" />
            {t("library.pdfDownload")}
          </a>
        </div>
      </div>
    );
  }

  // Desktop: native browser PDF rendering via iframe
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-border bg-card/60 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="size-3.5 text-warning" />
          <span className="font-medium">{t("library.pdfViewer")}</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={url}
            download
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            title={t("library.pdfDownload")}
          >
            <Download className="size-3" />
            {t("library.pdfDownload")}
          </a>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
          >
            <ExternalLink className="size-3" />
            {t("library.pdfOpen")}
          </a>
        </div>
      </div>
      <iframe
        src={url}
        className="w-full flex-1 border-0 bg-background"
        title={title}
      />
    </div>
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
