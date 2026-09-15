"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Loader2, RotateCcw } from "lucide-react";
import type { Contents, Location, Rendition } from "epubjs";
import {
  EPUB_DISPLAY_TIMEOUT_MS,
  EPUB_HIGHLIGHT_CLASS,
  EPUB_LAYOUT_KEY,
  EPUB_LAYOUT_MAX_FRAMES,
  EPUB_MIN_STAGE_PX,
  EPUB_PROGRESS_WRITE_INTERVAL_MS,
  EPUB_RENDITION_OPTIONS,
  EPUB_STAGE_TIMEOUT_MS,
  EPUB_THEME,
  EpubOpenError,
  activeChapterIndex,
  buildLayoutRules,
  buildThemeRules,
  epubHighlightStyles,
  epubProgressKey,
  fetchEpubArchive,
  openEpubBook,
  preloadEpubEngine,
  readThemePalette,
  type EpubDownloadProgress,
  type EpubFailureCode,
  type EpubHighlightControl,
  type EpubReaderLayout,
  type EpubMetadata,
  type EpubReaderControls,
  type EpubReaderState,
  type EpubReaderStatus,
  type EpubTocEntry,
} from "@/lib/osler/epub";
import { ERASER_TOOL } from "@/lib/osler/highlight-palette";
import { settings } from "@/lib/osler/storage";
import { haptic } from "@/lib/osler/native";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import { useEpubHighlights } from "@/hooks/use-epub-highlights";
import { Button } from "@/components/ui/button";
import { EpubChapterFooter, EpubChaptersPopover } from "./epub-chapters";
import { HighlighterToolbar } from "./highlighter-toolbar";
import { useI18n } from "./i18n-provider";
import { useLightbox } from "./lightbox-provider";
import { EmptyState } from "./ui-primitives";

/**
 * In-reader book viewer for EPUB library articles, powered by `epubjs`
 * (rendering, spine navigation, TOC, CFI positions) under Osler chrome.
 *
 * Design notes:
 *   · **Progressive open.** The archive is fetched, the OPF metadata + cover
 *     land first, and the first section is displayed *automatically* — the
 *     navigation document (the expensive parse) is read afterwards, so a book
 *     opens to page one instead of waiting on its TOC. While the first page
 *     renders, the reader shows the book's cover rather than a bare spinner.
 *   · **Chunked reading.** The rendition runs with the continuous manager, so
 *     epubjs renders only the sections in view (±500px) and tears the rest
 *     down as you scroll — a 900-section book never holds 900 iframes.
 *   · **One scroller.** `.epub-container` is the scroll viewport for scrolled
 *     flow; the host must not nest another `overflow-y-auto` around the stage
 *     (see `.osler-epub-stage` in globals.css) or iOS momentum fights itself.
 *   · **The book follows the app theme.** Palette values are read from the CSS
 *     design tokens at runtime and re-applied when the `<html>` theme class
 *     changes; the section background is pinned so a publisher's white page
 *     can never pair with the theme's light text.
 *   · **Chrome is optional.** In `embedded` mode the reader renders only its
 *     progress hairline + stage; the host owns title/chapters/prev-next so the
 *     desktop library keeps a single top bar and the mobile reader keeps the
 *     floating pill clear of any bottom bar. `standalone` (used by the QBank
 *     article modal) renders its own chapter bar + footer.
 *
 * Security notes: the rendition runs with `allowScriptedContent: false`, so
 * epubjs sandboxes every section iframe without script rights — publisher
 * JavaScript is inert by construction. Publisher stylesheets served as blob:
 * links are intentionally NOT allow-listed in the deployed CSP
 * (`style-src 'self'`), so books fall back to the injected Osler theme;
 * `frame-src blob:` IS allow-listed (public/_headers) because the section
 * iframes themselves need it.
 */

interface EpubReaderProps {
  /** Direct URL of the `.epub` archive (Worker R2 or bundled file). */
  fileUrl: string;
  /** Article file path — scopes the saved position and highlights. */
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
  /** `embedded` = host owns the chrome; `standalone` = reader renders it. */
  chrome?: "standalone" | "embedded";
  /** Cold reader state for the host's chrome (metadata, chapters, position). */
  onState?: (state: EpubReaderState) => void;
  /** Imperative prev/next/goto for the host's buttons. */
  controlsRef?: React.RefObject<EpubReaderControls | null>;
}

interface ReaderPosition {
  index: number;
  href: string;
  atStart: boolean;
  atEnd: boolean;
  percent: number;
}

const FAILURE_KEYS = {
  engine: "library.epub.failedEngine",
  invalid: "library.epub.failedInvalid",
  empty: "library.epub.failedEmpty",
  network: "library.epub.failedNetwork",
} satisfies Record<EpubFailureCode, string>;

const EMPTY_POSITION: ReaderPosition = { index: 0, href: "", atStart: true, atEnd: false, percent: 0 };

/* ── Helpers ────────────────────────────────────────────────────────────── */

function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

/** Resolve `promise`, or `null` when it doesn't settle within `ms`. */
function settle<T>(promise: Promise<T> | undefined, ms: number): Promise<T | null> {
  if (!promise) return Promise.resolve(null);
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/**
 * The rendition's scroller exists once epubjs mounts `.epub-container`, and it
 * needs a real height for `display()` to land. Waits for the element to appear
 * AND size up (the stage mounts a frame or two after the container).
 */
function waitForStage(host: HTMLElement, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const found = host.querySelector(".epub-container");
    if (found && found.clientHeight >= EPUB_MIN_STAGE_PX) return resolve(true);

    const started = Date.now();
    let ro: ResizeObserver | null = null;
    const done = (ok: boolean) => {
      window.clearInterval(timer);
      ro?.disconnect();
      resolve(ok);
    };
    const onSized = (el: Element) => {
      if (el.clientHeight < EPUB_MIN_STAGE_PX) return;
      ro?.disconnect();
      done(true);
    };
    const timer = window.setInterval(() => {
      const el = host.querySelector(".epub-container");
      if (el) {
        if (!ro) {
          ro = new ResizeObserver(() => onSized(el));
          ro.observe(el);
        }
        onSized(el);
        return;
      }
      if (Date.now() - started >= timeoutMs) done(false);
    }, 50);
  });
}

/** Reads the saved position for a book (`null` = fresh start). */
async function readSavedCfi(fileKey: string): Promise<string | null> {
  try {
    const raw = await settings.get(`epub-progress:${fileKey}`);
    if (typeof raw !== "string" || !raw) return null;
    const rec = JSON.parse(raw) as { cfi?: string };
    return typeof rec?.cfi === "string" ? rec.cfi : null;
  } catch {
    return null;
  }
}

/**
 * Cold reader state for the host — deliberately ignores `percent`, which moves
 * on every scroll tick, so the host (and its header chrome) never re-renders
 * while the reader is being scrolled.
 */
function sameReaderState(a: EpubReaderState | null, b: EpubReaderState): boolean {
  return (
    !!a &&
    a.status === b.status &&
    a.index === b.index &&
    a.chapterLabel === b.chapterLabel &&
    a.chaptersLoading === b.chaptersLoading &&
    a.chapters.length === b.chapters.length &&
    a.atStart === b.atStart &&
    a.atEnd === b.atEnd &&
    a.error === b.error
  );
}

/** EPUB book reader. See the module header for the design notes. */
export const EpubReader = React.memo(function EpubReader({
  fileUrl,
  fileKey,
  title,
  fontSize,
  lineHeight,
  maxWidth,
  fontFamily,
  chrome = "standalone",
  onState,
  controlsRef,
}: EpubReaderProps) {
  const { t } = useI18n();
  const { openLightbox } = useLightbox();
  const highlights = useEpubHighlights({ fileKey });

  const [status, setStatus] = React.useState<EpubReaderStatus>("loading");
  const [failure, setFailure] = React.useState<EpubFailureCode | null>(null);
  const [meta, setMeta] = React.useState<EpubMetadata | null>(null);
  const [chapters, setChapters] = React.useState<EpubTocEntry[]>([]);
  const [chaptersLoading, setChaptersLoading] = React.useState(true);
  const [spineLength, setSpineLength] = React.useState(0);
  const [position, setPosition] = React.useState<ReaderPosition>(EMPTY_POSITION);
  const [reloadNonce, setReloadNonce] = React.useState(0);
  const [themeNonce, setThemeNonce] = React.useState(0);
  // Archive download progress for the landing overlay. Local only — it moves
  // per network chunk and must never ride `onState` into host re-renders.
  const [downloadProgress, setDownloadProgress] = React.useState<EpubDownloadProgress | null>(null);
  const progressAtRef = React.useRef(0);

  const stageRef = React.useRef<HTMLDivElement>(null);
  const bookRef = React.useRef<{ destroy: () => void } | null>(null);
  const renditionRef = React.useRef<Rendition | null>(null);
  const layoutRef = React.useRef<Record<string, Record<string, string>>>({});
  const appliedRef = React.useRef<Set<string>>(new Set());
  const spineRef = React.useRef(0);
  const pendingCfiRef = React.useRef("");
  const savedCfiRef = React.useRef("");
  const savedAtRef = React.useRef(0);

  // Latest values for the epubjs callbacks — iframe events, relocation and
  // teardown all fire outside React's render cycle, and the open effect must
  // NOT re-run when typography or the armed highlighter tool changes.
  const tRef = React.useRef(t);
  tRef.current = t;
  const layout = React.useMemo<EpubReaderLayout>(
    () => ({ fontSize, lineHeight, maxWidth: maxWidth ?? 768, fontFamily }),
    [fontSize, lineHeight, maxWidth, fontFamily],
  );
  const layoutInputRef = React.useRef(layout);
  layoutInputRef.current = layout;
  const highlightsRef = React.useRef(highlights);
  highlightsRef.current = highlights;

  // Re-apply the theme whenever the `<html>` theme class flips (Settings →
  // Appearance) so the iframe inherits dark/light without reopening the book.
  React.useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setThemeNonce((n) => n + 1));
    obs.observe(el, { attributes: true, attributeFilter: ["class", "style"] });
    return () => obs.disconnect();
  }, []);

  const applyTheme = React.useCallback((rendition: Rendition) => {
    const palette = readThemePalette();
    try {
      rendition.themes.register(EPUB_THEME, buildThemeRules(palette));
      rendition.themes.select(EPUB_THEME);
      rendition.themes.fontSize(`${layoutInputRef.current.fontSize}px`);
    } catch {
      // theme re-apply races teardown — harmless
    }
    layoutRef.current = buildLayoutRules(layoutInputRef.current, palette);
  }, []);

  // Reading position lives in the synced settings store. `relocated` fires on
  // every scroll, so writes are rate-limited with a forced write on close.
  const persistPosition = React.useCallback(
    (cfi: string, force = false) => {
      if (!cfi || cfi === savedCfiRef.current) return;
      const now = Date.now();
      if (!force && now - savedAtRef.current < EPUB_PROGRESS_WRITE_INTERVAL_MS) return;
      savedCfiRef.current = cfi;
      savedAtRef.current = now;
      void settings.set(epubProgressKey(fileKey), JSON.stringify({ cfi, updatedAt: now })).catch(() => {});
    },
    [fileKey],
  );

  const onRelocated = React.useCallback(
    (loc: Location) => {
      const start = loc?.start;
      const cfi = typeof start?.cfi === "string" ? start.cfi : "";
      if (cfi) {
        pendingCfiRef.current = cfi;
        persistPosition(cfi);
      }
      const index = typeof start?.index === "number" ? start.index : 0;
      const href = typeof start?.href === "string" ? start.href : "";
      const total = spineRef.current;
      const percent = total > 0 ? Math.min(100, Math.round(((index + 1) / total) * 100)) : 0;
      const atStart = !!loc?.atStart;
      const atEnd = !!loc?.atEnd;
      setPosition((prev) =>
        prev.index === index &&
        prev.href === href &&
        prev.percent === percent &&
        prev.atStart === atStart &&
        prev.atEnd === atEnd
          ? prev
          : { index, href, atStart, atEnd, percent },
      );
    },
    [persistPosition],
  );

/**
   * Per-section document wiring: images → lightbox, external links → new tab,
   * and text selection → highlight (when a colour is armed).
   */
  const attachContentsHandlers = React.useCallback(
    (contents: Contents) => {
      const doc = contents.document;
      if (!doc) return;

      const openImageAt = (el: Element | null): boolean => {
        const img = el?.closest?.("img") as HTMLImageElement | null;
        const src = img?.currentSrc || img?.src || "";
        if (!img || !src) return false;
        openLightbox(src, img.alt || "");
        return true;
      };

      const onClick = (e: Event) => {
        const target = e.target as Element | null;
        const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
        const href = anchor?.getAttribute("href") ?? "";
        if (/^(https?:|mailto:|tel:)/i.test(href)) {
          e.preventDefault();
          e.stopPropagation();
          window.open(href, "_blank", "noopener");
          return;
        }
        if (openImageAt(target)) e.preventDefault();
      };

      // Touch: elementFromPoint so a slightly-moved finger still hits the image.
      const onTouchEnd = (e: TouchEvent) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        if (openImageAt(doc.elementFromPoint(touch.clientX, touch.clientY) as Element | null)) {
          e.preventDefault();
        }
      };

      let timer = 0;
      const applySelection = () => {
        const tool = highlightsRef.current.toolRef.current;
        if (!tool || tool === ERASER_TOOL) return;
        const selection = contents.window?.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
        const text = selection.toString().trim();
        if (!text) return;
        let cfi = "";
        try {
          cfi = contents.cfiFromRange(selection.getRangeAt(0));
        } catch {
          cfi = "";
        }
        selection.removeAllRanges();
        if (cfi) highlightsRef.current.add({ cfi, text });
      };
      const onMouseUp = () => {
        if (isCoarsePointer()) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(applySelection, 0);
      };
      const onSelectionChange = () => {
        if (!isCoarsePointer()) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(applySelection, 350);
      };

      doc.addEventListener("click", onClick);
      doc.addEventListener("touchend", onTouchEnd);
      doc.addEventListener("mouseup", onMouseUp);
      doc.addEventListener("selectionchange", onSelectionChange);
    },
    [openLightbox],
  );

  /**
   * Show the saved position, else the opening page. A position that never
   * settles is dropped (with a forced re-display, which also unblocks the
   * epubjs render queue) so the reader can't sit behind its loader.
   */
  const displayInitial = React.useCallback(
    async (rendition: Rendition, savedCfi: string | null) => {
      if (savedCfi) {
        try {
          if (await settle(rendition.display(savedCfi), EPUB_DISPLAY_TIMEOUT_MS)) return;
        } catch {
          // Stale CFI (republished book) — fall through to the opening page.
        }
        savedCfiRef.current = "";
        void settings.set(epubProgressKey(fileKey), "").catch(() => {});
      }
      if (!(await settle(rendition.display(), EPUB_DISPLAY_TIMEOUT_MS))) {
        throw new EpubOpenError("invalid", "the first section never rendered");
      }
    },
    [fileKey],
  );

  const observeStage = React.useCallback((stage: HTMLElement, rendition: Rendition) => {
    const onResize = () => {
      const box = stage.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      try {
        rendition.resize(Math.round(box.width), Math.round(box.height));
      } catch {
        // resize races teardown — harmless
      }
    };
    const obs = new ResizeObserver(onResize);
    obs.observe(stage);
    (rendition as unknown as { __resizeObs?: ResizeObserver }).__resizeObs = obs;
  }, []);

  const goPrev = React.useCallback(() => {
    haptic("selection");
    void renditionRef.current?.prev().catch(() => {});
  }, []);

  const goNext = React.useCallback(() => {
    haptic("selection");
    void renditionRef.current?.next().catch(() => {});
  }, []);

  const gotoChapter = React.useCallback((href: string) => {
    if (!href) return;
    haptic("selection");
    void renditionRef.current?.display(href).catch(() => {});
  }, []);

  const retry = React.useCallback(
    (fromStart = false) => {
      haptic("light");
      if (fromStart) {
        savedCfiRef.current = "";
        pendingCfiRef.current = "";
        void settings.set(epubProgressKey(fileKey), "").catch(() => {});
      }
      setFailure(null);
      setStatus("loading");
      setReloadNonce((n) => n + 1);
    },
    [fileKey],
  );

  // Open the book + boot the rendition. A new fileKey/fileUrl (or retry) tears
  // the previous rendition down first so blob URLs can't leak. Inputs that
  // change per render (typography, theme, armed tool) are read through refs, so
  // this effect only re-runs when the book itself changes.
  React.useEffect(() => {
    let cancelled = false;
    const stage = stageRef.current;
    if (!stage || !fileUrl) return;
    const controller = new AbortController();

    setStatus("loading");
    setFailure(null);
    setMeta(null);
    setChapters([]);
    setChaptersLoading(true);
    setSpineLength(0);
    setPosition(EMPTY_POSITION);
    setDownloadProgress(null);
    progressAtRef.current = 0;
    appliedRef.current = new Set();
    pendingCfiRef.current = "";
    savedCfiRef.current = "";
    savedAtRef.current = 0;
    spineRef.current = 0;

    // The engine module fetch overlaps the archive download (`openEpubBook`
    // awaits the shared preload promise) instead of following it.
    preloadEpubEngine();

    void (async () => {
      try {
        const buf = await fetchEpubArchive(fileUrl, controller.signal, (p) => {
          if (cancelled) return;
          // Network chunks arrive far faster than the screen needs — paint at
          // most ~8x/sec, plus the final tick.
          const now = Date.now();
          if (p.total != null && p.loaded < p.total && now - progressAtRef.current < 120) return;
          progressAtRef.current = now;
          setDownloadProgress(p);
        });
        if (cancelled) return;
        const opened = await openEpubBook(buf, (n) => tRef.current("library.epub.section", { n }));
        if (cancelled) {
          opened.destroy();
          return;
        }
        bookRef.current = opened;
        spineRef.current = opened.spineLength;
        setMeta(opened.metadata);
        setSpineLength(opened.spineLength);

        await waitForStage(stage, EPUB_STAGE_TIMEOUT_MS);
        if (cancelled) return;

        const rendition = opened.book.renderTo(stage, {
          width: "100%",
          height: "100%",
          ...EPUB_RENDITION_OPTIONS,
        });
        renditionRef.current = rendition;
        applyTheme(rendition);

        rendition.hooks.content.register((contents: Contents) => {
          void contents.addStylesheetRules(layoutRef.current, EPUB_LAYOUT_KEY)?.catch?.(() => {});
          attachContentsHandlers(contents);
        });
        rendition.on("relocated", onRelocated);

        const saved = await readSavedCfi(fileKey);
        if (cancelled) return;
        savedCfiRef.current = saved ?? "";
        await displayInitial(rendition, saved);
        if (cancelled) return;
        setStatus("ready");
        observeStage(stage, rendition);

        // The navigation document is parsed only once the first page is up.
        void opened
          .loadChapters()
          .then((list) => {
            if (cancelled) return;
            setChapters(list);
            setChaptersLoading(false);
          })
          .catch(() => {
            if (!cancelled) setChaptersLoading(false);
          });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailure(err instanceof EpubOpenError ? err.code : "invalid");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      persistPosition(pendingCfiRef.current, true);
      try {
        (renditionRef.current as unknown as { __resizeObs?: ResizeObserver } | null)?.__resizeObs?.disconnect();
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
  }, [
    fileUrl,
    fileKey,
    reloadNonce,
    applyTheme,
    attachContentsHandlers,
    displayInitial,
    observeStage,
    onRelocated,
    persistPosition,
  ]);

  // Live typography + theme updates on the mounted rendition.
  React.useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || status !== "ready") return;
    applyTheme(rendition);
    const list = rendition.getContents() as unknown as Contents | Contents[];
    for (const contents of Array.isArray(list) ? list : [list]) {
      if (!contents) continue;
      void contents.addStylesheetRules(layoutRef.current, EPUB_LAYOUT_KEY)?.catch?.(() => {});
    }
  }, [layout, themeNonce, status, applyTheme]);

  const bookDir = meta?.dir ?? "ltr";

  // Re-attach every stored highlight to the rendition as it comes up (and to
  // newly rendered sections — epubjs injects annotations on render itself).
  React.useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || status !== "ready") return;
    for (const item of highlights.highlights) {
      if (appliedRef.current.has(item.cfi)) continue;
      try {
        rendition.annotations.highlight(
          item.cfi,
          { id: item.id },
          () => {
            // Tapping a highlight with the eraser armed removes it (the
            // closure keeps the CFI — epubjs hands the callback a DOM event).
            if (highlightsRef.current.toolRef.current !== ERASER_TOOL) return;
            haptic("light");
            try {
              rendition.annotations.remove(item.cfi, "highlight");
            } catch {
              // annotation already gone with its view — harmless
            }
            appliedRef.current.delete(item.cfi);
            highlightsRef.current.remove(item.cfi);
          },
          EPUB_HIGHLIGHT_CLASS,
          epubHighlightStyles(item.color),
        );
        appliedRef.current.add(item.cfi);
      } catch {
        // A CFI no section can resolve (republished book) is skipped.
      }
    }
  }, [highlights.highlights, status]);

  // The host renders `<HighlighterToolbar>` from this control, so clearing all
  // must detach the rects from the rendition as well as the stored list.
  const highlightControl = React.useMemo<EpubHighlightControl>(
    () => ({
      ...highlights.control,
      onClearAll: () => {
        haptic("warning");
        for (const item of highlightsRef.current.highlights) {
          try {
            renditionRef.current?.annotations.remove(item.cfi, "highlight");
          } catch {
            // annotation already gone with its view — harmless
          }
        }
        appliedRef.current.clear();
        highlightsRef.current.clearAll();
      },
    }),
    [highlights.control],
  );

  // Imperative controls for the host's top bar / footer.
  React.useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = { prev: goPrev, next: goNext, goto: gotoChapter };
    return () => {
      controlsRef.current = null;
    };
  }, [controlsRef, goPrev, goNext, gotoChapter]);

  // Arrow-key page turns (scoped: ignored while typing in an input).
  React.useEffect(() => {
    if (status !== "ready") return;
    const forward = bookDir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const back = bookDir === "rtl" ? "ArrowRight" : "ArrowLeft";
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === forward) goNext();
      else if (e.key === back) goPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, bookDir, goNext, goPrev]);

  const chapterIndex = React.useMemo(
    () => activeChapterIndex(chapters, position.href, position.index),
    [chapters, position.href, position.index],
  );

  // Landing-overlay download meter. Language-neutral numerals only, so no
  // i18n key is needed for the per-chunk caption.
  const downloadFraction =
    downloadProgress?.total != null && downloadProgress.total > 0
      ? Math.min(1, downloadProgress.loaded / downloadProgress.total)
      : null;
  const formatMb = (bytes: number) => `${(bytes / 1048576).toFixed(1)}`;

  const chapterLabel = React.useMemo(() => {
    const entry = chapterIndex >= 0 ? chapters[chapterIndex] : undefined;
    if (entry?.label) return entry.label;
    if (spineLength > 0) return t("library.epub.chapter", { n: position.index + 1, total: spineLength });
    return meta?.title || title;
  }, [chapterIndex, chapters, spineLength, position.index, meta, title, t]);

  const readerState = React.useMemo<EpubReaderState>(
    () => ({
      status,
      error: failure,
      title: meta?.title || title,
      creator: meta?.creator || "",
      coverUrl: meta?.coverUrl ?? null,
      dir: bookDir,
      spineLength,
      index: position.index,
      href: position.href,
      chapterLabel,
      atStart: position.atStart,
      atEnd: position.atEnd,
      chapters,
      chaptersLoading,
      highlight: highlightControl,
    }),
    [
      status,
      failure,
      meta,
      title,
      bookDir,
      spineLength,
      position.index,
      position.href,
      position.atStart,
      position.atEnd,
      chapterLabel,
      chapters,
      chaptersLoading,
      highlightControl,
    ],
  );

  // Report only *cold* state: the reading percentage stays inside the reader's
  // own hairline, so scrolling never re-renders the host view.
  const lastReportedRef = React.useRef<EpubReaderState | null>(null);
  React.useEffect(() => {
    if (!onState) return;
    if (sameReaderState(lastReportedRef.current, readerState)) return;
    lastReportedRef.current = readerState;
    onState(readerState);
  }, [readerState, onState]);

  if (status === "error") {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <EmptyState
          icon={BookOpen}
          title={t("library.epub.failed")}
          description={t(FAILURE_KEYS[failure ?? "invalid"] as Parameters<typeof t>[0])}
          actions={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => retry()}>
                <RotateCcw className="size-3.5 me-1.5" />
                {t("library.epub.retry")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => retry(true)}>
                {t("library.epub.startOver")}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Reading progress hairline */}
      <div
        className="h-0.5 bg-muted shrink-0"
        role="progressbar"
        aria-valuenow={position.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("library.epub.progress", { n: position.percent })}
      >
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{ width: `${position.percent}%` }}
        />
      </div>

      {/* Standalone chrome (QBank article modal): title + chapters in one bar */}
      {chrome === "standalone" && (
        <div className="flex items-center gap-2 px-3 sm:px-4 h-12 shrink-0 border-b border-border bg-card/60 backdrop-blur-md">
          <EpubChaptersPopover data={readerState} fallbackTitle={title} onSelect={gotoChapter} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{readerState.title}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {readerState.creator
                ? t("library.epub.by", { name: readerState.creator })
                : readerState.chapterLabel}
            </div>
          </div>
          <HighlighterToolbar control={highlightControl} />
        </div>
      )}

      {/* Rendition stage — `.epub-container` (created by epubjs) is the only
          scroller here; the host must not wrap this in another one. */}
      <div className="osler-epub-stage flex-1 min-h-0 relative overflow-hidden">
        <div ref={stageRef} className="h-full w-full" />

        {/* Cover landing — shown until the first page is on screen, so opening
            a book never looks stuck behind a spinner. */}
        <AnimatePresence>
          {status !== "ready" && (
            <motion.div
              key="epub-landing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={MOTION_TRANSITION.fast}
              className="absolute inset-0 z-10 bg-background flex flex-col items-center justify-center gap-5 px-6 py-8 text-center"
            >
              {readerState.coverUrl ? (
                <img
                  src={readerState.coverUrl}
                  alt=""
                  className="max-h-[38vh] w-auto max-w-[62%] rounded-xl border border-border object-contain shadow-e2"
                />
              ) : (
                <div className="size-14 rounded-full bg-muted/40 grid place-items-center">
                  <BookOpen className="size-6 text-muted-foreground" />
                </div>
              )}
              <div className="space-y-1.5 max-w-sm">
                <div className="text-base font-semibold line-clamp-2">{readerState.title}</div>
                {readerState.creator && (
                  <div className="text-xs text-muted-foreground">
                    {t("library.epub.by", { name: readerState.creator })}
                  </div>
                )}
              </div>
              {downloadFraction != null ? (
                <div className="flex w-44 flex-col items-center gap-2">
                  <div
                    className="h-1 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(downloadFraction * 100)}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-150"
                      style={{ width: `${downloadFraction * 100}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {formatMb(downloadProgress!.loaded)} / {formatMb(downloadProgress!.total!)} MB
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("library.epub.opening")}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Standalone footer: prev / current chapter / next */}
      {chrome === "standalone" && (
        <EpubChapterFooter
          chapterLabel={chapterLabel}
          atStart={position.atStart}
          atEnd={position.atEnd}
          onPrev={goPrev}
          onNext={goNext}
        />
      )}
    </div>
  );
});

