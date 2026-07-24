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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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

type Tab = "local" | "cloud";

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

  const [selectedNode, setSelectedNode] = React.useState<ContentTreeNode | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);

  // ── Load cloud content
  const loadCloud = React.useCallback(() => {
    setCloudLoading(true);
    adminApi
      .listContent(cloudStatus)
      .then((r) => {
        setCloudItems(r.items);
        setR2Missing(false);
      })
      .catch((err) => {
        if (err?.status === 503) setR2Missing(true);
        else toast({ title: "Failed to load content", variant: "destructive" });
      })
      .finally(() => setCloudLoading(false));
  }, [cloudStatus, toast]);

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
          const res = await fetch(`/osler-content/${cat.folder}/manifest.json`, {
            cache: "no-store",
          });
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
          name: item.title ?? "Untitled",
          kind: "file" as const,
          ext: "json",
          size: item.body?.length,
          sourcePath: item.id,
          cloudObject: item,
        })),
    }));
  }, [cloudItems]);

  const tree = tab === "cloud" ? cloudTree : localTree;

  function handleSelect(node: ContentTreeNode) {
    haptic("selection");
    setSelectedNode(node);
    if (tab === "cloud" && node.cloudObject) {
      router.push(`/admin/content/${node.cloudObject.id}`);
    }
    // For local files, just show the preview pane (no navigation).
    // The preview pane shows the file path, type, and a "Use Upload to make
    // an editable cloud copy" hint.
  }

  // ── Render: R2 missing
  if (tab === "cloud" && r2Missing) {
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
            label={t("admin.content.tree.cloud")}
            desc={t("admin.content.tree.cloudDesc")}
          />
          <TabButton
            active={tab === "local"}
            onClick={() => setTab("local")}
            icon={HardDrive}
            label={t("admin.content.tree.local")}
            desc={t("admin.content.tree.localDesc")}
          />
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUploadOpen(true)}
          >
            <Upload className="mr-1.5 size-3.5" />
            Upload
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 size-3.5" />
            {t("admin.content.new")}
          </Button>
        </div>
      </div>

      {/* Two-pane tree + preview layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 h-[calc(100vh-220px)] min-h-[420px]">
        {/* Tree pane */}
        <div className="border border-border/60 rounded-xl overflow-hidden lg:min-h-0">
          {tab === "cloud" && cloudLoading ? (
            <LoadingState label={t("common.loading")} className="h-full" />
          ) : tab === "local" && localLoading ? (
            <LoadingState label={t("common.loading")} className="h-full" />
          ) : (
            <ContentTreePane
              tree={tree}
              selectedId={selectedNode?.id ?? null}
              onSelect={handleSelect}
              onRefresh={tab === "cloud" ? loadCloud : loadLocal}
              kind={tab}
              loading={tab === "cloud" ? cloudLoading : localLoading}
            />
          )}
        </div>

        {/* Preview pane */}
        <div className="border border-border/60 rounded-xl overflow-hidden bg-background">
          {!selectedNode ? (
            <EmptyState
              icon={FileText}
              title={t("admin.content.empty")}
              description={
                tab === "cloud"
                  ? t("admin.content.tree.cloudDesc")
                  : t("admin.content.tree.localDesc")
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
    </div>
  );
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
      onClick={() => {
        haptic("selection");
        onClick();
      }}
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
      .then((text) => setPreviewBody(text.slice(0, 5000))) // cap preview
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
              className="border border-border/60 rounded-lg p-3 text-sm bg-card/40"
            >
              <div className="flex items-center gap-2">
                <FileText className="size-3.5 text-muted-foreground" />
                <span className="font-medium truncate">{child.name}</span>
              </div>
              {child.cloudObject?.status && (
                <span className="mt-1 inline-block text-[10px] uppercase tracking-wider text-muted-foreground">
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
            {node.sourcePath ?? node.id}
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
          <MetaRow label="Language" value={node.cloudObject.language} />
          <MetaRow label={t("admin.content.col.updated")} value={new Date(node.cloudObject.updated_at).toLocaleString()} />
        </dl>
      )}

      {tab === "local" && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="text-xs text-muted-foreground mb-1.5 shrink-0">
            Read-only preview. Use Upload to create an editable cloud copy.
          </div>
          <div className="flex-1 min-h-0 overflow-auto medos-scroll-y border border-border/60 rounded-lg bg-background p-3">
            {previewLoading ? (
              <div className="text-xs text-muted-foreground text-center py-6">
                Loading preview…
              </div>
            ) : previewBody == null ? (
              <div className="text-xs text-muted-foreground text-center py-6">
                Preview unavailable.
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
          Click to open in the full editor.
        </p>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/60 rounded-lg px-2.5 py-1.5 bg-muted/30">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
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
      toast({ title: "Failed to create content", variant: "destructive" });
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
                Queued files ({dropped.length})
              </p>
              <div className="max-h-44 overflow-y-auto medos-scroll-y space-y-1">
                {dropped.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2.5 py-1.5 border border-border/60 rounded-md bg-card/40 text-xs"
                  >
                    <FileText className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate font-mono">{d.file.name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
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
  // `item.path` is the FULL path from the category root (with trailing /),
  // e.g. "cardiology/heart-failure/" for the Heart Failure folder inside Library.
  const path: string = item.path ?? "";
  const isLeaf = !item.items || item.items.length === 0;
  if (isLeaf) {
    // Leaf — show the actual files as children of this node.
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
