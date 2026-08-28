"use client";

/**
 * Osler shared UI primitives — the canonical building blocks for hub views.
 *
 * These components encode the design rules documented in `AGENTS.md →
 * Design System` and the adoption playbook in `docs/design-library-roadmap.md`.
 * Always prefer these over re-rolling the same Tailwind string in every
 * component.
 *
 * Components exposed:
 *   - <PageHeader>           eyebrow + title + subtitle (block or inline)
 *   - <SectionHeading>       small uppercase label that introduces a section
 *   - <EmptyState>           centered icon + title + body + optional actions
 *   - <LoadingState>         centered spinner + optional caption
 *   - <StatTile>             label + big value + optional icon, semantic colors
 *   - <Card> / <InteractiveCard>  thin wrappers that pin the canonical card recipe
 *   - <SegmentedControl>     Origin/Coss UI pattern — animated option toggle
 *   - <FormField>            Origin UI grouped field — label + control + hint/error
 *   - <Combobox>             Coss UI pattern — searchable select on existing Popover+Command
 *   - <PopoverForm>          Cult UI pattern — single/two-field inline form, no full dialog
 *   - <MetricBar>            compact labelled progress bar
 *   - <ChartCard>            wrapper for Recharts/TanStack chart surfaces
 *
 * Why a separate file: every hub view (Dashboard, Learn, QBank, Flashcards,
 * OSCE, Videos, Profile, Settings) used to hand-roll its own version of
 * these patterns with slightly different padding / radius / typography.
 * Centralising them here makes future drift impossible.
 */

import * as React from "react";
import { Loader2, ChevronRight, Check, ChevronsUpDown, Construction, type LucideIcon } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  MOTION_TRANSITION,
  MOTION_SPRING,
  easeOut,
  fadeUp,
  staggerContainer,
  pressFeedback,
} from "@/lib/osler/motion";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";
import { useI18n } from "./i18n-provider";

/* ─── PageHeader ─────────────────────────────────────────────────────── */

interface PageHeaderProps {
  /** Small uppercase label above the title. Optional. */
  eyebrow?: React.ReactNode;
  /** Optional icon rendered inside the eyebrow (typically a tiny lucide icon). */
  eyebrowIcon?: LucideIcon;
  /** The page H1. Required. */
  title: React.ReactNode;
  /** One-line muted subtitle below the title. Optional. */
  subtitle?: React.ReactNode;
  /** Inline variant: icon chip + title + subtitle in a row instead of stacked. */
  inline?: boolean;
  /** Icon chip rendered to the start of the inline header. Ignored when not inline. */
  inlineIcon?: LucideIcon;
  /** Accent color for the inline icon chip (CSS color string). Defaults to `var(--primary)`. */
  inlineIconColor?: string;
  /** Optional right-aligned actions (buttons, badges, etc.). */
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  subtitle,
  inline = false,
  inlineIcon: InlineIcon,
  inlineIconColor,
  actions,
  className,
}: PageHeaderProps) {
  if (inline) {
    return (
      <div className={cn("osler-page-header--inline", className)}>
        {InlineIcon && (
          <div
            className="size-10 rounded-xl flex items-center justify-center shrink-0 border"
            style={{
              backgroundColor: `color-mix(in oklch, ${inlineIconColor ?? "var(--primary)"} 12%, transparent)`,
              borderColor: `color-mix(in oklch, ${inlineIconColor ?? "var(--primary)"} 30%, transparent)`,
              color: inlineIconColor ?? "var(--primary)",
            }}
          >
            <InlineIcon className="size-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="osler-page-header__eyebrow">
              {EyebrowIcon && <EyebrowIcon className="size-3" />}
              {eyebrow}
            </p>
          )}
          <h1 className="osler-page-header__title">{title}</h1>
          {subtitle && <p className="osler-page-header__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    );
  }

  return (
    <div className={cn("osler-page-header", className)}>
      {eyebrow && (
        <p className="osler-page-header__eyebrow">
          {EyebrowIcon && <EyebrowIcon className="size-3" />}
          {eyebrow}
        </p>
      )}
      <h1 className="osler-page-header__title">{title}</h1>
      {subtitle && <p className="osler-page-header__subtitle">{subtitle}</p>}
      {actions && <div className="flex items-center gap-2 mt-3">{actions}</div>}
    </div>
  );
}

/* ─── SectionHeading ────────────────────────────────────────────────── */

interface SectionHeadingProps {
  /** Optional icon rendered before the label. */
  icon?: LucideIcon;
  children: React.ReactNode;
  /** Optional right-aligned actions (e.g. "View all" link). */
  actions?: React.ReactNode;
  /** Optional numbered circle (1, 2, 3…) shown before the label. Renders a
   *  small `size-5 rounded-full bg-primary/10 text-primary` chip. Use for
   *  stepped flows where the order matters (Create Test, onboarding). */
  number?: number;
  /** Optional muted description shown below the label. */
  description?: React.ReactNode;
  className?: string;
}

export function SectionHeading({ icon: Icon, children, actions, number, description, className }: SectionHeadingProps) {
  const label = (
    <h2 className="osler-section-heading mb-0 flex items-center gap-2">
      {typeof number === "number" && (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold tabular-nums text-primary shrink-0">
          {number}
        </span>
      )}
      {Icon && <Icon className="size-4" />}
      <span>{children}</span>
    </h2>
  );
  const block = description ? (
    <div>
      {label}
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
    </div>
  ) : label;

  if (actions) {
    return (
      <div className={cn("flex items-center justify-between mb-3 gap-3", className)}>
        {block}
        {actions}
      </div>
    );
  }
  return (
    <div className={cn(description ? "mb-3" : void 0, className)}>
      {block}
    </div>
  );
}

/* ─── SectionLabel ────────────────────────────────────────────────────
 * Tiny uppercase label used inside cards/dialogs where a full SectionHeading
 * is too heavy. Replaces ad-hoc `<div className="mb-2 flex items-center gap-1.5
 * text-xs font-semibold uppercase tracking-wider text-muted-foreground">`
 * strings scattered across the app.
 */

interface SectionLabelProps {
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}

export function SectionLabel({ icon: Icon, children, className }: SectionLabelProps) {
  return (
    <div className={cn("mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground", className)}>
      {Icon && <Icon className="size-3.5 text-primary" />}
      {children}
    </div>
  );
}

/* ─── EmptyState ────────────────────────────────────────────────────── */

interface EmptyStateProps {
  /** Lucide icon component shown inside the muted circle. */
  icon?: LucideIcon;
  /** Bold one-line title. */
  title: React.ReactNode;
  /** Optional muted body text. */
  description?: React.ReactNode;
  /** Optional call-to-action rendered below the body. */
  actions?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <motion.div
      className={cn("osler-empty", className)}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
      }}
    >
      {Icon && (
        <motion.div
          className="osler-empty__icon"
          variants={{
            hidden: { opacity: 0, scale: 0.85, y: 4 },
            visible: {
              opacity: 1,
              scale: 1,
              y: 0,
              transition: MOTION_SPRING.soft,
            },
          }}
        >
          <Icon className="size-6" />
        </motion.div>
      )}
      <motion.h3
        className="osler-empty__title"
        variants={{
          hidden: { opacity: 0, y: 4 },
          visible: { opacity: 1, y: 0, transition: MOTION_TRANSITION.base },
        }}
      >
        {title}
      </motion.h3>
      {description && (
        <motion.p
          className="osler-empty__body"
          variants={{
            hidden: { opacity: 0, y: 4 },
            visible: { opacity: 1, y: 0, transition: MOTION_TRANSITION.base },
          }}
        >
          {description}
        </motion.p>
      )}
      {actions && (
        <motion.div
          className="flex items-center gap-2 mt-2"
          variants={{
            hidden: { opacity: 0, y: 4 },
            visible: { opacity: 1, y: 0, transition: MOTION_TRANSITION.base },
          }}
        >
          {actions}
        </motion.div>
      )}
    </motion.div>
  );
}

/* ─── ComingSoonState ───────────────────────────────────────────────── */

interface ComingSoonStateProps {
  /** Optional lucide icon override (defaults to Construction). */
  icon?: LucideIcon;
  /** Optional title override (defaults to the shared "Coming soon" label). */
  title?: React.ReactNode;
  /** Optional description override. */
  description?: React.ReactNode;
  className?: string;
}

/**
 * ComingSoonState — the canonical empty state for modules/sections whose
 * content has not been published yet. Distinguishes "this space is empty
 * because nothing ships here yet" from the user-facing "no results" case
 * handled by <EmptyState>.
 */
export function ComingSoonState({ icon: Icon = Construction, title, description, className }: ComingSoonStateProps) {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={Icon}
      title={title ?? t("common.comingSoon")}
      description={description ?? t("common.comingSoonDesc")}
      className={className}
    />
  );
}

/* ─── LoadingState ──────────────────────────────────────────────────── */

interface LoadingStateProps {
  /** Optional caption shown below the spinner. */
  label?: React.ReactNode;
  /** Spinner size in pixels. Defaults to 24 (size-6). */
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LoadingState({ label, size = "md", className }: LoadingStateProps) {
  const sz = size === "sm" ? "size-5" : size === "lg" ? "size-7" : "size-6";
  return (
    <motion.div
      className={cn("osler-loading", className)}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={MOTION_TRANSITION.base}
    >
      <Loader2 className={cn(sz, "animate-spin text-muted-foreground")} />
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </motion.div>
  );
}

/* ─── StatTile ──────────────────────────────────────────────────────── */

export interface StatTileProps {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: LucideIcon;
  /** Semantic accent color for the icon. Defaults to `text-primary`. */
  color?: "primary" | "success" | "warning" | "destructive" | "info";
  /** Compact variant — use in 3-column dense grids (QBank/Flashcard hubs). */
  compact?: boolean;
  /**
   * Optional trend indicator rendered beside the value — typically a
   * `<SparkTrend>` from `analytics-primitives.tsx`. Omit entirely rather
   * than passing one for a tile that has no time-series backing it; this
   * is additive polish, not a required part of the tile.
   */
  trend?: React.ReactNode;
  /** Optional content pinned below the value row (e.g. a `<MetricBar>`). */
  footer?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

const STAT_TILE_COLOR: Record<NonNullable<StatTileProps["color"]>, string> = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-info",
};

export function StatTile({
  label,
  value,
  icon: Icon,
  color = "primary",
  compact = false,
  trend,
  footer,
  onClick,
  className,
}: StatTileProps) {
  const Container = onClick ? motion.button : motion.div;
  return (
    <Container
      type={onClick ? "button" : undefined}
      onClick={onClick}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={MOTION_TRANSITION.base}
      whileHover="hover"
      whileTap={onClick ? { scale: 0.98 } : undefined}
      className={cn(
        "text-left",
        compact ? "osler-stat-tile--compact" : "osler-stat-tile",
        onClick && "cursor-pointer transition-all",
        className,
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="osler-stat-tile__label">{label}</span>
        {Icon && (
          <motion.span
            className="inline-flex"
            variants={{ hover: { scale: 1.12 } }}
            transition={MOTION_SPRING.snappy}
          >
            <Icon className={cn("size-4", STAT_TILE_COLOR[color])} />
          </motion.span>
        )}
      </div>
      <div className="osler-stat-tile__row">
        <div className="osler-stat-tile__value min-w-0">{value}</div>
        {trend && <div className="shrink-0 pb-0.5">{trend}</div>}
      </div>
      {footer}
    </Container>
  );
}

/* ─── Card / InteractiveCard ────────────────────────────────────────── */

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Card padding scale. `default` = p-4, `compact` = p-3, `roomy` = p-5 md:p-6. */
  padding?: "compact" | "default" | "roomy";
}

export function OslerCard({ padding = "default", className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        padding === "compact" && "osler-card--compact",
        padding === "default" && "osler-card--default",
        padding === "roomy" && "osler-card--roomy",
        className,
      )}
      {...props}
    />
  );
}

interface InteractiveCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional animation delay (ms) for the osler-fade-in mount animation. */
  animationDelay?: number;
  /** Disable the mount animation. */
  noAnimation?: boolean;
}

export function InteractiveCard({
  animationDelay,
  noAnimation,
  className,
  ...props
}: InteractiveCardProps) {
  return (
    <div
      className={cn(
        "osler-card--interactive",
        !noAnimation && "osler-fade-in",
        className,
      )}
      style={animationDelay !== undefined ? { animationDelay: `${animationDelay}ms` } : undefined}
      {...props}
    />
  );
}

/* ─── SegmentedControl ────────────────────────────────────────────────
 * Origin/Coss UI pattern, adapted to Osler tokens. A compact option
 * toggle with a sliding thumb driven by Framer Motion `layout`. Use for
 * 2–4 mutually exclusive options in Settings, QBank setup, and Profile.
 * Pattern source: docs/design-library-roadmap.md § "Upgrade form ergonomics"
 */

export interface SegmentedOption<T extends string = string> {
  /** Unique value for this option. */
  value: T;
  /** Visible label. */
  label: React.ReactNode;
  /** Optional icon rendered before the label. */
  icon?: LucideIcon;
  /** Disable this option. */
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string = string> {
  /** Available options. */
  options: SegmentedOption<T>[];
  /** Currently selected value. */
  value: T;
  /** Called when the user picks an option. */
  onChange: (value: T) => void;
  /** Optional accessible label for the group. */
  label?: string;
  /** Stretch to fill the parent width. */
  fullWidth?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  label,
  fullWidth = false,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("osler-segmented relative", fullWidth && "w-full", className)}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onChange(opt.value)}
            className={cn(
              "osler-segmented__item relative z-10",
              fullWidth && "flex-1",
            )}
          >
            {selected && (
              <motion.span
                layoutId={`seg-thumb-${label ?? "anon"}`}
                className="osler-segmented__thumb"
                transition={MOTION_SPRING.snappy}
              />
            )}
            {Icon && <Icon className="size-3.5" />}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ─── FormField ───────────────────────────────────────────────────────
 * Origin UI grouped field pattern. Wraps a label + control + optional
 * description / error / hint with consistent vertical rhythm. The inner
 * control can be any input / select / textarea — FormField just provides
 * the layout and a `htmlFor` link.
 *
 * Pattern source: docs/design-library-roadmap.md § "Upgrade form ergonomics"
 */

interface FormFieldProps {
  /** `id` of the input control this label is for. Required for a11y. */
  htmlFor?: string;
  /** Visible label text. */
  label: React.ReactNode;
  /** Optional lucide icon rendered before the label. */
  icon?: LucideIcon;
  /** Optional muted description shown between label and control. */
  description?: React.ReactNode;
  /** When set, the field is marked invalid and the message is shown. */
  error?: React.ReactNode;
  /** Optional muted hint shown below the control (e.g. "12 characters minimum"). */
  hint?: React.ReactNode;
  /** Mark the label with a required asterisk. */
  required?: boolean;
  /** The control element. */
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  htmlFor,
  label,
  icon: Icon,
  description,
  error,
  hint,
  required = false,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn("osler-form-field", className)}>
      <label htmlFor={htmlFor} className="osler-form-field__label">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        <span>{label}</span>
        {required && <span className="text-destructive">*</span>}
      </label>
      {description && <p className="osler-form-field__description">{description}</p>}
      {children}
      {error ? (
        <p className="osler-form-field__error">{error}</p>
      ) : hint ? (
        <p className="osler-form-field__hint">{hint}</p>
      ) : null}
    </div>
  );
}

/* ─── Combobox ────────────────────────────────────────────────────────
 * Searchable single-select. Pattern reference: Coss UI's `Combobox`
 * (`docs/design-library-roadmap.md` § "Next-wave candidate additions").
 * Coss UI's own version is built on Base UI; per the roadmap's guardrail
 * to port the pattern rather than the dependency, this composes Osler's
 * *existing* Radix-based `Popover` + `Command` (cmdk) primitives instead
 * — no new dependency, same interaction shape (type-to-filter, keyboard
 * nav, empty state).
 *
 * Use this over a plain `<select>` once a list is long enough, or its
 * option labels long enough, that scanning beats native `<select>` UX —
 * e.g. the AI-assistant model picker. For a handful of short, stable
 * options (2–4 items), a `<SegmentedControl>` or plain popover list is
 * still the right, lighter-weight choice.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional secondary line shown under the label, e.g. a model description. */
  description?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Accessible label for the trigger button. */
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results found.",
  className,
  disabled,
  ...rest
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);
  const listId = React.useId();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={rest["aria-label"]}
          disabled={disabled}
          className={cn(
            "w-full h-9 rounded-lg border border-border bg-card px-3 text-sm",
            "flex items-center justify-between gap-2 transition-colors",
            "hover:border-primary/40 focus:outline-none focus-visible:border-primary",
            "disabled:opacity-50 disabled:pointer-events-none",
            className,
          )}
        >
          <span className={cn("truncate text-start", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="text-sm" />
          <CommandList id={listId}>
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              {emptyText}
            </CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={`${opt.label} ${opt.description ?? ""}`}
                  onSelect={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className="flex items-start gap-2"
                >
                  <Check
                    className={cn(
                      "size-3.5 mt-0.5 shrink-0",
                      opt.value === value ? "opacity-100 text-primary" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{opt.label}</span>
                    {opt.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {opt.description}
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ─── PopoverForm ─────────────────────────────────────────────────────
 * Cult UI's "Popover Form" pattern — a single/two-field create/edit form
 * that lives inside a Popover instead of a full modal Dialog. Reserved
 * for genuinely small forms (per the roadmap guardrail: 1–2 fields max;
 * escalate to a real Dialog past that, since a Popover has no true focus
 * trap or backdrop and shouldn't carry a large form's weight).
 *
 * Good fit: "New folder", "New file", quick single-field rename — actions
 * currently anchored to a stable toolbar button. Not a fit for anything
 * triggered from a context menu without a persistent anchor element, or
 * for multi-field forms — those stay as Dialogs.
 *
 * Pattern source: docs/design-library-roadmap.md § "Next-wave candidate
 * additions" (Cult UI). Built on Osler's existing Popover primitive, no
 * new dependency.
 */

interface PopoverFormProps {
  /** Trigger element — typically the existing toolbar button. Rendered with `asChild`. */
  trigger: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  onSubmit: () => void;
  submitLabel: React.ReactNode;
  submitIcon?: LucideIcon;
  submitDisabled?: boolean;
  submitPending?: boolean;
  cancelLabel?: React.ReactNode;
  /** Form field(s) — keep to 1–2 for this pattern; use a Dialog beyond that. */
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}

export function PopoverForm({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  submitLabel,
  submitIcon: SubmitIcon,
  submitDisabled = false,
  submitPending = false,
  cancelLabel = "Cancel",
  children,
  align = "start",
  className,
}: PopoverFormProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className={cn("w-80 p-4", className)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!submitDisabled && !submitPending) onSubmit();
          }}
          className="space-y-3"
        >
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
          {children}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-8 px-3 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted/60 transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              disabled={submitDisabled || submitPending}
              className={cn(
                "h-8 px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5",
                "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
                "disabled:opacity-50 disabled:pointer-events-none",
              )}
            >
              {submitPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                SubmitIcon && <SubmitIcon className="size-3.5" />
              )}
              {submitLabel}
            </button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/* ─── MetricBar ───────────────────────────────────────────────────────
 * Compact labelled progress bar. Use inside StatTile-like surfaces to
 * show a percentage or ratio without taking the room of a full chart.
 */

interface MetricBarProps {
  /** Current value (0..max). */
  value: number;
  /** Max value. Defaults to 100. */
  max?: number;
  /** Semantic color for the fill. Defaults to primary. */
  color?: "primary" | "success" | "warning" | "destructive" | "info";
  /** Optional accessible label. */
  label?: string;
  className?: string;
}

const METRIC_BAR_COLOR: Record<NonNullable<MetricBarProps["color"]>, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
};

export function MetricBar({
  value,
  max = 100,
  color = "primary",
  label,
  className,
}: MetricBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={cn("osler-metric-bar", className)}
    >
      <div
        className={cn("osler-metric-bar__fill", METRIC_BAR_COLOR[color])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ─── ChartCard ───────────────────────────────────────────────────────
 * Shared analytics surface — see analytics-primitives.tsx for the full
 * chart vocabulary (ChartContainer, ChartTooltip, ChartEmpty, etc.).
 * ChartCard is the lightweight wrapper for embedding a chart + title
 * + optional actions in any hub view.
 */

interface ChartCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Compact variant — smaller padding for dense dashboards. */
  compact?: boolean;
}

export function ChartCard({
  title,
  subtitle,
  actions,
  compact = false,
  className,
  children,
  ...props
}: ChartCardProps) {
  return (
    <div
      className={cn("osler-chart-card", compact && "p-3", className)}
      {...props}
    >
      {(title || actions) && (
        <div className="osler-chart-card__header">
          <div className="min-w-0">
            {title && <h3 className="osler-chart-card__title truncate">{title}</h3>}
            {subtitle && <p className="osler-chart-card__subtitle truncate">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </div>
      )}
      <div className="osler-chart-card__body">{children}</div>
    </div>
  );
}

/* ─── AnimatedDisclosure (Motion Primitives pattern) ──────────────────
 * Adapts the Motion Primitives "disclosure" pattern: an inline header
 * button that toggles a smooth height + opacity transition on the body.
 * Use for Settings sections, QBank explanation panels, and any
 * expandable content where Accordion (which is one-of-many) is too
 * restrictive.
 *
 * Pattern source: `docs/design-library-roadmap.md` § "Establish an
 * interaction layer" — disclosure is listed as a high-value first
 * candidate.
 */

interface AnimatedDisclosureProps {
  /** Visible label for the trigger. */
  label: React.ReactNode;
  /** Optional icon rendered before the label. */
  icon?: LucideIcon;
  /** Controlled open state. When omitted, the component is uncontrolled. */
  open?: boolean;
  /** Initial open state for uncontrolled usage. Defaults to false. */
  defaultOpen?: boolean;
  /** Called when the open state changes. */
  onOpenChange?: (open: boolean) => void;
  /** Optional right-aligned actions rendered in the header (e.g. a "Edit" button). */
  actions?: React.ReactNode;
  /** The expandable content. */
  children: React.ReactNode;
  className?: string;
}

export function AnimatedDisclosure({
  label,
  icon: Icon,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  actions,
  children,
  className,
}: AnimatedDisclosureProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const toggle = React.useCallback(() => {
    const next = !open;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }, [open, isControlled, onOpenChange]);

  return (
    <div className={cn("osler-card--default", className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex items-center gap-2 flex-1 min-w-0 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-md"
        >
          {Icon && <Icon className="size-4 text-muted-foreground shrink-0" />}
          <span className="text-sm font-semibold truncate">{label}</span>
          <motion.span
            animate={{ rotate: open ? 90 : 0 }}
            transition={MOTION_TRANSITION.quick}
            className="ms-auto text-muted-foreground shrink-0"
            aria-hidden
          >
            <ChevronRight className="size-4" />
          </motion.span>
        </button>
        {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={MOTION_TRANSITION.normal}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-border">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── SkeletonText / SkeletonCard (21st.dev-inspired) ─────────────────
 * Composed skeleton patterns for the most common loading layouts:
 * a paragraph of varied-width lines, and a card with header + body.
 * Saves every view from re-rolling the same skeleton recipe.
 */

interface SkeletonTextProps {
  /** Number of lines. Defaults to 3. */
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: i === lines - 1 ? "60%" : "100%" }}
        />
      ))}
    </div>
  );
}

interface SkeletonCardProps {
  /** Show the header icon + title placeholder. Defaults to true. */
  header?: boolean;
  /** Number of body lines. Defaults to 3. Set to 0 for header-only. */
  lines?: number;
  className?: string;
}

export function SkeletonCard({ header = true, lines = 2, className }: SkeletonCardProps) {
  return (
    <div className={cn("osler-card--roomy min-h-[168px] flex flex-col justify-between", className)}>
      <div>
        {header && (
          <div className="flex items-center gap-3.5 mb-3">
            <Skeleton className="size-12 rounded-xl shrink-0" />
            <div className="flex flex-col gap-2 flex-1 min-w-0">
              <Skeleton className="h-4 w-3/5 max-w-[180px]" />
              <Skeleton className="h-3 w-2/5 max-w-[100px]" />
            </div>
          </div>
        )}
        {lines > 0 && <SkeletonText lines={lines} />}
      </div>
      <div className="pt-3 border-t border-border/40 flex items-center justify-between">
        <Skeleton className="h-3 w-1/4 max-w-[80px]" />
        <Skeleton className="size-4 rounded shrink-0" />
      </div>
    </div>
  );
}

/* ─── HubSkeleton ─────────────────────────────────────────────────────
 * Premium loading state for hub views (Dashboard, Learn, QBank, etc.).
 * Replaces the centered spinner with a structural skeleton that mirrors
 * the real layout: page header, stat tile row, section heading, and a
 * grid of skeleton cards. Reads as "content arriving" instead of "loading".
 *
 * Pattern source: 21st.dev-inspired shimmer + the Osler hub layout
 * structure documented in `AGENTS.md → Page layout`.
 */

interface HubSkeletonProps {
  /** Number of stat tiles in the top row. Defaults to 4. */
  statCount?: number;
  /** Number of cards in the main grid. Defaults to 3. */
  cardCount?: number;
  /** Show a hero card above the stats row (e.g. "continue learning"). */
  hero?: boolean;
  /** Page header eyebrow + title skeleton. Defaults to true. */
  header?: boolean;
  className?: string;
}

export function HubSkeleton({
  statCount = 4,
  cardCount = 3,
  hero = false,
  header = true,
  className,
}: HubSkeletonProps) {
  // Column count maps to responsive classes (Tailwind can't JIT-compile
  // dynamic `md:grid-cols-${n}`, so enumerate the handful of shapes used).
  const statCols =
    statCount >= 4
      ? "grid-cols-2 md:grid-cols-4"
      : statCount === 3
        ? "grid-cols-2 md:grid-cols-3"
        : statCount === 2
          ? "grid-cols-2"
          : "grid-cols-1";
  return (
    <div className={cn("osler-page", className)}>
      <div className="osler-page__inner--wide">
        {header && (
          <div className="mb-6 md:mb-8">
            <Skeleton className="h-3 w-24 mb-2" />
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
        )}
        {hero && (
          <Skeleton className="h-36 w-full rounded-xl mb-6 min-h-[144px]" />
        )}
        <div className={cn("grid gap-3 mb-6", statCols)}>
          {Array.from({ length: statCount }).map((_, i) => (
            <div key={i} className="osler-stat-tile min-h-[82px] flex flex-col justify-between">
              <div className="flex items-center justify-between mb-2">
                <Skeleton className="h-3 w-3/4 max-w-16" />
                <Skeleton className="size-4 rounded shrink-0" />
              </div>
              <Skeleton className="h-7 w-1/2 max-w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="h-4 w-32 mb-3" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: cardCount }).map((_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── SelectableCard ──────────────────────────────────────────────────
 * The single canonical "selectable card" pattern. Replaces ChoiceCard,
 * ModeCard, LayoutOption, theme buttons, and the inline mode toggle —
 * every "card you tap to pick an option" in the app.
 *
 * Active state: border-primary + bg-primary/5 + shadow-sm (subtle lift).
 * Inactive state: border-border + bg-card + hover:border-primary/40.
 * Press feedback: scale 0.98 on tap (respects reduced motion via framer).
 */

interface SelectableCardProps {
  active: boolean;
  onClick: () => void;
  /** Optional lucide icon rendered in a leading chip. */
  icon?: LucideIcon;
  /** Card title. */
  label: React.ReactNode;
  /** Optional muted description. */
  description?: React.ReactNode;
  /** Optional leading content rendered in place of the icon chip (e.g. a
   *  preview swatch). */
  leading?: React.ReactNode;
  /** Optional trailing content (e.g. a checkmark or count). */
  trailing?: React.ReactNode;
  /** Disable the card. */
  disabled?: boolean;
  /** Stretch to fill the parent width. */
  fullWidth?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function SelectableCard({
  active,
  onClick,
  icon: Icon,
  label,
  description,
  leading,
  trailing,
  disabled,
  fullWidth,
  className,
  ...rest
}: SelectableCardProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      variants={pressFeedback}
      initial="rest"
      whileTap="press"
      className={cn(
        "flex items-start gap-2.5 rounded-xl border p-3 text-start transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        fullWidth && "w-full",
        active
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border bg-card hover:border-primary/40 hover:bg-primary/[0.02] hover:shadow-sm",
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
      {...rest}
    >
      {leading}
      {Icon && !leading && (
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
            active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{description}</span>
        )}
      </span>
      {trailing}
    </motion.button>
  );
}

/* ─── Pill ────────────────────────────────────────────────────────────
 * The single canonical "selectable pill" pattern. Replaces the tag pills,
 * only-mode pills, font buttons, alignment buttons, and every other
 * `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border`
 * variant in the app.
 *
 * Active: border-primary + bg-primary/10 + text-primary.
 * Inactive: border-border + bg-card + hover:border-primary/40.
 */

interface PillProps {
  active: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function Pill({ active, onClick, icon: Icon, children, disabled, className, ...rest }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-foreground hover:border-primary/40",
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className="size-3.5" />}
      {children}
    </button>
  );
}

/* ─── ToolButton ──────────────────────────────────────────────────────
 * Unified icon-button for the session action bars and tool menus. Active
 * state is always `border-primary bg-primary/10 text-primary`; inactive is
 * `border-border hover:bg-muted/60`. Stops the three-way split between
 * desktop outline buttons, header primary-foreground buttons, and the
 * SessionToolRow check-mark pattern.
 */

interface ToolButtonProps {
  onClick: () => void;
  icon: LucideIcon;
  active?: boolean;
  title?: string;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  disabled?: boolean;
  size?: "sm" | "icon" | "iconSm";
  variant?: "outline" | "ghost";
  className?: string;
}

export function ToolButton({
  onClick,
  icon: Icon,
  active,
  title,
  disabled,
  size = "sm",
  variant = "outline",
  className,
  ...rest
}: ToolButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "h-9 rounded-lg transition-colors",
        active && "border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
        className,
      )}
      {...rest}
    >
      <Icon className="size-4" />
    </Button>
  );
}

/* ─── PackSheetHeader / PackSheetFooter ───────────────────────────────
 * Shared chrome for the right-side sheets that show pack-scoped content
 * (TrackerPreviewSheet, SessionsSheet, future Wrong-Only review sheet).
 * Renders the canonical sticky header with optional icon chip + count
 * badges, and an optional sticky footer with actions. Both use the same
 * `bg-card/60 backdrop-blur-md` recipe so the sheet reads as one surface.
 */

interface PackSheetHeaderProps {
  icon?: LucideIcon;
  iconColor?: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  badges?: React.ReactNode;
  className?: string;
}

export function PackSheetHeader({ icon: Icon, iconColor, title, meta, badges, className }: PackSheetHeaderProps) {
  return (
    <header className={cn("safe-pt flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-4 pe-12 backdrop-blur-md", className)}>
      {Icon && (
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg"
          style={{
            backgroundColor: iconColor ? `color-mix(in oklch, ${iconColor} 12%, transparent)` : "color-mix(in oklch, var(--primary) 12%, transparent)",
            color: iconColor ?? "var(--primary)",
          }}
        >
          <Icon className="size-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {meta && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{meta}</div>}
      </div>
      {badges && <div className="flex shrink-0 items-center gap-1.5">{badges}</div>}
    </header>
  );
}

interface PackSheetFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function PackSheetFooter({ children, className }: PackSheetFooterProps) {
  return (
    <footer className={cn("shrink-0 border-t border-border bg-card/60 p-4 pb-[max(env(safe-area-inset-bottom),1rem)] backdrop-blur-md", className)}>
      {children}
    </footer>
  );
}

/* ─── SectionList ─────────────────────────────────────────────────────
 * Stagger-animated list wrapper. Renders `<motion.div variants={staggerContainer}
 * initial="hidden" animate="visible">` and lets children opt in via
 * `variants={fadeUp}`. Use for grids of cards, recent-session lists, etc.
 * — replaces the hand-rolled `osler-fade-in` + `animationDelay` pattern.
 */

interface SectionListProps {
  children: React.ReactNode;
  className?: string;
}

export function SectionList({ children, className }: SectionListProps) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ─── SectionItem ─────────────────────────────────────────────────────
 * Pair with `<SectionList>` — renders a `<motion.div variants={fadeUp}>`
 * that fades + lifts into place as part of a staggered list.
 */

interface SectionItemProps {
  children: React.ReactNode;
  className?: string;
}

export function SectionItem({ children, className }: SectionItemProps) {
  return (
    <motion.div variants={fadeUp} className={className}>
      {children}
    </motion.div>
  );
}

/* ─── SwipeableSheetHandle ────────────────────────────────────────────
 * A grab handle for bottom sheets that lets the user drag down to close.
 * Renders a visual grab bar that follows the finger via framer-motion drag.
 *
 * Uses `drag="y"` with `dragSnapToOrigin` so the sheet either snaps back
 * (if the drag didn't pass the threshold) or closes (if it did).
 * Velocity-aware: a fast flick closes even below the distance threshold.
 *
 * Usage inside a <SheetContent side="bottom">:
 *   <SwipeableSheetHandle onClose={() => setOpen(false)} />
 *   <SheetHeader>...</SheetHeader>
 */

interface SwipeableSheetHandleProps {
  /** Called when the user drags far enough to close the sheet. */
  onClose: () => void;
  className?: string;
}

export function SwipeableSheetHandle({ onClose, className }: SwipeableSheetHandleProps) {
  const dismiss = useSwipeBackDismiss({
    onDismiss: onClose,
    direction: "vertical",
    threshold: 80,
    velocityThreshold: 400,
  });

  return (
    <motion.div
      {...dismiss}
      className={cn(
        "flex justify-center pt-2.5 pb-1 shrink-0 cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      <div className="h-1 w-10 rounded-full bg-border" />
    </motion.div>
  );
}

/* ─── SwipeableSideSheet ──────────────────────────────────────────────
 * Wraps the content of a side sheet (right or left) so the user can
 * swipe horizontally to dismiss it — the same gesture iOS Settings uses.
 *
 * The Radix Sheet content controls its own enter/exit transform, so we
 * can't make the SheetContent itself draggable. Instead, this wrapper
 * goes *inside* the SheetContent and makes the inner content draggable.
 * When the drag commits, it calls `onClose` which triggers the Radix
 * exit animation.
 *
 * Usage:
 *   <SheetContent side="right" ...>
 *     <SwipeableSideSheet onClose={() => setOpen(false)} rtl={rtl}>
 *       ...sheet body...
 *     </SwipeableSideSheet>
 *   </SheetContent>
 */

interface SwipeableSideSheetProps {
  onClose: () => void;
  rtl?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function SwipeableSideSheet({ onClose, rtl = false, className, children }: SwipeableSideSheetProps) {
  const dismiss = useSwipeBackDismiss({
    onDismiss: onClose,
    direction: "horizontal",
    rtl,
    threshold: 100,
    velocityThreshold: 400,
  });

  return (
    <motion.div
      {...dismiss}
      className={cn("flex flex-col h-full", className)}
    >
      {children}
    </motion.div>
  );
}
