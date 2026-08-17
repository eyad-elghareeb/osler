"use client";

/**
 * Shared UI primitives for the Content Studio.
 *
 * These small building blocks are reused across every studio component so we
 * don't end up with five slightly-different "badge" implementations or three
 * copies of the same tooltip-icon-button. Keeping them in one place also
 * makes the professional-polish pass (sizes, spacing, colors) a one-file
 * change instead of a five-file change.
 */

import * as React from "react";
import {
  FileText,
  FileJson,
  FolderOpen,
  Folder,
  Image as ImageIcon,
  File,
  CheckCircle2,
  XCircle,
  Loader2,
  Layers,
  Sparkles,
  FileCode,
  FileEdit,
  Clock,
  AlertCircle,
  BookOpen,
  ListChecks,
  Brain,
  Stethoscope,
  Video,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import { STATUS_BADGE, type ValidationState } from "./types";

// ── NodeIcon — pick the right Lucide icon for a tree node ────────────────────

export function NodeIcon({ node, className }: { node: ContentTreeNode; className?: string }) {
  if (node.kind === "folder") {
    return <FolderOpen className={cn("fill-current/15", className)} />;
  }

  // Type-aware file icon
  const ct = node.cloudObject?.content_type;
  if (ct === "quiz" || ct === "bank" || ct === "written") {
    return <ListChecks className={className} />;
  }
  if (ct === "flashcard") return <Brain className={className} />;
  if (ct === "osce") return <Stethoscope className={className} />;
  if (ct === "video") return <Video className={className} />;
  if (ct === "library") return <BookOpen className={className} />;

  if (node.ext === "md") return <BookOpen className={className} />;
  if (node.ext === "pdf" || node.ext === "html") return <FileText className={className} />;
  if (node.ext === "json") return <FileJson className={className} />;
  if (node.ext && IMG_EXTS.has(node.ext)) return <ImageIcon className={className} />;
  return <File className={className} />;
}

const IMG_EXTS = new Set(["png", "jpg", "jpeg", "svg", "gif", "webp"]);

// ── Folder color tokens ─────────────────────────────────────────────────────

export const folderIconCls = "text-warning/80 dark:text-warning/90";
export const folderTileCls = "bg-warning/5 border-warning/20 dark:bg-warning/10 dark:border-warning/30";
export const folderRowCls = "text-warning/80 dark:text-warning/90";

// ── NodeBadges — icon-based micro-badges with rich tooltips ─────────────────

export function NodeBadges({
  node,
  variant = "default",
  showText = false,
}: {
  node: ContentTreeNode;
  /** "default" = normal icon badge; "compact" = micro icon badge */
  variant?: "default" | "compact";
  /** Optional flag to show text alongside icon (used in detail header) */
  showText?: boolean;
}) {
  const { t } = useI18n();
  const status = node.cloudObject?.status;

  const badgeWrapperCls = cn(
    "inline-flex items-center gap-1 rounded-md border transition-colors shadow-2xs",
    variant === "compact" ? "p-0.5 text-[10px]" : "px-1.5 py-0.5 text-xs font-medium",
  );

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-wrap items-center gap-1">
        {/* Managed badge */}
        {node.managed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(badgeWrapperCls, "border-primary/25 bg-primary/10 text-primary")}
                aria-label={t("admin.studio.badge.managed")}
              >
                <Layers className={variant === "compact" ? "size-2.5" : "size-3"} />
                {showText && <span className="uppercase tracking-wider">{t("admin.studio.rowManaged")}</span>}
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("admin.studio.badge.managed")}</TooltipContent>
          </Tooltip>
        )}

        {/* Staged badge */}
        {node.staged && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(badgeWrapperCls, "border-info/25 bg-info/10 text-info")}
                aria-label={t("admin.studio.badge.staged")}
              >
                <Sparkles className={variant === "compact" ? "size-2.5" : "size-3"} />
                {showText && <span className="uppercase tracking-wider">{t("admin.studio.rowStaged")}</span>}
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("admin.studio.badge.staged")}</TooltipContent>
          </Tooltip>
        )}

        {/* Raw / loose badge */}
        {!node.managed && !node.staged && node.r2Key && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(badgeWrapperCls, "border-border/70 bg-muted/60 text-muted-foreground")}
                aria-label={t("admin.studio.badge.raw")}
              >
                <FileCode className={variant === "compact" ? "size-2.5" : "size-3"} />
                {showText && <span className="uppercase tracking-wider">{t("admin.studio.rowRaw")}</span>}
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("admin.studio.badge.raw")}</TooltipContent>
          </Tooltip>
        )}

        {/* Status icon badge */}
        {status && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(badgeWrapperCls, STATUS_BADGE[status] ?? "border-border bg-muted text-muted-foreground")}
                aria-label={t(`admin.studio.badge.${status}` as any)}
              >
                {status === "published" && <CheckCircle2 className={variant === "compact" ? "size-2.5 text-success" : "size-3 text-success"} />}
                {status === "draft" && <FileEdit className={variant === "compact" ? "size-2.5" : "size-3"} />}
                {status === "pending" && <Clock className={variant === "compact" ? "size-2.5 text-warning" : "size-3 text-warning"} />}
                {status === "rejected" && <AlertCircle className={variant === "compact" ? "size-2.5 text-destructive" : "size-3 text-destructive"} />}
                {showText && (
                  <span className="uppercase tracking-wider">
                    {t(`admin.studio.row${status.charAt(0).toUpperCase() + status.slice(1)}` as any)}
                  </span>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent>{t(`admin.studio.badge.${status}` as any)}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

// ── ValidationBadge — valid / invalid / checking pill ────────────────────────

export function ValidationBadge({ state }: { state: ValidationState }) {
  const { t } = useI18n();
  if (state === "valid") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-success/30 bg-success/15 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider text-success">
        <CheckCircle2 className="size-2.5" /> {t("admin.studio.valid")}
      </span>
    );
  }
  if (state === "invalid") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-destructive/30 bg-destructive/15 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider text-destructive">
        <XCircle className="size-2.5" /> {t("admin.studio.invalid")}
      </span>
    );
  }
  if (state === "checking") {
    return (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Loader2 className="size-2.5 animate-spin" /> {t("admin.studio.autoValidating")}
      </span>
    );
  }
  return null;
}

// ── MetaRow — label + value box used in the detail panel ────────────────────

export function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="truncate text-xs font-medium">{value}</dd>
    </div>
  );
}

// ── IconActionButton — tooltip-wrapped icon-only button ──────────────────────
//
// Replaces the NavButton helper in explorer-toolbar.tsx and every inline
// `<Button size="sm" variant="ghost" className="h-8 w-8 p-0">` pattern. The
// `size` prop defaults to "iconSm" (size-7); pass "iconXs" (size-6) for the
// ultra-compact toolbar buttons.

export function IconActionButton({
  icon: Icon,
  label,
  disabled,
  onClick,
  variant = "ghost",
  size = "iconSm",
  className,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  variant?: "ghost" | "outline" | "default";
  size?: "iconSm" | "iconXs";
  className?: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size={size}
            variant={variant}
            disabled={disabled}
            onClick={() => {
              haptic("light");
              onClick();
            }}
            aria-label={label}
            className={className}
          >
            <Icon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── FileTypeIcon — colored icon container used in the detail panel ──────────

export function FileTypeIcon({ node, className }: { node: ContentTreeNode; className?: string }) {
  return (
    <div className={cn(
      "flex items-center justify-center rounded-xl border",
      node.kind === "folder"
        ? cn(folderTileCls, folderIconCls)
        : "bg-primary/10 border-primary/30 text-primary",
      className,
    )}>
      <NodeIcon node={node} className="size-6" />
    </div>
  );
}
