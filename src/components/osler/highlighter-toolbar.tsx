"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Highlighter, Eraser, Trash2, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";
import { useIsMobile } from "@/hooks/use-mobile";
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

/**
 * HighlighterToolbar — touch-first highlighter control.
 *
 * Mobile: a single 36px toggle button. When active, a palette floats below
 * with 36px color swatches (≥44px tap target incl. padding) plus eraser,
 * count and clear. Tap any color to set the active color and keep
 * highlighting; tap the highlighter icon again to close.
 *
 * Desktop (md+): same palette renders inline next to the toggle.
 */
export function HighlighterToolbar({
  control,
  tone = "surface",
  className = "",
}: HighlighterToolbarProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { tool, color, count, onToolChange, onColorChange, onClearAll } = control;

  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const active = tool !== null;
  const isEraser = tool === ERASER_TOOL;

  /* ── Toggle button ────────────────────────────────────────────────── */
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
        : "text-muted-foreground hover:text-foreground hover:bg-muted",
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

  /* ── Action buttons (eraser, clear) ───────────────────────────────── */
  const actionBtnSize = "size-6";

  const eraserClass = cn(
    "flex items-center justify-center rounded-md transition-colors shrink-0",
    actionBtnSize,
    isEraser
      ? "bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/25"
      : tone === "header"
        ? "bg-primary-foreground/10 text-destructive/80 hover:bg-primary-foreground/20"
        : "text-destructive/80 hover:text-destructive hover:bg-muted",
  );

  const clearClass = cn(
    "flex items-center justify-center rounded-md transition-colors shrink-0",
    actionBtnSize,
    "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
  );

  /* ── Color swatches ──────────────────────────────────────────────── */
  const swatchSize = "size-4";
  const swatchBase = cn(
    "rounded-full ring-2 ring-transparent transition-all shrink-0",
    swatchSize,
  );

  /* ── Palette container ────────────────────────────────────────────── */
  const palette = (
    <div
      className={cn(
        "flex items-center gap-1 rounded-xl p-1.5 shadow-lg",
        isMobile && "gap-1.5 p-2",
        tone === "header"
          ? "border border-primary-foreground/15 bg-primary-foreground/10 backdrop-blur-md"
          : "border border-border/60 bg-card",
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
                : "hover:scale-110 ring-border/40",
            )}
            style={{ backgroundColor: resolveHighlightColor(key) }}
            title={t("highlighter.color", { label: HIGHLIGHT_PALETTE[key].label })}
            aria-label={t("highlighter.color", { label: HIGHLIGHT_PALETTE[key].label })}
            aria-pressed={selected}
          />
        );
      })}

      {/* Divider */}
      <div className={cn("w-px bg-border/60 mx-0.5", isMobile ? "h-7" : "h-4")} />

      {/* Eraser */}
      <button
        onClick={handleEraser}
        className={eraserClass}
        title={t("highlighter.eraser")}
        aria-label={t("highlighter.eraserLabel")}
        aria-pressed={isEraser}
      >
        <Eraser className={cn(isMobile ? "size-4" : "size-3")} />
      </button>

      {/* Count + clear */}
      {count > 0 && (
        <>
          <span
            className={cn(
              "px-1.5 text-[10px] tabular-nums text-muted-foreground font-medium",
              isMobile && "text-xs px-2",
            )}
          >
            {count}
          </span>
          <button
            onClick={() => setConfirmOpen(true)}
            className={clearClass}
            title={t("highlighter.clearAllLabel")}
            aria-label={t("highlighter.clearAllLabel")}
          >
            <Trash2 className={cn(isMobile ? "size-4" : "size-3")} />
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
        title={active ? t("highlighter.toggleOn") : t("highlighter.toggleOff")}
        aria-pressed={active}
      >
        <Highlighter className={cn(isMobile ? "size-4" : "size-3.5")} />
      </button>

      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -4 }}
            transition={{ duration: 0.15 }}
            className={cn(
              // Mobile: floating popover below the toggle so the palette
              // doesn't push other header items horizontally.
              // Desktop (md+): inline within the toolbar row.
              "absolute top-full mt-1.5 z-50 end-0",
              "md:static md:end-auto md:mt-0 md:z-auto",
            )}
          >
            {palette}
          </motion.div>
        )}
      </AnimatePresence>

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
