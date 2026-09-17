"use client";

import * as React from "react";
import { BookOpen, ChevronLeft, ChevronRight, List } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activeChapterIndex, type EpubReaderState } from "@/lib/osler/epub";
import { useI18n } from "./i18n-provider";

/**
 * Chapter (manifest) chrome for the EPUB reader.
 *
 * The reader itself renders no chrome — the host decides where chapters live
 * (library desktop header, mobile reader header, modal bar) and these
 * components provide the one shared list, so every surface looks and behaves
 * identically:
 *   · `EpubChaptersPopover` — desktop top-bar menu (title + chapters in one bar)
 *   · `EpubChaptersSheet`   — mobile drawer
 *   · `EpubChapterFooter`   — prev / current chapter / next strip
 *
 * The list follows the *book's* reading direction (a RTL book indents from the
 * right even in an LTR UI), and highlights the chapter the reader is inside —
 * matched by href first, then by the closest preceding spine index, so books
 * whose TOC skips sections still track correctly.
 */

/** Fields the chapters UI reads — a slice of the reader state. */
export type EpubChaptersData = Pick<
  EpubReaderState,
  "chapters" | "chaptersLoading" | "href" | "index" | "spineLength" | "title" | "creator" | "coverUrl" | "dir"
>;

/** Cover + title + reading progress — the header of both containers. */
function ChaptersHeader({ data, fallbackTitle }: { data: EpubChaptersData; fallbackTitle: string }) {
  const { t } = useI18n();
  const percent = data.spineLength > 0 ? Math.min(100, Math.round(((data.index + 1) / data.spineLength) * 100)) : 0;
  const label = data.spineLength > 0 ? t("library.epub.chapter", { n: data.index + 1, total: data.spineLength }) : "";
  return (
    // Padding-grown, so safe-pt only extends it below the notch when this
    // header sits in a full-height side sheet (the popover usage is a
    // no-op: env() is 0 away from the viewport edge).
    <div className="flex items-start gap-3 px-3.5 py-3 border-b border-border safe-pt">
      {data.coverUrl ? (
        <img
          src={data.coverUrl}
          alt=""
          className="w-12 h-[4.75rem] rounded-md border border-border object-cover shrink-0 shadow-e1"
        />
      ) : (
        <div className="w-12 h-[4.75rem] rounded-md border border-border bg-muted/40 grid place-items-center shrink-0">
          <BookOpen className="size-4 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold leading-snug line-clamp-2">{data.title || fallbackTitle}</div>
        {data.creator && <div className="text-xs text-muted-foreground truncate mt-0.5">{data.creator}</div>}
        {data.spineLength > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">{label}</span>
          </div>
        )}
      </div>
    </div>
  );
}
function ChapterListSkeleton() {
  return (
    <div className="p-2 space-y-1.5" aria-hidden>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-1 py-1">
          <Skeleton className="size-5 rounded-md shrink-0" />
          <Skeleton className="h-4 rounded-md" style={{ width: `${58 + ((i * 13) % 34)}%` }} />
        </div>
      ))}
    </div>
  );
}

/**
 * The chapter list itself — hierarchy, active tracking, and a manual
 * scroll-to-active so opening the menu lands on the reader's position instead
 * of the book's first page. `scrollTop` is set directly (not
 * `scrollIntoView`) so the surrounding page never scrolls.
 */
export function EpubChapterList({
  data,
  onSelect,
  className,
}: {
  data: EpubChaptersData;
  onSelect: (href: string) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const { chapters, chaptersLoading } = data;
  const activeIndex = activeChapterIndex(chapters, data.href, data.index);
  const listRef = React.useRef<HTMLDivElement>(null);
  const activeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const list = listRef.current;
    const active = activeRef.current;
    if (!list || !active) return;
    const target = active.offsetTop - list.clientHeight / 2 + active.offsetHeight / 2;
    list.scrollTop = Math.max(0, Math.min(target, list.scrollHeight - list.clientHeight));
  }, [activeIndex, chapters.length]);

  if (chaptersLoading && !chapters.length) return <ChapterListSkeleton />;

  if (!chapters.length) {
    return <p className="text-xs text-muted-foreground text-center px-6 py-10">{t("library.epub.chaptersEmpty")}</p>;
  }

  return (
    <div ref={listRef} dir={data.dir} className={cn("overflow-y-auto osler-scroll p-1.5", className)}>
      {chapters.map((entry, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={`${entry.href}-${i}`}
            ref={active ? activeRef : undefined}
            type="button"
            onClick={() => onSelect(entry.href)}
            aria-current={active ? "true" : undefined}
            style={{ paddingInlineStart: 8 + entry.depth * 14 }}
            className={cn(
              "group w-full text-start flex items-start gap-2.5 rounded-lg pe-2 py-2 transition-colors",
              active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/60",
            )}
          >
            <span
              className={cn(
                "mt-px size-5 shrink-0 grid place-items-center rounded-md text-[11px] font-semibold tabular-nums",
                active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <span className={cn("min-w-0 flex-1 text-sm leading-snug", active && "font-semibold")}>
              <span className="line-clamp-2">{entry.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Desktop top-bar chapters menu — trigger shows the chapter you're reading. */
export function EpubChaptersPopover({
  data,
  fallbackTitle,
  onSelect,
}: {
  data: EpubChaptersData;
  fallbackTitle: string;
  onSelect: (href: string) => void;
}) {
  const { t } = useI18n();
  const active = activeChapterIndex(data.chapters, data.href, data.index);
  const current = active >= 0 ? data.chapters[active]?.label : "";
  const label =
    current ||
    (data.spineLength > 0
      ? t("library.epub.chapter", { n: data.index + 1, total: data.spineLength })
      : t("library.epub.chapters"));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-[15rem] min-w-0 justify-start gap-1.5 font-normal"
          title={t("library.epub.chapters")}
          aria-label={t("library.epub.chapters")}
        >
          <List className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[min(24rem,calc(100vw-1.5rem))] p-0 overflow-hidden">
        <ChaptersHeader data={data} fallbackTitle={fallbackTitle} />
        <EpubChapterList data={data} onSelect={onSelect} className="max-h-[60dvh]" />
      </PopoverContent>
    </Popover>
  );
}

/** Mobile chapters drawer — same content, full-height sheet. */
export function EpubChaptersSheet({
  data,
  fallbackTitle,
  open,
  onOpenChange,
  onSelect,
}: {
  data: EpubChaptersData;
  fallbackTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (href: string) => void;
}) {
  const { t, rtl } = useI18n();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={rtl ? "right" : "left"} className="w-[88vw] max-w-sm p-0 flex flex-col">
        <SheetHeader className="sr-only">
          <SheetTitle>{t("library.epub.chapters")}</SheetTitle>
        </SheetHeader>
        <ChaptersHeader data={data} fallbackTitle={fallbackTitle} />
        {/* Bottom clearance so the last chapter clears the home indicator. */}
        <EpubChapterList data={data} onSelect={onSelect} className="flex-1 min-h-0 pb-[min(env(safe-area-inset-bottom,0px),2.5rem)]" />
      </SheetContent>
    </Sheet>
  );
}

/** Bottom strip: previous / current chapter / next. */
export function EpubChapterFooter({
  chapterLabel,
  atStart,
  atEnd,
  onPrev,
  onNext,
}: {
  chapterLabel: string;
  atStart: boolean;
  atEnd: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t, rtl } = useI18n();
  return (
    // Fixed-height footer strip: the height grows with the home indicator
    // (content row stays 48px) so the buttons never sit underneath it.
    <div className="flex items-center gap-2 px-3 sm:px-4 h-[calc(3rem+env(safe-area-inset-bottom,0px))] shrink-0 border-t border-border bg-card/60 backdrop-blur-md safe-pb">
      <Button
        variant="outline"
        size="sm"
        disabled={atStart}
        onClick={onPrev}
        aria-label={t("library.epub.prev")}
        className="min-w-9"
      >
        <ChevronLeft className={cn("size-4", rtl && "rtl-flip-x")} />
        <span className="hidden sm:inline ms-1">{t("library.epub.prev")}</span>
      </Button>
      <div className="flex-1 min-w-0 text-center text-xs font-medium text-muted-foreground truncate px-2">
        {chapterLabel}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={atEnd}
        onClick={onNext}
        aria-label={t("library.epub.next")}
        className="min-w-9"
      >
        <span className="hidden sm:inline me-1">{t("library.epub.next")}</span>
        <ChevronRight className={cn("size-4", rtl && "rtl-flip-x")} />
      </Button>
    </div>
  );
}
