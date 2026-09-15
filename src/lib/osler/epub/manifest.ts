/**
 * EPUB chapter (manifest) support — turns a book into a flat, navigable
 * chapter list.
 *
 * Two sources, in order of preference:
 *   1. the navigation document — EPUB3 `nav` or EPUB2 NCX — parsed by epubjs
 *      into `book.loaded.navigation.toc`;
 *   2. the OPF spine itself, when the book ships no usable navigation (a
 *      surprisingly common failure: NCX pointing at missing files, empty
 *      `nav`, or a manifest with no nav entry at all).
 *
 * Every entry carries its spine index, so "which chapter am I in?" can be
 * answered by the current section index even when the TOC hrefs don't match
 * the spine hrefs (fragment-only anchors, renamed files, …).
 */

import type { Book, NavItem } from "epubjs";
import type { EpubTocEntry } from "./types";

/** Max nesting kept for display; deeper levels flatten onto this one. */
const MAX_DEPTH = 4;

/** Section href used for matching — fragment-free, no leading `./` or `/`. */
export function normalizeHref(href: string): string {
  return href.split("#")[0].replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Human label derived from a section filename ("ch-03_body.xhtml" →
 *  "Ch 03 Body"). Returns "" when the name carries no letters, so the caller
 *  can fall back to a localized "Section {n}". */
export function prettifySectionLabel(href: string): string {
  const file = normalizeHref(href).split("/").pop() ?? "";
  let name = file.replace(/\.x?html?$/i, "");
  try {
    name = decodeURIComponent(name);
  } catch {
    // Malformed percent-encoding — keep the raw name.
  }
  name = name.replace(/[-_+.]+/g, " ").replace(/\s+/g, " ").trim();
  if (!/[a-z\u00c0-\u024f\u0600-\u06ff]/i.test(name)) return "";
  return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

interface SpineLike {
  href?: string;
  index?: number;
  linear?: boolean;
}

function spineItems(book: Book): SpineLike[] {
  const items = (book.spine as unknown as { spineItems?: SpineLike[] } | undefined)?.spineItems;
  return Array.isArray(items) ? items : [];
}

/** Spine index an href points at, or -1 when it can't be resolved. */
function resolveSectionIndex(book: Book, href: string): number {
  if (!href) return -1;
  for (const candidate of [href, normalizeHref(href)]) {
    try {
      const section = book.spine?.get(candidate) as { index?: number } | undefined;
      if (section && typeof section.index === "number") return section.index;
    } catch {
      // Unresolvable target — try the next candidate.
    }
  }
  return -1;
}

function flattenNav(book: Book, items: NavItem[] | undefined, depth: number, out: EpubTocEntry[]): void {
  if (!items) return;
  for (const item of items) {
    const href = typeof item?.href === "string" ? item.href : "";
    if (href) {
      const label = typeof item.label === "string" ? item.label.trim() : "";
      out.push({
        label: label || prettifySectionLabel(href) || href,
        href,
        depth: Math.min(depth, MAX_DEPTH),
        index: resolveSectionIndex(book, href),
      });
    }
    flattenNav(book, item?.subitems, depth + 1, out);
  }
}

/** Chapters from the navigation document (EPUB3 nav / EPUB2 NCX). */
export function chaptersFromNav(book: Book, toc: NavItem[] | undefined): EpubTocEntry[] {
  const out: EpubTocEntry[] = [];
  flattenNav(book, toc, 0, out);
  return out;
}

/**
 * Chapters derived from the OPF spine — the manifest fallback for books with
 * no navigation document. `label` produces the localized "Section {n}" used
 * when a filename carries no readable words.
 */
export function chaptersFromSpine(book: Book, label: (n: number) => string): EpubTocEntry[] {
  const out: EpubTocEntry[] = [];
  let n = 0;
  for (const item of spineItems(book)) {
    if (item.linear === false) continue;
    const href = typeof item.href === "string" ? item.href : "";
    if (!href) continue;
    n += 1;
    out.push({
      label: prettifySectionLabel(href) || label(n),
      href,
      depth: 0,
      index: typeof item.index === "number" ? item.index : -1,
    });
  }
  return out;
}

/**
 * Index of the chapter the reader is currently inside, or -1.
 *
 * Href match first (exact position), then the closest chapter that starts at
 * or before the current spine index — so a TOC that skips sections (or one
 * whose hrefs don't line up with the spine) still tracks the right chapter.
 */
export function activeChapterIndex(
  chapters: EpubTocEntry[],
  href: string,
  spineIndex: number,
): number {
  if (!chapters.length) return -1;
  const target = normalizeHref(href);
  if (target) {
    const exact = chapters.findIndex((entry) => normalizeHref(entry.href) === target);
    if (exact >= 0) return exact;
  }
  let best = -1;
  let bestIndex = -1;
  chapters.forEach((entry, i) => {
    if (entry.index < 0 || entry.index > spineIndex) return;
    if (entry.index >= bestIndex) {
      bestIndex = entry.index;
      best = i;
    }
  });
  return best;
}
