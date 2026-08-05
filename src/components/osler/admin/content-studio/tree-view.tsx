"use client";

/**
 * Tree View — hierarchical navigation for the Content Studio.
 *
 * Reintroduces the folder tree the old content browser had: every category is
 * rooted at the top and folders expand/collapse in place, so an admin can scan
 * the whole structure without breadcrumb-drilling. Files are single-click
 * selectable (the detail panel previews them) and double-clickable to open the
 * editor.
 *
 * Behaviors:
 *   - Folder click toggles expansion; the chevron rotates.
 *   - File click selects (single selection — replaces the current set).
 *   - File double-click opens the editor.
 *   - When a search query is active the tree is filtered to matching subtrees
 *     and all folders in the filtered result are force-expanded.
 *
 * Renders the same ContentTreeNode the grid/list views use, so selection,
 * badges, and context actions stay consistent across all three view modes.
 */

import * as React from "react";
import { ChevronRight, FolderOpen } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import { NodeIcon, NodeBadges, folderRowCls } from "./ui";

export interface TreeViewProps {
  /** Full category trees to render (category roots at the top). */
  roots: ContentTreeNode[];
  selectedIds: Set<string>;
  onSelect: (node: ContentTreeNode) => void;
  onOpen: (node: ContentTreeNode) => void;
  /** Shared toolbar search query — filters + auto-expands matching subtrees. */
  query: string;
  className?: string;
}

export function TreeView({ roots, selectedIds, onSelect, onOpen, query, className }: TreeViewProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Filter the tree by the toolbar query, keeping ancestors of any match.
  // Returns null for subtrees that contain no match.
  const filtered = React.useMemo(() => {
    if (!query.trim()) return roots;
    const q = query.toLowerCase();
    function filterNode(node: ContentTreeNode): ContentTreeNode | null {
      if (node.kind === "file") {
        return node.name.toLowerCase().includes(q) ? node : null;
      }
      const items = (node.items ?? []).map(filterNode).filter((n): n is ContentTreeNode => n != null);
      if (items.length === 0 && !node.name.toLowerCase().includes(q)) return null;
      return { ...node, items };
    }
    return roots.map(filterNode).filter((n): n is ContentTreeNode => n != null);
  }, [roots, query]);

  const searching = query.trim().length > 0;

  if (filtered.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="text-xs text-muted-foreground">{t("admin.studio.tree.noMatches")}</p>
      </div>
    );
  }

  return (
    <div className={cn("h-full overflow-y-auto medos-scroll-y p-1.5", className)} role="tree" aria-label={t("admin.studio.view.tree")}>
      {filtered.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          expanded={expanded}
          selectedIds={selectedIds}
          searching={searching}
          onToggle={toggle}
          onSelect={onSelect}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

// ── Recursive row ───────────────────────────────────────────────────────────

interface TreeRowProps {
  node: ContentTreeNode;
  depth: number;
  expanded: Set<string>;
  selectedIds: Set<string>;
  searching: boolean;
  onToggle: (id: string) => void;
  onSelect: (node: ContentTreeNode) => void;
  onOpen: (node: ContentTreeNode) => void;
}

function TreeRow({ node, depth, expanded, selectedIds, searching, onToggle, onSelect, onOpen }: TreeRowProps) {
  const isFolder = node.kind === "folder";
  const isExpanded = isFolder && (searching || expanded.has(node.id));
  const selected = selectedIds.has(node.id);
  const children = node.items ?? [];

  function handleClick() {
    if (isFolder) onToggle(node.id);
    else onSelect(node);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }

  return (
    <div>
      <div
        role="treeitem"
        tabIndex={0}
        data-node-id={node.id}
        onClick={handleClick}
        onDoubleClick={() => !isFolder && onOpen(node)}
        onKeyDown={handleKeyDown}
        aria-expanded={isFolder ? isExpanded : undefined}
        aria-selected={isFolder ? undefined : selected}
        className={cn(
          "group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          selected ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
        )}
        style={{ paddingInlineStart: `${6 + depth * 14}px` }}
      >
        {isFolder ? (
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isFolder ? (
          <FolderOpen className={cn("size-3.5 shrink-0 fill-current/15", folderRowCls)} />
        ) : (
          <NodeIcon node={node} className="size-3.5 shrink-0 text-primary" />
        )}
        <span className={cn("min-w-0 flex-1 truncate font-medium", !isFolder && selected && "text-primary")}>{node.name}</span>
        {isFolder && children.length > 0 && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium tabular-nums text-muted-foreground">
            {children.length}
          </span>
        )}
        {!isFolder && <NodeBadges node={node} variant="compact" />}
      </div>
      {isFolder && isExpanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedIds={selectedIds}
              searching={searching}
              onToggle={onToggle}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}
