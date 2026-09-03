"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StructuredEditorProps } from "./structured/shared";

/**
 * Per-engine structured editors, each in its own chunk under ./structured/.
 * The admin content route only ever renders ONE editor at a time, so every
 * other editor's dependencies stay out of its initial bundle until selected.
 */
const mk = (loader: () => Promise<{ default: React.ComponentType<StructuredEditorProps> }>) =>
  dynamic(loader, { ssr: false, loading: () => <div className="h-40 rounded-lg bg-muted/40 animate-pulse" /> });

export const QuizEditor = mk(() => import("./structured/quiz-editor").then((m) => ({ default: m.QuizEditor })));
export const FlashcardEditor = mk(() => import("./structured/flashcard-editor").then((m) => ({ default: m.FlashcardEditor })));
export const OsceEditor = mk(() => import("./structured/osce-editor").then((m) => ({ default: m.OsceEditor })));
export const VideoEditor = mk(() => import("./structured/video-editor").then((m) => ({ default: m.VideoEditor })));
export const WrittenEditor = mk(() => import("./structured/written-editor").then((m) => ({ default: m.WrittenEditor })));
export const BankEditor = mk(() => import("./structured/bank-editor").then((m) => ({ default: m.BankEditor })));
export const MixedEditor = mk(() => import("./structured/mixed-editor").then((m) => ({ default: m.MixedEditor })));
export const LibraryArticleEditor = mk(() => import("./structured/library-article-editor").then((m) => ({ default: m.LibraryArticleEditor })));
export type { StructuredEditorProps } from "./structured/shared";

export function EditorNavigator({
  items,
  collapsed,
  onToggleCollapse,
  onJumpTo,
  labels,
}: {
  items: number;
  collapsed: Record<number, boolean>;
  onToggleCollapse: (i: number) => void;
  onJumpTo: (i: number) => void;
  labels?: string[];
}) {
  if (items <= 1) return null;
  const allCollapsed = Object.values(collapsed).filter((_, i) => i < items).every(Boolean);
  const noneCollapsed = Object.values(collapsed).filter((_, i) => i < items).every((v) => !v);
  return (
    <div className="sticky top-2 z-10 border border-border rounded-lg bg-card/90 backdrop-blur-sm p-2 space-y-2 shadow-e1">
      <div className="flex items-center gap-1 mb-1">
        <ListChecks className="size-3.5 text-primary" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Navigator ({items})
        </span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: items }, (_, i) => {
          const isCollapsed = collapsed[i] ?? false;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onJumpTo(i)}
              className={cn(
                "aspect-square rounded text-[11px] font-semibold tabular-nums border transition-all hover:border-primary/40",
                isCollapsed
                  ? "bg-muted/50 text-muted-foreground border-border"
                  : "bg-primary/10 text-primary border-primary/30",
              )}
              title={labels?.[i] ?? `Item ${i + 1}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1 pt-1 border-t border-border">
        <button
          type="button"
          onClick={() => { for (let i = 0; i < items; i++) if (!(collapsed[i] ?? false)) onToggleCollapse(i); }}
          disabled={allCollapsed}
          className="flex-1 text-[11px] font-medium px-1.5 py-1 rounded border border-border hover:border-primary/40 disabled:opacity-40"
        >
          Collapse all
        </button>
        <button
          type="button"
          onClick={() => { for (let i = 0; i < items; i++) if (collapsed[i] ?? false) onToggleCollapse(i); }}
          disabled={noneCollapsed}
          className="flex-1 text-[11px] font-medium px-1.5 py-1 rounded border border-border hover:border-primary/40 disabled:opacity-40"
        >
          Expand all
        </button>
      </div>
    </div>
  );
}
