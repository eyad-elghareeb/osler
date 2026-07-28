"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  FileText,
  AlertCircle,
  HardDrive,
  Upload,
  Loader2,
  RefreshCw,
  FolderPlus,
  FilePlus,
  Pencil,
  Trash2,
  Download,
  Eye,
  Sparkles,
  CloudCog,
  PackagePlus,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { EmptyState, LoadingState } from "@/components/osler/ui-primitives";
import {
  adminApi,
  type ContentObject,
  type ContentType,
  type AdminCapabilities,
} from "@/components/osler/admin/admin-api";
import { useToast } from "@/hooks/use-toast";
import {
  ContentTreePane,
  type ContentTreeNode,
} from "@/components/osler/admin/content-tree-pane";
import {
  ContentDropzone,
  uploadDroppedFile,
  type DroppedFile,
} from "@/components/osler/admin/content-dropzone";

const CONTENT_TYPES: ContentType[] = ["quiz", "bank", "flashcard", "written", "osce", "library", "video"];

/** Category folders exposed in the unified browser. Each one is also a
 *  student-facing R2 keyspace (content-files/<folder>/...). */
function getCategories(t: any): { folder: string; label: string; contentType: ContentType }[] {
  return [
    { folder: "library", label: t("admin.content.browser.library"), contentType: "library" },
    { folder: "qbank", label: t("admin.content.browser.qbank"), contentType: "quiz" },
    { folder: "flashcard", label: t("admin.content.browser.flashcards"), contentType: "flashcard" },
    { folder: "osce", label: t("admin.content.browser.osce"), contentType: "osce" },
    { folder: "videos", label: t("admin.content.browser.videos"), contentType: "video" },
  ];
}

interface ContentBrowserProps {
  capabilities: AdminCapabilities;
}

/** Tabs:
 *  - "unified" (default): merges managed content_objects with raw R2 keys
 *    into one tree per category. Each leaf is badged "managed" or "loose".
 *  - "local": read-only preview of files under /public/osler-content/ (useful
 *    only in self-hosted dev environments where the Next.js server is the
 *    content origin).
 */
type Tab = "unified" | "local";

export function ContentBrowser({ capabilities }: ContentBrowserProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();

  const [tab, setTab] = React.useState<Tab>("unified");

  // Unified-tree state
  const [unifiedTree, setUnifiedTree] = React.useState<ContentTreeNode[]>([]);
  const [unifiedLoading, setUnifiedLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [r2Missing, setR2Missing] = React.useState(false);

  // Local-tree state
  const [localTree, setLocalTree] = React.useState<ContentTreeNode[]>([]);
  const [localLoading, setLocalLoading] = React.useState(true);

  const [selectedNode, setSelectedNode] = React.useState<ContentTreeNode | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [newFileOpen, setNewFileOpen] = React.useState(false);
  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [adopting, setAdopting] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);

  // Delete-R2-key confirmation modal — replaces the old `confirm()` prompt
  // for a more native, dismissible experience.
  const [deleteR2Open, setDeleteR2Open] = React.useState(false);
  const [deleteR2Node, setDeleteR2Node] = React.useState<ContentTreeNode | null>(null);

  // Shared by the new-file/new-folder/rename dialogs
  const [dialogPath, setDialogPath] = React.useState("");
  const [dialogParent, setDialogParent] = React.useState<string>("");

  // ── Load unified tree ────────────────────────────────────────────────────
  //
  // The unified tree is a per-category merge of:
  //   1. Managed content_objects (filtered by statusFilter if not "all").
  //      Each becomes a leaf with managed=true and a status badge.
  //   2. Raw R2 keys under content-files/<category>/. Each becomes a leaf
  //      with r2Key set. After the merge, we call lookupByR2Key() in
  //      parallel to flip managed=true on any loose R2 leaf that actually
  //      belongs to a managed object — those leaves also keep their
  //      cloudObject reference so the badge + status render correctly.
  //
  // The merge is keyed on the r2 key (the canonical student-facing path).
  // Managed objects whose hybrid target path can't be matched to an existing
  // R2 key (e.g. they were published with a custom targetPath) are still
  // appended as managed leaves so admins can find them.
  const loadUnified = React.useCallback(async () => {
    setUnifiedLoading(true);
    setR2Missing(false);
    try {
      const categories = getCategories(t);
      const roots: ContentTreeNode[] = [];

      // Step 1: fetch all managed objects (all statuses) once.
      // listContent supports status="all" — use it so we can badge every
      // leaf with the right status regardless of the filter.
      const allObjects: ContentObject[] = [];
      try {
        const res = await adminApi.listContent("all");
        allObjects.push(...(res.items || []));
      } catch (err: any) {
        if (err?.status === 503) { setR2Missing(true); setUnifiedTree([]); return; }
        throw err;
      }

      // Group managed objects by their R2 category (derived from content_type).
      const typeToCat: Record<string, string> = {
        quiz: "qbank", bank: "qbank", written: "qbank",
        flashcard: "flashcard", osce: "osce",
        library: "library", video: "videos",
      };
      const managedByCat = new Map<string, ContentObject[]>();
      for (const obj of allObjects) {
        const cat = typeToCat[obj.content_type] ?? obj.content_type;
        if (!managedByCat.has(cat)) managedByCat.set(cat, []);
        managedByCat.get(cat)!.push(obj);
      }

      // Step 2: for each category, fetch the raw R2 keys and build a merged tree.
      for (const cat of categories) {
        const managed = managedByCat.get(cat.folder) ?? [];

        // Try to list the R2 keys. If R2 isn't configured, fall back to a
        // managed-only tree for this category.
        let r2Items: Array<{ key: string; size: number; uploaded: string | null }> = [];
        try {
          if (capabilities.manageUsers) {
            const r2 = await adminApi.listR2Keys(cat.folder);
            r2Items = r2.items || [];
          }
        } catch (err: any) {
          if (err?.status === 503) { setR2Missing(true); }
        }

        // Build the merged tree by walking the R2 keyspace first, then
        // attaching managed objects to their corresponding R2 leaves (or
        // appending as standalone managed leaves if they have no R2
        // counterpart yet — i.e. a draft that has never been published).
        const tree = buildUnifiedTree(cat.folder, cat.contentType, r2Items, managed, statusFilter);

        roots.push({
          id: `unified-root-${cat.folder}`,
          name: cat.label,
          kind: "folder",
          items: tree,
        });
      }

      setUnifiedTree(roots);
    } catch (err: any) {
      toast({ title: t("admin.toast.failedLoadContent"), variant: "destructive" });
    } finally {
      setUnifiedLoading(false);
    }
  }, [capabilities.manageUsers, statusFilter, toast, t]);

  React.useEffect(() => {
    if (tab === "unified") loadUnified();
  }, [tab, loadUnified]);

  // ── Load local content tree (dev-only tab) ────────────────────────────────
  const loadLocal = React.useCallback(async () => {
    setLocalLoading(true);
    try {
      const allTrees: ContentTreeNode[] = [];
      for (const cat of getCategories(t)) {
        try {
          const res = await fetch(`/osler-content/${cat.folder}/manifest.json`, { cache: "no-store" });
          if (!res.ok) continue;
          const manifest = await res.json();
          const tree = manifestToTree(manifest, cat.folder, cat.contentType);
          allTrees.push({
            id: `local-root-${cat.folder}`,
            name: cat.label,
            kind: "folder",
            items: tree,
          });
        } catch {}
      }
      setLocalTree(allTrees);
    } finally {
      setLocalLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    if (tab === "local") loadLocal();
  }, [tab, loadLocal]);

  const tree = tab === "unified" ? unifiedTree : localTree;

  function handleSelect(node: ContentTreeNode) {
    haptic("selection");
    setSelectedNode(node);
    // Route based on what we know about the node:
    //   - managed leaf → /admin/content/<id>
    //   - loose R2 leaf → /admin/content/raw?key=...
    //   - local leaf → no-op (read-only preview shown in the preview pane)
    if (tab === "unified") {
      if (node.managed && node.cloudObject) {
        router.push(`/admin/content/${node.cloudObject.id}`);
      } else if (node.r2Key) {
        router.push(`/admin/content/raw?key=${encodeURIComponent(node.r2Key)}`);
      }
    }
  }

  // ── Context menu action handlers ────────────────────────────────────────
  function openNewFileDialog(parentPath: string) {
    setDialogParent(parentPath);
    setDialogPath(parentPath ? `${parentPath}/new-file.json` : "new-file.json");
    setNewFileOpen(true);
  }
  function openNewFolderDialog(parentPath: string) {
    setDialogParent(parentPath);
    setDialogPath(parentPath ? `${parentPath}/new-folder` : "new-folder");
    setNewFolderOpen(true);
  }
  function openRenameDialog(node: ContentTreeNode) {
    setDialogParent(node.r2Key ?? "");
    setDialogPath(node.r2Key ?? node.name);
    setRenameOpen(true);
  }

  async function createNewR2File() {
    if (!capabilities.manageUsers) return;
    const key = `content-files/${dialogPath.replace(/^\/+/, "")}`;
    const isJson = key.endsWith(".json");
    const isMd = key.endsWith(".md");
    const body = isJson ? "{}" : isMd ? "# New article\n" : "";
    try {
      await adminApi.uploadFile(key, body);
      toast({ title: t("admin.toast.created", { path: dialogPath }) });
      setNewFileOpen(false);
      loadUnified();
    } catch (err) {
      toast({ title: t("admin.toast.createFailed", { error: String(err) }), variant: "destructive" });
    }
  }

  async function createNewR2Folder() {
    if (!capabilities.manageUsers) return;
    const path = `content-files/${dialogPath.replace(/^\/+/, "")}`;
    try {
      await adminApi.createR2Folder(path);
      toast({ title: t("admin.toast.createdFolder", { path: dialogPath }) });
      setNewFolderOpen(false);
      loadUnified();
    } catch (err) {
      toast({ title: t("admin.toast.createFolderFailed", { error: String(err) }), variant: "destructive" });
    }
  }

  async function renameR2Key() {
    if (!capabilities.manageUsers) return;
    try {
      await adminApi.renameR2Key(dialogParent, `content-files/${dialogPath.replace(/^\/+/, "")}`);
      toast({ title: t("admin.toast.renamed", { path: dialogPath }) });
      setRenameOpen(false);
      loadUnified();
    } catch (err) {
      toast({ title: t("admin.toast.renameFailed", { error: String(err) }), variant: "destructive" });
    }
  }

  async function deleteR2Key(node: ContentTreeNode) {
    if (!capabilities.manageUsers) return;
    if (!node.r2Key) return;
    // Open a native-styled AlertDialog instead of the blocking confirm()
    // so the user can dismiss by clicking the backdrop, pressing Esc, or
    // tapping Cancel — none of which work with the native browser confirm.
    setDeleteR2Node(node);
    setDeleteR2Open(true);
  }

  async function confirmDeleteR2Key() {
    const node = deleteR2Node;
    if (!node?.r2Key) return;
    try {
      await adminApi.deleteR2Key(node.r2Key);
      toast({ title: t("admin.toast.deleted", { name: node.name }) });
      loadUnified();
    } catch (err) {
      toast({ title: t("admin.toast.deleteFailedR2", { error: String(err) }), variant: "destructive" });
    } finally {
      setDeleteR2Open(false);
      setDeleteR2Node(null);
    }
  }

  async function duplicateR2Key(node: ContentTreeNode) {
    if (!capabilities.manageUsers) return;
    if (!node.r2Key) return;
    const ext = node.r2Key.split(".").pop() ?? "";
    const base = node.r2Key.replace(/\.[^.]+$/, "");
    const copyKey = `${base}-copy${ext ? "." + ext : ""}`;
    try {
      const res = await fetch(`/api/r2-fetch?key=${encodeURIComponent(node.r2Key)}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const body = await res.text();
      await adminApi.uploadFile(copyKey, body);
      toast({ title: t("admin.toast.duplicated", { path: copyKey.replace(/^content-files\//, "") }) });
      loadUnified();
    } catch (err) {
      toast({ title: t("admin.toast.duplicateFailed", { error: String(err) }), variant: "destructive" });
    }
  }

  async function promoteToManaged(node: ContentTreeNode) {
    if (!capabilities.manageUsers) return;
    if (!node.r2Key) return;
    setAdopting(true);
    try {
      const res = await adminApi.adoptR2Key(node.r2Key);
      toast({
        title: res.alreadyExisted
          ? t("admin.toast.adoptAlreadyManaged")
          : t("admin.toast.adopted", { id: res.id.slice(0, 8) }),
      });
      router.push(`/admin/content/${res.id}`);
    } catch (err: any) {
      toast({ title: t("admin.toast.adoptFailed", { error: String(err?.message ?? err) }), variant: "destructive" });
    } finally {
      setAdopting(false);
    }
  }

  async function regenerateAllManifests() {
    if (!capabilities.manageUsers) return;
    setRegenerating(true);
    try {
      const res = await adminApi.regenerateManifest("all");
      const failed = Object.entries(res.results).filter(([, v]) => !v.startsWith("ok") && v !== "empty");
      if (failed.length === 0) {
        toast({ title: t("admin.toast.manifestsRegenerated"), description: Object.entries(res.results).map(([k, v]) => `${k}: ${v}`).join(", ") });
      } else {
        toast({ title: t("admin.toast.regeneratedWithErrors", { n: String(failed.length) }), variant: "destructive" });
      }
      if (tab === "local") loadLocal();
    } catch (err) {
      toast({ title: t("admin.toast.regenerateFailed", { error: String(err) }), variant: "destructive" });
    } finally {
      setRegenerating(false);
    }
  }

  // ── Render: R2 not configured
  if (tab === "unified" && r2Missing && unifiedTree.length === 0) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t("admin.content.noR2")}
        description={t("admin.content.noR2Desc")}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab switcher + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 border-b border-border flex-1 min-w-[260px]">
          <TabButton
            active={tab === "unified"}
            onClick={() => setTab("unified")}
            icon={CloudCog}
            label={t("admin.content.tab.unified")}
            desc={t("admin.content.tab.unifiedDesc")}
          />
          <TabButton
            active={tab === "local"}
            onClick={() => setTab("local")}
            icon={HardDrive}
            label={t("admin.content.tab.local")}
            desc={t("admin.content.tab.localDesc")}
          />
        </div>

        <div className="flex items-center gap-2">
          {tab === "unified" && (
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("admin.content.tab.all")}</SelectItem>
                <SelectItem value="published">{t("admin.content.tab.published")}</SelectItem>
                <SelectItem value="draft">{t("admin.content.tab.drafts")}</SelectItem>
                <SelectItem value="pending">{t("admin.content.tab.pending")}</SelectItem>
                <SelectItem value="rejected">{t("admin.content.tab.rejected")}</SelectItem>
              </SelectContent>
            </Select>
          )}
          {tab === "unified" && capabilities.manageUsers && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openNewFolderDialog("")}
                title={t("admin.content.newFolder")}
              >
                <FolderPlus className="me-1.5 size-3.5" />
                {t("admin.content.newFolder")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openNewFileDialog("")}
                title={t("admin.content.newFile")}
              >
                <FilePlus className="me-1.5 size-3.5" />
                {t("admin.content.newFile")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={regenerateAllManifests}
                disabled={regenerating}
                title={t("admin.content.regenerateManifests")}
              >
                {regenerating ? <Loader2 className="me-1.5 size-3.5 animate-spin" /> : <Sparkles className="me-1.5 size-3.5" />}
                {t("admin.content.regenerateManifests")}
              </Button>
            </>
          )}
          {tab === "unified" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="me-1.5 size-3.5" />
              {t("admin.content.upload")}
            </Button>
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="me-1.5 size-3.5" />
            {t("admin.content.new")}
          </Button>
        </div>
      </div>

      {/* Two-pane tree + preview layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 min-h-[480px] lg:min-h-0 flex-1">
        {/* Tree pane — wrapped in a context menu for right-click actions */}
        <div className="border border-border rounded-xl overflow-hidden lg:min-h-0">
          {tab === "unified" && unifiedLoading ? (
            <LoadingState label={t("common.loading")} className="h-full" />
          ) : tab === "local" && localLoading ? (
            <LoadingState label={t("common.loading")} className="h-full" />
          ) : (
            <ContentTreePaneWithContextMenu
              tree={tree}
              selectedId={selectedNode?.id ?? null}
              onSelect={handleSelect}
              onRefresh={tab === "unified" ? loadUnified : loadLocal}
              kind={tab === "unified" ? "unified" : "local"}
              loading={tab === "unified" ? unifiedLoading : localLoading}
              tab={tab}
              onNewFile={openNewFileDialog}
              onNewFolder={openNewFolderDialog}
              onRename={openRenameDialog}
              onDelete={deleteR2Key}
              onDuplicate={duplicateR2Key}
              onPromote={promoteToManaged}
              canManage={capabilities.manageUsers}
              adopting={adopting}
            />
          )}
        </div>

        {/* Preview pane */}
        <div className="border border-border rounded-xl overflow-hidden bg-card">
          {!selectedNode ? (
            <EmptyState
              icon={FileText}
              title={t("admin.content.empty")}
              description={
                tab === "unified"
                  ? t("admin.content.previewDescUnified")
                  : t("admin.content.previewDescLocal")
              }
              className="h-full"
            />
          ) : (
            <PreviewPane node={selectedNode} tab={tab} />
          )}
        </div>
      </div>

      {/* Create dialog */}
      <CreateContentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => router.push(`/admin/content/${id}`)}
      />

      {/* Upload dialog */}
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={(id) => {
          setUploadOpen(false);
          loadUnified();
          router.push(`/admin/content/${id}`);
        }}
      />

      {/* New file dialog (unified tab — R2 keyspace) */}
      <Dialog open={newFileOpen} onOpenChange={setNewFileOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("admin.content.newFileTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground">
              {t("admin.content.newFileDesc")}
            </p>
            <Input
              value={dialogPath}
              onChange={(e) => setDialogPath(e.target.value)}
              placeholder="qbank/cardiology/acute-coronary/questions.json"
              className="font-mono text-xs"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFileOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={createNewR2File} disabled={!dialogPath.trim()}>
              <FilePlus className="size-3.5 me-1.5" /> {t("admin.content.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New folder dialog (unified tab — R2 keyspace) */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("admin.content.newFolderTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground">
              {t("admin.content.newFolderDesc")}
            </p>
            <Input
              value={dialogPath}
              onChange={(e) => setDialogPath(e.target.value)}
              placeholder="library/cardiology/new-topic"
              className="font-mono text-xs"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={createNewR2Folder} disabled={!dialogPath.trim()}>
              <FolderPlus className="size-3.5 me-1.5" /> {t("admin.content.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog (unified tab — R2 keyspace) */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("admin.content.renameTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground">
              {t("admin.content.renameDesc")}
            </p>
            <Input
              value={dialogPath}
              onChange={(e) => setDialogPath(e.target.value)}
              className="font-mono text-xs"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={renameR2Key} disabled={!dialogPath.trim()}>
              <Pencil className="size-3.5 me-1.5" /> {t("admin.content.rename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete R2 key confirmation — replaces the old `confirm()` prompt.
          Native-styled AlertDialog: dismissible, focus-trapped, keyboard-
          accessible (Esc to cancel, Enter to confirm). */}
      <AlertDialog open={deleteR2Open} onOpenChange={setDeleteR2Open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.content.deleteR2Title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.content.confirmDeleteR2", { key: deleteR2Node?.r2Key ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => { setDeleteR2Open(false); setDeleteR2Node(null); }}
            >
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteR2Key}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              <Trash2 className="size-3.5 me-1.5" />
              {t("admin.content.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Tree pane with context menu wrapper ────────────────────────────────────
//
// Wraps ContentTreePane in a ContextMenu so right-clicking on any node opens
// the relevant actions:
//   - managed leaf: Open editor, Delete (managed), Download
//   - loose R2 leaf: Open editor (raw mode), Promote to managed, Rename,
//     Duplicate, Delete, Download
//   - folder (R2): New file here, New folder here
//   - local leaf/folder: Refresh only (read-only)

interface ContentTreePaneWithContextMenuProps {
  tree: ContentTreeNode[];
  selectedId: string | null;
  onSelect: (node: ContentTreeNode) => void;
  onRefresh?: () => void;
  kind: "local" | "unified";
  loading?: boolean;
  tab: Tab;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (node: ContentTreeNode) => void;
  onDelete: (node: ContentTreeNode) => void;
  onDuplicate: (node: ContentTreeNode) => void;
  onPromote: (node: ContentTreeNode) => void;
  canManage: boolean;
  adopting: boolean;
}

function ContentTreePaneWithContextMenu(props: ContentTreePaneWithContextMenuProps) {
  const { t } = useI18n();
  const [contextNode, setContextNode] = React.useState<ContentTreeNode | null>(null);

  function handleContextMenu(e: React.MouseEvent) {
    const row = (e.target as HTMLElement).closest("[data-node-id]") as HTMLElement | null;
    if (!row) return;
    const id = row.dataset.nodeId;
    if (!id) return;
    const node = findNodeById(props.tree, id);
    if (node) setContextNode(node);
  }

  const isManagedLeaf = props.tab === "unified" && contextNode?.kind === "file" && contextNode.managed;
  const isLooseLeaf = props.tab === "unified" && contextNode?.kind === "file" && !!contextNode.r2Key && !contextNode.managed;

  return (
    <div className="h-full" onContextMenu={handleContextMenu}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="h-full">
            <ContentTreePane
              tree={props.tree}
              selectedId={props.selectedId}
              onSelect={props.onSelect}
              onRefresh={props.onRefresh}
              kind={props.kind}
              loading={props.loading}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {/* Managed leaf */}
          {isManagedLeaf && contextNode?.cloudObject && (
            <>
              <ContextMenuItem onClick={() => props.onSelect(contextNode)}>
                <Eye className="size-3.5 me-2" /> {t("admin.content.context.open")}
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  const r2k = contextNode.r2Key;
                  if (r2k) downloadR2Key(r2k, contextNode.name);
                }}
              >
                <Download className="size-3.5 me-2" /> {t("admin.content.context.download")}
              </ContextMenuItem>
              {props.canManage && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => props.onDelete(contextNode)}>
                    <Trash2 className="size-3.5 me-2 text-destructive" /> {t("admin.content.delete")}
                  </ContextMenuItem>
                </>
              )}
            </>
          )}

          {/* Loose R2 leaf — the file lives only in content-files/ with no
              D1 metadata. Promote it to a managed object to get the full
              draft/review/publish workflow. */}
          {isLooseLeaf && (
            <>
              <ContextMenuItem onClick={() => props.onSelect(contextNode)}>
                <Eye className="size-3.5 me-2" /> {t("admin.content.context.editRaw")}
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  if (contextNode.r2Key) downloadR2Key(contextNode.r2Key, contextNode.name);
                }}
              >
                <Download className="size-3.5 me-2" /> {t("admin.content.context.download")}
              </ContextMenuItem>
              {props.canManage && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => props.onPromote(contextNode)} disabled={props.adopting}>
                    {props.adopting ? <Loader2 className="size-3.5 me-2 animate-spin" /> : <PackagePlus className="size-3.5 me-2" />}
                    {t("admin.content.context.promote")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => props.onRename(contextNode)}>
                    <Pencil className="size-3.5 me-2" /> {t("admin.content.context.renameMove")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => props.onDuplicate(contextNode)}>
                    <Copy className="size-3.5 me-2" /> {t("admin.content.context.duplicate")}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => props.onDelete(contextNode)}>
                    <Trash2 className="size-3.5 me-2 text-destructive" /> {t("admin.content.delete")}
                  </ContextMenuItem>
                </>
              )}
            </>
          )}

          {/* Folder in R2 keyspace */}
          {props.tab === "unified" && props.canManage && contextNode?.kind === "folder" && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => props.onNewFile(folderOf(contextNode))}>
                <FilePlus className="size-3.5 me-2" /> {t("admin.content.context.newFileHere")}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => props.onNewFolder(folderOf(contextNode))}>
                <FolderPlus className="size-3.5 me-2" /> {t("admin.content.context.newFolderHere")}
              </ContextMenuItem>
            </>
          )}

          {/* Always-on actions */}
          {props.tab === "unified" && props.canManage && (
            <ContextMenuSeparator />
          )}
          <ContextMenuItem onClick={() => props.onRefresh?.()}>
            <RefreshCw className="size-3.5 me-2" /> {t("admin.content.context.refresh")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function folderOf(node: ContentTreeNode | null): string {
  if (!node) return "";
  if (node.kind === "folder") {
    const k = node.r2Key ?? "";
    return k.replace(/^content-files\//, "").replace(/\/$/, "");
  }
  const k = node.r2Key ?? "";
  const stripped = k.replace(/^content-files\//, "");
  const idx = stripped.lastIndexOf("/");
  return idx >= 0 ? stripped.slice(0, idx) : "";
}

function findNodeById(nodes: ContentTreeNode[], id: string): ContentTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.items) {
      const found = findNodeById(n.items, id);
      if (found) return found;
    }
  }
  return null;
}

async function downloadR2Key(key: string, name: string) {
  try {
    const url = `/api/r2-fetch?key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  } catch (err) {
    console.error("Download failed:", err);
  }
}

// ── Tab button ─────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  desc?: string;
}) {
  return (
    <button
      onClick={() => { haptic("selection"); onClick(); }}
      title={desc}
      className={cn(
        "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

// ── Preview pane ───────────────────────────────────────────────────────────

function PreviewPane({ node, tab }: { node: ContentTreeNode; tab: Tab }) {
  const { t } = useI18n();
  const [previewBody, setPreviewBody] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  // For local files, fetch the content for preview.
  React.useEffect(() => {
    setPreviewBody(null);
    if (tab !== "local" || !node.sourcePath || node.kind !== "file") return;
    setPreviewLoading(true);
    fetch(node.sourcePath)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then((text) => setPreviewBody(text.slice(0, 5000)))
      .catch(() => setPreviewBody(null))
      .finally(() => setPreviewLoading(false));
  }, [node, tab]);

  if (node.kind === "folder") {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-base font-semibold">{node.name}</h3>
          <span className="text-xs text-muted-foreground">
            {t("admin.content.tree.items", { n: String(node.items?.length ?? 0) })}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(node.items ?? []).map((child) => (
            <div
              key={child.id}
              className="border border-border rounded-xl p-3 text-sm bg-card/60"
            >
              <div className="flex items-center gap-2">
                <FileText className="size-3.5 text-muted-foreground" />
                <span className="font-medium truncate">{child.name}</span>
              </div>
              {child.managed && (
                <span className="mt-1 inline-block text-[10px] uppercase tracking-wider text-primary">
                  {t("admin.content.tree.managedBadge")}
                </span>
              )}
              {!child.managed && child.r2Key && (
                <span className="mt-1 inline-block text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("admin.content.tree.looseBadge")}
                </span>
              )}
              {child.cloudObject?.status && (
                <span className="mt-1 inline-block text-xs uppercase tracking-wider text-muted-foreground">
                  {child.cloudObject.status}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-3 h-full flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h3 className="text-base font-semibold truncate">{node.name}</h3>
          <p className="text-xs text-muted-foreground font-mono truncate">
            {node.sourcePath ?? node.r2Key ?? node.id}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {node.managed && (
            <span className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium bg-primary/10 text-primary border-primary/30">
              {t("admin.content.tree.managedBadge")}
            </span>
          )}
          {!node.managed && node.r2Key && (
            <span className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground border-border">
              {t("admin.content.tree.looseBadge")}
            </span>
          )}
          {node.cloudObject?.status && (
            <span
              className={cn(
                "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                STATUS_COLOR[node.cloudObject.status] ?? "",
              )}
            >
              {t(`admin.content.status.${node.cloudObject.status}` as any)}
            </span>
          )}
        </div>
      </div>

      {node.cloudObject && (
        <dl className="grid grid-cols-2 gap-2 text-xs shrink-0">
          <MetaRow label={t("admin.content.col.type")} value={node.cloudObject.content_type} />
          <MetaRow label={t("admin.content.col.author")} value={node.cloudObject.creator_username ? `@${node.cloudObject.creator_username}` : "—"} />
          <MetaRow label={t("admin.content.language")} value={node.cloudObject.language} />
          <MetaRow label={t("admin.content.col.updated")} value={new Date(node.cloudObject.updated_at).toLocaleString()} />
        </dl>
      )}

      {tab === "local" && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="text-xs text-muted-foreground mb-1.5 shrink-0">
            {t("admin.content.readOnlyPreview")}
          </div>
          <div className="flex-1 min-h-0 overflow-auto medos-scroll-y border border-border rounded-xl bg-card p-3">
            {previewLoading ? (
              <div className="text-xs text-muted-foreground text-center py-6">
                {t("admin.content.previewLoading")}
              </div>
            ) : previewBody == null ? (
              <div className="text-xs text-muted-foreground text-center py-6">
                {t("admin.content.previewUnavailable")}
              </div>
            ) : (
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-foreground/90">
                {previewBody}
                {previewBody.length >= 5000 && `\n\n… (${t("admin.content.truncated")})`}
              </pre>
            )}
          </div>
        </div>
      )}

      {tab === "unified" && node.managed && (
        <p className="text-xs text-muted-foreground shrink-0">
          {t("admin.content.clickToEdit")}
        </p>
      )}

      {tab === "unified" && !node.managed && node.r2Key && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="text-xs text-muted-foreground mb-1.5 shrink-0">
            {t("admin.content.previewR2Hint")}
          </div>
          <R2Preview node={node} />
          <div className="mt-2 shrink-0 text-xs text-muted-foreground/80">
            {t("admin.content.looseHint")}
          </div>
        </div>
      )}
    </div>
  );
}

function R2Preview({ node }: { node: ContentTreeNode }) {
  const { t } = useI18n();
  const [body, setBody] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    if (!node.r2Key) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/r2-fetch?key=${encodeURIComponent(node.r2Key)}`)
      .then((r) => r.ok ? r.text() : Promise.reject(new Error(`${r.status}`)))
      .then((text) => setBody(text.slice(0, 8000)))
      .catch(() => setBody(null))
      .finally(() => setLoading(false));
  }, [node.r2Key]);
  return (
    <div className="flex-1 min-h-0 overflow-auto medos-scroll-y border border-border rounded-xl bg-card p-3">
      {loading ? (
        <div className="text-xs text-muted-foreground text-center py-6">{t("common.loading")}</div>
      ) : body == null ? (
        <div className="text-xs text-muted-foreground text-center py-6">{t("admin.content.previewUnavailableR2")}</div>
      ) : (
        <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-foreground/90">
          {body}
          {body.length >= 8000 && `\n\n… (${t("admin.content.truncated")})`}
        </pre>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-xl px-2.5 py-1.5 bg-muted/30">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-xs font-medium truncate">{value}</dd>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  pending: "bg-warning/15 text-warning border-warning/30",
  published: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
};

// ── Create dialog ──────────────────────────────────────────────────────────

function CreateContentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [contentType, setContentType] = React.useState<ContentType>("library");
  const [title, setTitle] = React.useState("");
  const [language, setLanguage] = React.useState("en");
  const [busy, setBusy] = React.useState(false);

  async function create() {
    if (!title.trim()) return;
    haptic("light");
    setBusy(true);
    try {
      const res = await adminApi.createContent({
        contentType,
        title: title.trim(),
        language,
      });
      toast({ title: t("admin.content.saved") });
      onCreated(res.id);
    } catch {
      toast({ title: t("admin.toast.failedCreateContent"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("admin.content.newTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("admin.content.titleField")}
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              id="new-content-title"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("admin.content.type")}
            </label>
            <Select value={contentType} onValueChange={(v) => setContentType(v as ContentType)}>
              <SelectTrigger id="new-content-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_TYPES.map((ct) => (
                  <SelectItem key={ct} value={ct}>
                    {ct}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("admin.content.language")}
            </label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="new-content-lang">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={create} disabled={busy || !title.trim()}>
            {busy ? t("common.loading") : t("admin.content.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Upload dialog (drag-and-drop) ──────────────────────────────────────────

function UploadDialog({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (id: string) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [dropped, setDropped] = React.useState<DroppedFile[]>([]);
  const [uploading, setUploading] = React.useState(false);

  React.useEffect(() => {
    if (!open) setDropped([]);
  }, [open]);

  async function handleUpload() {
    if (dropped.length === 0) return;
    setUploading(true);
    let success = 0;
    let firstId: string | null = null;
    for (const d of dropped) {
      try {
        const id = await uploadDroppedFile(d);
        success += 1;
        if (!firstId) firstId = id;
      } catch (err) {
        toast({
          title: t("admin.content.browser.uploadFailed", { name: d.file.name }),
          description: String(err),
          variant: "destructive",
        });
      }
    }
    setUploading(false);
    if (success > 0) {
      toast({ title: t("admin.content.dropzone.uploaded", { n: success }) });
      if (firstId) onUploaded(firstId);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("admin.content.dropzone.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <ContentDropzone
            onFiles={(files) => setDropped((prev) => [...prev, ...files])}
          />
          {dropped.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("admin.content.queuedFiles", { n: dropped.length })}
              </p>
              <div className="max-h-44 overflow-y-auto medos-scroll-y space-y-1">
                {dropped.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2.5 py-1.5 border border-border rounded-md bg-card/60 text-xs"
                  >
                    <FileText className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate font-mono">{d.file.name}</span>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      {d.contentType}
                    </span>
                    <button
                      onClick={() => setDropped((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={t("common.remove")}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("admin.content.dropzone.hint")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={uploading}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleUpload} disabled={uploading || dropped.length === 0}>
            {uploading ? (
              <>
                <Loader2 className="size-3.5 me-1.5 animate-spin" />
                {t("admin.content.dropzone.uploading", { n: dropped.length })}
              </>
            ) : (
              <>
                <Upload className="size-3.5 me-1.5" />
                {t("admin.content.browser.upload")}{dropped.length > 0 ? ` (${dropped.length})` : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Local manifest → ContentTreeNode ───────────────────────────────────────

function manifestToTree(
  manifest: { items?: any[] },
  categoryFolder: string,
  contentType: ContentType,
): ContentTreeNode[] {
  if (!Array.isArray(manifest.items)) return [];
  return manifest.items.map((item) => mapNode(item, categoryFolder, contentType));
}

function mapNode(
  item: any,
  categoryFolder: string,
  contentType: ContentType,
): ContentTreeNode {
  const path: string = item.path ?? "";
  const isLeaf = !item.items || item.items.length === 0;
  if (isLeaf) {
    const files: ContentTreeNode[] = (item.files ?? []).map((f: string) => ({
      id: `local-${categoryFolder}-${path}${f}`,
      name: f,
      kind: "file" as const,
      ext: f.split(".").pop() ?? "",
      sourcePath: `/osler-content/${categoryFolder}/${path}${f}`,
    }));
    return {
      id: `local-${categoryFolder}-${path}`,
      name: item.title ?? path,
      kind: files.length > 0 ? "folder" : "file",
      ext: files.length === 0 ? "md" : undefined,
      sourcePath: files.length === 0 ? `/osler-content/${categoryFolder}/${path}` : undefined,
      items: files,
    };
  }
  return {
    id: `local-${categoryFolder}-${path}`,
    name: item.title ?? path,
    kind: "folder",
    items: (item.items ?? []).map((c: any) => mapNode(c, categoryFolder, contentType)),
  };
}

// ── Unified tree builder ──────────────────────────────────────────────────
//
// Walks the R2 keys under content-files/<category>/ and produces a folder
// tree. Each file leaf is then matched against the managed objects list —
// if the file's basename matches "<objectId>.<ext>" and an object with that
// id exists in `managed`, we attach the object to the leaf and mark it
// managed=true. Managed objects that have no R2 counterpart (e.g. drafts
// that have never been published) are appended under a synthetic
// "Drafts (managed only)" folder per category, so admins can still find
// and edit them.

function buildUnifiedTree(
  categoryFolder: string,
  contentType: ContentType,
  r2Items: Array<{ key: string; size: number; uploaded: string | null }>,
  managed: ContentObject[],
  statusFilter: string,
): ContentTreeNode[] {
  // Map every managed object's expected R2 file basename → object.
  // Mirrors hybridPublish(): for content_type "library" the file is
  // `<objectId>.md`, otherwise `<objectId>.json`.
  const managedByBasename = new Map<string, ContentObject>();
  for (const obj of managed) {
    const tail = (obj.r2_key_base || "").split("/").pop();
    if (!tail) continue;
    const expected = obj.content_type === "library" ? `${tail}.md` : `${tail}.json`;
    managedByBasename.set(expected, obj);
  }

  const roots: ContentTreeNode[] = [];
  const folderMap = new Map<string, ContentTreeNode>();
  const consumedObjectIds = new Set<string>();

  for (const item of r2Items) {
    const rel = item.key.replace(/^content-files\//, "");
    const parts = rel.split("/");
    const fileName = parts.pop() ?? "";
    if (fileName === ".keep") continue;
    const folderPath = parts.join("/");

    // Build ancestor folders
    let parent: ContentTreeNode | null = null;
    let cur = "";
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      cur = cur ? `${cur}/${seg}` : seg;
      if (!folderMap.has(cur)) {
        const folder: ContentTreeNode = {
          id: `r2-folder-${cur}`,
          name: seg,
          kind: "folder",
          r2Key: `content-files/${cur}`,
          items: [],
        };
        folderMap.set(cur, folder);
        if (parent) parent.items!.push(folder);
        else roots.push(folder);
      }
      parent = folderMap.get(cur) ?? null;
    }

    // Match the file against a managed object
    const matched = managedByBasename.get(fileName);
    const passesFilter = !matched || statusFilter === "all" || matched.status === statusFilter;
    if (matched && !passesFilter) continue; // hide managed leaves that don't match the status filter

    const fileNode: ContentTreeNode = {
      id: `r2-file-${rel}`,
      name: fileName,
      kind: "file",
      ext: fileName.split(".").pop() ?? "",
      size: item.size,
      r2Key: item.key,
      sourcePath: item.key,
      managed: !!matched,
      cloudObject: matched,
    };
    if (matched) consumedObjectIds.add(matched.id);

    if (parent) parent.items!.push(fileNode);
    else roots.push(fileNode);
  }

  // Append any managed objects that had no R2 counterpart under a synthetic
  // "Drafts (managed only)" folder so admins can still find them. These are
  // typically freshly-created drafts that have never been published via
  // hybridPublish().
  const orphanManaged = managed.filter((o) => !consumedObjectIds.has(o.id));
  const visibleOrphans = orphanManaged.filter((o) => statusFilter === "all" || o.status === statusFilter);
  if (visibleOrphans.length > 0) {
    const draftsFolder: ContentTreeNode = {
      id: `r2-folder-${categoryFolder}-__drafts__`,
      name: categoryFolder + " · drafts (managed only)",
      kind: "folder",
      r2Key: `content-files/${categoryFolder}`,
      items: visibleOrphans
        .slice()
        .sort((a, b) => b.updated_at - a.updated_at)
        .map((obj) => ({
          id: `cloud-${obj.id}`,
          name: obj.title ?? t_en_untitled(),
          kind: "file" as const,
          ext: obj.content_type === "library" ? "md" : "json",
          size: obj.body?.length,
          sourcePath: obj.id,
          cloudObject: obj,
          managed: true,
        })),
    };
    roots.push(draftsFolder);
  }

  // Sort: folders first, then files; alphabetically within each group.
  // The "drafts (managed only)" folder is kept last regardless.
  function sortTree(nodes: ContentTreeNode[]): ContentTreeNode[] {
    nodes.sort((a, b) => {
      const aIsDrafts = a.id.endsWith("__drafts__") ? 1 : 0;
      const bIsDrafts = b.id.endsWith("__drafts__") ? 1 : 0;
      if (aIsDrafts !== bIsDrafts) return aIsDrafts - bIsDrafts;
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.items) n.items = sortTree(n.items);
    return nodes;
  }
  return sortTree(roots);
}

// Avoid pulling the i18n hook into the buildUnifiedTree helper (which runs
// inside useMemo). The default English fallback is acceptable here.
function t_en_untitled(): string { return "Untitled"; }
