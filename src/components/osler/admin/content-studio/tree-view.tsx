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
  /** Called when files are dropped on a folder row — stages into that folder. */
  onDropOnFolder?: (e: React.DragEvent, node: ContentTreeNode) => void;
  className?: string;
}

export function TreeView({ roots, selectedIds, onSelect, onOpen, query, onDropOnFolder, className }: TreeViewProps) {
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
    <div className={cn("h-full overflow-y-auto osler-scroll-y p-1.5", className)} role="tree" aria-label={t("admin.studio.view.tree")}>
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
          onDropOnFolder={onDropOnFolder}
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
  onDropOnFolder?: (e: React.DragEvent, node: ContentTreeNode) => void;
}

function TreeRow({ node, depth, expanded, selectedIds, searching, onToggle, onSelect, onOpen, onDropOnFolder }: TreeRowProps) {
  const { t } = useI18n();
  const isFolder = node.kind === "folder";
  const isExpanded = isFolder && (searching || expanded.has(node.id));
  const selected = selectedIds.has(node.id);
  const children = node.items ?? [];
  const [dropActive, setDropActive] = React.useState(false);
  const canDropFolder = isFolder && onDropOnFolder && !node.id.endsWith("__drafts__");

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

  function handleDragOver(e: React.DragEvent) {
    if (!canDropFolder || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false);
  }
  function handleDrop(e: React.DragEvent) {
    if (!canDropFolder) return;
    setDropActive(false);
    void onDropOnFolder!(e, node);
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
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-expanded={isFolder ? isExpanded : undefined}
        aria-selected={isFolder ? undefined : selected}
        className={cn(
          "group relative flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          selected ? "bg-primary/10 text-primary" : "hover:bg-muted/60",
          dropActive && "bg-primary/5 ring-2 ring-inset ring-primary/40",
        )}
        style={{ paddingInlineStart: `${6 + depth * 14}px` }}
      >
        {/* Drop target overlay */}
        {dropActive && (
          <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-primary/10">
            <span className="max-w-[90%] truncate rounded bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
              {t("admin.studio.dropOnFolder", { name: node.name })}
            </span>
          </span>
        )}

        {isFolder ? (
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground/70 transition-transform", isExpanded && "rotate-90 text-foreground")} />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isFolder ? (
          <FolderOpen className={cn("size-3.5 shrink-0", folderRowCls)} />
        ) : (
          <NodeIcon node={node} className="size-3.5 shrink-0 text-primary" />
        )}
        <div className="min-w-0 flex-1 flex items-baseline gap-1.5 truncate">
          <span className={cn("truncate font-medium text-xs", !isFolder && selected ? "text-primary font-semibold" : "text-foreground")}>
            {node.name}
          </span>
          {!isFolder && node.r2Key && node.r2Key.split("/").pop() !== node.name && (
            <span className="truncate font-mono text-[11px] text-muted-foreground/60">
              {node.r2Key.split("/").pop()}
            </span>
          )}
        </div>
        {isFolder && children.length > 0 && (
          <span className="shrink-0 rounded-md border border-border/60 bg-muted/40 px-1 py-px text-[11px] font-medium tabular-nums text-muted-foreground">
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
              onDropOnFolder={onDropOnFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}
