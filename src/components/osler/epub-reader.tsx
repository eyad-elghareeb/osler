"use client";

import * as React from "react";
import { List, ChevronLeft, ChevronRight, BookOpen, RotateCcw } from "lucide-react";
import type { Book, Contents, Location, Rendition } from "epubjs";
import { openEpubBook, type EpubMetadata, type EpubTocEntry } from "@/lib/osler/epub";
import { settings } from "@/lib/osler/storage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, LoadingState } from "./ui-primitives";
import { haptic } from "@/lib/osler/native";
import { useI18n } from "./i18n-provider";

/**
 * In-reader book viewer for EPUB library articles, powered by `epubjs`
 * (rendering, spine navigation, TOC, CFI locations) under Osler chrome
 * (progress hairline, TOC drawer, chapter footer, persisted position).
 *
 * The book's typography inherits the library reader's display prefs and the
 * live app theme: palette values are read from the CSS design tokens at
 * runtime (never hardcoded) and re-applied whenever the `<html>` theme
 * class changes. The reading position is a CFI kept in the synced settings
 * store, so it follows the user across devices.
 *
 * Security notes: the rendition runs with `allowScriptedContent: false`,
 * so epubjs sandboxes every section iframe without script rights — publisher
 * JavaScript is inert by construction. Publisher stylesheets served as
 * blob: links are intentionally NOT allow-listed in the deployed CSP
 * (`style-src 'self'`), so books fall back to the injected Osler theme;
 * `frame-src blob:` IS allow-listed (public/_headers) because the section
 * iframes themselves need it.
 */

interface EpubReaderProps {
  /** Direct URL of the `.epub` archive (Worker R2 or bundled file). */
  fileUrl: string;
  /** Article file path — scopes the saved reading position. */
  fileKey: string;
  /** Fallback title until the OPF metadata loads. */
  title: string;
  /** Base font size in px (library reader display prefs). */
  fontSize: number;
  /** Line height multiplier (library reader display prefs). */
  lineHeight: number;
  /** Content max width in px (library reader display prefs). */
  maxWidth?: number;
  /** Font stack override (library reader sans mode); serif default. */
  fontFamily?: string;
}

interface ReaderPosition {
  index: number;
  href: string;
  atStart: boolean;
  atEnd: boolean;
}

function progressKey(fileKey: string): string {
  return `epub-progress:${fileKey}`;
}

/** Live app palette from the CSS design tokens (theme-aware, never hardcoded). */
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    fg: v("--foreground", "#111827"),
    primary: v("--primary", "#1d4ed8"),
    fontSerif: v("--font-serif", "Georgia, serif"),
  };
}

function normalizeHref(href: string): string {
  return href.split("#")[0].replace(/^\.\//, "").replace(/^\/+/, "");
}

export function EpubReader({ fileUrl, fileKey, title, fontSize, lineHeight, maxWidth, fontFamily }: EpubReaderProps) {
  const { t, rtl } = useI18n();
  const [meta, setMeta] = React.useState<EpubMetadata | null>(null);
  const [toc, setToc] = React.useState<EpubTocEntry[]>([]);
  const [spineLength, setSpineLength] = React.useState(0);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [tocOpen, setTocOpen] = React.useState(false);
  const [pos, setPos] = React.useState<ReaderPosition>({ index: 0, href: "", atStart: true, atEnd: false });
  const [reloadNonce, setReloadNonce] = React.useState(0);
  // Re-apply the theme whenever the `<html>` theme class flips (Settings →
  // Appearance) so the iframe inherits dark/light without reopening the book.
  const [themeNonce, setThemeNonce] = React.useState(0);

  const stageRef = React.useRef<HTMLDivElement>(null);
  const bookRef = React.useRef<{ book: Book; destroy: () => void } | null>(null);
  const renditionRef = React.useRef<Rendition | null>(null);
  const layoutRef = React.useRef<Record<string, Record<string, string>>>({});

  React.useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setThemeNonce((n) => n + 1));
    obs.observe(el, { attributes: true, attributeFilter: ["class", "style"] });
    return () => obs.disconnect();
  }, []);

  // Latest typography for the content hook (fires per newly shown section).
  const typo = React.useMemo(
    () => ({ fontSize, lineHeight, maxWidth: maxWidth ?? 768, fontFamily }),
    [fontSize, lineHeight, maxWidth, fontFamily],
  );
  const typoRef = React.useRef(typo);
  typoRef.current = typo;

  const layoutRules = React.useCallback((): Record<string, Record<string, string>> => {
    const cur = typoRef.current;
    return {
      body: {
        "line-height": `${cur.lineHeight} !important`,
        "font-family": `${cur.fontFamily ?? readPalette().fontSerif} !important`,
        "max-width": `${cur.maxWidth}px !important`,
        margin: "0 auto !important",
        padding: "0 6px !important",
      },
      img: { "max-width": "100% !important", height: "auto !important" },
      svg: { "max-width": "100% !important", height: "auto !important" },
      table: { "max-width": "100% !important" },
    };
  }, []);

  // Open the book + boot the rendition. A new fileKey/fileUrl (or retry)
  // tears the previous rendition down first so blob URLs can't leak.
  React.useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setToc([]);
    setSpineLength(0);
    setFailed(null);
    setReady(false);
    setPos({ index: 0, href: "", atStart: true, atEnd: false });

    (async () => {
      const stage = stageRef.current;
      if (!stage) return;
      try {
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const opened = await openEpubBook(buf);
        if (cancelled) {
          opened.destroy();
          return;
        }
        bookRef.current = opened;
        setMeta(opened.metadata);
        setToc(opened.toc);
        setSpineLength(opened.spineLength);

        const rendition = opened.book.renderTo(stage, {
          width: "100%",
          height: "100%",
          flow: "scrolled-doc",
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;

        // Osler reader theme inside the iframe: palette from the live CSS
        // tokens; layout from the library display prefs.
        const palette = readPalette();
        rendition.themes.register("osler", {
          body: {
            color: `${palette.fg} !important`,
            background: "transparent !important",
          },
          "h1, h2, h3, h4, h5, h6": { color: `${palette.fg} !important` },
          a: { color: `${palette.primary} !important` },
        });
        rendition.themes.select("osler");
        rendition.themes.fontSize(`${typoRef.current.fontSize}px`);
        layoutRef.current = layoutRules();
        rendition.hooks.content.register((contents: Contents) => {
          void contents.addStylesheetRules(layoutRef.current, "osler-layout");
          // External links leave the book in a new tab; internal spine
          // links are intercepted by the rendition itself.
          const onClick = (e: Event) => {
            const anchor = (e.target as Element | null)?.closest?.("a[href]");
            const href = anchor?.getAttribute("href") ?? "";
            if (/^(https?:|mailto:|tel:)/i.test(href)) {
              e.preventDefault();
              e.stopPropagation();
              window.open(href, "_blank", "noopener");
            }
          };
          contents.document.addEventListener("click", onClick);
        });

        rendition.on("relocated", (loc: Location) => {
          const cfi = loc?.start?.cfi;
          if (typeof cfi === "string" && cfi) {
            void settings.set(progressKey(fileKey), JSON.stringify({ cfi, updatedAt: Date.now() })).catch(() => {});
          }
          // First relocation means content is on screen — deterministic
          // loader gate (no dependence on auxiliary rendition events).
          if (!cancelled) setReady(true);
          setPos({
            index: typeof loc?.start?.index === "number" ? loc.start.index : 0,
            href: typeof loc?.start?.href === "string" ? loc.start.href : "",
            atStart: !!loc?.atStart,
            atEnd: !!loc?.atEnd,
          });
        });

        let savedCfi: string | null = null;
        try {
          const raw = await settings.get(progressKey(fileKey));
          const parsed = raw ? (JSON.parse(raw) as { cfi?: unknown }) : null;
          if (parsed && typeof parsed.cfi === "string" && parsed.cfi) savedCfi = parsed.cfi;
        } catch {
          savedCfi = null;
        }
        if (cancelled) return;
        try {
          if (savedCfi) await rendition.display(savedCfi);
          else await rendition.display();
        } catch {
          // A stale CFI (republished book) falls back to the opening page.
          if (!cancelled) await rendition.display().catch(() => {});
        }
        // Reflow text width when the stage resizes (rotation, split view).
        // The continuous manager doesn't observe this itself.
        const onResize = () => {
          const box = stage.getBoundingClientRect();
          if (box.width > 0 && box.height > 0) {
            try {
              rendition.resize(Math.round(box.width), Math.round(box.height));
            } catch {
              // resize races teardown — harmless
            }
          }
        };
        const resizeObs = new ResizeObserver(onResize);
        resizeObs.observe(stage);
        if (cancelled) resizeObs.disconnect();
        else (rendition as unknown as { __resizeObs?: ResizeObserver }).__resizeObs = resizeObs;
      } catch (err) {
        if (!cancelled) setFailed(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      try {
        const rendition = renditionRef.current as unknown as { __resizeObs?: ResizeObserver } | null;
        rendition?.__resizeObs?.disconnect();
      } catch {
        // ignore teardown failures during unmount
      }
      renditionRef.current = null;
      try {
        bookRef.current?.destroy();
      } catch {
        // ignore teardown failures during unmount
      }
      bookRef.current = null;
      if (stageRef.current) stageRef.current.innerHTML = "";
    };
  }, [fileUrl, fileKey, reloadNonce, layoutRules]);

  // Live typography + theme updates on the mounted rendition.
  React.useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !meta) return;
    const palette = readPalette();
    try {
      rendition.themes.register("osler", {
        body: { color: `${palette.fg} !important`, background: "transparent !important" },
        "h1, h2, h3, h4, h5, h6": { color: `${palette.fg} !important` },
        a: { color: `${palette.primary} !important` },
      });
      rendition.themes.select("osler");
      rendition.themes.fontSize(`${typo.fontSize}px`);
    } catch {
      // theme re-apply races teardown — harmless
    }
    layoutRef.current = layoutRules();
    try {
      const list = rendition.getContents() as unknown as Contents | Contents[];
      for (const contents of Array.isArray(list) ? list : [list]) {
        void contents?.addStylesheetRules(layoutRef.current, "osler-layout")?.catch?.(() => {});
      }
    } catch {
      // contents re-rule races teardown — harmless
    }
  }, [typo, themeNonce, meta, layoutRules]);

  const goPrev = React.useCallback(() => {
    haptic("selection");
    renditionRef.current?.prev().catch(() => {});
  }, []);
  const goNext = React.useCallback(() => {
    haptic("selection");
    renditionRef.current?.next().catch(() => {});
  }, []);
  const goHref = React.useCallback((href: string) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    haptic("selection");
    setTocOpen(false);
    rendition.display(href).catch(() => {});
  }, []);

  // Arrow-key page turns (scoped: ignore when typing in an input).
  React.useEffect(() => {
    if (!meta) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const forward = rtl ? "ArrowLeft" : "ArrowRight";
      const back = rtl ? "ArrowRight" : "ArrowLeft";
      if (e.key === forward) goNext();
      else if (e.key === back) goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [meta, goNext, goPrev, rtl]);

  if (failed) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <EmptyState
          icon={BookOpen}
          title={t("library.epub.failed")}
          description={failed}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                haptic("light");
                setFailed(null);
                setReloadNonce((n) => n + 1);
              }}
            >
              <RotateCcw className="size-3.5 me-1.5" />
              {t("library.epub.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const percent = spineLength > 0 ? Math.min(100, Math.round(((pos.index + 1) / spineLength) * 100)) : 0;
  const bookDir = meta?.dir ?? "ltr";
  const currentNorm = normalizeHref(pos.href);
  const activeLabel =
    toc.find((entry) => normalizeHref(entry.href) === currentNorm)?.label ??
    (spineLength > 0 ? t("library.epub.chapter", { n: pos.index + 1, total: spineLength }) : title);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Reading progress hairline */}
      <div className="h-0.5 bg-muted shrink-0" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t("library.epub.progress", { n: percent })}>
        <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />
      </div>

      {/* Book toolbar */}
      <div className="flex items-center gap-2 px-3 sm:px-4 h-12 shrink-0 border-b border-border">
        <Button variant="ghost" size="iconSm" onClick={() => { haptic("selection"); setTocOpen(true); }} aria-label={t("library.epub.toc")}>
          <List className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{meta?.title || title}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {meta?.creator
              ? t("library.epub.by", { name: meta.creator })
              : spineLength > 0
                ? t("library.epub.chapter", { n: pos.index + 1, total: spineLength })
                : title}
            {meta?.creator && spineLength > 0 && ` · ${t("library.epub.chapter", { n: pos.index + 1, total: spineLength })}`}
          </div>
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
          {t("library.epub.progress", { n: percent })}
        </span>
      </div>

      {/* Rendition stage (the continuous manager scrolls this element) */}
      <div className="flex-1 overflow-y-auto osler-scroll min-h-0 relative">
        {!ready && (
          <div className="absolute inset-0 bg-background">
            <LoadingState label={t("library.epub.loading")} size="lg" />
          </div>
        )}
        <div ref={stageRef} className="min-h-full" />
      </div>

      {/* Chapter footer nav */}
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 shrink-0 border-t border-border bg-card/60 backdrop-blur-md">
        <Button variant="outline" size="sm" disabled={pos.atStart} onClick={goPrev} aria-label={t("library.epub.prev")} className="min-w-9">
          <ChevronLeft className={cn("size-4", rtl && "rtl-flip-x")} />
          <span className="hidden sm:inline ms-1">{t("library.epub.prev")}</span>
        </Button>
        <button
          type="button"
          onClick={() => { haptic("selection"); setTocOpen(true); }}
          className="flex-1 min-w-0 text-center text-xs font-medium text-muted-foreground hover:text-foreground transition-colors truncate px-2 py-1.5 rounded-md hover:bg-muted/60"
        >
          {activeLabel}
        </button>
        <Button variant="outline" size="sm" disabled={pos.atEnd} onClick={goNext} aria-label={t("library.epub.next")} className="min-w-9">
          <span className="hidden sm:inline me-1">{t("library.epub.next")}</span>
          <ChevronRight className={cn("size-4", rtl && "rtl-flip-x")} />
        </Button>
      </div>

      {/* TOC drawer */}
      <Sheet open={tocOpen} onOpenChange={setTocOpen}>
        <SheetContent side={rtl ? "right" : "left"} className="w-80 max-w-[85vw] flex flex-col p-0">
          <SheetHeader className="px-4 pt-4 pb-3 border-b border-border text-start">
            <div className="flex items-center gap-3">
              {meta?.coverUrl && (
                <img src={meta.coverUrl} alt="" className="size-12 rounded-md border border-border object-cover shrink-0" />
              )}
              <div className="min-w-0">
                <SheetTitle className="text-sm truncate">{meta?.title || title}</SheetTitle>
                {meta?.creator && <div className="text-xs text-muted-foreground truncate">{meta.creator}</div>}
              </div>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto osler-scroll p-2">
            {toc.length > 0 ? (
              toc.map((entry, i) => {
                const isActive = normalizeHref(entry.href) === currentNorm;
                return (
                  <button
                    key={`${entry.href}-${i}`}
                    type="button"
                    onClick={() => goHref(entry.href)}
                    style={bookDir === "rtl" ? { paddingRight: 8 + entry.depth * 16 } : { paddingLeft: 8 + entry.depth * 16 }}
                    className={cn(
                      "w-full text-start text-sm px-2 py-2 rounded-lg transition-colors flex items-center gap-2",
                      isActive ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-muted/60",
                    )}
                  >
                    <BookOpen className={cn("size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground/50")} />
                    <span className="truncate">{entry.label}</span>
                  </button>
                );
              })
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8 px-4">
                {spineLength > 0 ? t("library.epub.chapter", { n: pos.index + 1, total: spineLength }) : title}
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
