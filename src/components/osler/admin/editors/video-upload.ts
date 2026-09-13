"use client";

import { adminApi } from "@/components/osler/admin/admin-api";
import { fileToDataUri, formatBytes } from "@/components/osler/admin/editors/image-upload";

export { formatBytes };

/**
 * Shared video-upload helpers for the admin video editor.
 *
 * Mirrors `image-upload.ts`, but for pack media instead of images:
 *   1. Admin picks a video file (MP4/WebM/M4V/MOV) in the video editor.
 *   2. The filename is sanitised (lowercase, hyphenated, ASCII-only).
 *   3. The file lands at `<pack>/media/<name>`:
 *        · Managed mode (r2KeyBase = "content/<type>/<id>"):
 *            → `${r2KeyBase}/media/<name>` via the raw-binary asset endpoint
 *              (no base64 inflation, no JSON size cap — required for video).
 *              hybridPublish() copies `media/` to the student keyspace at
 *              publish time (see cloudflare/worker/src/index.ts).
 *        · Raw mode (rawR2Key = "content-files/videos/<dir>/videos.json"):
 *            → `<dir>/media/<name>` via upload-file as a data URI
 *              (subject to the worker's ~30 MB JSON body cap — large files
 *              should use a managed content object instead).
 *   4. We return the pack-relative reference (`media/<name>`) stored as the
 *      video's `source: { type: "r2", key }` — the student app resolves it
 *      against the pack folder at runtime (see src/lib/osler/videos.ts).
 */

/** Video extensions accepted for R2 upload (playable via `<video>` / Plyr). */
export const VIDEO_UPLOAD_EXTS = ["mp4", "webm", "m4v", "mov"] as const;

const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
};

export function videoMimeFor(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  return VIDEO_MIME[ext] ?? "video/mp4";
}

/** True when a File looks like an uploadable video (mime or extension). */
export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  return (VIDEO_UPLOAD_EXTS as readonly string[]).includes(ext);
}

/** True when an r2 source key points at a supported pack-media file. */
export function isSupportedMediaKey(key: string): boolean {
  return /\.(mp4|webm|m4v|mov|m3u8)$/i.test(key.trim());
}

/** Sanitise a video filename for safe R2 storage (same rules as images). */
export function sanitizeVideoFilename(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot).replace(/[^a-z0-9.]/g, "") : "";
  const base = dot >= 0 ? lower.slice(0, dot) : lower;
  const cleanBase = base
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "video";
  return ext ? `${cleanBase}${ext}` : cleanBase;
}

/** Add a short uniqueness suffix so re-uploads don't clobber each other. */
export function uniqueVideoFilename(name: string): string {
  const safe = sanitizeVideoFilename(name);
  const dot = safe.lastIndexOf(".");
  const ext = dot >= 0 ? safe.slice(dot) : "";
  const base = dot >= 0 ? safe.slice(0, dot) : safe;
  const suffix = Math.random().toString(36).slice(2, 10);
  return `${base}-${suffix}${ext}`;
}

/** Compute the R2 key a video should be uploaded to, given the editor's
 *  context (either a managed `r2KeyBase` or a raw `rawR2Key`). Returns
 *  `null` when neither is provided (caller stores a bare reference only). */
export function computeVideoR2Key(
  videoName: string,
  opts: { r2KeyBase?: string; rawR2Key?: string },
): string | null {
  const { r2KeyBase, rawR2Key } = opts;
  if (r2KeyBase) return `${r2KeyBase}/media/${videoName}`;
  if (rawR2Key) {
    const slash = rawR2Key.lastIndexOf("/");
    if (slash < 0) return null;
    return `${rawR2Key.slice(0, slash + 1)}media/${videoName}`;
  }
  return null;
}

export interface UploadVideoResult {
  /** Pack-relative reference for `source.key` (`media/<name>`). */
  ref: string;
  /** Full R2 key the file was written to ("" when not uploaded). */
  key: string;
  /** Uploaded byte count. */
  bytes: number;
}

/** Upload a video file to R2 and return the pack-relative `media/<name>`
 *  reference for the video's `source.key`.
 *
 *  Managed mode streams the raw File through the asset endpoint with
 *  progress callbacks (no base64, no size cap beyond R2/Worker limits).
 *  Raw mode falls back to a data-URI upload-file write, which is subject
 *  to the worker's JSON body cap — callers should warn on files > 24 MB.
 *  With neither context the file is NOT uploaded and only the `media/`
 *  reference is returned. */
export async function uploadVideoForEditor(
  file: File,
  opts: { r2KeyBase?: string; rawR2Key?: string; unique?: boolean; onProgress?: (fraction: number) => void },
): Promise<UploadVideoResult> {
  const unique = opts.unique !== false;
  const name = unique ? uniqueVideoFilename(file.name) : sanitizeVideoFilename(file.name);
  const ref = `media/${name}`;
  const key = computeVideoR2Key(name, opts);

  const targetId = opts.r2KeyBase ? opts.r2KeyBase.split("/").pop() : null;
  if (targetId) {
    await adminApi.uploadAssetProgress(targetId, ref, file, videoMimeFor(name), opts.onProgress);
  } else if (key) {
    opts.onProgress?.(0);
    await adminApi.uploadFile(key, await fileToDataUri(file));
    opts.onProgress?.(1);
  }

  return { ref, key: key ?? "", bytes: file.size };
}
