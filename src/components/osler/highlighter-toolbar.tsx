"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Highlighter, Eraser, Trash2, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";
import { useIsMobile } from "@/hooks/use-mobile";
import { haptic } from "@/lib/osler/native";
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
 * Off state: a single compact toggle with a count pip when highlights exist.
 *
 * On state: an elevated palette panel anchored under the trigger. Mobile
 * gets a roomy two-row layout (≥36px swatch targets, labelled eraser,
 * count chip + clear, explicit Done button) because header rows are too
 * cramped for precise touch input; desktop (md+) keeps a one-row inline
 * pill. The palette never blocks article interactions — it closes via the
 * trigger, the Done button, or Escape (wired by each consumer).
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
  const header = tone === "header";

  /* ── Interactions (haptic on every pick, per the native-feel rule) ──── */
  const handleToggle = () => {
    haptic("selection");
    if (active) onToolChange(null);
    else onToolChange(color || HIGHLIGHT_COLOR_KEYS[0]);
  };

  const handleColor = (key: string) => {
    haptic("light");
    onColorChange(key);
    onToolChange(key);
  };

  const handleEraser = () => {
    haptic("selection");
    onToolChange(isEraser ? null : ERASER_TOOL);
  };

  /* ── Toggle button ────────────────────────────────────────────────── */

  const toggleClass = cn(
    "relative flex items-center justify-center rounded-lg transition-colors shrink-0",
    isMobile ? "size-9" : "size-7",
    active
      ? header
        ? "bg-primary-foreground/25 text-primary-foreground ring-1 ring-inset ring-primary-foreground/30"
        : "bg-primary/15 text-primary ring-1 ring-inset ring-primary/25"
      : header
        ? "bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25"
        : "text-muted-foreground hover:text-foreground hover:bg-muted",
  );

  /* ── Color swatch ──────────────────────────────────────────────────── */

  const swatchSize = isMobile ? "size-9" : "size-6";

  const renderSwatch = (key: (typeof HIGHLIGHT_COLOR_KEYS)[number]) => {
    const selected = tool === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => handleColor(key)}
        className={cn(
          "flex items-center justify-center rounded-lg transition-all shrink-0",
          swatchSize,
          selected
            ? cn("scale-105 ring-2", header ? "ring-primary-foreground ring-offset-1 ring-offset-primary" : "ring-foreground/70 ring-offset-2 ring-offset-card")
            : cn("hover:scale-110 ring-1", header ? "ring-primary-foreground/30" : "ring-border"),
        )}
        style={{ backgroundColor: resolveHighlightColor(key) }}
        title={t("highlighter.color", { label: HIGHLIGHT_PALETTE[key].label })}
        aria-label={t("highlighter.color", { label: HIGHLIGHT_PALETTE[key].label })}
        aria-pressed={selected}
      >
        {selected && (
          <Check className="size-3.5 text-white/95 drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]" />
        )}
      </button>
    );
  };

  /* ── Eraser / clear / done actions ─────────────────────────────────── */

  const actionBtnSize = isMobile ? "size-9" : "size-7";

  const eraserClass = cn(
    "flex items-center justify-center rounded-lg transition-colors shrink-0",
    actionBtnSize,
    isEraser
      ? header
        ? "bg-destructive/30 text-white ring-1 ring-inset ring-destructive/50"
        : "bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/30"
      : header
        ? "text-destructive/80 hover:text-destructive hover:bg-primary-foreground/15"
        : "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
  );

  const clearClass = cn(
    "flex items-center justify-center rounded-lg transition-colors shrink-0",
    actionBtnSize,
    header
      ? "text-primary-foreground/80 hover:text-white hover:bg-primary-foreground/20"
      : "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
  );

  const countChip = count > 0 && (
    <span
      className={cn(
        "inline-flex h-6 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums",
        header ? "bg-primary-foreground/15 text-primary-foreground" : "bg-muted text-muted-foreground",
      )}
      title={t("highlighter.clearAllLabel")}
    >
      {count > 99 ? "99+" : count}
    </span>
  );

  const divider = <div className={cn("w-px shrink-0", header ? "bg-primary-foreground/20" : "bg-border", isMobile ? "h-8" : "h-5")} />;

  /* ── Palette panel ──────────────────────────────────────────────────── */

  const panelClass = cn(
    "rounded-xl border shadow-e3 backdrop-blur-md",
    header
      ? "border-primary-foreground/15 bg-primary/80 text-primary-foreground"
      : "border-border bg-card/95",
  );

  // Mobile: two rows — colors on top, tools below — so every target stays
  // ≥36px without overflowing narrow headers.
  const mobilePanel = (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -4 }}
      transition={{ duration: 0.15 }}
      className={cn(panelClass, "absolute top-full mt-2 end-0 z-50 w-[17.5rem] p-2 flex flex-col gap-1.5")}
    >
      <div className="flex items-center justify-between gap-1">
        {HIGHLIGHT_COLOR_KEYS.map(renderSwatch)}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleEraser}
          className={cn(eraserClass, "w-auto px-2 gap-1.5 text-xs font-medium")}
          aria-pressed={isEraser}
        >
          <Eraser className="size-4" />
          <span>{t("highlighter.eraserLabel")}</span>
        </button>
        <div className="ms-auto flex items-center gap-1">
          {countChip}
          {count > 0 && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className={clearClass}
              title={t("highlighter.clearAllLabel")}
              aria-label={t("highlighter.clearAllLabel")}
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <Button
            size="sm"
            variant={header ? "secondary" : "default"}
            className="h-8 px-3 text-xs"
            onClick={() => {
              haptic("light");
              onToolChange(null);
            }}
          >
            <X className="size-3.5" />
            {t("highlighter.done")}
          </Button>
        </div>
      </div>
    </motion.div>
  );

  // Desktop (md+): one-row inline pill rendered next to the toggle.
  const desktopPanel = (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.12 }}
      className={cn(panelClass, "hidden md:flex items-center gap-1 p-1")}
    >
      {HIGHLIGHT_COLOR_KEYS.map(renderSwatch)}
      {divider}
      <button
        type="button"
        onClick={handleEraser}
        className={eraserClass}
        title={t("highlighter.eraser")}
        aria-label={t("highlighter.eraserLabel")}
        aria-pressed={isEraser}
      >
        <Eraser className="size-3.5" />
      </button>
      {count > 0 && (
        <>
          {countChip}
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className={clearClass}
            title={t("highlighter.clearAllLabel")}
            aria-label={t("highlighter.clearAllLabel")}
          >
            <Trash2 className="size-3.5" />
          </button>
        </>
      )}
    </motion.div>
  );

  return (
    <div className={cn("relative flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={handleToggle}
        className={toggleClass}
        title={active ? t("highlighter.toggleOn") : t("highlighter.toggleOff")}
        aria-pressed={active}
      >
        <Highlighter className="size-4" />
        {!active && count > 0 && (
          <span className="absolute -top-0.5 -end-0.5 size-2 rounded-full bg-primary ring-2 ring-background" />
        )}
      </button>

      <AnimatePresence>
        {active && (isMobile ? mobilePanel : desktopPanel)}
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
