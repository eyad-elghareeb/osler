/**
 * EPUB archive access (thin adapter over `epubjs`).
 *
 * All format work — ZIP extraction, OPF/spine parsing, NCX/nav TOC, resource
 * rewriting to blob URLs, CFI ranges — is epubjs's job. This module only:
 *   - lazy-loads epubjs so it never enters the main bundle,
 *   - opens an archive into a `Book` plus flattened reader metadata,
 *   - builds the chapter list *lazily* (`loadChapters`), so a heavy NCX never
 *     delays the first page,
 *   - owns teardown (book destroy + cover blob-URL revoke).
 *
 * Rendering, themes, link interception, highlights, and next/prev live in
 * `epub-reader.tsx`, which drives the returned `Book` through epubjs's own
 * `Rendition` API.
 */

import type { Book } from "epubjs";
import { chaptersFromNav, chaptersFromSpine } from "./manifest";
import { EPUB_CHAPTERS_TIMEOUT_MS, EPUB_RTL_LANGS } from "./tokens";
import { EpubOpenError, type EpubMetadata, type EpubTocEntry, type OpenEpubBook } from "./types";

function readingDir(language: string): "ltr" | "rtl" {
  const primary = language.trim().toLowerCase().split(/[-_]/)[0];
  return EPUB_RTL_LANGS.has(primary) ? "rtl" : "ltr";
}

type EpubFactory = (input: ArrayBuffer | Blob) => Book;

let epubFactoryPromise: Promise<EpubFactory> | null = null;

/**
 * Start loading the epubjs engine without waiting for it. The reader calls
 * this the moment a book is requested so the ~100–400ms module fetch +
 * parse overlaps the archive download instead of following it. Failures are
 * swallowed here and re-thrown (once) by `loadEpubFactory`, so a failed
 * preload never poisons retries.
 */
export function preloadEpubEngine(): void {
  void loadEpubFactory().catch(() => {});
}

async function loadEpubFactory(): Promise<EpubFactory> {
  epubFactoryPromise ??= (async () => {
    let mod: { default?: unknown };
    try {
      mod = (await import("epubjs")) as unknown as { default?: unknown };
    } catch {
      throw new EpubOpenError("engine", "epubjs failed to load");
    }
    // ESM build exposes the factory as `.default`; tolerate a CJS shape where
    // the module itself is the factory.
    const factory = typeof mod.default === "function" ? mod.default : mod;
    if (typeof factory !== "function") throw new EpubOpenError("engine", "unexpected epubjs module shape");
    return factory as EpubFactory;
  })().catch((err) => {
    epubFactoryPromise = null;
    throw err;
  });
  return epubFactoryPromise;
}

/** Resolve to null instead of hanging — pathological NCX files exist. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Open an EPUB archive for reading. Throws an `EpubOpenError` carrying a code
 * the reader maps to localized copy.
 *
 * `sectionLabel` supplies the localized "Section {n}" used by the spine-derived
 * chapter fallback for books without a navigation document.
 */
export async function openEpubBook(
  data: ArrayBuffer | Blob,
  sectionLabel: (n: number) => string,
): Promise<OpenEpubBook> {
  const ePub = await loadEpubFactory();
  const book = ePub(data);

  try {
    await book.ready;
  } catch {
    try {
      book.destroy();
    } catch {
      // ignore secondary teardown failures
    }
    throw new EpubOpenError("invalid", "the archive could not be opened");
  }

  // Metadata + spine are cheap (already parsed from the OPF). The navigation
  // document is deliberately NOT awaited here — it is the expensive one.
  const [metadata, spine] = await Promise.all([
    book.loaded.metadata.catch(() => null),
    book.loaded.spine.catch(() => []),
  ]);

  const spineList = Array.isArray(spine) ? spine : [];
  const spineLength = spineList.length || (book.spine as unknown as { spineItems?: unknown[] })?.spineItems?.length || 0;

  // Sanitize every section before it reaches an iframe: publisher `<script>`
  // elements (the section sandbox has no script rights — each one logs a
  // "blocked script execution" error) and publisher stylesheet `<link>`s
  // (rewritten to blob: URLs, which the CSP intentionally doesn't
  // allow-list). Neither can ever take effect — the Osler theme owns section
  // styling — so removing them changes nothing visually and keeps the
  // console clean on script/CSS-heavy books. Registered on the spine's
  // shared content hooks (which every section runs pre-serialization), NOT
  // on the rendition hooks (which fire after the iframe already parsed and
  // logged). Failures must never break the open.
  //
  // NOTE: sections are XML documents, where type selectors only match
  // no-namespace elements — `querySelectorAll("script")` silently matches
  // nothing on XHTML. `getElementsByTagName` is namespace-agnostic and is
  // what epubjs itself uses.
  try {
    const spineHooks = (
      book.spine as unknown as {
        hooks?: { content?: { register?: (...fns: Array<(doc: Document) => void>) => void } };
      }
    )?.hooks?.content;
    spineHooks?.register?.((doc: Document) => {
      try {
        removeElementsByTag(doc, "script");
        const links = doc?.getElementsByTagName?.("link");
        if (links) {
          for (let i = links.length - 1; i >= 0; i--) {
            const rel = links[i]?.getAttribute?.("rel") ?? "";
            if (rel.split(/\s+/).some((t) => t.toLowerCase() === "stylesheet")) {
              links[i]?.parentNode?.removeChild(links[i]);
            }
          }
        }
      } catch {
        // A half-parsed section document — the sandbox/CSP blocks apply anyway.
      }
    });
  } catch {
    // Hook registration failed — the reader's DOM-level strip still applies.
  }
  if (!spineLength) {
    try {
      book.destroy();
    } catch {
      // ignore teardown failures
    }
    throw new EpubOpenError("empty", "the book has no spine");
  }

  let cover: string | null = null;
  try {
    const url = await book.coverUrl();
    cover = typeof url === "string" && url ? url : null;
  } catch {
    cover = null;
  }

  const language = typeof metadata?.language === "string" ? metadata.language : "en";

  let chapters: EpubTocEntry[] | null = null;
  const loadChapters = async (): Promise<EpubTocEntry[]> => {
    if (chapters) return chapters;
    const navigation = await withTimeout(book.loaded.navigation, EPUB_CHAPTERS_TIMEOUT_MS);
    const fromNav = chaptersFromNav(book, navigation?.toc);
    chapters = fromNav.length ? fromNav : chaptersFromSpine(book, sectionLabel);
    return chapters;
  };

  return {
    book,
    metadata: {
      title: (typeof metadata?.title === "string" && metadata.title.trim()) || "",
      creator: typeof metadata?.creator === "string" ? metadata.creator.trim() : "",
      language,
      dir: readingDir(language),
      coverUrl: cover,
    },
    spineLength,
    loadChapters,
    destroy: () => {
      if (cover) {
        try {
          URL.revokeObjectURL(cover);
        } catch {
          // already revoked — harmless
        }
      }
      try {
        book.destroy();
      } catch {
        // ignore teardown failures during unmount
      }
    },
  };
}

/** Remove every element with the given tag name (live collection, backwards). */
function removeElementsByTag(doc: Document, tag: string): void {
  const els = doc?.getElementsByTagName?.(tag);
  if (!els) return;
  for (let i = els.length - 1; i >= 0; i--) {
    try {
      els[i]?.parentNode?.removeChild(els[i]);
    } catch {
      // Already detached — harmless.
    }
  }
}

/** Streaming download progress, reported while the archive arrives. */
export interface EpubDownloadProgress {
  /** Bytes received so far. */
  loaded: number;
  /** From `content-length` — null when the server doesn't send one. */
  total: number | null;
}

/**
 * Fetch the archive with cancellation (fast article switching) and progress.
 *
 * The body streams through a reader so the landing overlay can show a
 * determinate progress bar on multi-megabyte books, and the chunks assemble
 * straight into a Blob: epubjs (via JSZip) opens Blobs natively, which skips
 * the extra full-archive copy an `arrayBuffer()` round-trip would add.
 */
export async function fetchEpubArchive(
  url: string,
  signal?: AbortSignal,
  onProgress?: (progress: EpubDownloadProgress) => void,
): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new EpubOpenError("network", "the book request failed");
  }
  if (!res.ok) throw new EpubOpenError("network", `HTTP ${res.status}`);
  const totalRaw = Number(res.headers.get("content-length"));
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : null;
  if (!res.body || typeof res.body.getReader !== "function") {
    try {
      const fallback = await res.blob();
      onProgress?.({ loaded: fallback.size, total: fallback.size });
      return fallback;
    } catch {
      throw new EpubOpenError("network", "the book body could not be read");
    }
  }
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.({ loaded, total });
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new EpubOpenError("network", "the book body could not be read");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already closed with the stream — harmless.
    }
  }
  return new Blob(chunks, { type: "application/epub+zip" });
}