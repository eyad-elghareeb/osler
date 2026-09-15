/**
 * Shared EPUB helpers for the admin content tools.
 *
 * Used by the library article editor (drop → metadata + asset upload) and
 * the studio detail panel (preview + extract-to-markdown). Framework-agnostic:
 * the heavy deps (jszip for archive access, turndown for HTML → markdown)
 * are dynamic-imported so the admin hub never pays for them until an EPUB
 * tool actually runs.
 */

export interface EpubChapterRef {
  /** File path inside the archive (e.g. "OEBPS/ch1.xhtml"). */
  path: string;
  /** Chapter title from the TOC ("" when the book has no nav map). */
  title: string;
}

export interface EpubMeta {
  title: string;
  creator: string;
  language: string;
  /** Total spine items (sections) in reading order. */
  spineLength: number;
  chapters: EpubChapterRef[];
  /** Approximate word count across all text sections. */
  words: number;
}

export interface EpubToMarkdownResult {
  markdown: string;
  chaptersConverted: number;
  chaptersTotal: number;
}

/** Canonical MIME for EPUB archives staged as data URIs. */
export const EPUB_MIME = "application/epub+zip";

/** Canonical MIME for PDF artifacts staged as data URIs. */
export const PDF_MIME = "application/pdf";

/**
 * Chunked ArrayBuffer → base64. The `btoa(String.fromCharCode(...bytes))`
 * spread form throws a RangeError past ~100k arguments, so every upload path
 * must go through here (or FileReader) for real-world multi-megabyte files.
 */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Single-read File → canonical `data:<mime>;base64,…` URI (no MIME sniffing). */
export function arrayBufferToDataUri(buf: ArrayBuffer, mime: string): string {
  return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
}

/**
 * Chunked `data:…;base64,…` → bytes. Used instead of `fetch(dataUri)` so
 * multi-megabyte archives don't duplicate in memory through a data-URL fetch.
 * Returns null when the body isn't a base64 data URI.
 */
export function dataUriToBytes(body: string): Uint8Array | null {
  if (!body.startsWith("data:")) return null;
  const comma = body.indexOf(",");
  if (comma < 0 || !body.slice(0, comma).includes(";base64")) return null;
  const b64 = body.slice(comma + 1).replace(/\s+/g, "");
  if (!b64) return null;
  try {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** True when bytes look like a ZIP archive (EPUBs are ZIPs: `PK\x03\x04`). */
export function hasZipMagic(bytes: ArrayBuffer | Uint8Array): boolean {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/** True when bytes look like a PDF (`%PDF-`). */
export function hasPdfMagic(bytes: ArrayBuffer | Uint8Array): boolean {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
}

/**
 * True when a staged body is an EPUB archive. Accepts the canonical
 * `data:application/epub…` prefix plus the legacy `data:application/octet-stream`
 * prefix older uploads produced when the OS had no `.epub` MIME mapping
 * (FileReader stamps `blob.type`, which is empty on Windows) — verified by
 * ZIP magic so a PDF saved as octet-stream never matches.
 */
export function isEpubDataUri(body: string): boolean {
  if (body.startsWith("data:application/epub")) return true;
  if (!body.startsWith("data:application/octet-stream;base64,")) return false;
  const bytes = dataUriToBytes(body);
  return bytes !== null && hasZipMagic(bytes);
}

/** True when a staged body is a PDF artifact. */
export function isPdfDataUri(body: string): boolean {
  return body.startsWith("data:application/pdf");
}

type ZipEntry = { async: (kind: "string" | "uint8array") => Promise<string | Uint8Array> };
type ZipLike = { file: (path: string) => ZipEntry | null };

async function loadZip(data: ArrayBuffer): Promise<ZipLike> {
  const mod = (await import("jszip")) as unknown as {
    default?: new () => { loadAsync: (d: ArrayBuffer) => Promise<ZipLike> };
  };
  const Ctor = mod.default ?? (mod as unknown as new () => { loadAsync: (d: ArrayBuffer) => Promise<ZipLike> });
  return new Ctor().loadAsync(data);
}

async function readText(zip: ZipLike, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  try {
    return new TextDecoder().decode((await entry.async("uint8array")) as Uint8Array);
  } catch {
    return null;
  }
}

/** Resolve a spine href against the OPF's directory. */
function resolveOpfPath(opfDir: string, href: string): string {
  const clean = href.split("#")[0].split("?")[0];
  if (!clean) return "";
  // Filenames with a literal `%` (or non-UTF8 escapes) make
  // decodeURIComponent throw — one bad href must not kill the whole book.
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    decoded = clean;
  }
  if (decoded.startsWith("/")) return decoded.slice(1);
  const parts = [...opfDir.split("/").filter(Boolean), ...decoded.split("/")];
  const out: string[] = [];
  for (const p of parts) {
    if (p === "." || !p) continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

function opfDirOf(containerXml: string | null): { opfPath: string; opfDir: string } {
  const opfPath = containerXml
    ? (containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1] ?? "")
    : "";
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  return { opfPath, opfDir };
}

/** Spine hrefs in reading order (itemref order, manifest fallback). */
async function readSpineHrefs(zip: ZipLike, opf: string | null): Promise<string[]> {
  if (!opf) return [];
  const doc = new DOMParser().parseFromString(opf, "application/xml");
  const idToHref = new Map<string, string>();
  for (const item of Array.from(doc.getElementsByTagName("item"))) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) idToHref.set(id, href);
  }
  const refs = Array.from(doc.getElementsByTagName("itemref"))
    .map((r) => r.getAttribute("idref") ?? "")
    .filter(Boolean);
  const ids = refs.length ? refs : [...idToHref.keys()];
  return ids.map((id) => idToHref.get(id) ?? "").filter(Boolean);
}

/** Chapter titles keyed by resolved path (EPUB3 nav, then EPUB2 NCX). */
async function readTocTitles(zip: ZipLike, opfDir: string, opf: string | null): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  if (!opf) return titles;
  const doc = new DOMParser().parseFromString(opf, "application/xml");
  const items = Array.from(doc.getElementsByTagName("item"));
  const ncx = items.find((i) => (i.getAttribute("media-type") ?? "").includes("ncx"))?.getAttribute("href") ?? "";
  const nav = items.find((i) => (i.getAttribute("properties") ?? "").split(/\s+/).includes("nav"))?.getAttribute("href") ?? "";
  if (nav) {
    const navHtml = await readText(zip, resolveOpfPath(opfDir, nav));
    if (navHtml) {
      const navDoc = new DOMParser().parseFromString(navHtml, "text/html");
      // The namespaced `*|type` selector throws a SyntaxError in engines
      // without a namespace context — fall back to plain selectors.
      let navEl: Element | null = null;
      for (const selector of ["nav[*|type='toc']", "nav[epub\\:type='toc']", "nav[role='doc-toc']", "nav"]) {
        try {
          navEl = navDoc.querySelector(selector);
        } catch {
          navEl = null;
        }
        if (navEl) break;
      }
      for (const a of Array.from(navEl?.querySelectorAll("a[href]") ?? [])) {
        const href = a.getAttribute("href") ?? "";
        const label = a.textContent?.trim() ?? "";
        if (href && label) {
          const key = resolveOpfPath(opfDir, href);
          if (!titles.has(key)) titles.set(key, label);
        }
      }
      if (titles.size > 0) return titles;
    }
  }
  if (ncx) {
    const ncxXml = await readText(zip, resolveOpfPath(opfDir, ncx));
    if (ncxXml) {
      const ncxDoc = new DOMParser().parseFromString(ncxXml, "application/xml");
      for (const point of Array.from(ncxDoc.getElementsByTagName("navPoint"))) {
        const label = point.getElementsByTagName("text")[0]?.textContent?.trim() ?? "";
        const src = point.getElementsByTagName("content")[0]?.getAttribute("src") ?? "";
        if (src && label) {
          const key = resolveOpfPath(opfDir, src);
          if (!titles.has(key)) titles.set(key, label);
        }
      }
    }
  }
  return titles;
}

/** Read OPF metadata + TOC + word count without rendering anything. */
export async function readEpubMeta(data: ArrayBuffer): Promise<EpubMeta> {
  const zip = await loadZip(data);
  const loc = opfDirOf(await readText(zip, "META-INF/container.xml"));
  const opf = loc.opfPath ? await readText(zip, loc.opfPath) : null;
  let title = "";
  let creator = "";
  let language = "en";
  if (opf) {
    const doc = new DOMParser().parseFromString(opf, "application/xml");
    title = doc.getElementsByTagName("dc:title")[0]?.textContent?.trim() ?? "";
    creator = doc.getElementsByTagName("dc:creator")[0]?.textContent?.trim() ?? "";
    language = doc.getElementsByTagName("dc:language")[0]?.textContent?.trim() || "en";
  }
  const hrefs = await readSpineHrefs(zip, opf);
  const paths = hrefs.map((h) => resolveOpfPath(loc.opfDir, h)).filter(Boolean);
  const titles = await readTocTitles(zip, loc.opfDir, opf);
  const chapters: EpubChapterRef[] = paths.map((path) => ({ path, title: titles.get(path) ?? "" }));
  let words = 0;
  const parser = new DOMParser();
  for (const path of paths) {
    const entry = zip.file(path);
    if (!entry) continue;
    try {
      const raw = (await entry.async("uint8array")) as Uint8Array;
      const text = parser
        .parseFromString(new TextDecoder().decode(raw), "text/html")
        .documentElement?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text) words += text.split(" ").length;
    } catch {
      // Metadata stays best-effort — skip unreadable sections.
    }
  }
  return { title, creator, language, spineLength: paths.length, chapters, words };
}

/** Convert an EPUB archive to markdown (one `## chapter` block per section). */
export async function epubToMarkdown(data: ArrayBuffer): Promise<EpubToMarkdownResult> {
  const zip = await loadZip(data);
  const loc = opfDirOf(await readText(zip, "META-INF/container.xml"));
  const opf = loc.opfPath ? await readText(zip, loc.opfPath) : null;
  const hrefs = await readSpineHrefs(zip, opf);
  const paths = hrefs.map((h) => resolveOpfPath(loc.opfDir, h)).filter(Boolean);
  const titles = await readTocTitles(zip, loc.opfDir, opf);
  const { default: TurndownService } = (await import("turndown")) as unknown as {
    default: new () => { turndown: (html: string) => string; remove: (s: string | string[]) => void };
  };
  const turndown = new TurndownService();
  turndown.remove(["script", "style", "nav"]);
  const blocks: string[] = [];
  let converted = 0;
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const html = await readText(zip, path);
    if (!html || !/<(p|h\d|div|li|table|img)\b/i.test(html)) continue;
    let md = "";
    try {
      md = turndown.turndown(html).trim();
    } catch {
      continue;
    }
    if (!md) continue;
    blocks.push(`## ${titles.get(path) || `Section ${i + 1}`}\n\n${md}\n`);
    converted++;
  }
  return { markdown: blocks.join("\n").trim(), chaptersConverted: converted, chaptersTotal: paths.length };
}

/** Extract the book's cover image as a blob URL (for the preview header). */
export async function epubCoverUrl(data: ArrayBuffer): Promise<string | null> {
  try {
    const zip = await loadZip(data);
    const loc = opfDirOf(await readText(zip, "META-INF/container.xml"));
    if (!loc.opfPath) return null;
    const opf = await readText(zip, loc.opfPath);
    if (!opf) return null;
    const doc = new DOMParser().parseFromString(opf, "application/xml");
    const items = Array.from(doc.getElementsByTagName("item"));
    const coverItem =
      items.find((el) => (el.getAttribute("properties") ?? "").split(/\s+/).includes("cover-image")) ??
      items.find((el) => (el.getAttribute("id") ?? "").toLowerCase().includes("cover"));
    const href = coverItem?.getAttribute("href") ?? "";
    if (!href) return null;
    const entry = zip.file(resolveOpfPath(loc.opfDir, href));
    if (!entry) return null;
    const raw = (await entry.async("uint8array")) as Uint8Array;
    const ext = href.split(".").pop()?.toLowerCase() ?? "";
    const mime = ext === "png" ? "image/png" : ext === "svg" ? "image/svg+xml" : ext === "gif" ? "image/gif" : "image/jpeg";
    const bytes = new Uint8Array(raw.length);
    bytes.set(raw);
    return URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: mime }));
  } catch {
    return null;
  }
}
