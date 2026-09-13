/**
 * EPUB access for the library book reader (thin adapter over `epubjs`).
 *
 * All format work — ZIP extraction, OPF/spine parsing, NCX/nav TOC,
 * resource rewriting to blob URLs, CFI locations — is epubjs's job (the
 * standard, battle-tested EPUB library). This module only:
 *   - lazy-loads epubjs so it never enters the main bundle,
 *   - opens an archive into a `Book` plus flattened reader metadata,
 *   - owns teardown (rendition/book destroy + cover blob-URL revoke).
 *
 * Rendering, themes, link interception, and next/prev live in
 * `epub-reader.tsx`, which drives the returned `Book` through epubjs's own
 * `Rendition` API.
 */

import type { Book, NavItem } from "epubjs";

export interface EpubTocEntry {
  label: string;
  /** Spine href as listed in the TOC (fragment-free matching done by caller). */
  href: string;
  depth: number;
}

export interface EpubMetadata {
  title: string;
  creator: string;
  language: string;
  /** Reading direction for reader chrome (TOC side, prev/next icons). */
  dir: "ltr" | "rtl";
  /** Blob URL of the cover image, when the package declares one. */
  coverUrl: string | null;
}

export interface OpenEpubBook {
  book: Book;
  metadata: EpubMetadata;
  toc: EpubTocEntry[];
  /** Number of spine items — drives the reading-progress fraction. */
  spineLength: number;
  destroy: () => void;
}

/** Languages read right-to-left (BCP-47 primary subtags). */
const RTL_LANGS = new Set(["ar", "he", "fa", "ur", "ps", "yi"]);

function readingDir(language: string): "ltr" | "rtl" {
  const primary = language.trim().toLowerCase().split(/[-_]/)[0];
  return RTL_LANGS.has(primary) ? "rtl" : "ltr";
}

function flattenToc(items: NavItem[] | undefined, depth: number, out: EpubTocEntry[]): void {
  if (!items) return;
  for (const item of items) {
    if (item.href) {
      out.push({ label: (item.label ?? "").trim() || item.href, href: item.href, depth: Math.min(depth, 4) });
    }
    flattenToc(item.subitems, depth + 1, out);
  }
}

/**
 * Open an EPUB archive for reading. Throws a human-readable Error when the
 * bytes are not a usable EPUB.
 */
export async function openEpubBook(data: ArrayBuffer): Promise<OpenEpubBook> {
  let ePub: (input: ArrayBuffer) => Book;
  try {
    const mod = (await import("epubjs")) as unknown as { default?: unknown };
    // ESM build exposes the factory as `.default`; tolerate a CJS shape
    // where the module itself is the factory.
    const factory = typeof mod.default === "function" ? mod.default : mod;
    if (typeof factory !== "function") throw new Error("bad shape");
    ePub = factory as (input: ArrayBuffer) => Book;
  } catch {
    throw new Error("Not a valid EPUB: the book engine failed to load");
  }

  const book = ePub(data);
  try {
    await book.ready;
  } catch {
    try {
      book.destroy();
    } catch {
      // ignore secondary teardown failures
    }
    throw new Error("Not a valid EPUB: the archive could not be opened");
  }

  const [metadata, navigation, spine, coverUrl] = await Promise.all([
    book.loaded.metadata.catch(() => null),
    book.loaded.navigation.catch(() => null),
    book.loaded.spine.catch(() => []),
    book.coverUrl().catch(() => null),
  ]);

  const language = typeof metadata?.language === "string" ? metadata.language : "en";
  const toc: EpubTocEntry[] = [];
  flattenToc(navigation?.toc, 0, toc);

  const cover = typeof coverUrl === "string" && coverUrl ? coverUrl : null;
  return {
    book,
    metadata: {
      title: (typeof metadata?.title === "string" && metadata.title.trim()) || "Untitled",
      creator: typeof metadata?.creator === "string" ? metadata.creator.trim() : "",
      language,
      dir: readingDir(language),
      coverUrl: cover,
    },
    toc,
    spineLength: Array.isArray(spine) ? spine.length : 0,
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
