"use client";

/**
 * Review Preview — the right-hand preview panel of the Review Queue.
 *
 * Renders the actual submitted content so an admin can see what they're about
 * to approve, mirroring the Content Studio detail panel:
 *  - Pending content_object submissions preview their D1 body (library
 *    articles render as markdown, typed packs via RenderedContentPreview).
 *  - Staged uploads fetch the selected R2 key through the admin API and render
 *    it the same way, with a compact file selector for multi-file groups.
 *
 * Images open in the shared ImageLightbox; oversized bodies degrade to a
 * "too large" hint instead of freezing the browser.
 */

import * as React from "react";
import { Eye, FolderOpen } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { adminApi, type ContentObject } from "@/components/osler/admin/admin-api";
import { isImageR2Key, formatBytes } from "@/components/osler/admin/editors/image-upload";
import { ImageLightbox } from "@/components/osler/admin/image-lightbox";
import type { ContentTreeNode } from "@/components/osler/admin/content-tree-pane";
import {
  MarkdownBody,
  RenderedContentPreview,
  inferContentType,
} from "@/components/osler/admin/content-studio/content-preview";
import { LoadingState } from "@/components/osler/ui-primitives";

export interface StagedFile {
  key: string;
  size: number;
  uploaded: string | null;
}

/** A folder of staged files awaiting a single Publish / Discard decision. */
export interface StagedGroup {
  dir: string;
  keys: StagedFile[];
  totalBytes: number;
}

/** What the preview panel is currently showing. */
export type ReviewPreviewTarget =
  | { kind: "pending"; item: ContentObject }
  | { kind: "stagedGroup"; group: StagedGroup; fileKey: string };

const MAX_PREVIEW_CHARS = 500_000;

export function ReviewPreview({
  target,
  onSelectFile,
}: {
  target: ReviewPreviewTarget | null;
  onSelectFile?: (group: StagedGroup, key: string) => void;
}) {
  const { t } = useI18n();

  // Stable keys that drive the fetch effect (primitive deps only, so the
  // panel doesn't refetch on every parent re-render).
  const kind = target?.kind ?? null;
  const item = target?.kind === "pending" ? target.item : null;
  const group = target?.kind === "stagedGroup" ? target.group : null;
  const fileKey = target?.kind === "stagedGroup" ? target.fileKey : null;
  const fetchKey = item?.id ?? fileKey ?? null;

  const r2Key = fileKey ?? item?.published_r2_key ?? item?.r2_key_base ?? null;
  const isImage = !!r2Key && isImageR2Key(r2Key);
  const isMarkdown = !isImage && (item?.content_type === "library" || (r2Key?.endsWith(".md") ?? false));

  const [body, setBody] = React.useState<string | null>(null);
  const [truncated, setTruncated] = React.useState(false);
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setBody(null);
    setImageUrl(null);
    setTruncated(false);
    if (!target) { setLoading(false); return; }

    let alive = true;
    let objUrl: string | null = null;
    setLoading(true);

    const finish = (text: string) => {
      if (!alive) return;
      if (text.length > MAX_PREVIEW_CHARS) setTruncated(true);
      else setBody(text);
    };

    const load = async () => {
      try {
        if (target.kind === "pending") {
          const content = await adminApi.getContent(target.item.id);
          if (alive && content.body) finish(content.body);
          else if (alive) setBody(null);
        } else if (isImageR2Key(target.fileKey)) {
          const blob = await adminApi.getR2Binary(target.fileKey);
          objUrl = URL.createObjectURL(blob);
          if (alive) setImageUrl(objUrl);
        } else {
          const res = await adminApi.getR2Content(target.fileKey);
          finish(res.body);
        }
      } catch {
        if (alive) { setBody(null); setImageUrl(null); }
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();

    return () => { alive = false; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [kind, fetchKey, target]);

  const parsed = body == null ? null : (() => {
    if (isMarkdown) return null;
    try { return JSON.parse(body); } catch { return null; }
  })();
  const contentType = item?.content_type ?? (parsed ? inferContentType(parsed) : null);
  const renderable = isMarkdown || (parsed && contentType);
  const lang = parsed?.meta?.lang ?? item?.language;

  const name = item?.title ?? (fileKey?.split("/").pop() ?? t("admin.review.untitled"));

  const node: ContentTreeNode | null = target ? {
    id: item?.id ?? fileKey ?? name,
    name,
    kind: "file",
    r2Key: r2Key ?? undefined,
    cloudObject: item ?? undefined,
  } : null;

  return (
    <div className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Staged group file selector */}
      {group && (
        <div className="shrink-0 border-b border-border p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <FolderOpen className="size-3 shrink-0" />
            <span className="truncate font-mono">{group.dir || t("admin.review.stagedRoot")}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {group.keys.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => onSelectFile?.(group, f.key)}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                  f.key === fileKey
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
                )}
              >
                {f.key.split("/").pop()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      {target && (
        <div className="shrink-0 border-b border-border p-3">
          <h3 className="truncate text-sm font-semibold">{name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {contentType && <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{contentType}</span>}
            {item?.creator_username && (
              <span>{t("admin.review.submittedBy", { name: `@${item.creator_username}` })}</span>
            )}
            {group && (
              <span>{t("admin.review.stagedFilesCount", { n: String(group.keys.length), size: formatBytes(group.totalBytes) })}</span>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div dir={lang === "ar" ? "rtl" : "ltr"} className="min-h-0 flex-1 overflow-auto osler-scroll-y p-3">
        {!target ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
            <div className="osler-empty__icon"><Eye className="size-6" /></div>
            <p className="osler-empty__title text-sm">{t("admin.studio.noSelection")}</p>
            <p className="osler-empty__body text-xs">{t("admin.studio.noSelectionDesc")}</p>
          </div>
        ) : loading ? (
          <LoadingState size="sm" />
        ) : imageUrl ? (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="block w-full"
            aria-label={t("admin.preview.previewImage")}
          >
            <img
              src={imageUrl}
              alt={name}
              className="mx-auto max-h-[45vh] max-w-full rounded-lg border border-border object-contain"
            />
          </button>
        ) : truncated ? (
          <div className="py-8 text-center text-[11px] text-muted-foreground">
            {t("admin.studio.preview.tooLarge")}
          </div>
        ) : body == null ? (
          <div className="py-8 text-center text-[11px] text-muted-foreground">
            {t("admin.content.previewUnavailableR2")}
          </div>
        ) : renderable && body ? (
          isMarkdown
            ? <MarkdownBody md={body} r2Key={r2Key ?? undefined} />
            : parsed && contentType
              ? <RenderedContentPreview node={node!} contentType={contentType} parsed={parsed} />
              : null
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[10px] text-foreground/90">
            {body}
          </pre>
        )}
      </div>

      <ImageLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        src={imageUrl ?? ""}
        alt={name}
        fileName={name}
      />
    </div>
  );
}
