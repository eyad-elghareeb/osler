"use client";

/**
 * Explorer Toolbar — the single top bar of the Content Studio.
 *
 * One row that holds everything the studio needs:
 *   - Side-panel collapse toggles (rail + detail)
 *   - Back / Up / Forward navigation (the parent manages history)
 *   - Breadcrumb trail showing category + current folder path
 *   - Search, status filter, grid/list toggle, refresh
 *   - "More" overflow menu (New empty file, Rebuild manifests)
 *   - Primary actions: Upload / New folder / New content
 *
 * The row wraps on narrow screens so nothing clips, and icon-only labels
 * collapse on small viewports. All tooltip-wrapped icon buttons use the
 * shared `IconActionButton` from `./ui` so they look + behave identically.
 */

import * as React from "react";
import {
  ChevronLeft, ChevronRight, ArrowUp, RefreshCw, Search,
  LayoutGrid, List as ListIcon, ListTree, FolderPlus, FilePlus, Upload,
  Plus, Sparkles, Loader2, Home, PanelLeft, PanelRight, MoreHorizontal,
  Trash2,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Breadcrumb } from "./types";
import { IconActionButton } from "./ui";

export type ViewMode = "grid" | "list" | "tree";
export type StatusFilter = "all" | "draft" | "pending" | "published" | "rejected";

export interface ExplorerToolbarProps {
  breadcrumbs: Breadcrumb[];
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onBreadcrumbClick: (path: string) => void;
  onOpenSearchModal: () => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (s: StatusFilter) => void;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  onRefresh: () => void;
  loading?: boolean;
  canManage: boolean;
  onNewFile: () => void;
  onNewFolder: () => void;
  onUpload: () => void;
  onNewContent: () => void;
  onRegenerateManifests: () => void;
  regenerating?: boolean;
  onBackfill?: () => void;
  backfilling?: boolean;
  onGcOrphans?: () => void;
  gcRunning?: boolean;
  railOpen: boolean;
  onToggleRail: () => void;
  detailOpen: boolean;
  onToggleDetail: () => void;
  className?: string;
}

export function ExplorerToolbar(props: ExplorerToolbarProps) {
  const { t } = useI18n();
  const {
    breadcrumbs, canGoBack, canGoForward, canGoUp,
    onBack, onForward, onUp, onBreadcrumbClick,
    onOpenSearchModal,
    statusFilter, onStatusFilterChange,
    viewMode, onViewModeChange,
    onRefresh, loading, canManage,
    onNewFile, onNewFolder, onUpload, onNewContent,
    onRegenerateManifests, regenerating,
    onBackfill, backfilling,
    onGcOrphans, gcRunning,
    railOpen, onToggleRail, detailOpen, onToggleDetail, className,
  } = props;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 border-b border-border bg-card/90 px-2 sm:px-3 py-2 backdrop-blur-md", className)}>
      {/* Side-panel toggles */}
      <IconActionButton
        icon={PanelLeft}
        label={t("admin.studio.allCategories")}
        size="iconSm"
        onClick={onToggleRail}
        className={railOpen ? "text-primary bg-primary/10" : "text-muted-foreground"}
      />

      {/* Nav buttons */}
      <div className="hidden sm:flex items-center gap-0.5">
        <IconActionButton icon={ChevronLeft} label={`${t("admin.studio.back")} (Alt+Left)`} disabled={!canGoBack} onClick={onBack} size="iconSm" />
        <IconActionButton icon={ArrowUp} label={`${t("admin.studio.up")} (Alt+Up)`} disabled={!canGoUp} onClick={onUp} size="iconSm" />
        <IconActionButton icon={ChevronRight} label={`${t("admin.studio.forward")} (Alt+Right)`} disabled={!canGoForward} onClick={onForward} size="iconSm" />
      </div>

      {/* Breadcrumbs */}
      <nav
        aria-label={t("admin.studio.breadcrumbRoot")}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto osler-scroll-x"
      >
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1;
          return (
            <React.Fragment key={crumb.path + i}>
              {i > 0 && <ChevronRight className="size-2.5 shrink-0 text-muted-foreground/60" />}
              {i === 0 && <Home className="size-3 shrink-0 text-muted-foreground/70" />}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => !isLast && onBreadcrumbClick(crumb.path)}
                disabled={isLast}
                className={cn(
                  "h-7 shrink-0 rounded px-1.5 text-xs font-medium",
                  isLast ? "text-foreground font-semibold" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {crumb.label}
              </Button>
            </React.Fragment>
          );
        })}
      </nav>

      {/* Global Search Button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          haptic("selection");
          onOpenSearchModal();
        }}
        className="h-8 gap-2 px-2 sm:px-2.5 text-xs text-muted-foreground hover:text-foreground border-border bg-background/50 shadow-2xs"
      >
        <Search className="size-3.5 text-muted-foreground" />
        <span className="hidden lg:inline">{t("admin.studio.searchModal.title")}</span>
        <kbd className="hidden md:inline-flex items-center gap-0.5 rounded border border-border bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground">
          Ctrl K
        </kbd>
      </Button>

      {/* Status filter */}
      <Select value={statusFilter} onValueChange={(v) => onStatusFilterChange(v as StatusFilter)}>
        <SelectTrigger className="h-8 w-20 sm:w-28 shrink-0 text-xs bg-background/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("admin.content.tab.all")}</SelectItem>
          <SelectItem value="published">{t("admin.content.tab.published")}</SelectItem>
          <SelectItem value="draft">{t("admin.content.tab.drafts")}</SelectItem>
          <SelectItem value="pending">{t("admin.content.tab.pending")}</SelectItem>
          <SelectItem value="rejected">{t("admin.content.tab.rejected")}</SelectItem>
        </SelectContent>
      </Select>

      {/* View toggle */}
      <div className="flex shrink-0 items-center rounded-md border border-border bg-background/60">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                onClick={() => {
                  haptic("selection");
                  onViewModeChange("tree");
                }}
                aria-pressed={viewMode === "tree"}
                className={cn(
                  "flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-s-md transition-colors",
                  viewMode === "tree" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <ListTree className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("admin.studio.view.tree")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                onClick={() => {
                  haptic("selection");
                  onViewModeChange("grid");
                }}
                aria-pressed={viewMode === "grid"}
                className={cn(
                  "flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center transition-colors",
                  viewMode === "grid" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <LayoutGrid className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("admin.studio.view.grid")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                onClick={() => {
                  haptic("selection");
                  onViewModeChange("list");
                }}
                aria-pressed={viewMode === "list"}
                className={cn(
                  "flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-e-md transition-colors",
                  viewMode === "list" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <ListIcon className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("admin.studio.view.list")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Refresh */}
      <IconActionButton
        icon={RefreshCw}
        label={t("admin.studio.refresh")}
        disabled={loading}
        onClick={onRefresh}
        size="iconSm"
        className={cn(loading && "[&_svg]:animate-spin")}
      />

      {/* More actions (admin only) — overflow for secondary commands */}
      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="iconSm" variant="ghost" aria-label={t("admin.studio.moreActions")}>
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onNewFile}>
              <FilePlus className="me-2 size-3.5" /> {t("admin.studio.newFile")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRegenerateManifests} disabled={regenerating}>
              {regenerating ? (
                <Loader2 className="me-2 size-3.5 animate-spin" />
              ) : (
                <Sparkles className="me-2 size-3.5" />
              )}
              {t("admin.studio.regenerateManifests")}
            </DropdownMenuItem>
            {onBackfill && (
              <DropdownMenuItem onClick={onBackfill} disabled={backfilling}>
                {backfilling ? (
                  <Loader2 className="me-2 size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="me-2 size-3.5" />
                )}
                {t("admin.studio.backfillContent")}
              </DropdownMenuItem>
            )}
            {onGcOrphans && (
              <DropdownMenuItem onClick={onGcOrphans} disabled={gcRunning}>
                {gcRunning ? (
                  <Loader2 className="me-2 size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="me-2 size-3.5" />
                )}
                {t("admin.studio.gcOrphans")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Divider before primary actions */}
      <div className="hidden sm:block h-5 w-px shrink-0 bg-border" />

      {/* Primary actions */}
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={onUpload} title="Upload files (Ctrl+U)" className="h-8 shadow-2xs">
          <Upload className="size-3.5 text-muted-foreground" />
          <span className="hidden sm:inline">{t("admin.studio.upload")}</span>
        </Button>
        {canManage && (
          <>
            <Button size="sm" variant="outline" onClick={onNewFolder} title="New folder (Ctrl+Shift+N)" className="h-8 shadow-2xs">
              <FolderPlus className="size-3.5 text-muted-foreground" />
              <span className="hidden sm:inline">{t("admin.studio.newFolder")}</span>
            </Button>
            <Button size="sm" onClick={onNewContent} title="New content (Ctrl+N)" className="h-8 shadow-2xs font-medium">
              <Plus className="size-3.5" />
              <span className="hidden sm:inline">{t("admin.studio.newContent")}</span>
            </Button>
          </>
        )}
      </div>

      {/* Detail toggle */}
      <IconActionButton
        icon={PanelRight}
        label={t("admin.studio.noSelection")}
        size="iconSm"
        onClick={onToggleDetail}
        className={detailOpen ? "text-primary bg-primary/10" : "text-muted-foreground"}
      />
    </div>
  );
}
