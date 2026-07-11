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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

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

  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const active = tool !== null;
  const isEraser = tool === ERASER_TOOL;

  // All buttons in the toolbar match the surrounding header button size (size-7).
  // The toggle button is size-7 in both surface and header tones for consistency.
  const toggleSize = "size-7";

  const toggleClass = cn(
    "flex items-center justify-center rounded-lg transition-colors shrink-0",
    toggleSize,
    active
      ? tone === "header"
        ? "bg-primary-foreground/25 text-primary-foreground ring-1 ring-inset ring-primary-foreground/30"
        : "bg-primary/15 text-primary ring-1 ring-inset ring-primary/25"
      : tone === "header"
        ? "bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25"
        : "text-muted-foreground hover:text-foreground hover:bg-muted"
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

  // Eraser + clear buttons are slightly smaller (size-6) so the palette stays
  // compact. On touch devices the medos-touch-target class bumps them to 40px.
  const eraserClass = cn(
    "flex items-center justify-center rounded-md transition-colors size-6 shrink-0",
    isEraser
      ? "bg-destructive/15 text-destructive"
      : tone === "header"
        ? "bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20"
        : "text-muted-foreground hover:text-foreground hover:bg-muted"
  );

  // Swatches are size-4 (16px) — smaller than before (size-5) for a compact bar.
  const swatchBase =
    "size-4 rounded-full ring-2 ring-transparent transition-all shrink-0";

  const clearClass = cn(
    "flex items-center justify-center rounded-md transition-colors size-6 shrink-0",
    "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
  );

  // The palette content (color swatches + eraser + count + clear).
  // On mobile this floats below the toggle button as an absolute popover
  // so it doesn't push other header items horizontally. On md+ it stays
  // inline (static) inside the toolbar row.
  const palette = (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-lg p-1 shadow-sm animate-in fade-in-0 duration-150",
        tone === "header"
          ? "border border-primary-foreground/15 bg-primary-foreground/10 backdrop-blur-sm"
          : "border border-border/60 bg-card"
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
                ? "ring-foreground/60 scale-110"
                : "hover:scale-110"
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
        className={eraserClass}
        title="Erase highlights — tap a highlight to remove it"
        aria-label="Erase highlights"
        aria-pressed={isEraser}
      >
        <Eraser className="size-3" />
      </button>

      {count > 0 && (
        <>
          <div className="w-px h-4 bg-border/60 mx-0.5" />
          <span className="px-1 text-[10px] tabular-nums text-muted-foreground">
            {count}
          </span>
          <button
            onClick={() => setConfirmOpen(true)}
            className={clearClass}
            title="Clear all highlights"
            aria-label="Clear all highlights"
          >
            <Trash2 className="size-3" />
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className={cn("relative flex items-center gap-1", className)}>
      <button
        onClick={handleToggle}
        className={toggleClass}
        title={
          active
            ? "Highlighter on — pick a color or the eraser"
            : "Highlight text"
        }
        aria-pressed={active}
      >
        <Highlighter className="size-3.5" />
      </button>

      {active && (
        <>
          {/* Mobile: floating popover below the toggle button so the color
              palette doesn't push other header items horizontally.
              Desktop (md+): inline within the toolbar row. */}
          <div
            className={cn(
              "absolute top-full mt-1 z-50 end-0",
              "md:static md:end-auto md:mt-0 md:z-auto"
            )}
          >
            {palette}
          </div>
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all highlights?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all {count} highlight{count === 1 ? "" : "s"} on this
              item. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={() => {
                  onClearAll();
                  setConfirmOpen(false);
                }}
              >
                Clear all
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
