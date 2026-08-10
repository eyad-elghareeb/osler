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
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/osler/native";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import { walkDropEntries } from "@/components/osler/admin/content-dropzone";
import { STATUS_BADGE, formatSize, formatRelativeTime, findNodeInTree, folderPathOf, type ViewMode, type UploadProgress } from "./types";
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
  /** Files dropped into the explorer's empty area. `targetPath` is the folder
   *  they resolved to (the currently open folder, or a category when dropped
   *  on a category tile). When undefined, the parent opens its upload dialog. */
  onDropFiles?: (files: File[], paths: Map<File, string>, targetPath?: string) => void;
  /** Full path of the folder currently open (used to resolve container drops). */
  dropTargetPath?: string;
  /** Live progress of a direct-staging upload, rendered as an overlay. */
  uploadJob?: UploadProgress | null;
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
  viewMode, loading, canManage, onDropFiles, dropTargetPath, uploadJob,
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
  async function handleDrop(e: React.DragEvent) {
    if (!onDropFiles) return;
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    // Walk entries so a dropped folder keeps its internal structure.
    const { files, paths } = await walkDropEntries(e.dataTransfer);
    if (files.length > 0) onDropFiles(files, paths, dropTargetPath || undefined);
    setDragOver(false);
  }

  /** Shared collection helper for drops that land directly on a folder tile:
   *  resolves to that folder's path so the parent stages into it even when a
   *  different folder is open. */
  async function collectDropOnFolder(
    e: React.DragEvent,
    folderNode: ContentTreeNode,
  ): Promise<void> {
    if (!onDropFiles) return;
    e.preventDefault();
    e.stopPropagation();
    const { files, paths } = await walkDropEntries(e.dataTransfer);
    if (files.length > 0) onDropFiles(files, paths, folderPathOf(folderNode));
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

  // ── Direct-staging upload overlay ──────────────────────────────────────
  const uploadOverlay = uploadJob ? (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30">
      <div className="rounded-lg border border-border bg-card/95 p-2.5 shadow-lg backdrop-blur">
        <div className="flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin text-primary" />
          <span className="min-w-0 flex-1 truncate">
            {t("admin.studio.uploadProgress", {
              done: String(uploadJob.done),
              total: String(uploadJob.total),
            })}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground truncate">
            {uploadJob.dest}
          </span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-200"
            style={{ width: `${(uploadJob.done / Math.max(1, uploadJob.total)) * 100}%` }}
          />
        </div>
      </div>
    </div>
  ) : null;

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
        {uploadOverlay}
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
              onDropOnFolder={onDropFiles ? collectDropOnFolder : undefined}
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
              onDropOnFolder={onDropFiles ? collectDropOnFolder : undefined}
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
              onDropOnFolder={onDropFiles ? collectDropOnFolder : undefined}
            />
          )}

          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          )}
          {uploadOverlay}
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
  /** Called when files are dropped on a folder tile — stages into that folder. */
  onDropOnFolder?: (e: React.DragEvent, node: ContentTreeNode) => void;
}

function GridView({ items, selectedIds, onSelectSingle, onToggle, onSelectRange, onOpenFolder, onOpen, onDropOnFolder }: ItemViewProps) {
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
            onDropOnFolder={node.kind === "folder" && !node.id.endsWith("__drafts__") ? onDropOnFolder : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function GridTile({
  node, selected, onClick, onDoubleClick, onDropOnFolder,
}: {
  node: ContentTreeNode;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onDropOnFolder?: (e: React.DragEvent, node: ContentTreeNode) => void;
}) {
  const { t } = useI18n();
  const isFolder = node.kind === "folder";
  const status = node.cloudObject?.status;
  const [dropActive, setDropActive] = React.useState(false);

  function handleTileDragOver(e: React.DragEvent) {
    if (!onDropOnFolder || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }
  function handleTileDragLeave() { setDropActive(false); }
  function handleTileDrop(e: React.DragEvent) {
    if (!onDropOnFolder) return;
    setDropActive(false);
    void onDropOnFolder(e, node);
  }

  return (
    <Button
      type="button"
      role="option"
      data-node-id={node.id}
      onDragOver={handleTileDragOver}
      onDragLeave={handleTileDragLeave}
      onDrop={handleTileDrop}
      aria-selected={selected}
      onClick={(e) => { haptic("selection"); onClick(e); }}
      onDoubleClick={() => { haptic("light"); onDoubleClick(); }}
      className={cn(
        "group relative flex h-auto w-full aspect-[4/3] flex-col items-center gap-1 rounded-xl border p-2 text-center transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        selected
          ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30"
          : "border-border bg-card hover:bg-muted/40 hover:shadow-sm",
        dropActive && "border-primary ring-2 ring-primary/50",
      )}
    >
      {/* Drop target overlay */}
      {dropActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-primary/10">
          <span className="max-w-[90%] truncate rounded bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
            {t("admin.studio.dropOnFolder", { name: node.name })}
          </span>
        </div>
      )}

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
          isFolder ? "line-clamp-1 text-xs" : "line-clamp-2 text-xs",
        )}
      >
        {node.name}
      </span>

      {/* Footer */}
      <div className="mt-auto flex w-full items-center justify-center gap-1 text-xs text-muted-foreground">
        {!isFolder && !status && node.size != null && node.size > 0 && (
          <span className="tabular-nums">{formatSize(node.size)}</span>
        )}
        {isFolder && node.items && node.items.length > 0 && (
          <span className="tabular-nums">{node.items.length}</span>
        )}
      </div>
    </Button>
  );
}

// ── List view ───────────────────────────────────────────────────────────────

function ListView({ items, selectedIds, onSelectSingle, onToggle, onSelectRange, onOpenFolder, onOpen, onDropOnFolder }: ItemViewProps) {
  const { t } = useI18n();
  return (
    <div className="flex-1 overflow-y-auto medos-scroll-y">
      {/* Header row */}
      <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_110px_70px_100px_110px] items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
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
            onDropOnFolder={node.kind === "folder" && !node.id.endsWith("__drafts__") ? onDropOnFolder : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function ListRow({
  node, selected, onClick, onDoubleClick, onDropOnFolder,
}: {
  node: ContentTreeNode;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onDropOnFolder?: (e: React.DragEvent, node: ContentTreeNode) => void;
}) {
  const { t } = useI18n();
  const status = node.cloudObject?.status;
  const [dropActive, setDropActive] = React.useState(false);

  function handleRowDragOver(e: React.DragEvent) {
    if (!onDropOnFolder || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }
  function handleRowDragLeave() { setDropActive(false); }
  function handleRowDrop(e: React.DragEvent) {
    if (!onDropOnFolder) return;
    setDropActive(false);
    void onDropOnFolder(e, node);
  }

  return (
    <Button
      type="button"
      role="option"
      data-node-id={node.id}
      onDragOver={handleRowDragOver}
      onDragLeave={handleRowDragLeave}
      onDrop={handleRowDrop}
      aria-selected={selected}
      onClick={(e) => { haptic("selection"); onClick(e); }}
      onDoubleClick={() => { haptic("light"); onDoubleClick(); }}
      className={cn(
        "grid h-auto w-full grid-cols-[minmax(0,1fr)_110px_70px_100px_110px] items-center gap-2 rounded-none border-b border-border px-3 py-1.5 text-start text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
        selected ? "bg-primary/10" : "hover:bg-muted/40",
        dropActive && "bg-primary/5 ring-1 ring-inset ring-primary/40",
      )}
    >
      {/* Drop target label — shown as an overlay chip on the row */}
      {dropActive && (
        <span className="col-span-5 inline-flex max-w-full items-center gap-1 overflow-hidden">
          <span className="max-w-full truncate rounded bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
            {t("admin.studio.dropOnFolder", { name: node.name })}
          </span>
        </span>
      )}

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
          <span className={cn("rounded-full border px-1 py-px text-xs uppercase tracking-wider", STATUS_BADGE[status])}>
            {t(`admin.studio.row${status.charAt(0).toUpperCase() + status.slice(1)}` as any)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>

      {/* Size */}
      <div className="text-end text-xs tabular-nums text-muted-foreground">
        {node.size != null && node.size > 0 ? formatSize(node.size) : "—"}
      </div>

      {/* Type */}
      <div className="text-xs text-muted-foreground">
        {node.kind === "folder" ? t("admin.studio.folder") : node.cloudObject?.content_type ?? node.ext ?? "—"}
      </div>

      {/* Updated */}
      <div className="text-xs text-muted-foreground">
        {node.cloudObject?.updated_at ? formatRelativeTime(node.cloudObject.updated_at) : "—"}
      </div>
    </Button>
  );
}
