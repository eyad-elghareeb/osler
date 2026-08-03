"use client";

import * as React from "react";
import {
  ChevronRight,
  Folder,
  FileText,
  FileJson,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Cloud,
  HardDrive,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ContentObject } from "@/components/osler/admin/admin-api";

// ── Types ──────────────────────────────────────────────────────────────────

export type ContentTreeKind = "local" | "cloud" | "unified";

export interface ContentTreeNode {
  /** Stable id for the node (used as React key) */
  id: string;
  /** Display name */
  name: string;
  /** "folder" (has children) or "file" (leaf) */
  kind: "folder" | "file";
  /** File extension for file nodes ("md", "json", …) */
  ext?: string;
  /** File size in bytes for file nodes */
  size?: number;
  /** Children for folder nodes */
  items?: ContentTreeNode[];
  /** Original source path (for local files: path under /public/osler-content/;
   *  for cloud objects: the content object id) */
  sourcePath?: string;
  /** For cloud nodes: the underlying ContentObject (leaf only) */
  cloudObject?: ContentObject;
  /** For R2-tab nodes: the full R2 key (e.g. "content-files/library/asthma.md"). */
  r2Key?: string;
  /** For R2-tab folder nodes: the prefix to list when refreshing. */
  r2Prefix?: string;
  /** True when this leaf is a managed content_object (has D1 metadata). Used
   *  by the unified browser to badge files as "managed" vs "loose". */
  managed?: boolean;
  /** True when this leaf lives under content-staging/ — private, not yet
   *  published to students. */
  staged?: boolean;
}

interface ContentTreePaneProps {
  /** Tree root nodes */
  tree: ContentTreeNode[];
  /** Currently selected node id */
  selectedId?: string | null;
  /** Called when a leaf node is clicked */
  onSelect: (node: ContentTreeNode) => void;
  /** Refresh callback */
  onRefresh?: () => void;
  /** Active tree kind, controls the badge color */
  kind: ContentTreeKind;
  /** Loading state */
  loading?: boolean;
  className?: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ContentTreePane({
  tree,
  selectedId,
  onSelect,
  onRefresh,
  kind,
  loading,
  className,
}: ContentTreePaneProps) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState("");
  const [allExpanded, setAllExpanded] = React.useState(false);

  // Filter the tree by query — keeps ancestors of any matching descendant.
  const filtered = React.useMemo(() => {
    if (!query.trim()) return tree;
    const q = query.toLowerCase();
    function filterNode(node: ContentTreeNode): ContentTreeNode | null {
      if (node.kind === "file") {
        return node.name.toLowerCase().includes(q) ? node : null;
      }
      const items = (node.items ?? [])
        .map(filterNode)
        .filter((n): n is ContentTreeNode => n != null);
      if (items.length === 0 && !node.name.toLowerCase().includes(q)) return null;
      return { ...node, items };
    }
    return tree.map(filterNode).filter((n): n is ContentTreeNode => n != null);
  }, [tree, query]);

  const leafCount = React.useMemo(() => countLeaves(tree), [tree]);

  // Reset allExpanded whenever the tree kind changes.
  React.useEffect(() => {
    setAllExpanded(false);
  }, [kind]);

  return (
    <div className={cn("flex h-full flex-col bg-card/60", className)}>
      {/* Header */}
      <div className="shrink-0 border-b border-border p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          {kind === "local" ? (
            <HardDrive className="size-3.5 text-muted-foreground" />
          ) : (
            <Cloud className="size-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {kind === "local"
              ? t("admin.content.tree.local")
              : kind === "unified"
                ? t("admin.content.tree.unified")
                : t("admin.content.tree.cloud")}
          </span>
          <span className="text-xs text-muted-foreground/60 ms-auto">
            {t("admin.content.tree.items", { n: leafCount })}
          </span>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("admin.content.tree.search")}
          className="h-7 text-xs"
        />
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() => setAllExpanded(true)}
                  aria-label={t("admin.content.tree.expandAll")}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("admin.content.tree.expandAll")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() => setAllExpanded(false)}
                  aria-label={t("admin.content.tree.collapseAll")}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("admin.content.tree.collapseAll")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {onRefresh && (
            <Button
              variant="ghost"
              size="iconSm"
              onClick={onRefresh}
              className="ms-auto"
              aria-label={t("admin.content.tree.refresh")}
              disabled={loading}
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
          )}
        </div>
      </div>

      {/* Tree body */}
      <div className="flex-1 min-h-0 overflow-y-auto medos-scroll-y p-1.5">
        {tree.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {t("admin.content.tree.empty")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {t("admin.content.tree.noMatches", { query })}
          </div>
        ) : (
          filtered.map((node) => (
            <TreeRow
              key={node.id}
              node={node}
              depth={0}
              selectedId={selectedId}
              onSelect={onSelect}
              forceExpand={allExpanded ? "expanded" : query.trim() ? "expanded" : undefined}
              expandVersion={allExpanded ? 1 : 0}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── TreeRow ────────────────────────────────────────────────────────────────

interface TreeRowProps {
  node: ContentTreeNode;
  depth: number;
  selectedId?: string | null;
  onSelect: (node: ContentTreeNode) => void;
  forceExpand?: "expanded" | "collapsed";
  expandVersion: number;
}

function TreeRow({
  node,
  depth,
  selectedId,
  onSelect,
  forceExpand,
  expandVersion,
}: TreeRowProps) {
  const { t } = useI18n();
  const isFolder = node.kind === "folder";
  const [expanded, setExpanded] = React.useState(false);

  // Respond to expand-all / collapse-all from the parent.
  React.useEffect(() => {
    if (forceExpand === "expanded") setExpanded(true);
    else if (forceExpand === "collapsed") setExpanded(false);
  }, [forceExpand, expandVersion]);

  const active = node.id === selectedId;

  function handleClick() {
    if (isFolder) {
      setExpanded((e) => !e);
    } else {
      onSelect(node);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    } else if (e.key === "ArrowRight" && isFolder && !expanded) {
      setExpanded(true);
    } else if (e.key === "ArrowLeft" && isFolder && expanded) {
      setExpanded(false);
    }
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        data-node-id={node.id}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-expanded={isFolder ? expanded : undefined}
        className={cn(
          "admin-tree-row",
          isFolder && "admin-tree-row--folder",
          active && "admin-tree-row--active",
        )}
        style={{ paddingInlineStart: `${8 + depth * 12}px` }}
      >
        {isFolder ? (
          <ChevronRight
            className={cn("size-3.5 icon transition-transform", expanded && "rotate-90")}
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isFolder ? (
          <Folder className="size-3.5 icon" />
        ) : node.ext === "md" ? (
          <FileText className="size-3.5 icon" />
        ) : node.ext === "json" ? (
          <FileJson className="size-3.5 icon" />
        ) : (
          <FileText className="size-3.5 icon" />
        )}
        <span className="name truncate flex-1">{node.name}</span>
        {isFolder && node.items && node.items.length > 0 && (
          <span className="meta">{node.items.length}</span>
        )}
        {!isFolder && node.size != null && (
          <span className="meta">{formatSize(node.size)}</span>
        )}
        {!isFolder && node.managed && (
          <span
            className="meta rounded-full px-1.5 py-0.5 border text-[10px] uppercase tracking-wider bg-primary/10 text-primary border-primary/30"
            title={t("admin.content.tree.managedBadge")}
          >
            {t("admin.content.tree.managedBadge")}
          </span>
        )}
        {!isFolder && node.staged && (
          <span
            className="meta rounded-full px-1.5 py-0.5 border text-[10px] uppercase tracking-wider bg-info/15 text-info border-info/30"
            title={t("admin.content.tree.stagedBadge")}
          >
            {t("admin.content.tree.stagedBadge")}
          </span>
        )}
        {!isFolder && node.r2Key && !node.managed && !node.staged && (
          <span
            className="meta rounded-full px-1.5 py-0.5 border text-[10px] uppercase tracking-wider bg-muted text-muted-foreground border-border"
            title={t("admin.content.tree.looseBadge")}
          >
            {t("admin.content.tree.looseBadge")}
          </span>
        )}
        {!isFolder && node.cloudObject?.status && (
          <span
            className={cn(
              "meta rounded-full px-1.5 py-0.5 border text-[11px] uppercase tracking-wider",
              STATUS_BADGE[node.cloudObject.status] ?? "",
            )}
          >
            {node.cloudObject.status}
          </span>
        )}
      </div>
      {isFolder && expanded && node.items && node.items.length > 0 && (
        <div className="admin-tree-children">
          {node.items.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              forceExpand={forceExpand}
              expandVersion={expandVersion}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  pending: "bg-warning/15 text-warning border-warning/30",
  published: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
};

function countLeaves(nodes: ContentTreeNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.kind === "file") n += 1;
    else if (node.items) n += countLeaves(node.items);
  }
  return n;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
