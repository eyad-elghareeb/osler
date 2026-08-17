"use client";

/**
 * Move Content Dialog — Move files, folders, or multiple items to another folder.
 */

import * as React from "react";
import {
  FolderInput,
  Folder,
  FolderOpen,
  ChevronRight,
  Loader2,
  Check,
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import { CATEGORIES, folderPathOf, type CategoryDef } from "./types";
import { folderRowCls } from "./ui";

export interface MoveContentDialogProps {
  open: boolean;
  onClose: () => void;
  targetNodes: ContentTreeNode[];
  categoryFolder: string;
  unifiedTree: ContentTreeNode[];
  onConfirmMove: (destinationFolder: string, targetNodes: ContentTreeNode[]) => Promise<void>;
}

export function MoveContentDialog({
  open,
  onClose,
  targetNodes,
  categoryFolder,
  unifiedTree,
  onConfirmMove,
}: MoveContentDialogProps) {
  const { t } = useI18n();
  const [selectedCategory, setSelectedCategory] = React.useState<string>(categoryFolder || "library");
  const [subfolderPath, setSubfolderPath] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Update selected category when dialog opens
  React.useEffect(() => {
    if (open) {
      setSelectedCategory(categoryFolder || "library");
      setSubfolderPath("");
      setBusy(false);
    }
  }, [open, categoryFolder]);

  if (!open || targetNodes.length === 0) return null;

  const isBatch = targetNodes.length > 1;
  const singleName = targetNodes[0]?.name || "";

  // Extract all existing folders for the selected category
  const categoryFolders = React.useMemo<{ path: string; label: string; depth: number }[]>(() => {
    const root = unifiedTree.find((n) => n.id === `unified-root-${selectedCategory}`);
    if (!root) return [];

    const list: { path: string; label: string; depth: number }[] = [];

    function collectFolders(node: ContentTreeNode, depth: number) {
      for (const item of node.items ?? []) {
        if (item.kind === "folder" && !item.id.endsWith("__drafts__")) {
          const rawRel = folderPathOf(item);
          // Strip category prefix from path
          const relPath = rawRel.startsWith(`${selectedCategory}/`)
            ? rawRel.slice(selectedCategory.length + 1)
            : rawRel === selectedCategory
              ? ""
              : rawRel;

          if (relPath) {
            list.push({
              path: relPath,
              label: item.name,
              depth,
            });
          }
          collectFolders(item, depth + 1);
        }
      }
    }

    collectFolders(root, 0);
    return list;
  }, [unifiedTree, selectedCategory]);

  const cleanDestination = subfolderPath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  const fullDestinationPath = cleanDestination ? `${selectedCategory}/${cleanDestination}` : selectedCategory;

  async function handleMove() {
    haptic("light");
    setBusy(true);
    try {
      await onConfirmMove(fullDestinationPath, targetNodes);
      onClose();
    } catch {
      // Error handled in hook
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FolderInput className="size-4 text-primary" />
            {t("admin.studio.move.title")}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          {isBatch
            ? t("admin.studio.move.batchDesc", { n: String(targetNodes.length) })
            : t("admin.studio.move.desc", { name: singleName })}
        </p>

        {/* Category Selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("admin.studio.categoryLibrary")}
          </label>
          <Select value={selectedCategory} onValueChange={(val) => { setSelectedCategory(val); setSubfolderPath(""); }}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat.folder} value={cat.folder}>
                  {t(cat.labelKey as any)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Existing Folder Quick Picker */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("admin.studio.move.selectExisting")}
          </label>
          <div className="max-h-36 overflow-y-auto osler-scroll-y rounded-md border border-border bg-card p-1 space-y-0.5">
            {/* Category Root Option */}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                haptic("selection");
                setSubfolderPath("");
              }}
              className={cn(
                "w-full justify-start h-6 text-xs font-normal",
                !cleanDestination ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              <Folder className="me-1.5 size-3 text-primary" />
              {t("admin.studio.move.rootFolder")}
              {!cleanDestination && <Check className="ms-auto size-3 text-primary" />}
            </Button>

            {categoryFolders.map((f) => {
              const active = cleanDestination === f.path;
              return (
                <Button
                  key={f.path}
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    haptic("selection");
                    setSubfolderPath(f.path);
                  }}
                  className={cn(
                    "w-full justify-start h-6 text-xs font-normal truncate",
                    active ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60 text-foreground/80",
                  )}
                  style={{ paddingInlineStart: `${16 + f.depth * 12}px` }}
                >
                  <FolderOpen className={cn("me-1.5 size-3 shrink-0", folderRowCls)} />
                  <span className="truncate">{f.label}</span>
                  <span className="ms-1 font-mono text-[10px] text-muted-foreground opacity-60">({f.path})</span>
                  {active && <Check className="ms-auto size-3 text-primary shrink-0" />}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Destination Path Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("admin.studio.move.destinationFolder")}
          </label>
          <div className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-muted-foreground">
            <span className="shrink-0 text-primary font-semibold">{selectedCategory}/</span>
            <Input
              value={subfolderPath}
              onChange={(e) => setSubfolderPath(e.target.value)}
              placeholder="e.g. cardiology/acute-coronary"
              className="h-6 flex-1 border-0 bg-transparent p-0 text-xs text-foreground font-mono focus-visible:ring-0 shadow-none"
            />
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={handleMove} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="me-1.5 size-3.5 animate-spin" />
                {t("admin.studio.move.moving")}
              </>
            ) : (
              <>
                <FolderInput className="me-1.5 size-3.5" />
                {t("admin.studio.move.moveButton")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
