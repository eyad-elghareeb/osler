"use client";

import * as React from "react";
import { Highlighter, Eraser, Trash2, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import {
  HIGHLIGHT_COLOR_KEYS,
  HIGHLIGHT_PALETTE,
  ERASER_TOOL,
  resolveHighlightColor,
  type HighlightColorKey,
} from "@/lib/osler/highlight-palette";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

/**
 * HighlighterToolbar — compact, top-bar integrated highlighter control.
 *
 * Compact trigger in the top bar indicates active state, selected color dot,
 * or eraser mode. Clicking opens a sleek floating palette. Picking a color
 * or tool immediately auto-compacts back into the top bar, allowing effortless
 * text selection or erasing without cluttering the screen. Clicking the trigger
 * again re-opens the palette.
 */
export function HighlighterToolbar({
  control,
  tone = "surface",
  className = "",
}: HighlighterToolbarProps) {
  const { t } = useI18n();
  const { tool, color, count, onToolChange, onColorChange, onClearAll } = control;

  const [open, setOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const active = tool !== null;
  const isEraser = tool === ERASER_TOOL;
  const header = tone === "header";
  const activeColorKey = !isEraser && tool ? tool : color || HIGHLIGHT_COLOR_KEYS[0];

  /* ── Actions ────────────────────────────────────────────────────────── */
  const handleTriggerClick = () => {
    haptic("selection");
    if (!open && !active) {
      onToolChange(activeColorKey);
    }
    setOpen((prev) => !prev);
  };

  const handleColorPick = (key: HighlightColorKey) => {
    haptic("light");
    onColorChange(key);
    onToolChange(key);
    setOpen(false); // Auto-compacts immediately upon selection
  };

  const handleEraserPick = () => {
    haptic("selection");
    onToolChange(isEraser ? null : ERASER_TOOL);
    setOpen(false); // Auto-compacts immediately upon selection
  };

  const handleTurnOff = () => {
    haptic("selection");
    onToolChange(null);
    setOpen(false);
  };

  /* ── Trigger button styling ─────────────────────────────────────────── */
  const triggerClass = cn(
    "relative size-7 rounded-lg flex items-center justify-center transition-colors shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    active
      ? header
        ? "bg-primary-foreground/30 text-primary-foreground ring-1 ring-inset ring-primary-foreground/40"
        : "bg-primary/15 text-primary ring-1 ring-inset ring-primary/25"
      : header
        ? "bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25"
        : "text-muted-foreground hover:text-foreground hover:bg-muted",
  );

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={handleTriggerClick}
            className={triggerClass}
            title={active ? t("highlighter.toggleOn") : t("highlighter.toggleOff")}
            aria-label={active ? t("highlighter.toggleOn") : t("highlighter.toggleOff")}
            aria-pressed={active}
          >
            {isEraser ? (
              <Eraser className="size-3.5 text-destructive" />
            ) : (
              <Highlighter className="size-3.5" />
            )}

            {/* Active color dot indicator */}
            {active && !isEraser && (
              <span
                className="absolute bottom-0.5 end-0.5 size-2 rounded-full ring-1 ring-background shadow-xs pointer-events-none"
                style={{ backgroundColor: resolveHighlightColor(activeColorKey) }}
              />
            )}

            {/* Count pip when inactive but highlights exist */}
            {!active && count > 0 && (
              <span className="absolute -top-0.5 -end-0.5 size-2 rounded-full bg-primary ring-2 ring-background pointer-events-none" />
            )}
          </button>
        </PopoverTrigger>

        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={6}
          className="w-auto p-1.5 rounded-xl border border-border bg-popover/95 backdrop-blur-md shadow-lg flex items-center gap-1.5 z-50 animate-in fade-in-0 zoom-in-95"
        >
          {/* Swatches */}
          <div className="flex items-center gap-1">
            {HIGHLIGHT_COLOR_KEYS.map((key) => {
              const isSelected = tool === key;
              const swatch = HIGHLIGHT_PALETTE[key];
              const bg = resolveHighlightColor(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleColorPick(key)}
                  className={cn(
                    "size-6 sm:size-6.5 rounded-md transition-all flex items-center justify-center shrink-0",
                    isSelected
                      ? "scale-105 ring-2 ring-foreground/80 ring-offset-1 ring-offset-popover"
                      : "hover:scale-110 ring-1 ring-border/60",
                  )}
                  style={{ backgroundColor: bg }}
                  title={t("highlighter.color", { label: swatch.label })}
                  aria-label={t("highlighter.color", { label: swatch.label })}
                  aria-pressed={isSelected}
                >
                  {isSelected && (
                    <Check className="size-3 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="w-px h-5 bg-border shrink-0" />

          {/* Eraser Tool */}
          <button
            type="button"
            onClick={handleEraserPick}
            className={cn(
              "size-6 sm:size-6.5 rounded-md flex items-center justify-center transition-colors shrink-0",
              isEraser
                ? "bg-destructive/20 text-destructive ring-1 ring-inset ring-destructive/40"
                : "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
            )}
            title={t("highlighter.eraser")}
            aria-label={t("highlighter.eraserLabel")}
            aria-pressed={isEraser}
          >
            <Eraser className="size-3.5" />
          </button>

          {/* Turn Off / Power Button (when active) */}
          {active && (
            <button
              type="button"
              onClick={handleTurnOff}
              className="size-6 sm:size-6.5 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              title={t("highlighter.turnOff")}
              aria-label={t("highlighter.turnOff")}
            >
              <X className="size-3.5" />
            </button>
          )}

          {/* Highlights Count & Clear All */}
          {count > 0 && (
            <>
              <div className="w-px h-5 bg-border shrink-0" />
              <span
                className="inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-semibold tabular-nums bg-muted text-muted-foreground"
                title={t("highlighter.clearAllLabel")}
              >
                {count > 99 ? "99+" : count}
              </span>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="size-6 sm:size-6.5 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                title={t("highlighter.clearAllLabel")}
                aria-label={t("highlighter.clearAllLabel")}
              >
                <Trash2 className="size-3.5" />
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>

      {/* Clear All Confirmation Dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("highlighter.clearConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("highlighter.clearConfirmDesc", { count })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={() => {
                  haptic("warning");
                  onClearAll();
                  setConfirmOpen(false);
                }}
              >
                {t("highlighter.clearConfirm")}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
