"use client";

/**
 * Detail Panel — the right-hand pane of the Content Studio.
 *
 * Shows metadata, validation status, and quick actions for the currently
 * selected file. When multiple files are selected, shows a batch-action
 * summary instead. When nothing is selected, shows a hint to click a file.
 *
 * The panel is intentionally compact (350–400px wide) so the file explorer
 * gets the lion's share of the window. All shared primitives (NodeIcon,
 * NodeBadges, MetaRow, ValidationBadge, FileTypeIcon) come from `./ui` so
 * this file stays focused on layout + the R2 preview fetch.
 */

import * as React from "react";
import {
  Eye, Pencil, Send, CloudUpload, Copy, Download, Trash2,
  PackagePlus, Sparkles, Repeat2, Layers, FolderOpen,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import {
  adminApi,
  type ContentType,
} from "@/components/osler/admin/admin-api";
import { r2KeyToWorkerUrl, isImageR2Key, formatBytes } from "@/components/osler/admin/editors/image-upload";
import { ImageLightbox } from "@/components/osler/admin/image-lightbox";
import {
  formatRelativeTime,
  type ValidationState,
} from "./types";
import {
  NodeIcon,
  NodeBadges,
  MetaRow,
  ValidationBadge,
  FileTypeIcon,
  folderIconCls,
  folderTileCls,
  folderRowCls,
} from "./ui";
import {
  MarkdownBody,
  RenderedContentPreview,
  inferContentType,
} from "./content-preview";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DetailPanelProps {
  selectedNodes: ContentTreeNode[];
  categoryContentType: ContentType;
  validationStates: Map<string, ValidationState>;
  onOpen: (node: ContentTreeNode) => void;
  onRename: (node: ContentTreeNode) => void;
  onDelete: (node: ContentTreeNode) => void;
  onDuplicate: (node: ContentTreeNode) => void;
  onDownload: (node: ContentTreeNode) => void;
  onConvert: (node: ContentTreeNode) => void;
  onPromote: (node: ContentTreeNode) => void;
  onPublishStaged: (node: ContentTreeNode) => void;
  onDiscardStaged: (node: ContentTreeNode) => void;
  onPublish?: (node: ContentTreeNode) => void;
  onUnpublish?: (node: ContentTreeNode) => void;
  canManage: boolean;
  className?: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export function DetailPanel(props: DetailPanelProps) {
  const { t } = useI18n();
  const { selectedNodes } = props;

  if (selectedNodes.length === 0) {
    return (
      <div className={cn("flex h-full flex-col items-center justify-center gap-2 p-6 text-center", props.className)}>
        <div className="osler-empty__icon"><Eye className="size-6" /></div>
        <div>
          <p className="osler-empty__title text-sm">{t("admin.studio.noSelection")}</p>
          <p className="osler-empty__body text-xs">{t("admin.studio.noSelectionDesc")}</p>
        </div>
      </div>
    );
  }

  if (selectedNodes.length > 1) {
    return (
      <div className={cn("flex h-full flex-col gap-3 p-3.5", props.className)}>
        <BatchSummary nodes={selectedNodes} {...props} />
      </div>
    );
  }

  const node = selectedNodes[0];
  return (
    <div className={cn("flex h-full flex-col overflow-hidden", props.className)}>
      <SingleDetail key={node.id} node={node} {...props} />
    </div>
  );
}

// ── Batch summary ───────────────────────────────────────────────────────────

function BatchSummary({
  nodes, onDelete, onConvert, onPublishStaged, onDiscardStaged, canManage,
}: DetailPanelProps & { nodes: ContentTreeNode[] }) {
  const { t } = useI18n();
  const managedCount = nodes.filter((n) => n.managed).length;
  const stagedCount = nodes.filter((n) => n.staged).length;
  const folderCount = nodes.filter((n) => n.kind === "folder").length;
  const fileCount = nodes.length - folderCount;
  const hasStaged = stagedCount > 0;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
          <Layers className="size-3.5" />
        </div>
        <div>
          <p className="text-sm font-semibold">{t("admin.studio.selected", { n: String(nodes.length) })}</p>
          <p className="text-xs text-muted-foreground">
            {t("admin.studio.filesCount", { n: String(fileCount) })} · {t("admin.studio.foldersCount", { n: String(folderCount) })}
            {managedCount > 0 && ` · ${t("admin.studio.managedCount", { n: String(managedCount) })}`}
            {stagedCount > 0 && ` · ${t("admin.studio.stagedCount", { n: String(stagedCount) })}`}
          </p>
        </div>
      </div>

      {/* Selection chips — preview the first 8 names */}
      <div className="flex flex-wrap gap-1">
        {nodes.slice(0, 8).map((n) => (
          <span
            key={n.id}
            className="inline-flex max-w-[130px] items-center gap-1 rounded-lg border border-border bg-muted/40 px-1.5 py-0.5 text-xs"
          >
            {n.kind === "folder" ? (
              <FolderOpen className={cn("size-2.5 shrink-0 fill-current/15", folderRowCls)} />
            ) : (
              <NodeIcon node={n} className="size-2.5 shrink-0 text-primary" />
            )}
            <span className="truncate">{n.name}</span>
          </span>
        ))}
        {nodes.length > 8 && (
          <span className="text-xs text-muted-foreground">{t("admin.studio.moreItems", { n: String(nodes.length - 8) })}</span>
        )}
      </div>

      {/* Batch actions */}
      <div className="mt-1 flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("admin.studio.batchActions")}
        </p>
        {hasStaged && canManage && (
          <>
            <Button size="xs" variant="outline" className="justify-start" onClick={() => nodes.forEach((n) => onPublishStaged(n))}>
              <Sparkles className="me-1.5 size-3" /> {t("admin.studio.publishStaged")}
            </Button>
            <Button size="xs" variant="outline" className="justify-start text-destructive hover:text-destructive" onClick={() => nodes.forEach((n) => onDiscardStaged(n))}>
              <Trash2 className="me-1.5 size-3" /> {t("admin.studio.discardStaged")}
            </Button>
          </>
        )}
        {managedCount > 0 && (
          <Button size="xs" variant="outline" className="justify-start" onClick={() => onConvert(nodes[0])}>
            <Repeat2 className="me-1.5 size-3" /> {t("admin.studio.convert")}
          </Button>
        )}
        {canManage && (
          <Button size="xs" variant="outline" className="justify-start text-destructive hover:text-destructive" onClick={() => nodes.forEach((n) => onDelete(n))}>
            <Trash2 className="me-1.5 size-3" /> {t("admin.studio.batchDelete")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Single-node detail ──────────────────────────────────────────────────────

function SingleDetail(props: DetailPanelProps & { node: ContentTreeNode }) {
  const { t } = useI18n();
  const { node, validationStates, canManage, onOpen, onConvert } = props;

  if (node.kind === "folder") {
    return <FolderDetail node={node} canManage={canManage} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border p-3.5">
        <div className="flex items-start gap-2.5">
          <FileTypeIcon node={node} className="size-11" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold">{node.name}</h3>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {node.sourcePath ?? node.r2Key ?? node.id}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <NodeBadges node={node} />
              {validationStates.has(node.id) && (
                <ValidationBadge state={validationStates.get(node.id)!} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Metadata grid */}
      {node.cloudObject && (
        <div className="shrink-0 grid grid-cols-2 gap-1.5 border-b border-border p-3.5">
          <MetaRow label={t("admin.studio.columnType")} value={node.cloudObject.content_type} />
          <MetaRow label={t("admin.content.col.author")} value={node.cloudObject.creator_username ? `@${node.cloudObject.creator_username}` : "—"} />
          <MetaRow label={t("admin.content.language")} value={node.cloudObject.language} />
          <MetaRow label={t("admin.studio.columnUpdated")} value={formatRelativeTime(node.cloudObject.updated_at)} />
        </div>
      )}

      {/* Body preview (managed + loose/staged R2 files) */}
      {node.r2Key && (
        <div className="min-h-0 flex-1 overflow-hidden border-b border-border">
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("admin.studio.content")}
            </p>
            {node.cloudObject && (
              <p className="text-xs text-muted-foreground">{t("admin.studio.previewHint")}</p>
            )}
          </div>
          <R2Preview node={node} />
        </div>
      )}

      {/* Quick actions */}
      <div className="shrink-0 space-y-1.5 p-3.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("admin.studio.quickActions")}
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="xs" className="col-span-2" onClick={() => onOpen(node)}>
            <Eye className="me-1 size-3" /> {t("admin.studio.openEditor")}
          </Button>
          <Button size="xs" variant="outline" onClick={() => onConvert(node)}>
            <Repeat2 className="me-1 size-3" /> {t("admin.studio.convert")}
          </Button>
          {node.managed && canManage && props.onPublish && node.cloudObject?.status !== "published" && (
            <Button size="xs" variant="outline" onClick={() => props.onPublish?.(node)}>
              <Send className="me-1 size-3" /> {t("admin.studio.publish")}
            </Button>
          )}
          {node.managed && canManage && props.onUnpublish && node.cloudObject?.status === "published" && (
            <Button size="xs" variant="outline" onClick={() => props.onUnpublish?.(node)}>
              <CloudUpload className="me-1 size-3" /> {t("admin.studio.unpublish")}
            </Button>
          )}
          {canManage && (
            <Button size="xs" variant="outline" onClick={() => props.onDuplicate(node)}>
              <Copy className="me-1 size-3" /> {t("admin.studio.duplicate")}
            </Button>
          )}
          <Button size="xs" variant="outline" onClick={() => props.onDownload(node)}>
            <Download className="me-1 size-3" /> {t("admin.studio.download")}
          </Button>
          {canManage && !node.managed && (
            <Button size="xs" variant="outline" onClick={() => props.onPromote(node)}>
              <PackagePlus className="me-1 size-3" /> {t("admin.studio.promoteToManaged")}
            </Button>
          )}
          {canManage && (
            <Button size="xs" variant="outline" onClick={() => props.onRename(node)}>
              <Pencil className="me-1 size-3" /> {t("admin.studio.rename")}
            </Button>
          )}
          {canManage && (
            <Button size="xs" variant="outline" className="text-destructive hover:text-destructive" onClick={() => props.onDelete(node)}>
              <Trash2 className="me-1 size-3" /> {t("admin.studio.delete")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Folder detail ───────────────────────────────────────────────────────────

function FolderDetail({ node, canManage }: { node: ContentTreeNode; canManage: boolean }) {
  const { t } = useI18n();
  const childCount = node.items?.length ?? 0;
  const fileCount = node.items?.filter((c) => c.kind === "file").length ?? 0;
  const folderCount = childCount - fileCount;
  const stagedCount = node.items?.filter((c) => c.staged).length ?? 0;

  return (
    <div className="flex h-full flex-col gap-3 p-3.5">
      <div className="flex items-start gap-2.5">
        <div className={cn("flex size-11 items-center justify-center rounded-xl border", folderTileCls, folderIconCls)}>
          <FolderOpen className="size-5 fill-current/15" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{node.name}</h3>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {node.r2Key ?? node.id}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <MetaRow label={t("admin.studio.files")} value={String(fileCount)} />
        <MetaRow label={t("admin.studio.folders")} value={String(folderCount)} />
        {stagedCount > 0 && <MetaRow label={t("admin.studio.rowStaged")} value={String(stagedCount)} />}
      </div>

      {!canManage && (
        <p className="text-[11px] text-muted-foreground">{t("admin.content.clickToEdit")}</p>
      )}
    </div>
  );
}

// ── R2 preview ──────────────────────────────────────────────────────────────

const MAX_PREVIEW_CHARS = 500_000;

function R2Preview({ node }: { node: ContentTreeNode }) {
  const { t } = useI18n();
  const [body, setBody] = React.useState<string | null>(null);
  const [truncated, setTruncated] = React.useState(false);
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const isImage = !!node.r2Key && isImageR2Key(node.r2Key);
  const isMarkdown = !isImage && (node.r2Key?.endsWith(".md") ?? false);

  React.useEffect(() => {
    if (!node.r2Key) { setLoading(false); return; }
    setLoading(true);
    setTruncated(false);

    const fetchText = (p: Promise<string>) =>
      p.then((text) => {
        if (text.length > MAX_PREVIEW_CHARS) { setTruncated(true); return; }
        setBody(text);
      })
        .catch(() => setBody(null))
        .finally(() => setLoading(false));
    const fetchImage = (p: Promise<Blob>) =>
      p.then((blob) => setImageUrl(URL.createObjectURL(blob)))
        .catch(() => setImageUrl(null))
        .finally(() => setLoading(false));

    if (node.r2Key.startsWith("content-staging/")) {
      if (isImage) fetchImage(adminApi.getR2Binary(node.r2Key));
      else fetchText(adminApi.getR2Content(node.r2Key).then((r) => r.body));
      return;
    }
    const url = r2KeyToWorkerUrl(node.r2Key);
    if (!url) { setBody(null); setImageUrl(null); setLoading(false); return; }
    if (isImage) {
      fetchImage(fetch(url).then((r) => r.ok ? r.blob() : Promise.reject(new Error(`${r.status}`))));
    } else {
      fetchText(fetch(url).then((r) => r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))));
    }
  }, [node.r2Key, isImage]);

  React.useEffect(() => {
    return () => { if (imageUrl) URL.revokeObjectURL(imageUrl); };
  }, [imageUrl]);

  if (isImage) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto osler-scroll-y p-2.5">
          {loading ? (
            <div className="text-xs text-muted-foreground text-center py-6">{t("common.loading")}</div>
          ) : imageUrl ? (
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="block w-full"
              aria-label={t("admin.preview.previewImage")}
            >
              <img
                src={imageUrl}
                alt={node.name}
                className="mx-auto max-h-[35vh] max-w-full rounded-xl border border-border object-contain"
              />
            </button>
          ) : (
            <div className="text-xs text-muted-foreground text-center py-6">
              {t("admin.content.previewUnavailableR2")}
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-border px-2.5 py-1 text-xs text-muted-foreground">
          {node.name}{node.size != null ? ` · ${formatBytes(node.size)}` : ""}
        </div>
        <ImageLightbox
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          src={imageUrl ?? ""}
          alt={node.name}
          fileName={node.name}
          sizeBytes={node.size}
        />
      </div>
    );
  }

  // Rendered preview: markdown articles + typed JSON packs. Falls back to a
  // raw text view when the body isn't parseable / renderable.
  const parsed = body == null ? null : (() => {
    if (isMarkdown) return null;
    try { return JSON.parse(body); } catch { return null; }
  })();
  const contentType = node.cloudObject?.content_type ?? null;
  const effectiveType = contentType ?? (parsed ? inferContentType(parsed) : null);
  const renderable = isMarkdown || (parsed && effectiveType);
  const lang = parsed?.meta?.lang ?? node.cloudObject?.language;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div dir={lang === "ar" ? "rtl" : "ltr"} className="flex-1 min-h-0 overflow-auto osler-scroll-y p-2.5">
        {loading ? (
          <div className="text-xs text-muted-foreground text-center py-6">{t("common.loading")}</div>
        ) : renderable && body != null ? (
          isMarkdown
            ? <MarkdownBody md={body} r2Key={node.r2Key} />
            : parsed && effectiveType
              ? <RenderedContentPreview node={node} contentType={effectiveType} parsed={parsed} />
              : null
        ) : truncated ? (
          <div className="text-xs text-muted-foreground text-center py-6">
            {t("admin.studio.preview.tooLarge")}
          </div>
        ) : body == null ? (
          <div className="text-xs text-muted-foreground text-center py-6">
            {t("admin.content.previewUnavailableR2")}
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground/90">
            {body}
          </pre>
        )}
      </div>
    </div>
  );
}
