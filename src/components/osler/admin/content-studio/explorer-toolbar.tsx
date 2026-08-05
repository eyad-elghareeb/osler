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
  LayoutGrid, List as ListIcon, FolderPlus, FilePlus, Upload,
  Plus, Sparkles, Loader2, Home, PanelLeft, PanelRight, MoreHorizontal,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export type ViewMode = "grid" | "list";
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
  search: string;
  onSearchChange: (q: string) => void;
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
    search, onSearchChange,
    statusFilter, onStatusFilterChange,
    viewMode, onViewModeChange,
    onRefresh, loading, canManage,
    onNewFile, onNewFolder, onUpload, onNewContent,
    onRegenerateManifests, regenerating,
    railOpen, onToggleRail, detailOpen, onToggleDetail, className,
  } = props;

  return (
    <div className={cn("flex flex-wrap items-center gap-1 border-b border-border bg-card/40 px-2 py-1.5", className)}>
      {/* Side-panel toggles */}
      <IconActionButton
        icon={PanelLeft}
        label={t("admin.studio.allCategories")}
        size="iconXs"
        onClick={onToggleRail}
        className={railOpen ? "text-primary" : "text-muted-foreground"}
      />

      {/* Nav buttons */}
      <div className="flex items-center gap-0.5">
        <IconActionButton icon={ChevronLeft} label={t("admin.studio.back")} disabled={!canGoBack} onClick={onBack} size="iconXs" />
        <IconActionButton icon={ArrowUp} label={t("admin.studio.up")} disabled={!canGoUp} onClick={onUp} size="iconXs" />
        <IconActionButton icon={ChevronRight} label={t("admin.studio.forward")} disabled={!canGoForward} onClick={onForward} size="iconXs" />
      </div>

      {/* Breadcrumbs */}
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto medos-scroll-x"
      >
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1;
          return (
            <React.Fragment key={crumb.path + i}>
              {i > 0 && <ChevronRight className="size-2.5 shrink-0 text-muted-foreground/60" />}
              {i === 0 && <Home className="size-3 shrink-0 text-muted-foreground/70" />}
              <button
                type="button"
                onClick={() => !isLast && onBreadcrumbClick(crumb.path)}
                disabled={isLast}
                className={cn(
                  "shrink-0 rounded px-1 py-0.5 text-[11px] font-medium transition-colors",
                  isLast ? "text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {/* Search */}
      <div className="relative w-40 shrink-0 lg:w-52">
        <Search className="absolute start-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("admin.studio.search")}
          className="h-7 ps-6 text-xs"
        />
      </div>

      {/* Status filter */}
      <Select value={statusFilter} onValueChange={(v) => onStatusFilterChange(v as StatusFilter)}>
        <SelectTrigger className="h-7 w-28 shrink-0 text-xs">
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
              <button
                type="button"
                onClick={() => onViewModeChange("grid")}
                aria-pressed={viewMode === "grid"}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-s-md transition-colors",
                  viewMode === "grid" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <LayoutGrid className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("admin.studio.view.grid")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onViewModeChange("list")}
                aria-pressed={viewMode === "list"}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-e-md transition-colors",
                  viewMode === "list" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <ListIcon className="size-3" />
              </button>
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
        size="iconXs"
        className={cn(loading && "[&_svg]:animate-spin")}
      />

      {/* More actions (admin only) — overflow for secondary commands */}
      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="iconXs" variant="ghost" aria-label={t("admin.studio.moreActions")}>
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
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Divider before primary actions */}
      <div className="h-5 w-px shrink-0 bg-border" />

      {/* Primary actions */}
      <div className="flex items-center gap-1">
        <Button size="xs" variant="outline" onClick={onUpload}>
          <Upload className="size-3" />
          <span className="hidden sm:inline">{t("admin.studio.upload")}</span>
        </Button>
        {canManage && (
          <>
            <Button size="xs" variant="outline" onClick={onNewFolder}>
              <FolderPlus className="size-3" />
              <span className="hidden sm:inline">{t("admin.studio.newFolder")}</span>
            </Button>
            <Button size="xs" onClick={onNewContent}>
              <Plus className="size-3" />
              <span className="hidden sm:inline">{t("admin.studio.newContent")}</span>
            </Button>
          </>
        )}
      </div>

      {/* Detail toggle */}
      <IconActionButton
        icon={PanelRight}
        label={t("admin.studio.noSelection")}
        size="iconXs"
        onClick={onToggleDetail}
        className={detailOpen ? "text-primary" : "text-muted-foreground"}
      />
    </div>
  );
}
