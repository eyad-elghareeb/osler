"use client";

import * as React from "react";
import { Highlighter, X, Trash2 } from "lucide-react";
import { ARTICLE_HIGHLIGHT_COLORS } from "@/lib/osler/article-highlights";
import type { UseArticleHighlighterReturn } from "@/hooks/use-article-highlighter";

interface HighlighterToolbarProps {
  ctrl: UseArticleHighlighterReturn;
  compact?: boolean;
  className?: string;
}

export function HighlighterToolbar({
  ctrl,
  compact = false,
  className = "",
}: HighlighterToolbarProps) {
  const {
    highlightMode,
    setHighlightMode,
    highlightColor,
    setHighlightColor,
    highlights,
    onColorPick,
    clearAll,
  } = ctrl;

  if (compact) {
    return (
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setHighlightMode(!highlightMode)}
          className={`size-8 rounded-lg flex items-center justify-center transition-colors ${
            highlightMode
              ? "bg-amber-400 text-amber-950"
              : "hover:bg-muted text-foreground"
          }`}
          title={highlightMode ? "Highlight mode ON — select text to auto-apply" : "Toggle highlight mode"}
          aria-pressed={highlightMode}
        >
          <Highlighter className="size-4" />
        </button>
        {highlightMode && ARTICLE_HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => {
              setHighlightColor(c);
              onColorPick(c);
            }}
            className={`size-5 rounded-full border-2 transition-all ${
              highlightColor === c
                ? "border-foreground scale-110"
                : "border-transparent hover:scale-110"
            }`}
            style={{ backgroundColor: c }}
            title={`Highlight ${c}`}
            aria-label={`Highlight color ${c}`}
          />
        ))}
        {highlightMode && highlights.length > 0 && (
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Clear all ${highlights.length} highlight${highlights.length === 1 ? "" : "s"}?`
                )
              ) {
                clearAll();
              }
            }}
            className="size-5 rounded-full hover:bg-muted flex items-center justify-center"
            title="Clear all highlights"
            aria-label="Clear all highlights"
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <button
        onClick={() => setHighlightMode(!highlightMode)}
        className={`size-8 rounded-lg flex items-center justify-center transition-colors ${
          highlightMode
            ? "bg-amber-400 text-amber-950"
            : "hover:bg-muted text-foreground"
        }`}
        title={highlightMode ? "Highlight mode ON — select text to auto-apply" : "Toggle highlight mode"}
        aria-pressed={highlightMode}
      >
        <Highlighter className="size-4" />
      </button>
      {highlightMode && (
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-card border border-border shadow-sm">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mr-1 flex items-center gap-1">
            <Highlighter className="size-3" />
            Select text:
          </span>
          {ARTICLE_HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setHighlightColor(c);
                onColorPick(c);
              }}
              className={`size-6 rounded-full border-2 transition-all ${
                highlightColor === c
                  ? "border-foreground scale-110"
                  : "border-transparent hover:scale-110"
              }`}
              style={{ backgroundColor: c }}
              title={`Highlight color ${c}`}
              aria-label={`Highlight color ${c}`}
            />
          ))}
          {highlights.length > 0 && (
            <>
              <div className="w-px h-5 bg-border mx-1" />
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {highlights.length}
              </span>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      `Clear all ${highlights.length} highlight${highlights.length === 1 ? "" : "s"}?`
                    )
                  ) {
                    clearAll();
                  }
                }}
                className="size-6 rounded-full hover:bg-muted flex items-center justify-center"
                title="Clear all highlights"
                aria-label="Clear all highlights"
              >
                <Trash2 className="size-3.5" />
              </button>
            </>
          )}
          <button
            onClick={() => setHighlightMode(false)}
            className="size-6 rounded-lg hover:bg-muted flex items-center justify-center ml-1"
            title="Exit highlight mode"
            aria-label="Exit highlight mode"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
