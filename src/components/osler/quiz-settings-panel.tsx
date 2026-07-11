"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  AlignLeft,
  AlignCenter,
  AlignRight,
  RotateCcw,
  Sliders,
  BookOpenText,
  ScrollText,
  Zap,
  Sun,
  Moon,
  Plus,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePlatform } from "@/hooks/use-platform";
import { useQuizSettings } from "@/hooks/use-quiz-settings";
import { useOslerTheme } from "./theme-provider";
import { useI18n } from "./i18n-provider";
import {
  useResizableSidebar,
  SidebarResizeHandle,
} from "@/hooks/use-resizable-sidebar";
import type {
  QuizSettings,
  QuestionAlign,
} from "@/lib/osler/storage";

interface FontFamilyOption {
  id: QuizSettings["fontFamily"];
  sample: string;
  cssFamily: string;
}

const FONT_FAMILY_OPTIONS: FontFamilyOption[] = [
  { id: "system", sample: "Aa", cssFamily: "inherit" },
  { id: "serif", sample: "Aa", cssFamily: "Lora, Georgia, serif" },
  { id: "sans", sample: "Aa", cssFamily: "Inter, system-ui, sans-serif" },
  { id: "mono", sample: "Aa", cssFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
];

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 24;
const FONT_SIZE_STEP = 1;

const LINE_HEIGHT_MIN = 1.2;
const LINE_HEIGHT_MAX = 2.5;
const LINE_HEIGHT_STEP = 0.1;

const FONT_WEIGHT_OPTIONS: Array<{ id: number; key: string }> = [
  { id: 400, key: "qbank.settings.weight.400" },
  { id: 500, key: "qbank.settings.weight.500" },
  { id: 600, key: "qbank.settings.weight.600" },
  { id: 700, key: "qbank.settings.weight.700" },
];

const ALIGN_OPTIONS: Array<{
  id: QuestionAlign;
  key: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "left", key: "qbank.settings.align.left", icon: AlignLeft },
  { id: "center", key: "qbank.settings.align.center", icon: AlignCenter },
  { id: "right", key: "qbank.settings.align.right", icon: AlignRight },
];

interface QuizSettingsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Tone: "header" when invoked from the navy QBank header bar, "surface" otherwise */
  tone?: "header" | "surface";
}

export function QuizSettingsPanel({
  open,
  onClose,
  tone = "header",
}: QuizSettingsPanelProps) {
  const platform = usePlatform();
  const { t, rtl } = useI18n();
  const { theme, setTheme } = useOslerTheme();
  const { settings, update, reset } = useQuizSettings();
  const isPhone = platform.isPhone;

  const resizable = useResizableSidebar({
    storageKey: "osler-quiz-settings-width",
    defaultWidth: 384,
    minWidth: 320,
    maxWidth: 560,
    disabled: isPhone,
  });

  const headerTone =
    tone === "header"
      ? "bg-primary text-primary-foreground border-primary-foreground/10"
      : "bg-card text-foreground border-border";

  const isSplitMode = settings.explanationMode === "split";

  // Font size +/- handlers
  const decFontSize = () =>
    update({ fontSize: Math.max(FONT_SIZE_MIN, settings.fontSize - FONT_SIZE_STEP) });
  const incFontSize = () =>
    update({ fontSize: Math.min(FONT_SIZE_MAX, settings.fontSize + FONT_SIZE_STEP) });

  // Line height +/- handlers (rounded to 1 decimal)
  const decLineHeight = () =>
    update({ lineHeight: Math.round(Math.max(LINE_HEIGHT_MIN, settings.lineHeight - LINE_HEIGHT_STEP) * 10) / 10 });
  const incLineHeight = () =>
    update({ lineHeight: Math.round(Math.min(LINE_HEIGHT_MAX, settings.lineHeight + LINE_HEIGHT_STEP) * 10) / 10 });

  const content = (
    <div className="flex flex-col h-full bg-card text-foreground">
      {/* Header */}
      <div
        className={cn(
          "flex items-center gap-3 px-4 md:px-6 py-3 border-b shrink-0",
          headerTone
        )}
      >
        <div
          className={cn(
            "size-9 rounded-full flex items-center justify-center",
            tone === "header"
              ? "bg-primary-foreground/15"
              : "bg-primary/15 text-primary"
          )}
        >
          <Sliders className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{t("qbank.settings.title")}</h3>
          <p
            className={cn(
              "text-[11px]",
              tone === "header" ? "text-primary-foreground/70" : "text-muted-foreground"
            )}
          >
            {t("qbank.settings.subtitle")}
          </p>
        </div>
        <button
          onClick={onClose}
          className={cn(
            "size-7 rounded-lg flex items-center justify-center transition-colors",
            tone === "header"
              ? "hover:bg-primary-foreground/15"
              : "hover:bg-muted text-muted-foreground"
          )}
          aria-label={t("qbank.settings.close")}
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Scrollable settings body */}
      <div className="flex-1 overflow-y-auto medos-scroll px-4 md:px-6 py-5 space-y-7">
        {/* Theme switcher — quick dark/light toggle at the top */}
        <Section
          icon={theme === "dark" ? Moon : Sun}
          title={t("settings.theme.title")}
        >
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTheme("light")}
              className={cn(
                "flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 transition-all",
                theme === "light"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border hover:border-primary/40 text-muted-foreground"
              )}
            >
              <Sun className="size-4" />
              <span className="text-xs font-medium">{t("settings.theme.light")}</span>
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={cn(
                "flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 transition-all",
                theme === "dark"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border hover:border-primary/40 text-muted-foreground"
              )}
            >
              <Moon className="size-4" />
              <span className="text-xs font-medium">{t("settings.theme.dark")}</span>
            </button>
          </div>
        </Section>

        {/* Typography */}
        <Section
          icon={Zap}
          title={t("qbank.settings.section.typography")}
          description={t("qbank.settings.section.typography.desc")}
        >
          {/* Font family */}
          <Field label={t("qbank.settings.fontFamily")}>
            <div className="grid grid-cols-4 gap-2">
              {FONT_FAMILY_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => update({ fontFamily: opt.id })}
                  className={cn(
                    "flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border-2 transition-all",
                    settings.fontFamily === opt.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  <span
                    className="text-lg leading-none"
                    style={{ fontFamily: opt.cssFamily }}
                  >
                    {opt.sample}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t(`qbank.settings.fontFamily.${opt.id}`)}
                  </span>
                </button>
              ))}
            </div>
          </Field>

          {/* Font size — compact +/- stepper */}
          <Field label={t("qbank.settings.fontSize")} hint={`${settings.fontSize}px`}>
            <Stepper
              value={settings.fontSize}
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              onDec={decFontSize}
              onInc={incFontSize}
            />
          </Field>

          {/* Font weight */}
          <Field label={t("qbank.settings.fontWeight")}>
            <div className="grid grid-cols-4 gap-2">
              {FONT_WEIGHT_OPTIONS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => update({ fontWeight: w.id })}
                  style={{ fontWeight: w.id }}
                  className={cn(
                    "px-2 py-2 rounded-lg border-2 text-xs transition-all",
                    settings.fontWeight === w.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  )}
                >
                  {t(w.key)}
                </button>
              ))}
            </div>
          </Field>

          {/* Line height — compact +/- stepper */}
          <Field label={t("qbank.settings.lineHeight")} hint={settings.lineHeight.toFixed(1)}>
            <Stepper
              value={settings.lineHeight}
              min={LINE_HEIGHT_MIN}
              max={LINE_HEIGHT_MAX}
              step={LINE_HEIGHT_STEP}
              format={(v) => v.toFixed(1)}
              onDec={decLineHeight}
              onInc={incLineHeight}
            />
          </Field>

          {/* Apply to choices */}
          <Field
            label={t("qbank.settings.applyToChoices")}
            description={t("qbank.settings.applyToChoices.desc")}
            row
          >
            <Switch
              checked={settings.textAffectsChoices}
              onCheckedChange={(v) => update({ textAffectsChoices: v })}
            />
          </Field>
        </Section>

        {/* Behavior */}
        <Section
          icon={Zap}
          title={t("qbank.settings.section.behavior")}
          description={t("qbank.settings.section.behavior.desc")}
        >
          <Field
            label={t("qbank.settings.autoSubmit")}
            description={t("qbank.settings.autoSubmit.desc")}
            row
          >
            <Switch
              checked={settings.autoSubmit}
              onCheckedChange={(v) => update({ autoSubmit: v })}
            />
          </Field>

          <Field
            label={t("qbank.settings.explanationLayout")}
            description={t("qbank.settings.explanationLayout.desc")}
          >
            <div className="grid grid-cols-2 gap-2">
              <LayoutOption
                active={settings.explanationMode === "split"}
                onClick={() => update({ explanationMode: "split" })}
                icon={BookOpenText}
                label={t("qbank.settings.explanation.split")}
                description={t("qbank.settings.explanation.split.desc")}
              />
              <LayoutOption
                active={settings.explanationMode === "continuous"}
                onClick={() => update({ explanationMode: "continuous" })}
                icon={ScrollText}
                label={t("qbank.settings.explanation.continuous")}
                description={t("qbank.settings.explanation.continuous.desc")}
              />
            </div>
          </Field>
        </Section>

        {/* Alignment — hidden in 2-page (split) mode since alignment is forced to left there.
            Only shown in continuous mode where the alignment choice actually takes effect. */}
        {!isSplitMode && (
          <Section
            icon={AlignLeft}
            title={t("qbank.settings.section.alignment")}
            description={t("qbank.settings.section.alignment.desc")}
          >
            <div className="grid grid-cols-3 gap-2">
              {ALIGN_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = settings.questionAlign === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => update({ questionAlign: opt.id })}
                    className={cn(
                      "flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg border-2 transition-all",
                      active
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-primary/40 text-muted-foreground"
                    )}
                  >
                    <Icon className="size-4" />
                    <span className="text-[11px] font-medium">{t(opt.key)}</span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {/* Reset */}
        <div className="pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reset()}
            className="w-full h-9 rounded-lg"
          >
            <RotateCcw className="size-3.5 mr-1.5" />
            {t("qbank.settings.reset")}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={isPhone ? { y: "100%", opacity: 0 } : { x: rtl ? -360 : 360, opacity: 0 }}
          animate={isPhone ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 }}
          exit={isPhone ? { y: "100%", opacity: 0 } : { x: rtl ? -360 : 360, opacity: 0 }}
          transition={
            isPhone
              ? { type: "spring", damping: 32, stiffness: 320 }
              : { type: "spring", damping: 28, stiffness: 300 }
          }
          className={
            isPhone
              ? "fixed inset-0 z-50 bg-card flex flex-col safe-screen"
              : cn(
                  "fixed top-0 bottom-0 z-50 border-l border-border bg-card shadow-xl flex flex-col",
                  rtl ? "left-0" : "right-0",
                )
          }
          style={
            isPhone
              ? undefined
              : {
                  width: resizable.width ? `${resizable.width}px` : "24rem",
                }
          }
          role="dialog"
          aria-label={t("qbank.settings.title")}
        >
          {/* Resize handle (desktop only — sits on the inner edge) */}
          {!isPhone && (
            <SidebarResizeHandle
              onMouseDown={resizable.onDragHandleMouseDown}
              onTouchStart={resizable.onDragHandleTouchStart}
              active={resizable.isResizing}
              ariaLabel={t("sidebar.resize")}
            />
          )}
          {content}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Sub-components ────────────────────────────────────────────────── */

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 size-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon className="size-3.5" />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">{title}</h4>
          {description && (
            <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-3 ms-8">{children}</div>
    </section>
  );
}

function Field({
  label,
  description,
  hint,
  row,
  children,
}: {
  label: string;
  description?: string;
  hint?: string;
  row?: boolean;
  children: React.ReactNode;
}) {
  if (row) {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <label className="text-[11px] font-semibold text-foreground block">{label}</label>
          {description && (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {description}
            </p>
          )}
        </div>
        <div className="shrink-0 pt-0.5">{children}</div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-semibold text-foreground">{label}</label>
        {hint && (
          <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      {description && (
        <p className="text-[10px] text-muted-foreground leading-relaxed -mt-0.5">
          {description}
        </p>
      )}
      <div>{children}</div>
    </div>
  );
}

/** Compact +/- stepper for numeric values (font size, line height, etc.). */
function Stepper({
  value,
  min,
  max,
  step = 1,
  format,
  onDec,
  onInc,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onDec: () => void;
  onInc: () => void;
}) {
  const display = format ? format(value) : String(value);
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onDec}
        disabled={value <= min}
        className="size-8 rounded-md border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        aria-label="Decrease"
      >
        <Minus className="size-3.5" />
      </button>
      <div className="flex-1 h-8 rounded-md border border-border bg-card flex items-center justify-center text-sm font-mono tabular-nums text-foreground">
        {display}
      </div>
      <button
        onClick={onInc}
        disabled={value >= max}
        className="size-8 rounded-md border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        aria-label="Increase"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function LayoutOption({
  active,
  onClick,
  icon: Icon,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 px-3 py-2.5 rounded-lg border-2 text-start transition-all",
        active
          ? "border-primary bg-primary/5 text-primary"
          : "border-border hover:border-primary/40 text-muted-foreground"
      )}
    >
      <Icon className="size-4" />
      <div>
        <div className="text-xs font-semibold text-foreground">{label}</div>
        <div className="text-[10px] text-muted-foreground">{description}</div>
      </div>
    </button>
  );
}
