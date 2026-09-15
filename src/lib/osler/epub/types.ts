/**
 * EPUB public types — the reader's state/control contract plus the shapes the
 * format helpers exchange. `import type` only, so nothing here drags epubjs
 * (or a component) into a chunk that doesn't need it.
 */

import type { Book } from "epubjs";

export interface EpubTocEntry {
  label: string;
  /** Spine href as listed in the navigation document (with any fragment). */
  href: string;
  /** Nesting level in the source TOC (0 = top level, capped for display). */
  depth: number;
  /** Spine index this entry points at (-1 when it can't be resolved). */
  index: number;
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

/** One saved highlight, addressed by CFI range so it survives reflow. */
export interface EpubHighlight {
  id: string;
  cfi: string;
  text: string;
  /** Palette key (`HighlightColorKey`) or a legacy hex value. */
  color: string;
  createdAt: string;
}

/** Why an archive could not be opened — mapped to localized copy by the UI. */
export type EpubFailureCode = "engine" | "invalid" | "empty" | "network";

export class EpubOpenError extends Error {
  constructor(
    readonly code: EpubFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "EpubOpenError";
  }
}

export interface OpenEpubBook {
  book: Book;
  metadata: EpubMetadata;
  /** Number of spine items — drives the reading-progress fraction. */
  spineLength: number;
  /**
   * Lazily built chapter list: the navigation document (EPUB3 nav / EPUB2
   * NCX) when it exists, otherwise chapters derived from the OPF spine. Only
   * called after the book's first page is on screen, so a heavy NCX never
   * delays first paint.
   */
  loadChapters: () => Promise<EpubTocEntry[]>;
  destroy: () => void;
}

export type EpubReaderStatus = "loading" | "ready" | "error";

/** Highlight controls — structurally compatible with `HighlighterControl`,
 *  so `<HighlighterToolbar control={state.highlight} />` just works. */
export interface EpubHighlightControl {
  /** null = off, "eraser" = erase tool, otherwise a color key. */
  tool: string | null;
  color: string;
  count: number;
  onToolChange: (tool: string | null) => void;
  onColorChange: (color: string) => void;
  onClearAll: () => void;
}

/**
 * Everything the host needs to render reader chrome. Deliberately *cold*:
 * the hot field (reading percentage) stays inside the reader's own progress
 * hairline so scrolling never re-renders the host view.
 */
export interface EpubReaderState {
  status: EpubReaderStatus;
  error: EpubFailureCode | null;
  title: string;
  creator: string;
  coverUrl: string | null;
  dir: "ltr" | "rtl";
  spineLength: number;
  /** Spine index of the section currently on screen. */
  index: number;
  /** Href of the section currently on screen. */
  href: string;
  /** Localized "Chapter 3 of 12" / TOC label for the current position. */
  chapterLabel: string;
  atStart: boolean;
  atEnd: boolean;
  chapters: EpubTocEntry[];
  chaptersLoading: boolean;
  highlight: EpubHighlightControl;
}

/** Imperative controls handed to the host (top bar / footer buttons). */
export interface EpubReaderControls {
  prev: () => void;
  next: () => void;
  goto: (href: string) => void;
}

/** Typography the rendition inherits from the library display prefs. */
export interface EpubReaderLayout {
  /** Base font size in px. */
  fontSize: number;
  /** Line-height multiplier. */
  lineHeight: number;
  /** Content max width in px. */
  maxWidth: number;
  /** Optional font stack override (library sans mode); serif default. */
  fontFamily?: string;
}
