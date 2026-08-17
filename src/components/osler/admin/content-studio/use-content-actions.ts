"use client";

/**
 * useContentActions — a hook that bundles every R2 / managed-object action
 * the Content Studio needs (create file, create folder, rename, delete,
 * duplicate, download, promote, publish, discard, regenerate manifests, …).
 *
 * Extracted from content-studio.tsx so the studio component is a slim
 * orchestrator: it owns the *state* (which dialogs are open, which node is
 * selected) and the hook owns the *side effects* (API calls, toasts, tree
 * reloads). This keeps each piece under 200 lines and makes the actions
 * testable without rendering any UI.
 *
 * The hook returns a stable `actions` object plus a handful of dialog-state
 * setters the parent renders into <PathInputDialog /> / <DeleteConfirmDialog />.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/osler/i18n-provider";
import { useToast } from "@/hooks/use-toast";
import { haptic } from "@/lib/osler/native";
import {
  adminApi,
  type AdminCapabilities,
} from "@/components/osler/admin/admin-api";
import { r2KeyToWorkerUrl } from "@/components/osler/admin/editors/image-upload";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import { collectStagedKeys, folderPathOf } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DialogState {
  /** The path shown in the PathInputDialog (new-file / new-folder / rename). */
  pathInput: string;
  /** The original R2 key being renamed (used as the `from` arg). */
  pathParent: string;
  /** Whether the rename target is a folder (recursive prefix move). */
  renameIsFolder: boolean;
  /** Which PathInputDialog variant is open. */
  pathMode: "newFile" | "newFolder" | "rename" | null;
  /** Delete confirmation. */
  deleteNode: ContentTreeNode | null;
  deleteOpen: boolean;
  /** Convert dialog. */
  convertNode: ContentTreeNode | null;
  convertOpen: boolean;
  /** Move dialog. */
  moveNodes: ContentTreeNode[];
  moveOpen: boolean;
}

export interface ContentActions {
  /** Open the PathInputDialog in "new file" mode. */
  openNewFileDialog: (parentPath: string) => void;
  /** Open the PathInputDialog in "new folder" mode. */
  openNewFolderDialog: (parentPath: string) => void;
  /** Open the PathInputDialog in "rename" mode. */
  openRenameDialog: (node: ContentTreeNode) => void;
  /** Close the PathInputDialog (cancel). */
  closePathDialog: () => void;
  /** Submit the PathInputDialog (creates file/folder or renames). */
  submitPathDialog: () => Promise<void>;
  /** Open the delete confirmation for a node. */
  openDeleteDialog: (node: ContentTreeNode) => void;
  /** Close the delete confirmation (cancel). */
  closeDeleteDialog: () => void;
  /** Confirm the delete. */
  confirmDelete: () => Promise<void>;
  /** Open the convert dialog for a node. */
  openConvertDialog: (node: ContentTreeNode) => void;
  /** Close the convert dialog. */
  closeConvertDialog: () => void;
  /** Open the move dialog for one or more nodes. */
  openMoveDialog: (nodes: ContentTreeNode | ContentTreeNode[]) => void;
  /** Close the move dialog. */
  closeMoveDialog: () => void;
  /** Confirm moving nodes to a destination folder. */
  confirmMove: (destinationFolder: string, nodes: ContentTreeNode[]) => Promise<void>;
  /** Duplicate a node's R2 key. */
  duplicate: (node: ContentTreeNode) => Promise<void>;
  /** Download a node's R2 body as a blob. */
  download: (node: ContentTreeNode) => Promise<void>;
  /** Promote a loose R2 key to a managed content_object. */
  promote: (node: ContentTreeNode) => Promise<void>;
  /** Publish all staged keys under a node. */
  publishStaged: (node: ContentTreeNode) => Promise<void>;
  /** Discard all staged keys under a node. */
  discardStaged: (node: ContentTreeNode) => Promise<void>;
  /** Direct-publish a managed object. */
  publish: (node: ContentTreeNode) => Promise<void>;
  /** Unpublish a managed object. */
  unpublish: (node: ContentTreeNode) => Promise<void>;
  /** Regenerate every category manifest. */
  regenerateManifests: () => Promise<void>;
  /** Whether the manifest regeneration is in flight. */
  regenerating: boolean;
  /** Whether an adopt() call is in flight. */
  adopting: boolean;
  /** Batch backfill raw files in content-files/ to managed content_objects. */
  backfill: () => Promise<void>;
  /** Whether a backfill is in flight. */
  backfilling: boolean;
  /** Sweep orphaned managed R2 objects (failed-backfill debris). */
  gcOrphans: () => Promise<void>;
  /** Whether an orphan sweep is in flight. */
  gcRunning: boolean;
}

export interface UseContentActionsArgs {
  capabilities: AdminCapabilities;
  /** Called after any mutation so the tree reloads. */
  onMutated: () => void;
  /** Called after a successful promote — navigates to the new editor. */
  onPromoted: (id: string) => void;
  /** Called after a successful convert — navigates to the new editor. */
  onConverted: (id: string) => void;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useContentActions({
  capabilities,
  onMutated,
  onPromoted,
  onConverted,
}: UseContentActionsArgs) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();

  const [dialog, setDialog] = React.useState<DialogState>({
    pathInput: "",
    pathParent: "",
    renameIsFolder: false,
    pathMode: null,
    deleteNode: null,
    deleteOpen: false,
    convertNode: null,
    convertOpen: false,
    moveNodes: [],
    moveOpen: false,
  });
  const [adopting, setAdopting] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);
  const [backfilling, setBackfilling] = React.useState(false);
  const [gcRunning, setGcRunning] = React.useState(false);

  // ── Auto-rebuild helper ───────────────────────────────────────────────
  const autoRebuildForCategory = React.useCallback((categoryOrKey: string) => {
    if (!capabilities.manageUsers || !categoryOrKey) return;
    const clean = categoryOrKey
      .replace(/^content-files\//, "")
      .replace(/^content-staging\//, "")
      .replace(/^content\//, "")
      .replace(/^\/+/, "");
    const cat = clean.split("/")[0];
    if (cat && ["library", "qbank", "flashcard", "osce", "videos"].includes(cat)) {
      adminApi.regenerateManifest(cat).catch(() => {
        // Background silent failure log
      });
    }
  }, [capabilities.manageUsers]);

  // ── Backfill ──────────────────────────────────────────────────────────
  async function backfill() {
    if (!capabilities.manageUsers) return;
    setBackfilling(true);
    try {
      let backfilled = 0;
      let existing = 0;
      let guard = 0;
      while (guard++ < 20) {
        const res = await adminApi.backfillContent();
        backfilled += res.backfilled;
        existing += res.existing;
        if (res.complete) break;
        if (res.backfilled === 0 && res.existing === 0) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      haptic("success");
      toast({
        title: t("admin.toast.backfillSuccess"),
        description: t("admin.toast.backfillSuccessDesc", {
          backfilled: String(backfilled),
          existing: String(existing),
        }),
      });
      autoRebuildForCategory("all");
      onMutated();
    } catch {
      haptic("error");
      toast({ title: t("admin.toast.backfillFailed"), variant: "destructive" });
    } finally {
      setBackfilling(false);
    }
  }

  // ── Orphan GC ──────────────────────────────────────────────────────────
  async function gcOrphans() {
    if (!capabilities.manageUsers) return;
    setGcRunning(true);
    try {
      const res = await adminApi.gcOrphans();
      haptic("success");
      toast({
        title: t("admin.toast.gcOrphansSuccess"),
        description: t("admin.toast.gcOrphansSuccessDesc", {
          deleted: String(res.deleted),
          remaining: String(res.remaining),
        }),
      });
      onMutated();
    } catch {
      haptic("error");
      toast({ title: t("admin.toast.gcOrphansFailed"), variant: "destructive" });
    } finally {
      setGcRunning(false);
    }
  }

  // ── Path validation ───────────────────────────────────────────────────
  function pathError(raw: string): string | null {
    const p = raw.replace(/^\/+/, "");
    if (!p) return "Required";
    if (p.split("/").some((seg) => seg === "..") || p.includes("\\") || p.startsWith("/")) {
      return "Invalid path — cannot contain '..' or '\\'";
    }
    return null;
  }

  // ── PathInputDialog openers ───────────────────────────────────────────
  function openNewFileDialog(parentPath: string) {
    setDialog((d) => ({
      ...d,
      pathMode: "newFile",
      pathParent: parentPath,
      pathInput: parentPath ? `${parentPath}/new-file.json` : "new-file.json",
    }));
  }
  function openNewFolderDialog(parentPath: string) {
    setDialog((d) => ({
      ...d,
      pathMode: "newFolder",
      pathParent: parentPath,
      pathInput: parentPath ? `${parentPath}/new-folder` : "new-folder",
    }));
  }
  function openRenameDialog(node: ContentTreeNode) {
    setDialog((d) => ({
      ...d,
      pathMode: "rename",
      pathParent: node.r2Key ?? "",
      pathInput: node.r2Key ?? node.name,
      renameIsFolder: node.kind === "folder",
    }));
  }
  function closePathDialog() {
    setDialog((d) => ({ ...d, pathMode: null }));
  }

  // ── PathInputDialog submit ────────────────────────────────────────────
  async function submitPathDialog() {
    if (!capabilities.manageUsers || !dialog.pathMode) return;
    const pathErr = pathError(dialog.pathInput);
    if (pathErr) {
      toast({ title: t("admin.content.invalidPath"), description: pathErr, variant: "destructive" });
      return;
    }
    const cleaned = dialog.pathInput.replace(/^\/+/, "");
    try {
      if (dialog.pathMode === "newFile") {
        const key = `content-files/${cleaned}`;
        const isJson = key.endsWith(".json");
        const isMd = key.endsWith(".md");
        const body = isJson ? "{}" : isMd ? "# New article\n" : "";
        await adminApi.uploadFile(key, body);
        toast({ title: t("admin.toast.created", { path: dialog.pathInput }) });
        autoRebuildForCategory(cleaned);
      } else if (dialog.pathMode === "newFolder") {
        await adminApi.createR2Folder(`content-files/${cleaned}`);
        toast({ title: t("admin.toast.createdFolder", { path: dialog.pathInput }) });
        autoRebuildForCategory(cleaned);
      } else if (dialog.pathMode === "rename") {
        const to = `content-files/${cleaned}`;
        if (dialog.renameIsFolder) {
          await adminApi.renameR2Folder(dialog.pathParent, to);
          toast({ title: t("admin.toast.renamedFolder", { path: dialog.pathInput }) });
        } else {
          await adminApi.renameR2Key(dialog.pathParent, to);
          toast({ title: t("admin.toast.renamed", { path: dialog.pathInput }) });
        }
        autoRebuildForCategory(dialog.pathParent);
        autoRebuildForCategory(cleaned);
      }
      setDialog((d) => ({ ...d, pathMode: null }));
      onMutated();
    } catch (err) {
      const key = dialog.pathMode === "newFile"
        ? "admin.toast.createFailed"
        : dialog.pathMode === "newFolder"
          ? "admin.toast.createFolderFailed"
          : "admin.toast.renameFailed";
      toast({ title: t(key as any, { error: String(err) }), variant: "destructive" });
    }
  }

  // ── Move ──────────────────────────────────────────────────────────────
  function openMoveDialog(nodes: ContentTreeNode | ContentTreeNode[]) {
    const list = Array.isArray(nodes) ? nodes : [nodes];
    setDialog((d) => ({ ...d, moveNodes: list, moveOpen: true }));
  }
  function closeMoveDialog() {
    setDialog((d) => ({ ...d, moveOpen: false, moveNodes: [] }));
  }

  async function confirmMove(destinationFolder: string, nodes: ContentTreeNode[]) {
    if (!capabilities.manageUsers || nodes.length === 0) return;
    const destClean = destinationFolder.replace(/^\/+/, "").replace(/\/+$/, "");
    let movedCount = 0;
    const affectedCats = new Set<string>();
    affectedCats.add(destClean.split("/")[0]);

    for (const node of nodes) {
      try {
        if (node.kind === "folder") {
          const fromPrefix = folderPathOf(node);
          const toPrefix = `${destClean}/${node.name}`;
          await adminApi.renameR2Folder(fromPrefix, toPrefix);
          affectedCats.add(fromPrefix.split("/")[0]);
          movedCount++;
        } else {
          const rawKey = node.r2Key ?? "";
          if (rawKey) {
            const isStaged = rawKey.startsWith("content-staging/");
            const scope = isStaged ? "content-staging" : "content-files";
            const targetKey = `${scope}/${destClean}/${node.name}`;
            await adminApi.renameR2Key(rawKey, targetKey);
            affectedCats.add(rawKey.replace(/^content-[^/]+\//, "").split("/")[0]);
            movedCount++;
          }
          if (node.managed && node.cloudObject) {
            if (node.cloudObject.status === "published") {
              await adminApi.publishDirect(node.cloudObject.id, {
                targetPath: `${destClean}/${node.name}`,
                hybrid: true,
              });
            }
          }
        }
      } catch (err) {
        console.error("Move error for", node.name, err);
      }
    }

    if (movedCount > 0) {
      haptic("success");
      toast({
        title: nodes.length === 1
          ? t("admin.studio.move.success", { name: nodes[0].name, dest: destClean })
          : t("admin.studio.move.batchSuccess", { n: String(movedCount), dest: destClean }),
      });
      // Auto-rebuild manifests for all affected categories
      affectedCats.forEach((cat) => autoRebuildForCategory(cat));
      onMutated();
    } else {
      haptic("error");
      toast({ title: t("admin.studio.move.failed", { error: "Could not move items" }), variant: "destructive" });
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────
  function openDeleteDialog(node: ContentTreeNode) {
    setDialog((d) => ({ ...d, deleteNode: node, deleteOpen: true }));
  }
  function closeDeleteDialog() {
    setDialog((d) => ({ ...d, deleteOpen: false, deleteNode: null }));
  }
  async function confirmDelete() {
    const node = dialog.deleteNode;
    if (!node) return;
    try {
      if (node.kind === "folder") {
        const path = folderPathOf(node);
        const res = await adminApi.deleteR2Folder(path);
        toast({ title: t("admin.toast.deletedFolder", { name: node.name, n: String(res.deleted) }) });
        autoRebuildForCategory(path);
      } else {
        if (!node.r2Key) return;
        if (node.managed && node.cloudObject) {
          await adminApi.deleteContent(node.cloudObject.id);
        } else {
          await adminApi.deleteR2Key(node.r2Key);
        }
        toast({ title: t("admin.toast.deleted", { name: node.name }) });
        autoRebuildForCategory(node.r2Key);
      }
      setDialog((d) => ({ ...d, deleteOpen: false, deleteNode: null }));
      onMutated();
    } catch (err) {
      toast({ title: t("admin.toast.deleteFailedR2", { error: String(err) }), variant: "destructive" });
    }
  }

  // ── Convert ───────────────────────────────────────────────────────────
  function openConvertDialog(node: ContentTreeNode) {
    setDialog((d) => ({ ...d, convertNode: node, convertOpen: true }));
  }
  function closeConvertDialog() {
    setDialog((d) => ({ ...d, convertOpen: false, convertNode: null }));
  }

  // ── Duplicate ─────────────────────────────────────────────────────────
  async function duplicate(node: ContentTreeNode) {
    if (!capabilities.manageUsers || !node.r2Key) return;
    const ext = node.r2Key.split(".").pop() ?? "";
    const base = node.r2Key.replace(/\.[^.]+$/, "");
    const copyKey = `${base}-copy${ext ? "." + ext : ""}`;
    try {
      const url = r2KeyToWorkerUrl(node.r2Key);
      if (!url) throw new Error("Cloud not configured");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const body = await res.text();
      await adminApi.uploadFile(copyKey, body);
      toast({ title: t("admin.toast.duplicated", { path: copyKey.replace(/^content-files\//, "") }) });
      autoRebuildForCategory(copyKey);
      onMutated();
    } catch (err) {
      toast({ title: t("admin.toast.duplicateFailed", { error: String(err) }), variant: "destructive" });
    }
  }

  // ── Download ──────────────────────────────────────────────────────────
  async function download(node: ContentTreeNode) {
    if (!node.r2Key) return;
    try {
      const url = node.r2Key.startsWith("content-staging/")
        ? null
        : r2KeyToWorkerUrl(node.r2Key);
      let blob: Blob;
      if (url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        blob = await res.blob();
      } else {
        blob = await adminApi.getR2Binary(node.r2Key);
      }
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = node.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      console.error("Download failed:", err);
      toast({ title: "Download failed", variant: "destructive" });
    }
  }

  // ── Promote (adopt) ───────────────────────────────────────────────────
  async function promote(node: ContentTreeNode) {
    if (!capabilities.manageUsers || !node.r2Key) return;
    setAdopting(true);
    try {
      const res = await adminApi.adoptR2Key(node.r2Key);
      toast({
        title: res.alreadyExisted
          ? t("admin.toast.adoptAlreadyManaged")
          : t("admin.toast.adopted", { id: res.id.slice(0, 8) }),
      });
      autoRebuildForCategory(node.r2Key);
      onPromoted(res.id);
    } catch (err: any) {
      toast({ title: t("admin.toast.adoptFailed", { error: String(err?.message ?? err) }), variant: "destructive" });
    } finally {
      setAdopting(false);
    }
  }

  // ── Staged publish / discard ──────────────────────────────────────────
  async function publishStaged(node: ContentTreeNode) {
    if (!capabilities.manageUsers) return;
    const keys = collectStagedKeys(node);
    if (keys.length === 0) return;
    try {
      const res = await adminApi.publishStaged(keys);
      toast({ title: t("admin.toast.publishedStaged", { n: res.published.length }) });
      keys.forEach((k) => autoRebuildForCategory(k));
      onMutated();
    } catch (err: any) {
      toast({ title: t("admin.toast.publishStagedFailed", { error: String(err?.message ?? err) }), variant: "destructive" });
    }
  }
  async function discardStaged(node: ContentTreeNode) {
    if (!capabilities.manageUsers) return;
    const keys = collectStagedKeys(node);
    if (keys.length === 0) return;
    try {
      const res = await adminApi.discardStaged(keys);
      toast({ title: t("admin.toast.discardedStaged", { n: res.deleted }) });
      onMutated();
    } catch (err: any) {
      toast({ title: t("admin.toast.discardStagedFailed", { error: String(err?.message ?? err) }), variant: "destructive" });
    }
  }

  // ── Managed publish / unpublish ───────────────────────────────────────
  async function publish(node: ContentTreeNode) {
    if (!node.cloudObject) return;
    try {
      await adminApi.publishDirect(node.cloudObject.id);
      toast({ title: t("admin.content.published") });
      if (node.r2Key) autoRebuildForCategory(node.r2Key);
      onMutated();
    } catch (err: any) {
      toast({ title: t("admin.toast.publishFailed"), description: String(err?.message ?? err), variant: "destructive" });
    }
  }
  async function unpublish(node: ContentTreeNode) {
    if (!node.cloudObject) return;
    try {
      await adminApi.unpublish(node.cloudObject.id);
      toast({ title: "Unpublished" });
      if (node.r2Key) autoRebuildForCategory(node.r2Key);
      onMutated();
    } catch (err: any) {
      toast({ title: "Unpublish failed", description: String(err?.message ?? err), variant: "destructive" });
    }
  }

  // ── Regenerate manifests ──────────────────────────────────────────────
  async function regenerateManifests() {
    if (!capabilities.manageUsers) return;
    setRegenerating(true);
    try {
      const res = await adminApi.regenerateManifest("all");
      const failed = Object.entries(res.results).filter(([, v]) => !v.startsWith("ok") && v !== "empty");
      if (failed.length === 0) {
        toast({ title: t("admin.toast.manifestsRegenerated") });
      } else {
        toast({ title: t("admin.toast.regeneratedWithErrors", { n: String(failed.length) }), variant: "destructive" });
      }
    } catch (err) {
      toast({ title: t("admin.toast.regenerateFailed", { error: String(err) }), variant: "destructive" });
    } finally {
      setRegenerating(false);
    }
  }

  // ── Stable actions object ─────────────────────────────────────────────
  const actions: ContentActions = React.useMemo(() => ({
    openNewFileDialog,
    openNewFolderDialog,
    openRenameDialog,
    closePathDialog,
    submitPathDialog,
    openDeleteDialog,
    closeDeleteDialog,
    confirmDelete,
    openConvertDialog,
    closeConvertDialog,
    openMoveDialog,
    closeMoveDialog,
    confirmMove,
    duplicate,
    download,
    promote,
    publishStaged,
    discardStaged,
    publish,
    unpublish,
    regenerateManifests,
    regenerating,
    adopting,
    backfill,
    backfilling,
    gcOrphans,
    gcRunning,
  }), [capabilities, onMutated, onPromoted, adopting, regenerating, backfilling, gcRunning, t, toast, router, autoRebuildForCategory]);

  return { actions, dialog, setDialog };
}
