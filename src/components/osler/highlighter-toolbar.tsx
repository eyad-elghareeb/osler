"use client";

import * as React from "react";
import { Highlighter, Eraser, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HIGHLIGHT_COLOR_KEYS,
  HIGHLIGHT_PALETTE,
  ERASER_TOOL,
  resolveHighlightColor,
} from "@/lib/osler/highlight-palette";

export interface HighlighterControl {
  /** null = off, "eraser" = erase tool, otherwise a color key */
  tool: string | null;
  /** currently selected color key (last picked) */
  color: string;
  /** number of highlights present */
  count: number;
  onToolChange: (t: string | null) => void;
  onColorChange: (c: string) => void;
  onClearAll: () => void;
}

interface HighlighterToolbarProps {
  control: HighlighterControl;
  /** "surface" for light card areas (Library), "header" for the QBank navy bar */
  tone?: "surface" | "header";
  className?: string;
}

export function HighlighterToolbar({
  control,
  tone = "surface",
  className = "",
}: HighlighterToolbarProps) {
  const { tool, color, count, onToolChange, onColorChange, onClearAll } = control;

  const active = tool !== null;
  const isEraser = tool === ERASER_TOOL;

  const toggleButtonClass = cn(
    "size-8 rounded-lg flex items-center justify-center transition-colors shrink-0 medos-touch-target",
    active
      ? "bg-amber-400 text-amber-950"
      : tone === "header"
        ? "bg-primary-foreground/15 hover:bg-primary-foreground/25 text-primary-foreground"
        : "bg-muted hover:bg-muted/70 text-foreground"
  );

  const handleToggle = () => {
    if (active) onToolChange(null);
    else onToolChange(color || HIGHLIGHT_COLOR_KEYS[0]);
  };

  const handleColor = (key: string) => {
    onColorChange(key);
    onToolChange(key);
  };

  const handleEraser = () => {
    onToolChange(isEraser ? null : ERASER_TOOL);
  };

  const swatchBase =
    "size-6 rounded-full border-2 transition-all medos-touch-target";

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        onClick={handleToggle}
        className={toggleButtonClass}
        title={
          active
            ? "Highlighter on — pick a color or tap a color to highlight"
            : "Highlight text"
        }
        aria-pressed={active}
      >
        <Highlighter className="size-4" />
      </button>

      {active && (
        <div
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-lg border border-border shadow-sm",
            tone === "header" ? "bg-primary-foreground/10" : "bg-card"
          )}
        >
          {HIGHLIGHT_COLOR_KEYS.map((key) => {
            const selected = tool === key;
            return (
              <button
                key={key}
                onClick={() => handleColor(key)}
                className={cn(
                  swatchBase,
                  selected
                    ? "border-foreground scale-110"
                    : "border-transparent hover:scale-110"
                )}
                style={{ backgroundColor: resolveHighlightColor(key) }}
                title={`Highlight ${HIGHLIGHT_PALETTE[key].label}`}
                aria-label={`Highlight ${HIGHLIGHT_PALETTE[key].label}`}
                aria-pressed={selected}
              />
            );
          })}

          <button
            onClick={handleEraser}
            className={cn(
              "size-6 rounded-lg flex items-center justify-center transition-all medos-touch-target",
              isEraser
                ? "bg-red-400 text-red-950 scale-110"
                : tone === "header"
                  ? "bg-primary-foreground/15 hover:bg-primary-foreground/25 text-primary-foreground"
                  : "bg-muted hover:bg-muted/70 text-foreground"
            )}
            title="Erase highlights — tap a highlight to remove it"
            aria-label="Erase highlights"
            aria-pressed={isEraser}
          >
            <Eraser className="size-3.5" />
          </button>

          {count > 0 && (
            <>
              <div
                className={cn(
                  "w-px h-5 mx-0.5",
                  tone === "header" ? "bg-primary-foreground/20" : "bg-border"
                )}
              />
              <span className="text-[10px] text-muted-foreground tabular-nums px-0.5">
                {count}
              </span>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      `Clear all ${count} highlight${count === 1 ? "" : "s"}?`
                    )
                  ) {
                    onClearAll();
                  }
                }}
                className={cn(
                  "size-6 rounded-full flex items-center justify-center transition-colors medos-touch-target",
                  tone === "header"
                    ? "hover:bg-primary-foreground/20 text-primary-foreground"
                    : "hover:bg-muted text-foreground"
                )}
                title="Clear all highlights"
                aria-label="Clear all highlights"
              >
                <Trash2 className="size-3.5" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
