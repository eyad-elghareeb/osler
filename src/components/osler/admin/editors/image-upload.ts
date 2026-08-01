/**
 * Shared image-upload helpers for the admin content editors.
 *
 * Used by:
 *   · src/components/osler/admin/editors/markdown-editor.tsx  (MarkdownEditor)
 *   · src/components/osler/admin/editors/structured-editors.tsx (ImageListField)
 *
 * End-to-end workflow:
 *   1. Admin picks / drops / pastes an image into an editor.
 *   2. The browser hands us a `File`.
 *   3. We sanitise the filename and (if requested) add a short uniqueness
 *      suffix so re-uploads don't clobber each other.
 *   4. We compute the R2 key the image should land at:
 *        · Managed mode (r2_key_base = "content/<type>/<id>"):
 *            → `${r2_key_base}/images/<name>`
 *          These get copied to the published keyspace at publish time by
 *          hybridPublish() in cloudflare/worker/src/index.ts.
 *        · Raw mode (rawR2Key = "content-files/<category>/<dir>/<file>.md"):
 *            → strip the filename, then append `images/<name>`:
 *              "content-files/library/cardiology/asthma.md"
 *              → "content-files/library/cardiology/asthma/images/<name>"
 *          Wait — that's NOT what the student-side resolver expects. The
 *          student resolver (resolveArticleAsset in src/lib/osler/articles.ts)
 *          uses `articleDir = parent dir of the .md file`. So for
 *          `library/cardiology/asthma.md`, articleDir = "cardiology/" and
 *          images resolve to `library/cardiology/images/<name>`.
 *          For `library/demos/image-support-demo/image-support-demo.md`,
 *          articleDir = "demos/image-support-demo/" and images resolve to
 *          `library/demos/image-support-demo/images/<name>`.
 *          So in raw mode the image must be uploaded to
 *          `content-files/<category>/<articleDir>images/<name>`, i.e. drop
 *          the .md filename and append `images/<name>`.
 *   5. We POST `{ key, body: dataUri }` to /v1/admin/content/upload-file.
 *   6. We return the relative reference (`images/<name>`) that should be
 *      inserted into the markdown / image-list src field — this matches
 *      what the student-side resolver expects.
 */

import { adminApi } from "@/components/osler/admin/admin-api";
import { resolvedCloudApiUrlSync } from "@/lib/osler/cloud";

/** Sanitise a filename for safe R2 storage.
 *  - lower-case
 *  - replace runs of whitespace with a single hyphen
 *  - drop any character that isn't a-z, 0-9, hyphen, underscore, or dot
 *  - collapse multiple consecutive hyphens/dots
 *  - if the result is empty, fall back to "image"
 *  - preserve the original extension if recognisable
 */
export function sanitizeImageFilename(name: string): string {
  const lower = name.toLowerCase();
  // Pull the extension off before sanitising so we don't lose it.
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot).replace(/[^a-z0-9.]/g, "") : "";
  const base = dot >= 0 ? lower.slice(0, dot) : lower;
  const cleanBase = base
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "image";
  return ext ? `${cleanBase}${ext}` : cleanBase;
}

/** Add a short uniqueness suffix to `name` so concurrent uploads of the same
 *  file don't clobber each other. Format: `<base>-<8hex>.<ext>`. */
export function uniqueImageFilename(name: string): string {
  const safe = sanitizeImageFilename(name);
  const dot = safe.lastIndexOf(".");
  const ext = dot >= 0 ? safe.slice(dot) : "";
  const base = dot >= 0 ? safe.slice(0, dot) : safe;
  const suffix = Math.random().toString(36).slice(2, 10);
  return `${base}-${suffix}${ext}`;
}

/** Read a File (or Blob) as a base64 data URI. */
export function fileToDataUri(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

/** Determine whether the given File is an image we accept. */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  // Some browsers don't set `type` for svg/avif — fall back to extension.
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  return ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"].includes(ext);
}

/** Compute the R2 key an image should be uploaded to, given the editor's
 *  context (either a managed `r2KeyBase` or a raw `rawR2Key`).
 *
 *  Returns `null` if neither is provided (caller should fall back to a
 *  relative reference only — no upload). */
export function computeImageR2Key(
  imageName: string,
  opts: { r2KeyBase?: string; rawR2Key?: string },
): string | null {
  const { r2KeyBase, rawR2Key } = opts;
  if (r2KeyBase) {
    // Managed mode — draft storage under the content_object's R2 folder.
    // hybridPublish() will copy these to the student keyspace at publish.
    return `${r2KeyBase}/images/${imageName}`;
  }
  if (rawR2Key) {
    // Raw mode — the .md/.json file is already in content-files/. Strip the
    // filename and append `images/<name>`. The student-side resolver will
    // look for the image at exactly this location.
    const slash = rawR2Key.lastIndexOf("/");
    if (slash < 0) return null;
    const dir = rawR2Key.slice(0, slash + 1); // includes trailing slash
    return `${dir}images/${imageName}`;
  }
  return null;
}

/** Upload a single image to R2 and return the relative reference (`images/<name>`)
 *  that should be inserted into the markdown body or the image-list `src` field.
 *
 *  - If neither `r2KeyBase` nor `rawR2Key` is provided, the file is NOT
 *    uploaded — we return `images/<name>` so the user can still see the
 *    reference; they'll need to upload the file via another channel.
 *  - If `unique` is true (default), a short random suffix is appended to the
 *    filename so concurrent uploads don't overwrite each other.
 *  - The filename is always sanitised (lowercase, hyphenated, ASCII-only).
 */
export async function uploadImageForEditor(
  file: File,
  opts: { r2KeyBase?: string; rawR2Key?: string; unique?: boolean },
): Promise<{ ref: string; key: string; dataUri: string }> {
  const unique = opts.unique !== false;
  const name = unique ? uniqueImageFilename(file.name) : sanitizeImageFilename(file.name);
  const ref = `images/${name}`;
  const key = computeImageR2Key(name, opts);
  const dataUri = await fileToDataUri(file);
  if (key) {
    await adminApi.uploadFile(key, dataUri);
  }
  return { ref, key: key ?? "", dataUri };
}

/**
 * Map an R2 key (e.g. "content-files/library/asthma.md" or
 * "content/library/abc123/draft.json") to a URL the browser can fetch
 * directly from the Worker's public content endpoint.
 *
 * The old /api/r2-fetch Pages route is gone (static export has no server).
 * The Worker's `/v1/content/<category>/<path>` and
 * `/v1/content-manifests/<category>/manifest.json` endpoints are public
 * and set `Cross-Origin-Resource-Policy: cross-origin` so the Pages site
 * can read them directly.
 *
 * Returns `null` if the Worker URL is not configured (cloud disabled) or
 * if the key isn't under `content-files/` or `content-manifests/`.
 */
export function r2KeyToWorkerUrl(r2Key: string): string | null {
  const apiUrl = resolvedCloudApiUrlSync();
  if (!apiUrl) return null;
  if (r2Key.startsWith("content-files/")) {
    const rel = r2Key.slice("content-files/".length);
    const encoded = rel.split("/").map(encodeURIComponent).join("/");
    return `${apiUrl}/v1/content/${encoded}`;
  }
  if (r2Key.startsWith("content-manifests/")) {
    const rel = r2Key.slice("content-manifests/".length);
    const encoded = rel.split("/").map(encodeURIComponent).join("/");
    return `${apiUrl}/v1/content-manifests/${encoded}`;
  }
  return null;
}

/** Resolve a relative `images/foo.png` (or bare `foo.png`) reference to a
 *  URL the admin can preview. In raw mode this is the same R2 key the file
 *  was uploaded to (served directly from the Worker's public content
 *  endpoint). In managed mode we don't have a published location until
 *  publish time, so we use the draft R2 key (also via the Worker).
 *
 *  Absolute URLs, `data:` URIs, and `/`-rooted paths pass through unchanged. */
export function resolveImageForPreview(
  src: string,
  opts: { r2KeyBase?: string; rawR2Key?: string },
): string {
  if (!src) return src;
  if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:") || src.startsWith("/")) {
    return src;
  }
  // Normalise to "images/<name>"
  const base = src.includes("/") ? src : `images/${src}`;
  let r2Key: string | null = null;
  if (opts.r2KeyBase) {
    r2Key = `${opts.r2KeyBase}/${base}`;
  } else if (opts.rawR2Key) {
    const slash = opts.rawR2Key.lastIndexOf("/");
    if (slash >= 0) r2Key = `${opts.rawR2Key.slice(0, slash + 1)}${base}`;
  }
  if (!r2Key) return src;
  // Draft R2 keys (e.g. "content/library/<id>/images/<name>") aren't under
  // content-files/, so the Worker's public /v1/content/* won't serve them.
  // The admin previews those via the dataUri returned by uploadImageForEditor
  // instead — this function returns the relative ref for the markdown body.
  const workerUrl = r2KeyToWorkerUrl(r2Key);
  return workerUrl ?? src;
}
