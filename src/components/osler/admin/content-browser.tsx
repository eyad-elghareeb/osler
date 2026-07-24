"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Plus,
  FileText,
  AlertCircle,
  Cloud,
  HardDrive,
  Upload,
  Loader2,
  Database,
  RefreshCw,
  FolderPlus,
  FilePlus,
  Pencil,
  Trash2,
  Download,
  Eye,
  Sparkles,
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
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

// Categories that have local manifests under /osler-content/<folder>/manifest.json
const LOCAL_CATEGORIES: { folder: string; label: string; contentType: ContentType }[] = [
  { folder: "library", label: "Library", contentType: "library" },
  { folder: "qbank", label: "QBank", contentType: "quiz" },
  { folder: "flashcard", label: "Flashcards", contentType: "flashcard" },
  { folder: "osce", label: "OSCE", contentType: "osce" },
  { folder: "videos", label: "Videos", contentType: "video" },
];

interface ContentBrowserProps {
  capabilities: AdminCapabilities;
}

type Tab = "local" | "cloud" | "r2";

export function ContentBrowser({ capabilities }: ContentBrowserProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();

  const [tab, setTab] = React.useState<Tab>("cloud");
  const [cloudItems, setCloudItems] = React.useState<ContentObject[]>([]);
  const [cloudLoading, setCloudLoading] = React.useState(true);
  const [cloudStatus, setCloudStatus] = React.useState<string>("published");
  const [r2Missing, setR2Missing] = React.useState(false);

  const [localTree, setLocalTree] = React.useState<ContentTreeNode[]>([]);
  const [localLoading, setLocalLoading] = React.useState(true);

  const [r2Tree, setR2Tree] = React.useState<ContentTreeNode[]>([]);
  const [r2Loading, setR2Loading] = React.useState(false);

  const [selectedNode, setSelectedNode] = React.useState<ContentTreeNode | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [newFileOpen, setNewFileOpen] = React.useState(false);
  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [regenerating, setRegenerating] = React.useState(false);

  // For the new-file/new-folder/rename dialogs
  const [dialogPath, setDialogPath] = React.useState("");
  const [dialogParent, setDialogParent] = React.useState<string>("");

  // ── Load cloud content
  const loadCloud = React.useCallback(() => {
    setCloudLoading(true);
    adminApi
      .listContent(cloudStatus)
      .then((r) => { setCloudItems(r.items); setR2Missing(false); })
      .catch((err: any) => {
        if (err?.status === 503) setR2Missing(true);
        else toast({ title: t("admin.toast.failedLoadContent"), variant: "destructive" });
      })
      .finally(() => setCloudLoading(false));
  }, [cloudStatus, toast, t]);

  React.useEffect(() => {
    if (tab === "cloud") loadCloud();
  }, [tab, loadCloud]);

  // ── Load local content tree
  const loadLocal = React.useCallback(async () => {
    setLocalLoading(true);
    try {
      const allTrees: ContentTreeNode[] = [];
      for (const cat of LOCAL_CATEGORIES) {
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
  }, []);

  React.useEffect(() => {
    if (tab === "local") loadLocal();
  }, [tab, loadLocal]);

  // ── Load R2 raw keys
  const loadR2 = React.useCallback(async () => {
    if (!capabilities.manageUsers) return;
    setR2Loading(true);
    try {
      const allTrees: ContentTreeNode[] = [];
      for (const cat of LOCAL_CATEGORIES) {
        try {
          const res = await adminApi.listR2Keys(cat.folder);
          const tree = r2KeysToTree(res.items, cat.folder, cat.contentType);
          allTrees.push({
            id: `r2-root-${cat.folder}`,
            name: cat.label,
            kind: "folder",
            items: tree,
            r2Prefix: `content-files/${cat.folder}/`,
          });
        } catch (err: any) {
          if (err?.status === 503) { setR2Missing(true); break; }
        }
      }
      setR2Tree(allTrees);
    } finally {
      setR2Loading(false);
    }
  }, [capabilities.manageUsers]);

  React.useEffect(() => {
    if (tab === "r2") loadR2();
  }, [tab, loadR2]);

  // Build the cloud tree (group by content_type)
  const cloudTree = React.useMemo<ContentTreeNode[]>(() => {
    const groups = new Map<string, ContentObject[]>();
    for (const item of cloudItems) {
      const key = item.content_type;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return Array.from(groups.entries()).map(([type, items]) => ({
      id: `cloud-root-${type}`,
      name: type,
      kind: "folder" as const,
      items: items
        .slice()
        .sort((a, b) => (b.updated_at - a.updated_at))
        .map((item) => ({
          id: `cloud-${item.id}`,
          name: item.title ?? t("admin.content.untitled"),
          kind: "file" as const,
          ext: "json",
          size: item.body?.length,
          sourcePath: item.id,
          cloudObject: item,
        })),
    }));
  }, [cloudItems, t]);

  const tree = tab === "cloud" ? cloudTree : tab === "local" ? localTree : r2Tree;

  function handleSelect(node: ContentTreeNode) {
    haptic("selection");
    setSelectedNode(node);
    if (tab === "cloud" && node.cloudObject) {
      router.push(`/admin/content/${node.cloudObject.id}`);
    }
  }

  // ── Context menu actions ────────────────────────────────────────────────
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
    const body = isJson ? "{}" : "";
    try {
      await adminApi.uploadFile(key, body);
      toast({ title: `Created ${dialogPath}` });
      setNewFileOpen(false);
      loadR2();
    } catch (err) {
      toast({ title: `Create failed: ${String(err)}`, variant: "destructive" });
    }
  }

  async function createNewR2Folder() {
    if (!capabilities.manageUsers) return;
    const path = `content-files/${dialogPath.replace(/^\/+/, "")}`;
    try {
      await adminApi.createR2Folder(path);
      toast({ title: `Created folder ${dialogPath}` });
      setNewFolderOpen(false);
      loadR2();
    } catch (err) {
      toast({ title: `Create folder failed: ${String(err)}`, variant: "destructive" });
    }
  }

  async function renameR2Key() {
    if (!capabilities.manageUsers) return;
    try {
      await adminApi.renameR2Key(dialogParent, `content-files/${dialogPath.replace(/^\/+/, "")}`);
      toast({ title: `Renamed to ${dialogPath}` });
      setRenameOpen(false);
      loadR2();
    } catch (err) {
      toast({ title: `Rename failed: ${String(err)}`, variant: "destructive" });
    }
  }

  async function deleteR2Key(node: ContentTreeNode) {
    if (!capabilities.manageUsers) return;
    if (!node.r2Key) return;
    if (!confirm(`Delete ${node.r2Key}? This cannot be undone.`)) return;
    try {
      await adminApi.deleteR2Key(node.r2Key);
      toast({ title: `Deleted ${node.name}` });
      loadR2();
    } catch (err) {
      toast({ title: `Delete failed: ${String(err)}`, variant: "destructive" });
    }
  }

  async function regenerateAllManifests() {
    if (!capabilities.manageUsers) return;
    setRegenerating(true);
    try {
      const res = await adminApi.regenerateManifest("all");
      const failed = Object.entries(res.results).filter(([, v]) => !v.startsWith("ok") && v !== "empty");
      if (failed.length === 0) {
        toast({ title: "Manifests regenerated", description: Object.entries(res.results).map(([k, v]) => `${k}: ${v}`).join(", ") });
      } else {
        toast({ title: `Regenerated with ${failed.length} errors`, variant: "destructive" });
      }
      if (tab === "local") loadLocal();
    } catch (err) {
      toast({ title: `Regenerate failed: ${String(err)}`, variant: "destructive" });
    } finally {
      setRegenerating(false);
    }
  }

  // ── Render: R2 missing
  if ((tab === "cloud" || tab === "r2") && r2Missing) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="mb-3 size-12 text-warning" />
        <h2 className="mb-1 text-base font-semibold">{t("admin.content.noR2")}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{t("admin.content.noR2Desc")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab switcher + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 border-b border-border flex-1 min-w-[260px]">
          <TabButton
            active={tab === "cloud"}
            onClick={() => setTab("cloud")}
            icon={Cloud}
            label="Cloud Objects"
            desc="Draft/pending/published content objects (D1 + R2)"
          />
          <TabButton
            active={tab === "local"}
            onClick={() => setTab("local")}
            icon={HardDrive}
            label="Local Files"
            desc="Files in public/osler-content/ (read-only preview)"
          />
          {capabilities.manageUsers && (
            <TabButton
              active={tab === "r2"}
              onClick={() => setTab("r2")}
              icon={Database}
              label="R2 Browser"
              desc="Raw student-facing R2 content (admin only)"
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          {tab === "cloud" && (
            <Select value={cloudStatus} onValueChange={setCloudStatus}>
              <SelectTrigger className="w-32 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="draft">Drafts</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          )}
          {tab === "r2" && capabilities.manageUsers && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openNewFolderDialog("")}
              >
                <FolderPlus className="mr-1.5 size-3.5" />
                New Folder
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openNewFileDialog("")}
              >
                <FilePlus className="mr-1.5 size-3.5" />
                New File
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={regenerateAllManifests}
                disabled={regenerating}
                title="Rebuild manifest.json for every category"
              >
                {regenerating ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Sparkles className="mr-1.5 size-3.5" />}
                Regenerate Manifests
              </Button>
            </>
          )}
          {tab === "cloud" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="mr-1.5 size-3.5" />
              Upload
            </Button>
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 size-3.5" />
            {t("admin.content.new")}
          </Button>
        </div>
      </div>

      {/* Two-pane tree + preview layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 h-[calc(100vh-220px)] min-h-[420px]">
        {/* Tree pane — wrapped in a context menu for right-click actions */}
        <div className="border border-border rounded-xl overflow-hidden lg:min-h-0">
          {tab === "cloud" && cloudLoading ? (
            <LoadingState label={t("common.loading")} className="h-full" />
          ) : tab === "local" && localLoading ? (
            <LoadingState label={t("common.loading")} className="h-full" />
          ) : tab === "r2" && r2Loading ? (
            <LoadingState label={t("common.loading")} className="h-full" />
          ) : (
            <ContentTreePaneWithContextMenu
              tree={tree}
              selectedId={selectedNode?.id ?? null}
              onSelect={handleSelect}
              onRefresh={tab === "cloud" ? loadCloud : tab === "local" ? loadLocal : loadR2}
              kind={tab === "cloud" ? "cloud" : "local"}
              loading={tab === "cloud" ? cloudLoading : tab === "local" ? localLoading : r2Loading}
              tab={tab}
              onNewFile={openNewFileDialog}
              onNewFolder={openNewFolderDialog}
              onRename={openRenameDialog}
              onDelete={deleteR2Key}
              canManage={capabilities.manageUsers}
            />
          )}
        </div>

        {/* Preview pane */}
        <div className="border border-border rounded-xl overflow-hidden bg-background">
          {!selectedNode ? (
            <EmptyState
              icon={FileText}
              title={t("admin.content.empty")}
              description={
                tab === "cloud"
                  ? "Browse and edit content objects (drafts, pending, published)."
                  : tab === "local"
                    ? "Read-only preview of local files under public/osler-content/."
                    : "Raw student-facing R2 files. Right-click to manage."
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
          loadCloud();
          router.push(`/admin/content/${id}`);
        }}
      />

      {/* New file dialog (R2 tab) */}
      <Dialog open={newFileOpen} onOpenChange={setNewFileOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New file</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground">
              Path under <code>content-files/</code>. Use a <code>.json</code> or <code>.md</code> extension.
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
            <Button variant="outline" onClick={() => setNewFileOpen(false)}>Cancel</Button>
            <Button onClick={createNewR2File} disabled={!dialogPath.trim()}>
              <FilePlus className="size-3.5 mr-1.5" /> Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New folder dialog (R2 tab) */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground">
              Path under <code>content-files/</code>. A placeholder <code>.keep</code> file will be created.
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
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button onClick={createNewR2Folder} disabled={!dialogPath.trim()}>
              <FolderPlus className="size-3.5 mr-1.5" /> Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog (R2 tab) */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename / move</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground">
              New path under <code>content-files/</code>. The original file will be deleted after the copy.
            </p>
            <Input
              value={dialogPath}
              onChange={(e) => setDialogPath(e.target.value)}
              className="font-mono text-xs"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button onClick={renameR2Key} disabled={!dialogPath.trim()}>
              <Pencil className="size-3.5 mr-1.5" /> Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tree pane with context menu wrapper ────────────────────────────────────
//
// Wraps ContentTreePane in a ContextMenu so right-clicking on any node opens
// the relevant actions (new file/folder, rename, delete, download). For cloud
// nodes, only "Open" and "Delete" are available; for local nodes nothing is
// available (read-only); for R2 nodes the full CRUD is available.

interface ContentTreePaneWithContextMenuProps {
  tree: ContentTreeNode[];
  selectedId: string | null;
  onSelect: (node: ContentTreeNode) => void;
  onRefresh?: () => void;
  kind: "local" | "cloud";
  loading?: boolean;
  tab: Tab;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (node: ContentTreeNode) => void;
  onDelete: (node: ContentTreeNode) => void;
  canManage: boolean;
}

function ContentTreePaneWithContextMenu(props: ContentTreePaneWithContextMenuProps) {
  // We can't easily wrap individual rows in ContextMenu (the tree component
  // owns the row rendering), so we wrap the whole tree pane in a single
  // ContextMenu that detects which node was right-clicked via data attributes.
  const [contextNode, setContextNode] = React.useState<ContentTreeNode | null>(null);

  function handleContextMenu(e: React.MouseEvent) {
    // Find the closest tree row and look up its node by id.
    const row = (e.target as HTMLElement).closest("[data-node-id]") as HTMLElement | null;
    if (!row) return;
    const id = row.dataset.nodeId;
    if (!id) return;
    const node = findNodeById(props.tree, id);
    if (node) setContextNode(node);
  }

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
          {props.tab === "cloud" && contextNode?.cloudObject && (
            <>
              <ContextMenuItem onClick={() => props.onSelect(contextNode)}>
                <Eye className="size-3.5 mr-2" /> Open editor
              </ContextMenuItem>
              {props.canManage && (
                <ContextMenuItem onClick={() => props.onDelete(contextNode)}>
                  <Trash2 className="size-3.5 mr-2 text-destructive" /> Delete
                </ContextMenuItem>
              )}
            </>
          )}
          {props.tab === "r2" && props.canManage && contextNode && (
            <>
              <ContextMenuItem onClick={() => props.onSelect(contextNode)}>
                <Eye className="size-3.5 mr-2" /> Preview
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  if (contextNode.r2Key) downloadR2Key(contextNode.r2Key, contextNode.name);
                }}
              >
                <Download className="size-3.5 mr-2" /> Download
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => props.onRename(contextNode)}>
                <Pencil className="size-3.5 mr-2" /> Rename / move
              </ContextMenuItem>
              <ContextMenuItem onClick={() => props.onDelete(contextNode)}>
                <Trash2 className="size-3.5 mr-2 text-destructive" /> Delete
              </ContextMenuItem>
            </>
          )}
          {props.tab === "r2" && props.canManage && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => props.onNewFile(folderOf(contextNode))}>
                <FilePlus className="size-3.5 mr-2" /> New file here…
              </ContextMenuItem>
              <ContextMenuItem onClick={() => props.onNewFolder(folderOf(contextNode))}>
                <FolderPlus className="size-3.5 mr-2" /> New folder here…
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => props.onRefresh?.()}>
                <RefreshCw className="size-3.5 mr-2" /> Refresh
              </ContextMenuItem>
            </>
          )}
          {props.tab === "local" && (
            <ContextMenuItem onClick={() => props.onRefresh?.()}>
              <RefreshCw className="size-3.5 mr-2" /> Refresh
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function folderOf(node: ContentTreeNode | null): string {
  if (!node) return "";
  if (node.kind === "folder") {
    // Strip the leading "content-files/<category>/" from r2Key if present
    const k = node.r2Key ?? "";
    return k.replace(/^content-files\//, "").replace(/\/$/, "");
  }
  // File — return parent folder
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
    // Fetch from the public /v1/content/* endpoint (works without auth for
    // content-files/ keys).
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
            {node.items?.length ?? 0} items
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(node.items ?? []).map((child) => (
            <div
              key={child.id}
              className="border border-border rounded-lg p-3 text-sm bg-card/40"
            >
              <div className="flex items-center gap-2">
                <FileText className="size-3.5 text-muted-foreground" />
                <span className="font-medium truncate">{child.name}</span>
              </div>
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
        {node.cloudObject?.status && (
          <span
            className={cn(
              "shrink-0 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
              STATUS_COLOR[node.cloudObject.status] ?? "",
            )}
          >
            {t(`admin.content.status.${node.cloudObject.status}` as any)}
          </span>
        )}
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
          <div className="flex-1 min-h-0 overflow-auto medos-scroll-y border border-border rounded-lg bg-background p-3">
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
                {previewBody.length >= 5000 && "\n\n… (truncated)"}
              </pre>
            )}
          </div>
        </div>
      )}

      {tab === "cloud" && (
        <p className="text-xs text-muted-foreground shrink-0">
          {t("admin.content.clickToEdit")}
        </p>
      )}

      {tab === "r2" && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="text-xs text-muted-foreground mb-1.5 shrink-0">
            Raw R2 object. Right-click to manage (rename, delete, download).
          </div>
          <R2Preview node={node} />
        </div>
      )}
    </div>
  );
}

function R2Preview({ node }: { node: ContentTreeNode }) {
  const [body, setBody] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    if (!node.r2Key) { setLoading(false); return; }
    setLoading(true);
    // Use the public content endpoint to fetch
    const category = node.r2Key.replace(/^content-files\//, "").split("/")[0];
    const relativePath = node.r2Key.replace(/^content-files\//, "").slice(category.length + 1);
    fetch(`/api/r2-fetch?key=${encodeURIComponent(node.r2Key)}`)
      .then((r) => r.ok ? r.text() : Promise.reject(new Error(`${r.status}`)))
      .then((text) => setBody(text.slice(0, 8000)))
      .catch(() => setBody(null))
      .finally(() => setLoading(false));
  }, [node.r2Key]);
  return (
    <div className="flex-1 min-h-0 overflow-auto medos-scroll-y border border-border rounded-lg bg-background p-3">
      {loading ? (
        <div className="text-xs text-muted-foreground text-center py-6">Loading…</div>
      ) : body == null ? (
        <div className="text-xs text-muted-foreground text-center py-6">Preview unavailable (binary or missing)</div>
      ) : (
        <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-foreground/90">
          {body}
          {body.length >= 8000 && "\n\n… (truncated)"}
        </pre>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg px-2.5 py-1.5 bg-muted/30">
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
          title: `Failed to upload ${d.file.name}`,
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
                    className="flex items-center gap-2 px-2.5 py-1.5 border border-border rounded-md bg-card/40 text-xs"
                  >
                    <FileText className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate font-mono">{d.file.name}</span>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      {d.contentType}
                    </span>
                    <button
                      onClick={() => setDropped((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove"
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
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                {t("admin.content.dropzone.uploading", { n: dropped.length })}
              </>
            ) : (
              <>
                <Upload className="size-3.5 mr-1.5" />
                Upload {dropped.length > 0 ? `(${dropped.length})` : ""}
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

// ── R2 keys → ContentTreeNode ──────────────────────────────────────────────
//
// Builds a tree from a flat list of R2 keys. Each key is split on `/` to find
// its parent folder.

function r2KeysToTree(
  items: Array<{ key: string; size: number; uploaded: string | null }>,
  categoryFolder: string,
  _contentType: ContentType,
): ContentTreeNode[] {
  const roots: ContentTreeNode[] = [];
  const folderMap = new Map<string, ContentTreeNode>();

  for (const item of items) {
    const rel = item.key.replace(/^content-files\//, "");
    const parts = rel.split("/");
    const fileName = parts.pop() ?? "";
    // Skip .keep placeholder files in the tree
    if (fileName === ".keep") continue;
    const folderPath = parts.join("/");
    // Ensure all ancestor folders exist
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
    // Add the file to its parent
    const fileNode: ContentTreeNode = {
      id: `r2-file-${rel}`,
      name: fileName,
      kind: "file",
      ext: fileName.split(".").pop() ?? "",
      size: item.size,
      r2Key: item.key,
      sourcePath: item.key,
    };
    if (parent) parent.items!.push(fileNode);
    else roots.push(fileNode);
  }

  // Sort: folders first, then files; alphabetically within each group.
  function sortTree(nodes: ContentTreeNode[]): ContentTreeNode[] {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.items) n.items = sortTree(n.items);
    return nodes;
  }
  return sortTree(roots);
}
