"use client";

/**
 * File Explorer — the center pane of the Content Studio.
 *
 * Renders the contents of the currently-selected folder (or category root)
 * in either grid or list mode, with file-explorer-style interactions:
 *
 *   - Single-click selects a file.
 *   - Double-click opens the editor.
 *   - Ctrl/Cmd+click toggles a file in the multi-selection.
 *   - Shift+click extends the selection from the anchor to the clicked file.
 *   - Ctrl/Cmd+A selects all files in the current view.
 *   - Esc clears the selection.
 *   - Enter opens the anchor file.
 *   - F2 starts inline rename (falls back to the rename dialog).
 *   - Delete moves the anchor file to the trash (with a confirm dialog).
 *
 * The explorer also accepts drag-and-dropped files (forwarded to the parent
 * for staging) and renders an empty-state placeholder when the folder is
 * empty.
 *
 * UI primitives (NodeIcon, NodeBadges) are imported from `./ui` so this
 * file stays focused on selection logic + rendering, not on badge styling.
 */

import * as React from "react";
import { Inbox, Loader2 } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import { STATUS_BADGE, formatSize, formatRelativeTime, findNodeInTree, type ViewMode } from "./types";
import { ExplorerContextMenu } from "./explorer-context-menu";
import { TreeView } from "./tree-view";
import { NodeIcon, NodeBadges, folderIconCls, folderTileCls, folderRowCls } from "./ui";

// ── Types ───────────────────────────────────────────────────────────────────

export interface FileExplorerProps {
  items: ContentTreeNode[];
  /** Full category trees, used by tree view mode to render every level. */
  treeRoots: ContentTreeNode[];
  /** Shared toolbar search query, forwarded to the tree view. */
  query: string;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onOpen: (node: ContentTreeNode) => void;
  onOpenFolder: (node: ContentTreeNode) => void;
  viewMode: ViewMode;
  loading?: boolean;
  canManage: boolean;
  onDropFiles?: (files: File[]) => void;
  contextActions: ContextMenuActions;
  className?: string;
}

export interface ContextMenuActions {
  onOpen: (node: ContentTreeNode) => void;
  onRename: (node: ContentTreeNode) => void;
  onDelete: (node: ContentTreeNode) => void;
  onDuplicate: (node: ContentTreeNode) => void;
  onDownload: (node: ContentTreeNode) => void;
  onPromote: (node: ContentTreeNode) => void;
  onPublishStaged: (node: ContentTreeNode) => void;
  onDiscardStaged: (node: ContentTreeNode) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onConvert: (node: ContentTreeNode) => void;
  onPublish?: (node: ContentTreeNode) => void;
  onUnpublish?: (node: ContentTreeNode) => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function FileExplorer({
  items, treeRoots, query, selectedIds, onSelectionChange, onOpen, onOpenFolder,
  viewMode, loading, canManage, onDropFiles,
  contextActions, className,
}: FileExplorerProps) {
  const { t } = useI18n();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const anchorRef = React.useRef<number | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [contextNode, setContextNode] = React.useState<ContentTreeNode | null>(null);

  // ── Selection helpers ──────────────────────────────────────────────────
  const selectSingle = (idx: number, node: ContentTreeNode) => {
    anchorRef.current = idx;
    onSelectionChange(new Set([node.id]));
  };
  const toggleInSelection = (idx: number, node: ContentTreeNode) => {
    anchorRef.current = idx;
    const next = new Set(selectedIds);
    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    onSelectionChange(next);
  };
  const selectRange = (idx: number) => {
    const anchor = anchorRef.current ?? 0;
    const start = Math.min(anchor, idx);
    const end = Math.max(anchor, idx);
    const next = new Set(selectedIds);
    for (let i = start; i <= end; i++) if (items[i]) next.add(items[i].id);
    onSelectionChange(next);
  };

  // ── Keyboard navigation ────────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
      onSelectionChange(new Set(items.map((i) => i.id)));
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); onSelectionChange(new Set()); return; }
    if (items.length === 0) return;
    const curIdx = anchorRef.current ?? 0;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      const nextIdx = Math.min(items.length - 1, curIdx + 1);
      anchorRef.current = nextIdx;
      selectSingle(nextIdx, items[nextIdx]);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      const nextIdx = Math.max(0, curIdx - 1);
      anchorRef.current = nextIdx;
      selectSingle(nextIdx, items[nextIdx]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const node = items[curIdx];
      if (node) (node.kind === "folder" ? onOpenFolder : onOpen)(node);
    } else if (e.key === "F2") {
      e.preventDefault();
      const node = items[curIdx];
      if (node && canManage) contextActions.onRename(node);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const node = items[curIdx];
      if (node && canManage) contextActions.onDelete(node);
    }
  }

  // ── Drag-and-drop ──────────────────────────────────────────────────────
  function handleDragOver(e: React.DragEvent) {
    if (!onDropFiles) return;
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  }
  function handleDragLeave(e: React.DragEvent) {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) setDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    if (!onDropFiles) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      onDropFiles(Array.from(e.dataTransfer.files));
      setDragOver(false);
    }
  }

  // ── Container-level right-click handler ────────────────────────────────
  function handleContextMenu(e: React.MouseEvent) {
    const row = (e.target as HTMLElement).closest("[data-node-id]") as HTMLElement | null;
    if (!row) { setContextNode(null); return; }
    const id = row.dataset.nodeId;
    if (!id) return;
    const node = items.find((n) => n.id === id) ?? findNodeInTree(treeRoots, id);
    if (node) setContextNode(node);
  }

  const sharedProps = {
    ref: containerRef,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    onKeyDown: handleKeyDown,
    tabIndex: 0,
    className: cn(
      "relative flex h-full flex-col overflow-hidden outline-none",
      dragOver && "bg-primary/5 ring-2 ring-inset ring-primary/30",
      className,
    ),
  };

  // ── Render: empty state ────────────────────────────────────────────────
  if (items.length === 0 && !loading) {
    return (
      <div {...sharedProps} className={cn(sharedProps.className, "items-center justify-center gap-2 p-8 text-center")}>
        <div className="osler-empty__icon"><Inbox className="size-6" /></div>
        <div>
          <p className="osler-empty__title text-sm">{t("admin.studio.empty")}</p>
          <p className="osler-empty__body text-xs">{t("admin.studio.emptyDesc")}</p>
        </div>
        {dragOver && <p className="text-xs font-medium text-primary">{t("admin.studio.dropToUpload")}</p>}
      </div>
    );
  }

  // ── Render: list or grid ───────────────────────────────────────────────
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          {...sharedProps}
          onContextMenu={handleContextMenu}
          role="listbox"
          aria-multiselectable
        >
          {viewMode === "tree" ? (
            <TreeView
              roots={treeRoots}
              selectedIds={selectedIds}
              onSelect={(node) => {
                anchorRef.current = -1;
                onSelectionChange(new Set([node.id]));
              }}
              onOpen={onOpen}
              query={query}
            />
          ) : viewMode === "grid" ? (
            <GridView
              items={items}
              selectedIds={selectedIds}
              onSelectSingle={selectSingle}
              onToggle={toggleInSelection}
              onSelectRange={selectRange}
              onOpenFolder={onOpenFolder}
              onOpen={onOpen}
            />
          ) : (
            <ListView
              items={items}
              selectedIds={selectedIds}
              onSelectSingle={selectSingle}
              onToggle={toggleInSelection}
              onSelectRange={selectRange}
              onOpenFolder={onOpenFolder}
              onOpen={onOpen}
            />
          )}

          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ExplorerContextMenu node={contextNode} canManage={canManage} actions={contextActions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── Grid view ───────────────────────────────────────────────────────────────

interface ItemViewProps {
  items: ContentTreeNode[];
  selectedIds: Set<string>;
  onSelectSingle: (idx: number, node: ContentTreeNode) => void;
  onToggle: (idx: number, node: ContentTreeNode) => void;
  onSelectRange: (idx: number) => void;
  onOpenFolder: (node: ContentTreeNode) => void;
  onOpen: (node: ContentTreeNode) => void;
}

function GridView({ items, selectedIds, onSelectSingle, onToggle, onSelectRange, onOpenFolder, onOpen }: ItemViewProps) {
  return (
    <div className="flex-1 overflow-y-auto medos-scroll-y p-2.5">
      <div
        role="listbox"
        aria-multiselectable
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
      >
        {items.map((node, idx) => (
          <GridTile
            key={node.id}
            node={node}
            selected={selectedIds.has(node.id)}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) onToggle(idx, node);
              else if (e.shiftKey) onSelectRange(idx);
              else onSelectSingle(idx, node);
            }}
            onDoubleClick={() => (node.kind === "folder" ? onOpenFolder : onOpen)(node)}
          />
        ))}
      </div>
    </div>
  );
}

function GridTile({
  node, selected, onClick, onDoubleClick,
}: {
  node: ContentTreeNode;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}) {
  const isFolder = node.kind === "folder";
  const status = node.cloudObject?.status;
  return (
    <button
      type="button"
      role="option"
      data-node-id={node.id}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-selected={selected}
      className={cn(
        "group relative flex aspect-[4/3] flex-col items-center gap-1 rounded-lg border p-2 text-center transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        selected
          ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30"
          : "border-border bg-card hover:bg-muted/40",
      )}
    >
      {/* Badges — top-right, compact */}
      <div className="absolute end-1 top-1">
        <NodeBadges node={node} variant="compact" />
      </div>

      {/* Icon */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border",
          isFolder
            ? cn("size-8", folderTileCls, folderIconCls)
            : "mt-1 size-10 bg-primary/5 border-primary/20 text-primary",
        )}
      >
        <NodeIcon node={node} className={cn(isFolder ? "size-4" : "size-5")} />
      </div>

      {/* Name */}
      <span
        className={cn(
          "w-full break-words font-medium leading-tight",
          isFolder ? "line-clamp-1 text-[11px]" : "line-clamp-2 text-[11px]",
        )}
      >
        {node.name}
      </span>

      {/* Footer */}
      <div className="mt-auto flex w-full items-center justify-center gap-1 text-[9px] text-muted-foreground">
        {!isFolder && !status && node.size != null && node.size > 0 && (
          <span className="tabular-nums">{formatSize(node.size)}</span>
        )}
        {isFolder && node.items && node.items.length > 0 && (
          <span className="tabular-nums">{node.items.length}</span>
        )}
      </div>
    </button>
  );
}

// ── List view ───────────────────────────────────────────────────────────────

function ListView({ items, selectedIds, onSelectSingle, onToggle, onSelectRange, onOpenFolder, onOpen }: ItemViewProps) {
  const { t } = useI18n();
  return (
    <div className="flex-1 overflow-y-auto medos-scroll-y">
      {/* Header row */}
      <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_110px_70px_100px_110px] items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
        <span>{t("admin.studio.columnName")}</span>
        <span>{t("admin.studio.columnStatus")}</span>
        <span className="text-end">{t("admin.studio.columnSize")}</span>
        <span>{t("admin.studio.columnType")}</span>
        <span>{t("admin.studio.columnUpdated")}</span>
      </div>

      {/* Rows */}
      <div role="listbox" aria-multiselectable>
        {items.map((node, idx) => (
          <ListRow
            key={node.id}
            node={node}
            selected={selectedIds.has(node.id)}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) onToggle(idx, node);
              else if (e.shiftKey) onSelectRange(idx);
              else onSelectSingle(idx, node);
            }}
            onDoubleClick={() => (node.kind === "folder" ? onOpenFolder : onOpen)(node)}
          />
        ))}
      </div>
    </div>
  );
}

function ListRow({
  node, selected, onClick, onDoubleClick,
}: {
  node: ContentTreeNode;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}) {
  const { t } = useI18n();
  const status = node.cloudObject?.status;
  return (
    <button
      type="button"
      role="option"
      data-node-id={node.id}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-selected={selected}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_110px_70px_100px_110px] items-center gap-2 border-b border-border/60 px-3 py-1.5 text-start text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
        selected ? "bg-primary/10" : "hover:bg-muted/40",
      )}
    >
      {/* Name + icon */}
      <div className="flex min-w-0 items-center gap-2">
        <NodeIcon
          node={node}
          className={cn(
            "size-3.5 shrink-0",
            node.kind === "folder" ? folderRowCls : "text-primary",
          )}
        />
        <span className="truncate font-medium">{node.name}</span>
        <NodeBadges node={node} variant="compact" />
      </div>

      {/* Status */}
      <div>
        {status ? (
          <span className={cn("rounded-full border px-1 py-px text-[9px] uppercase tracking-wider", STATUS_BADGE[status])}>
            {t(`admin.studio.row${status.charAt(0).toUpperCase() + status.slice(1)}` as any)}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
      </div>

      {/* Size */}
      <div className="text-end text-[10px] tabular-nums text-muted-foreground">
        {node.size != null && node.size > 0 ? formatSize(node.size) : "—"}
      </div>

      {/* Type */}
      <div className="text-[10px] text-muted-foreground">
        {node.kind === "folder" ? t("admin.studio.folder") : node.cloudObject?.content_type ?? node.ext ?? "—"}
      </div>

      {/* Updated */}
      <div className="text-[10px] text-muted-foreground">
        {node.cloudObject?.updated_at ? formatRelativeTime(node.cloudObject.updated_at) : "—"}
      </div>
    </button>
  );
}
