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
 * "too large" hint instead of freezing the browser. EPUB artifacts (pending
 * data-URI bodies and staged `.epub` keys) preview in the real book reader
 * and PDFs as a placeholder — base64 archives never reach the text path.
 */

import * as React from "react";
import dynamic from "next/dynamic";
import { Eye, FileText, FolderOpen } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { adminApi, type ContentObject } from "@/components/osler/admin/admin-api";
import { isEpubR2Key, isImageR2Key, formatBytes } from "@/components/osler/admin/editors/image-upload";
import { dataUriToBytes, isEpubDataUri } from "@/components/osler/admin/editors/epub-tools";
import { ImageLightbox } from "@/components/osler/admin/image-lightbox";
// epubjs only loads when an EPUB preview actually opens — same split the
// studio detail panel uses.
const EpubReader = dynamic(
  () => import("@/components/osler/epub-reader").then((m) => ({ default: m.EpubReader })),
  { ssr: false, loading: () => null },
);
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
  // Binary artifact previews: EPUBs render in the real book reader, PDFs as
  // a placeholder. Both must stay OUT of the text path — a multi-megabyte
  // base64 body in MarkdownBody/<pre> freezes the tab.
  const [epubUrl, setEpubUrl] = React.useState<string | null>(null);
  const [pdfArtifact, setPdfArtifact] = React.useState(false);
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setBody(null);
    setImageUrl(null);
    setEpubUrl(null);
    setPdfArtifact(false);
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

    /** Route a staged data-URI body to the binary preview when it is one. */
    const finishDataBody = (text: string | null | undefined) => {
      if (!alive) return;
      if (text && isEpubDataUri(text)) {
        const raw = dataUriToBytes(text);
        if (raw) {
          objUrl = URL.createObjectURL(new Blob([raw as unknown as BlobPart], { type: "application/epub+zip" }));
          setEpubUrl(objUrl);
        } else {
          setBody(null);
        }
        return;
      }
      if (text && text.startsWith("data:application/pdf")) {
        setPdfArtifact(true);
        return;
      }
      if (text) finish(text);
      else setBody(null);
    };

    const load = async () => {
      try {
        if (target.kind === "pending") {
          const content = await adminApi.getContent(target.item.id);
          finishDataBody(content.body);
        } else if (isEpubR2Key(target.fileKey)) {
          const blob = await adminApi.getR2Binary(target.fileKey);
          objUrl = URL.createObjectURL(blob);
          if (alive) setEpubUrl(objUrl);
        } else if (target.fileKey.toLowerCase().endsWith(".pdf")) {
          if (alive) setPdfArtifact(true);
        } else if (isImageR2Key(target.fileKey)) {
          const blob = await adminApi.getR2Binary(target.fileKey);
          objUrl = URL.createObjectURL(blob);
          if (alive) setImageUrl(objUrl);
        } else {
          const res = await adminApi.getR2Content(target.fileKey);
          finish(res.body);
        }
      } catch {
        if (alive) { setBody(null); setImageUrl(null); setEpubUrl(null); setPdfArtifact(false); }
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
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                  "rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors",
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

      {/* Body — the book reader owns its scroller, so the EPUB branch drops
          the host `overflow-auto` padding (same rule as the studio panel). */}
      <div
        dir={lang === "ar" ? "rtl" : "ltr"}
        className={epubUrl && !loading
          ? "min-h-0 flex-1 overflow-hidden flex flex-col"
          : "min-h-0 flex-1 overflow-auto osler-scroll-y p-3"}
      >
        {!target ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
            <div className="osler-empty__icon"><Eye className="size-6" /></div>
            <p className="osler-empty__title text-sm">{t("admin.studio.noSelection")}</p>
            <p className="osler-empty__body text-xs">{t("admin.studio.noSelectionDesc")}</p>
          </div>
        ) : loading ? (
          <LoadingState size="sm" />
        ) : epubUrl ? (
          <EpubReader
            fileUrl={epubUrl}
            fileKey={`admin-review:${fetchKey}`}
            title={name}
            fontSize={15}
            lineHeight={1.7}
            maxWidth={640}
          />
        ) : pdfArtifact ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
            <FileText className="size-10 text-warning" />
            <p className="text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">{t("admin.studio.previewBinaryHint")}</p>
          </div>
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
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/90">
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
