"use client";

/**
 * Osler shared UI primitives — the canonical building blocks for hub views.
 *
 * These components encode the design rules documented in `AGENTS.md →
 * Design System`. Always prefer these over re-rolling the same Tailwind
 * string in every component.
 *
 * Components exposed:
 *   - <PageHeader>           eyebrow + title + subtitle (block or inline)
 *   - <SectionHeading>       small uppercase label that introduces a section
 *   - <EmptyState>           centered icon + title + body + optional actions
 *   - <LoadingState>         centered spinner + optional caption
 *   - <StatTile>             label + big value + optional icon, semantic colors
 *   - <Card> / <InteractiveCard>  thin wrappers that pin the canonical card recipe
 *
 * Why a separate file: every hub view (Dashboard, Learn, QBank, Flashcards,
 * OSCE, Videos, Profile, Settings) used to hand-roll its own version of
 * these patterns with slightly different padding / radius / typography.
 * Centralising them here makes future drift impossible.
 */

import * as React from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
  className?: string;
}

export function SectionHeading({ icon: Icon, children, actions, className }: SectionHeadingProps) {
  if (actions) {
    return (
      <div className={cn("flex items-center justify-between mb-3", className)}>
        <h2 className="osler-section-heading mb-0 flex items-center gap-2">
          {Icon && <Icon className="size-4" />}
          {children}
        </h2>
        {actions}
      </div>
    );
  }
  return (
    <h2 className={cn("osler-section-heading flex items-center gap-2", className)}>
      {Icon && <Icon className="size-4" />}
      {children}
    </h2>
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
    <div className={cn("osler-empty", className)}>
      {Icon && (
        <div className="osler-empty__icon">
          <Icon className="size-6" />
        </div>
      )}
      <h3 className="osler-empty__title">{title}</h3>
      {description && <p className="osler-empty__body">{description}</p>}
      {actions && <div className="flex items-center gap-2 mt-2">{actions}</div>}
    </div>
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
    <div className={cn("osler-loading", className)}>
      <Loader2 className={cn(sz, "animate-spin text-muted-foreground")} />
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
    </div>
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
  onClick,
  className,
}: StatTileProps) {
  const Container = onClick ? "button" : "div";
  return (
    <Container
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "text-left",
        compact ? "osler-stat-tile--compact" : "osler-stat-tile",
        onClick && "hover:border-primary/40 transition-colors cursor-pointer",
        className,
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="osler-stat-tile__label">{label}</span>
        {Icon && <Icon className={cn("size-4", STAT_TILE_COLOR[color])} />}
      </div>
      <div className="osler-stat-tile__value">{value}</div>
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
  /** Optional animation delay (ms) for the medos-fade-in mount animation. */
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
        !noAnimation && "medos-fade-in",
        className,
      )}
      style={animationDelay !== undefined ? { animationDelay: `${animationDelay}ms` } : undefined}
      {...props}
    />
  );
}
