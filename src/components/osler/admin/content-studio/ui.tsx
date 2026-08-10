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
  Image as ImageIcon,
  File,
  CheckCircle2,
  XCircle,
  Loader2,
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
//
// Folders use FolderOpen with `fill-current` so they read as solid shapes
// (the outline-only default looks too airy at small sizes). Files keep the
// outline style but get a subtle fill tint via the parent container.

export function NodeIcon({ node, className }: { node: ContentTreeNode; className?: string }) {
  if (node.kind === "folder") {
    return <FolderOpen className={cn("fill-current/15", className)} />;
  }
  if (node.ext === "md" || node.ext === "pdf") return <FileText className={className} />;
  if (node.ext === "json") return <FileJson className={className} />;
  if (node.ext && IMG_EXTS.has(node.ext)) return <ImageIcon className={className} />;
  return <File className={className} />;
}

const IMG_EXTS = new Set(["png", "jpg", "jpeg", "svg", "gif", "webp"]);

// ── Folder color tokens ─────────────────────────────────────────────────────
//
// Muted, professional folder colors. Replaces the bright amber-500/600 that
// was used everywhere — the new palette is desaturated so folders don't
// dominate the file list. Files keep the primary tint.
//
// `folderIconCls`   — applied to the <NodeIcon /> itself (text color)
// `folderTileCls`   — applied to the icon's container (bg + border)
// `folderRowCls`    — applied to inline list-row icons (text color only)

export const folderIconCls = "text-warning/80";
export const folderTileCls = "bg-warning/5 border-warning/20";
export const folderRowCls = "text-warning/80";

// ── NodeBadges — the row of small "managed / staged / raw / status" pills ──
//
// Renders up to 4 badges depending on the node's state. Used by the grid
// tile, the list row, and the detail panel header.

export function NodeBadges({
  node,
  variant = "default",
}: {
  node: ContentTreeNode;
  /** "default" = colored pills; "compact" = smaller, for tight rows */
  variant?: "default" | "compact";
}) {
  const { t } = useI18n();
  const status = node.cloudObject?.status;
  const sizeCls = variant === "compact"
    ? "px-1 py-px text-[9px]"
    : "px-1.5 py-0.5 text-[10px]";

  return (
    <div className="flex flex-wrap items-center gap-1">
      {node.managed && (
        <span className={cn("rounded-full border border-primary/30 bg-primary/10 font-medium uppercase tracking-wider text-primary", sizeCls)}>
          {t("admin.studio.rowManaged")}
        </span>
      )}
      {node.staged && (
        <span className={cn("rounded-full border border-info/30 bg-info/15 font-medium uppercase tracking-wider text-info", sizeCls)}>
          {t("admin.studio.rowStaged")}
        </span>
      )}
      {!node.managed && !node.staged && node.r2Key && (
        <span className={cn("rounded-full border border-border bg-muted font-medium uppercase tracking-wider text-muted-foreground", sizeCls)}>
          {t("admin.studio.rowRaw")}
        </span>
      )}
      {status && (
        <span className={cn("rounded-full border font-medium uppercase tracking-wider", sizeCls, STATUS_BADGE[status])}>
          {t(`admin.studio.row${status.charAt(0).toUpperCase() + status.slice(1)}` as any)}
        </span>
      )}
    </div>
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
      <span className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
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
