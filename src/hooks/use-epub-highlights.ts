"use client";

import * as React from "react";
import { ERASER_TOOL, HIGHLIGHT_COLOR_KEYS } from "@/lib/osler/highlight-palette";
import {
  createEpubHighlight,
  dropEpubHighlight,
  loadEpubHighlights,
  saveEpubHighlights,
  upsertEpubHighlight,
  type EpubHighlight,
  type EpubHighlightControl,
} from "@/lib/osler/epub";
import { haptic } from "@/lib/osler/native";

interface UseEpubHighlightsOptions {
  /** Article file path — scopes this book's highlights. */
  fileKey: string;
}

export interface UseEpubHighlightsReturn {
  highlights: EpubHighlight[];
  /** Shape consumed by `<HighlighterToolbar control={…} />`. */
  control: EpubHighlightControl;
  /** Read by the rendition's (non-React) iframe event handlers. */
  toolRef: React.RefObject<string | null>;
  /** Persist a highlight for the current selection; null when no tool is armed. */
  add: (input: { cfi: string; text: string }) => EpubHighlight | null;
  remove: (cfi: string) => void;
  clearAll: () => void;
}

/**
 * CFI-based highlights for one EPUB book.
 *
 * Highlights are stored per book (synced settings tier) and re-applied to the
 * rendition by the reader, so this hook stays format-agnostic: it owns the
 * list, the armed tool, and persistence only.
 *
 * No cross-device subscription here on purpose — the reader rewrites its
 * reading position (same settings store) as the user scrolls, and reloading
 * highlights on every settings change would thrash the rendition. A book
 * picks up highlights from other devices when it is next opened.
 */
export function useEpubHighlights({ fileKey }: UseEpubHighlightsOptions): UseEpubHighlightsReturn {
  const [tool, setTool] = React.useState<string | null>(null);
  const [color, setColor] = React.useState<string>(HIGHLIGHT_COLOR_KEYS[0]);
  const [highlights, setHighlights] = React.useState<EpubHighlight[]>([]);

  const itemsRef = React.useRef<EpubHighlight[]>([]);
  const toolRef = React.useRef<string | null>(null);
  toolRef.current = tool;

  const commit = React.useCallback((next: EpubHighlight[]) => {
    itemsRef.current = next;
    setHighlights(next);
    void saveEpubHighlights(fileKey, next).catch(() => {});
  }, [fileKey]);

  React.useEffect(() => {
    itemsRef.current = [];
    setHighlights([]);
    setTool(null);
    if (!fileKey) return;
    let cancelled = false;
    void loadEpubHighlights(fileKey).then((items) => {
      if (cancelled) return;
      itemsRef.current = items;
      setHighlights(items);
    });
    return () => {
      cancelled = true;
    };
  }, [fileKey]);

  const add = React.useCallback(
    (input: { cfi: string; text: string }) => {
      const active = toolRef.current;
      if (!active || active === ERASER_TOOL || !input.cfi) return null;
      const item = createEpubHighlight({ cfi: input.cfi, text: input.text, color: active });
      commit(upsertEpubHighlight(itemsRef.current, item));
      haptic("light");
      return item;
    },
    [commit],
  );

  const remove = React.useCallback(
    (cfi: string) => {
      commit(dropEpubHighlight(itemsRef.current, cfi));
    },
    [commit],
  );

  const clearAll = React.useCallback(() => {
    commit([]);
  }, [commit]);

  const control = React.useMemo<EpubHighlightControl>(
    () => ({
      tool,
      color,
      count: highlights.length,
      onToolChange: setTool,
      onColorChange: setColor,
      onClearAll: clearAll,
    }),
    [tool, color, highlights.length, clearAll],
  );

  return { highlights, control, toolRef, add, remove, clearAll };
}