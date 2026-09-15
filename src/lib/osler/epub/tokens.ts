/**
 * EPUB module tokens — every shared magic value for the book reader.
 *
 * Tokenized so the reader, the chapter menu, and the persistence helpers can
 * never drift apart (module layout follows `@/lib/osler/pdf`: tokens →
 * stateless helpers → per-feature engines).
 */

/** Rendition theme name registered on `rendition.themes`. */
export const EPUB_THEME = "osler";

/** Key used by the injected layout stylesheet (`contents.addStylesheetRules`). */
export const EPUB_LAYOUT_KEY = "osler-layout";

/** CSS class epubjs stamps on every highlight rect (used for click handling). */
export const EPUB_HIGHLIGHT_CLASS = "osler-epub-hl";

/** Setting-store prefixes — per book: reading position and saved highlights. */
export const EPUB_PROGRESS_PREFIX = "epub-progress:";
export const EPUB_HIGHLIGHTS_PREFIX = "epub-highlights:";

/** Languages read right-to-left (BCP-47 primary subtags). */
export const EPUB_RTL_LANGS = new Set(["ar", "he", "fa", "ur", "ps", "yi"]);

/** Highlight rect opacity. Pastel fills read on both the light and the dark
 *  app background, so a highlight keeps working when the theme flips. */
export const EPUB_HIGHLIGHT_OPACITY = "0.35";

/** Caps on synced highlight payloads (untrusted: they ride the cloud blob). */
export const EPUB_HIGHLIGHT_LIMIT = 500;
export const EPUB_HIGHLIGHT_TEXT_LIMIT = 2000;

/** A stage smaller than this hasn't been laid out yet. epubjs sizes its
 *  views from `getBoundingClientRect()` at attach time, so opening a book
 *  into a zero-height stage renders an invisible, unreachable book and the
 *  reader looks stuck behind its loader. */
export const EPUB_MIN_STAGE_PX = 8;

/** Animation frames to wait for a laid-out stage before giving up waiting. */
export const EPUB_LAYOUT_MAX_FRAMES = 60;

/** How long the (lazy) table-of-contents parse may take before the reader
 *  renders the usable spine-derived chapter list instead. Pathological NCX
 *  files can otherwise leave the chapter menu spinning forever. */
export const EPUB_CHAPTERS_TIMEOUT_MS = 6000;

/** Ceiling on the first section render. A display that never settles would
 *  otherwise leave the reader behind its loader forever; on timeout the
 *  reader asks epubjs for the opening page again (which also unblocks its
 *  render queue). */
export const EPUB_DISPLAY_TIMEOUT_MS = 8000;

/** Ceiling on waiting for the rendition stage to be laid out before the
 *  first `display()` anyway — the display itself re-checks geometry, so a
 *  late-resizing stage only risks a wasted render, never a stuck loader. */
export const EPUB_STAGE_TIMEOUT_MS = 4000;

/** Minimum gap between reading-position writes. `relocated` fires on every
 *  scroll, and each write touches the synced settings store, so positions are
 *  persisted at most this often — with a forced write on close. */
export const EPUB_PROGRESS_WRITE_INTERVAL_MS = 1500;

/**
 * Rendition options — continuous scroll across the whole book.
 *
 * `manager: "continuous"` is what makes reading *chunked*: epubjs renders only
 * the sections in view (± 500px) and destroys the rest as you scroll, so a
 * 900-section book never holds 900 iframes. `flow: "scrolled-doc"` keeps each
 * section one long scrolling document rather than a slide per page (which is
 * what makes the `.epub-container` the single scroll viewport).
 */
export const EPUB_RENDITION_OPTIONS = {
  flow: "scrolled-doc",
  manager: "continuous",
  allowScriptedContent: false,
} as const;
