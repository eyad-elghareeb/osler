"use client";

/**
 * Content Search Modal — Fast, category-scoped search for Content Studio.
 *
 * Indexed over all category trees and manifests, allowing admins to search
 * across titles, paths, slugs, metadata, and authors instantly.
 */

import * as React from "react";
import {
  Search,
  Folder,
  ArrowRight,
  Copy,
  Check,
  FileEdit,
  ExternalLink,
  Layers,
  Sparkles,
  FileCode,
  CheckCircle2,
  Clock,
  AlertCircle,
  X,
  BookOpen,
  ListChecks,
  Brain,
  Stethoscope,
  Video,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import { CATEGORIES, folderPathOf, type CategoryDef } from "./types";
import { NodeIcon, NodeBadges } from "./ui";

export interface FlatSearchItem {
  id: string;
  node: ContentTreeNode;
  category: string;
  categoryDef?: CategoryDef;
  folderPath: string;
  displayName: string;
  fileName: string;
  searchableText: string;
}

export interface ContentSearchModalProps {
  open: boolean;
  onClose: () => void;
  unifiedTree: ContentTreeNode[];
  onOpenItem: (node: ContentTreeNode) => void;
  onNavigateToFolder: (folderPath: string) => void;
  initialCategory?: string | null;
}

export function ContentSearchModal({
  open,
  onClose,
  unifiedTree,
  onOpenItem,
  onNavigateToFolder,
  initialCategory,
}: ContentSearchModalProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [query, setQuery] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState<string>("all");
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Sync initial category when opening
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedCategory(initialCategory || "all");
      setHighlightedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialCategory]);

  // Flatten the unified tree into search items
  const allItems = React.useMemo<FlatSearchItem[]>(() => {
    const flat: FlatSearchItem[] = [];

    for (const cat of CATEGORIES) {
      const root = unifiedTree.find((n) => n.id === `unified-root-${cat.folder}`);
      if (!root) continue;

      function walk(node: ContentTreeNode, currentPath: string) {
        if (node.kind === "file") {
          const rawKey = node.r2Key ?? "";
          const parts = rawKey.split("/");
          const fileName = parts[parts.length - 1] || node.name;
          const author = node.cloudObject?.creator_username || "";
          const lang = node.cloudObject?.language || "";
          const type = node.cloudObject?.content_type || node.ext || "";
          const status = node.cloudObject?.status || "";

          const searchableText = [
            node.name,
            fileName,
            currentPath,
            rawKey,
            author,
            lang,
            type,
            status,
          ]
            .join(" ")
            .toLowerCase();

          flat.push({
            id: node.id,
            node,
            category: cat.folder,
            categoryDef: cat,
            folderPath: currentPath,
            displayName: node.name,
            fileName,
            searchableText,
          });
        } else if (node.items) {
          const nextPath = node.id.startsWith("unified-root-")
            ? ""
            : currentPath
              ? `${currentPath}/${node.name}`
              : node.name;

          for (const child of node.items) {
            walk(child, nextPath);
          }
        }
      }

      walk(root, "");
    }

    return flat;
  }, [unifiedTree]);

  // Filter items by category and search query
  const filteredResults = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);

    return allItems.filter((item) => {
      // Category scope filter
      if (selectedCategory !== "all" && item.category !== selectedCategory) {
        return false;
      }
      if (tokens.length === 0) return true;
      // All tokens must match
      return tokens.every((token) => item.searchableText.includes(token));
    }).slice(0, 50); // Cap to 50 for max UI responsiveness
  }, [allItems, selectedCategory, query]);

  // Reset highlight index when results change
  React.useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredResults.length, selectedCategory]);

  // Scroll active item into view
  React.useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>("[data-highlighted='true']");
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (filteredResults.length ? (prev + 1) % filteredResults.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (filteredResults.length ? (prev - 1 + filteredResults.length) % filteredResults.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = filteredResults[highlightedIndex];
      if (current) {
        haptic("selection");
        onOpenItem(current.node);
        onClose();
      }
    }
  }

  function handleCopyPath(e: React.MouseEvent, item: FlatSearchItem) {
    e.stopPropagation();
    haptic("light");
    const p = item.node.r2Key ? item.node.r2Key.replace(/^content-files\//, "") : item.displayName;
    navigator.clipboard.writeText(p);
    setCopiedId(item.id);
    toast({ title: t("admin.studio.context.copied") });
    setTimeout(() => setCopiedId(null), 1500);
  }

  function handleGoToFolder(e: React.MouseEvent, item: FlatSearchItem) {
    e.stopPropagation();
    haptic("selection");
    const fullPath = item.folderPath ? `${item.category}/${item.folderPath}` : item.category;
    onNavigateToFolder(fullPath);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl gap-0 p-0 overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("admin.studio.searchModal.title")}</DialogTitle>
        </DialogHeader>

        {/* Search Input Bar */}
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5 bg-card">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.studio.searchModal.placeholder")}
            className="h-8 flex-1 border-0 bg-transparent p-0 text-sm focus-visible:ring-0 shadow-none placeholder:text-muted-foreground/60"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </Button>
          )}
          <span className="hidden sm:inline-flex rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ESC
          </span>
        </div>

        {/* Category Scope Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto osler-scroll-x border-b border-border/80 bg-muted/30 px-3 py-1.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              haptic("selection");
              setSelectedCategory("all");
            }}
            className={cn(
              "h-6 rounded-md px-2 text-xs font-medium transition-colors",
              selectedCategory === "all"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
          >
            {t("admin.studio.searchModal.allCategories")}
            <span className="ms-1 opacity-75 tabular-nums">({allItems.length})</span>
          </Button>

          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const count = allItems.filter((i) => i.category === cat.folder).length;
            const active = selectedCategory === cat.folder;
            return (
              <Button
                key={cat.folder}
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  haptic("selection");
                  setSelectedCategory(cat.folder);
                }}
                className={cn(
                  "h-6 shrink-0 rounded-md px-2 text-xs font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <Icon className="me-1 size-3" />
                {t(cat.labelKey as any)}
                <span className="ms-1 opacity-75 tabular-nums">({count})</span>
              </Button>
            );
          })}
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="max-h-[50vh] min-h-[160px] overflow-y-auto osler-scroll-y p-1.5"
          role="listbox"
        >
          {filteredResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="size-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium text-foreground">
                {t("admin.studio.searchModal.noResults", { query: query || "…" })}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("admin.studio.search")}
              </p>
            </div>
          ) : (
            filteredResults.map((item, index) => {
              const highlighted = index === highlightedIndex;
              const hasDistinctFile = item.fileName && item.fileName !== item.displayName;

              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={highlighted}
                  data-highlighted={highlighted ? "true" : "false"}
                  onClick={() => {
                    haptic("selection");
                    onOpenItem(item.node);
                    onClose();
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={cn(
                    "group relative flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-start transition-colors cursor-pointer",
                    highlighted ? "bg-primary/10 text-foreground ring-1 ring-primary/25" : "hover:bg-muted/50",
                  )}
                >
                  {/* Left: Icon + Titles */}
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/80 bg-background/80 text-primary shadow-2xs">
                      <NodeIcon node={item.node} className="size-3.5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {item.displayName}
                        </span>
                        <NodeBadges node={item.node} variant="compact" />
                      </div>

                      {/* Path & Filename info */}
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono truncate">
                        <span className="text-primary/80 font-medium">[{item.category}]</span>
                        {item.folderPath && <span>{item.folderPath} /</span>}
                        {hasDistinctFile && <span className="opacity-80">{item.fileName}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Right: Quick actions on hover / highlight */}
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      onClick={(e) => handleCopyPath(e, item)}
                      aria-label={t("admin.studio.searchModal.copyPath")}
                      title={t("admin.studio.searchModal.copyPath")}
                      className="text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100"
                    >
                      {copiedId === item.id ? (
                        <Check className="size-3 text-success" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      onClick={(e) => handleGoToFolder(e, item)}
                      aria-label={t("admin.studio.searchModal.goToFolder")}
                      title={t("admin.studio.searchModal.goToFolder")}
                      className="text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100"
                    >
                      <Folder className="size-3" />
                    </Button>

                    <ArrowRight className={cn("size-3.5 text-muted-foreground transition-transform", highlighted && "text-primary translate-x-0.5")} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-muted/20 px-3.5 py-2 text-[11px] text-muted-foreground">
          <span>{t("admin.studio.searchModal.resultsCount", { n: String(filteredResults.length) })}</span>
          <span>{t("admin.studio.searchModal.hint")}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
