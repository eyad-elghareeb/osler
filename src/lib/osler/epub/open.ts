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

async function loadEpubFactory(): Promise<(input: ArrayBuffer) => Book> {
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
  return factory as (input: ArrayBuffer) => Book;
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
  data: ArrayBuffer,
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

/** Fetch the archive bytes with cancellation (fast article switching). */
export async function fetchEpubArchive(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new EpubOpenError("network", "the book request failed");
  }
  if (!res.ok) throw new EpubOpenError("network", `HTTP ${res.status}`);
  try {
    return await res.arrayBuffer();
  } catch {
    throw new EpubOpenError("network", "the book body could not be read");
  }
}