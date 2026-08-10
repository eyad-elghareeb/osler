"use client";

/**
 * GlobalSearchPanel — content of the global search popover / sheet.
 *
 * Renders a single search input plus grouped results. The parent (AppShell)
 * owns the open/close state and supplies `onSelect` to dispatch navigation.
 *
 * The panel fetches the search index lazily on first open and re-uses it
 * for every subsequent keystroke. Results are grouped by kind and rendered
 * with kind-specific icons.
 */

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search as SearchIcon,
  BookOpen,
  ListChecks,
  Layers,
  Activity,
  Video as VideoIcon,
  Settings as SettingsIcon,
  CornerDownLeft,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import {
  loadSearchIndex,
  searchAll,
  groupResults,
  localiseResultTitle,
  filterByView,
  VIEW_PLACEHOLDER_KEY,
  SEARCH_GROUP_LABEL_KEY,
  type SearchResult,
  type SearchKind,
} from "@/lib/osler/search";
import { useI18n } from "./i18n-provider";
import type { StringKey } from "@/lib/osler/i18n";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import { Skeleton } from "@/components/ui/skeleton";

interface GlobalSearchPanelProps {
  /** Controlled query — parent persists it across open/close. */
  query: string;
  onQueryChange: (q: string) => void;
  /** Called when the user picks a result. Parent closes the panel. */
  onSelect: (r: SearchResult) => void;
  /** Current view — filters results to only kinds relevant to this view. */
  view?: string;
  /** Optional: autofocus the input on mount. */
  autoFocus?: boolean;
  /** Optional: render with extra padding (used inside mobile sheet). */
  variant?: "popover" | "sheet";
}

const KIND_ICON: Record<SearchKind, LucideIcon> = {
  article: BookOpen,
  qbank: ListChecks,
  flashcard: Layers,
  osce: Activity,
  video: VideoIcon,
  setting: SettingsIcon,
  nav: ArrowRight,
};

export function GlobalSearchPanel({
  query,
  onQueryChange,
  onSelect,
  view,
  autoFocus = true,
  variant = "popover",
}: GlobalSearchPanelProps) {
  const { t, lang, rtl } = useI18n();
  const [index, setIndex] = React.useState<SearchResult[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [activeIdx, setActiveIdx] = React.useState(0);

  // Lazy-load the search index on first mount.
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadSearchIndex()
      .then((idx) => {
        if (cancelled) return;
        setIndex(idx);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Autofocus on mount (popover mounts fresh every time it opens).
  React.useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const results = React.useMemo(() => {
    if (!index) return [];
    return filterByView(searchAll(index, query), view);
  }, [index, query, view]);

  const grouped = React.useMemo(() => groupResults(results), [results]);

  // Flat list of results for keyboard navigation (preserves group order).
  const flat = React.useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // Reset active index when the query changes.
  React.useEffect(() => { setActiveIdx(0); }, [query]);

  // Keyboard nav: ↑/↓ to move, Enter to select, Escape handled by parent.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = flat[activeIdx];
      if (r) {
        haptic("selection");
        onSelect(r);
      }
    }
  };

  // Scroll the active row into view when it changes.
  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const placeholderKey = (VIEW_PLACEHOLDER_KEY[view ?? "dashboard"] ?? "search.globalPlaceholder") as StringKey;
  const placeholder = t(placeholderKey);
  const padCls = variant === "sheet" ? "p-4" : "p-3";

  let runningIdx = -1; // flat index as we render groups

  return (
    <div className="flex flex-col">
      <div className={cn("border-b border-border", padCls)}>
        <div className="flex items-center gap-2">
          <SearchIcon className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground min-w-0"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground shrink-0">
            ESC
          </kbd>
        </div>
      </div>

      <div ref={listRef} className="max-h-[60vh] min-h-[120px] overflow-y-auto medos-scroll p-2">
        {loading ? (
          /* 21st.dev-inspired shimmer rows — reads as "results arriving"
           * rather than a flat "Loading…" string. Three placeholder rows
           * match the typical result-group height so the panel doesn't
           * jump when real results land. */
          <div className="space-y-2 p-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-2 rounded-md">
                <Skeleton className="size-7 rounded-md shrink-0" />
                <div className="flex-1 flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : !query ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            <p>{t("search.empty")}</p>
            <p className="mt-2 text-[11px] text-muted-foreground/70">{t("search.globalHint")}</p>
          </div>
        ) : flat.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("search.noResults", { query })}
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {grouped.map((group) => {
                const Icon = KIND_ICON[group.kind];
                return (
                  <motion.div
                    key={group.kind}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5 flex items-center gap-1.5">
                      <Icon className="size-3" />
                      {t(SEARCH_GROUP_LABEL_KEY[group.kind])}
                    </div>
                    <div className="space-y-0.5">
                      {group.items.map((r) => {
                        runningIdx += 1;
                        const idx = runningIdx;
                        const isActive = idx === activeIdx;
                        const title = localiseResultTitle(r, t, lang);
                        return (
                          <button
                            key={r.id}
                            data-idx={idx}
                            onClick={() => {
                              haptic("selection");
                              onSelect(r);
                            }}
                            onMouseEnter={() => setActiveIdx(idx)}
                            className={cn(
                              "relative w-full text-start px-2 py-2 rounded-md transition-colors flex items-center gap-3",
                              isActive ? "bg-primary/10 text-foreground" : "hover:bg-muted/60",
                            )}
                          >
                            <span className="size-7 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
                              <Icon className="size-3.5 text-muted-foreground" />
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{title}</div>
                              {(r.subtitle || r.meta) && (
                                <div className="text-xs text-muted-foreground truncate">
                                  {[r.subtitle, r.meta].filter(Boolean).join(" · ")}
                                </div>
                              )}
                            </div>
                            {isActive && (
                              <CornerDownLeft
                                className={cn(
                                  "size-3.5 text-muted-foreground shrink-0",
                                  rtl && "rtl-flip-x",
                                )}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {flat.length > 0 && (
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground flex items-center gap-3">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded border border-border">↑</kbd>
            <kbd className="px-1 py-0.5 rounded border border-border">↓</kbd>
            {t("common.previous")} / {t("common.next")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded border border-border">↵</kbd>
            {t("common.confirm")}
          </span>
          <span className="ms-auto">{t("search.countResults", { n: flat.length })}</span>
        </div>
      )}
    </div>
  );
}
