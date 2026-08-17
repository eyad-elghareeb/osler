"use client";

/**
 * Right-click context menu for the File Explorer.
 *
 * Renders different menu items based on the kind of node that was right-
 * clicked (managed leaf, loose R2 leaf, staged leaf, or folder). The
 * parent passes a `contextActions` object with all the handlers — this
 * component just decides which items to show.
 */

import * as React from "react";
import {
  Eye,
  Pencil,
  Trash2,
  Download,
  Copy,
  PackagePlus,
  Sparkles,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Send,
  Repeat2,
  CloudUpload,
  FolderInput,
  Link,
  Search,
  CheckSquare,
  Plus,
  Upload,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { useToast } from "@/hooks/use-toast";
import { haptic } from "@/lib/osler/native";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import type { ContextMenuActions } from "./file-explorer";
import { collectStagedKeys, nodeContainsStaged, folderPathOf } from "./types";

interface ExplorerContextMenuProps {
  node: ContentTreeNode | null;
  canManage: boolean;
  actions: ContextMenuActions;
}

export function ExplorerContextMenu({ node, canManage, actions }: ExplorerContextMenuProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  function copyToClipboard(text: string, labelKey = "admin.studio.context.copied") {
    haptic("light");
    navigator.clipboard.writeText(text);
    toast({ title: t(labelKey as any) });
  }

  // ── Empty area right-click (no node) ─────────────────────────────────
  if (!node) {
    return (
      <>
        {actions.onSearch && (
          <ContextMenuItem onClick={actions.onSearch}>
            <Search className="size-3.5 me-2" /> {t("admin.studio.context.searchEverything")}
          </ContextMenuItem>
        )}
        {actions.onSelectAll && (
          <ContextMenuItem onClick={actions.onSelectAll}>
            <CheckSquare className="size-3.5 me-2" /> {t("admin.studio.context.selectAll")}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {canManage && (
          <>
            {actions.onNewContent && (
              <ContextMenuItem onClick={actions.onNewContent}>
                <Plus className="size-3.5 me-2 text-primary" /> {t("admin.studio.newContent")}
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => actions.onNewFile("")}>
              <FilePlus className="size-3.5 me-2" /> {t("admin.content.context.newFileHere")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.onNewFolder("")}>
              <FolderPlus className="size-3.5 me-2" /> {t("admin.content.context.newFolderHere")}
            </ContextMenuItem>
            {actions.onUpload && (
              <ContextMenuItem onClick={actions.onUpload}>
                <Upload className="size-3.5 me-2" /> {t("admin.studio.upload")}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={() => actions.onOpen(node as any)}>
          <RefreshCw className="size-3.5 me-2" /> {t("admin.content.context.refresh")}
        </ContextMenuItem>
      </>
    );
  }

  const isFolder = node.kind === "folder";
  const isManagedLeaf = !isFolder && !!node.managed;
  const isStagedLeaf = !isFolder && !!node.staged;
  const isLooseLeaf = !isFolder && !!node.r2Key && !node.managed && !node.staged;
  const folderHasStaged = isFolder && !!node.items?.some(nodeContainsStaged);
  const isPublished = node.cloudObject?.status === "published";

  // ── Managed leaf ──────────────────────────────────────────────────────
  if (isManagedLeaf) {
    return (
      <>
        <ContextMenuItem onClick={() => actions.onOpen(node)}>
          <Eye className="size-3.5 me-2" /> {t("admin.studio.openEditor")}
        </ContextMenuItem>
        {actions.onMove && canManage && (
          <ContextMenuItem onClick={() => actions.onMove?.(node)}>
            <FolderInput className="size-3.5 me-2 text-primary" /> {t("admin.studio.context.move")}
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => actions.onConvert(node)}>
          <Repeat2 className="size-3.5 me-2" /> {t("admin.studio.convert")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onDownload(node)}>
          <Download className="size-3.5 me-2" /> {t("admin.studio.download")}
        </ContextMenuItem>

        <ContextMenuSeparator />
        {/* Copy utilities */}
        {node.cloudObject && (
          <ContextMenuItem onClick={() => copyToClipboard(node.cloudObject!.id)}>
            <Link className="size-3.5 me-2" /> {t("admin.studio.context.copyId")}
          </ContextMenuItem>
        )}
        {node.r2Key && (
          <ContextMenuItem onClick={() => copyToClipboard(node.r2Key!)}>
            <Copy className="size-3.5 me-2" /> {t("admin.studio.context.copyKey")}
          </ContextMenuItem>
        )}

        {canManage && (
          <>
            <ContextMenuSeparator />
            {isPublished && actions.onUnpublish ? (
              <ContextMenuItem onClick={() => actions.onUnpublish?.(node)}>
                <CloudUpload className="size-3.5 me-2" /> {t("admin.studio.unpublish")}
              </ContextMenuItem>
            ) : actions.onPublish ? (
              <ContextMenuItem onClick={() => actions.onPublish?.(node)}>
                <Send className="size-3.5 me-2" /> {t("admin.studio.publish")}
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem onClick={() => actions.onDuplicate(node)}>
              <Copy className="size-3.5 me-2" /> {t("admin.studio.duplicate")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.onDelete(node)}>
              <Trash2 className="size-3.5 me-2 text-destructive" /> {t("admin.studio.delete")}
            </ContextMenuItem>
          </>
        )}
      </>
    );
  }

  // ── Staged R2 leaf ────────────────────────────────────────────────────
  if (isStagedLeaf) {
    return (
      <>
        <ContextMenuItem onClick={() => actions.onOpen(node)}>
          <Eye className="size-3.5 me-2" /> {t("admin.studio.openRaw")}
        </ContextMenuItem>
        {actions.onMove && canManage && (
          <ContextMenuItem onClick={() => actions.onMove?.(node)}>
            <FolderInput className="size-3.5 me-2 text-primary" /> {t("admin.studio.context.move")}
          </ContextMenuItem>
        )}
        {node.r2Key && (
          <ContextMenuItem onClick={() => copyToClipboard(node.r2Key!)}>
            <Copy className="size-3.5 me-2" /> {t("admin.studio.context.copyKey")}
          </ContextMenuItem>
        )}
        {canManage && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => actions.onPublishStaged(node)}>
              <Sparkles className="size-3.5 me-2" /> {t("admin.studio.publishStaged")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.onDiscardStaged(node)}>
              <Trash2 className="size-3.5 me-2 text-destructive" /> {t("admin.studio.discardStaged")}
            </ContextMenuItem>
          </>
        )}
      </>
    );
  }

  // ── Loose R2 leaf ─────────────────────────────────────────────────────
  if (isLooseLeaf) {
    return (
      <>
        <ContextMenuItem onClick={() => actions.onOpen(node)}>
          <Eye className="size-3.5 me-2" /> {t("admin.studio.openRaw")}
        </ContextMenuItem>
        {actions.onMove && canManage && (
          <ContextMenuItem onClick={() => actions.onMove?.(node)}>
            <FolderInput className="size-3.5 me-2 text-primary" /> {t("admin.studio.context.move")}
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => actions.onConvert(node)}>
          <Repeat2 className="size-3.5 me-2" /> {t("admin.studio.convert")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => actions.onDownload(node)}>
          <Download className="size-3.5 me-2" /> {t("admin.studio.download")}
        </ContextMenuItem>
        {node.r2Key && (
          <ContextMenuItem onClick={() => copyToClipboard(node.r2Key!)}>
            <Copy className="size-3.5 me-2" /> {t("admin.studio.context.copyKey")}
          </ContextMenuItem>
        )}
        {canManage && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => actions.onPromote(node)}>
              <PackagePlus className="size-3.5 me-2" /> {t("admin.studio.promoteToManaged")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => actions.onRename(node)}>
              <Pencil className="size-3.5 me-2" /> {t("admin.studio.rename")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.onDuplicate(node)}>
              <Copy className="size-3.5 me-2" /> {t("admin.studio.duplicate")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.onDelete(node)}>
              <Trash2 className="size-3.5 me-2 text-destructive" /> {t("admin.studio.delete")}
            </ContextMenuItem>
          </>
        )}
      </>
    );
  }

  // ── Folder ────────────────────────────────────────────────────────────
  if (isFolder && canManage) {
    const folderPath = folderPathOf(node);
    const isDrafts = node.id.endsWith("__drafts__");
    return (
      <>
        {folderHasStaged && (
          <>
            <ContextMenuItem onClick={() => actions.onPublishStaged(node)}>
              <Sparkles className="size-3.5 me-2" /> {t("admin.studio.publishStaged")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.onDiscardStaged(node)}>
              <Trash2 className="size-3.5 me-2 text-destructive" /> {t("admin.studio.discardStaged")}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {/* The drafts folder is synthetic (no real R2 path) — creating a
            file/folder inside it would write to a fake __drafts__ key. */}
        {!isDrafts && (
          <>
            <ContextMenuItem onClick={() => actions.onNewFile(folderPath)}>
              <FilePlus className="size-3.5 me-2" /> {t("admin.content.context.newFileHere")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.onNewFolder(folderPath)}>
              <FolderPlus className="size-3.5 me-2" /> {t("admin.content.context.newFolderHere")}
            </ContextMenuItem>
          </>
        )}
        {/* Move folder */}
        {!isDrafts && node.r2Key && actions.onMove && (
          <ContextMenuItem onClick={() => actions.onMove?.(node)}>
            <FolderInput className="size-3.5 me-2 text-primary" /> {t("admin.studio.context.move")}
          </ContextMenuItem>
        )}
        {/* Copy folder path */}
        {!isDrafts && (
          <ContextMenuItem onClick={() => copyToClipboard(folderPath)}>
            <Copy className="size-3.5 me-2" /> {t("admin.studio.context.copyPath")}
          </ContextMenuItem>
        )}
        {/* Only non-root, non-drafts folders can be renamed/deleted */}
        {!isDrafts && node.r2Key && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => actions.onRename(node)}>
              <Pencil className="size-3.5 me-2" /> {t("admin.content.context.renameFolder")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => actions.onDelete(node)}>
              <Trash2 className="size-3.5 me-2 text-destructive" /> {t("admin.content.context.deleteFolder")}
            </ContextMenuItem>
          </>
        )}
      </>
    );
  }

  return null;
}

// Exported for parents that want to know if a folder has staged children
// without importing the types module.
export function hasStagedChildren(node: ContentTreeNode): boolean {
  return nodeContainsStaged(node);
}

export function stagedKeysIn(node: ContentTreeNode): string[] {
  return collectStagedKeys(node);
}
