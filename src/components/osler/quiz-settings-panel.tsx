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
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePlatform } from "@/hooks/use-platform";
import { useQuizSettings } from "@/hooks/use-quiz-settings";
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

const FONT_SIZE_OPTIONS = [13, 14, 15, 16, 17, 18, 19, 20, 21];

const FONT_WEIGHT_OPTIONS: Array<{ id: number; key: string }> = [
  { id: 400, key: "qbank.settings.weight.400" },
  { id: 500, key: "qbank.settings.weight.500" },
  { id: 600, key: "qbank.settings.weight.600" },
  { id: 700, key: "qbank.settings.weight.700" },
];

const LINE_HEIGHT_OPTIONS = [1.3, 1.5, 1.7, 1.9, 2.1, 2.3];

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
  /** Optional sample stem text shown in the live preview block. */
  previewStem?: string;
  /** Optional sample choice text shown in the live preview block. */
  previewChoice?: string;
  /** Tone: "header" when invoked from the navy QBank header bar, "surface" otherwise */
  tone?: "header" | "surface";
}

export function QuizSettingsPanel({
  open,
  onClose,
  previewStem = "A 67-year-old man with a history of hypertension presents with crushing substernal chest pain radiating to the left arm. ECG shows ST elevations in leads II, III, and aVF. What is the most likely diagnosis?",
  previewChoice = "Acute inferior wall myocardial infarction",
  tone = "header",
}: QuizSettingsPanelProps) {
  const platform = usePlatform();
  const { t, rtl } = useI18n();
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

  // Resolve CSS family for the preview
  const previewFontFamily = React.useMemo(
    () => FONT_FAMILY_OPTIONS.find((o) => o.id === settings.fontFamily)?.cssFamily ?? "inherit",
    [settings.fontFamily],
  );

  // Alignment helper for the live preview — block-level alignment using
  // max-width + margin-auto. Same approach as in qbank-studio.
  const previewAlignClass = React.useMemo(() => {
    switch (settings.questionAlign) {
      case "center": return "mx-auto";
      case "right": return rtl ? "me-auto" : "ms-auto";
      case "left":
      default: return "";
    }
  }, [settings.questionAlign, rtl]);

  const previewMaxWidthClass = settings.questionAlign !== "left" ? "max-w-md" : "";

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

          {/* Font size */}
          <Field label={t("qbank.settings.fontSize")} hint={`${settings.fontSize}px`}>
            <div className="flex flex-wrap items-center gap-1">
              {FONT_SIZE_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => update({ fontSize: s })}
                  className={cn(
                    "size-8 rounded-md text-[11px] font-mono tabular-nums transition-colors",
                    settings.fontSize === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/40 hover:bg-muted text-muted-foreground"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
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

          {/* Line height */}
          <Field label={t("qbank.settings.lineHeight")} hint={settings.lineHeight.toFixed(1)}>
            <div className="flex flex-wrap items-center gap-1">
              {LINE_HEIGHT_OPTIONS.map((lh) => (
                <button
                  key={lh}
                  onClick={() => update({ lineHeight: lh })}
                  className={cn(
                    "size-8 rounded-md text-[11px] font-mono tabular-nums transition-colors",
                    settings.lineHeight === lh
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/40 hover:bg-muted text-muted-foreground"
                  )}
                >
                  {lh.toFixed(1)}
                </button>
              ))}
            </div>
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

        {/* Alignment */}
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

        {/* Live preview */}
        <Section
          icon={Check}
          title={t("qbank.settings.section.preview")}
          description={t("qbank.settings.section.preview.desc")}
        >
          <div className="rounded-lg border border-border bg-background p-4">
            {/* Stem block — alignment applies to the BLOCK, not inline text */}
            <div className={cn(previewMaxWidthClass, previewAlignClass)}>
              <div
                className="uworld-prose"
                style={{
                  fontFamily: previewFontFamily,
                  fontSize: `${settings.fontSize}px`,
                  fontWeight: settings.fontWeight,
                  lineHeight: settings.lineHeight,
                }}
              >
                {previewStem}
              </div>
            </div>

            {/* Choice block — alignment applies to the BLOCK */}
            <div className={cn("mt-3 flex items-center gap-2", previewMaxWidthClass, previewAlignClass)}>
              <div className="size-6 rounded-full border-2 border-border flex items-center justify-center text-[11px] font-semibold text-muted-foreground shrink-0">
                A
              </div>
              <div
                className={cn(
                  "flex-1 text-[14px] leading-relaxed pt-0.5",
                  !settings.textAffectsChoices && "font-normal"
                )}
                style={
                  settings.textAffectsChoices
                    ? {
                        fontFamily: previewFontFamily,
                        fontSize: `${settings.fontSize}px`,
                        fontWeight: settings.fontWeight,
                        lineHeight: settings.lineHeight,
                      }
                    : undefined
                }
              >
                {previewChoice}
              </div>
            </div>
          </div>
        </Section>

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
                  // On RTL, the resize handle sits on the visual right edge
                  // (which is the inline-start). On LTR it sits on the left
                  // edge of the right-docked sidebar.
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
