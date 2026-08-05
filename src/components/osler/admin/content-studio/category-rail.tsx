"use client";

/**
 * Category Rail — the leftmost column of the Content Studio.
 *
 * Shows the 5 student-facing content categories (Library, Q-Bank, Flashcards,
 * OSCE, Videos) as compact tiles. Each tile shows:
 *   - The category icon
 *   - The category name (semibold)
 *   - The number of files in that category (badge)
 *
 * The description is shown as a hover tooltip so the tiles stay narrow.
 * Clicking a tile selects that category and the file explorer shows its
 * contents. The active tile gets a colored ring + filled background.
 *
 * Tiles are single-row and compact (32px icon block) so all 5 + the "All"
 * tile fit without scrolling on most viewports.
 */

import * as React from "react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CATEGORIES, ACCENT_CLASSES, type CategoryDef } from "./types";

interface CategoryRailProps {
  activeFolder: string | null;
  onSelect: (folder: string) => void;
  counts: Record<string, number>;
  totalCount: number;
  className?: string;
}

export function CategoryRail({
  activeFolder, onSelect, counts, totalCount, className,
}: CategoryRailProps) {
  const { t } = useI18n();

  return (
    <nav
      aria-label={t("admin.studio.allCategories")}
      className={cn(
        "flex h-full w-full flex-col gap-0.5 overflow-y-auto medos-scroll-y p-1.5",
        className,
      )}
    >
      {/* All categories tile */}
      <CategoryTile
        active={activeFolder === null}
        onClick={() => onSelect("")}
        icon={null}
        label={t("admin.studio.allCategories")}
        description={t("admin.studio.items", { n: String(totalCount) })}
        count={totalCount}
        accent="slate"
      />

      <div className="my-1 h-px bg-border/60" />

      {CATEGORIES.map((cat) => (
        <CategoryTile
          key={cat.folder}
          active={activeFolder === cat.folder}
          onClick={() => onSelect(cat.folder)}
          icon={cat.icon}
          label={t(cat.labelKey as any)}
          description={t(cat.descKey as any)}
          count={counts[cat.folder] ?? 0}
          accent={cat.accent}
        />
      ))}
    </nav>
  );
}

// ── Tile ────────────────────────────────────────────────────────────────────

interface CategoryTileProps {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }> | null;
  label: string;
  description: string;
  count: number;
  accent: CategoryDef["accent"];
}

function CategoryTile({
  active, onClick, icon: Icon, label, description, count, accent,
}: CategoryTileProps) {
  const cls = ACCENT_CLASSES[accent];
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
              "group relative flex w-full items-center gap-2 rounded-md border p-1.5 text-start transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              cls.tile,
              active && cls.tileActive,
              active ? `ring-1 ${cls.ring}` : "ring-0",
            )}
          >
            {/* Icon block */}
            {Icon ? (
              <div
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md border",
                  active ? cls.badge : "bg-background/60 border-border",
                )}
              >
                <Icon className="size-3.5" />
              </div>
            ) : (
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background/60 border-border text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                All
              </div>
            )}

            {/* Text block */}
            <div className="flex min-w-0 flex-1 items-center justify-between gap-1">
              <span className="truncate text-[11px] font-semibold">{label}</span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium tabular-nums",
                  active ? cls.badge : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-[220px]">
          <p className="font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
