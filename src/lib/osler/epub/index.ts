/**
 * EPUB module — the single public surface for the library book reader.
 *
 * Layout mirrors `@/lib/osler/pdf/`: `tokens` (shared magic values) →
 * `types` (contracts) → stateless helpers (`manifest`, `theme`) →
 * persistence (`highlights`) → the archive engine (`open`). Callers import
 * from this barrel only; the internals are free to move.
 *
 * The barrel stays free of static `epubjs` imports — `open.ts` dynamic-imports
 * the engine, so the book reader's heavy dependency is fetched on first open.
 */

export { fetchEpubArchive, openEpubBook } from "./open";

export {
  createEpubHighlight,
  dropEpubHighlight,
  epubProgressKey,
  loadEpubHighlights,
  parseEpubHighlights,
  saveEpubHighlights,
  upsertEpubHighlight,
} from "./highlights";

export {
  activeChapterIndex,
  chaptersFromNav,
  chaptersFromSpine,
  normalizeHref,
  prettifySectionLabel,
} from "./manifest";

export { buildLayoutRules, buildThemeRules, epubHighlightStyles, readThemePalette } from "./theme";

export type { EpubThemePalette } from "./theme";

export {
  EPUB_CHAPTERS_TIMEOUT_MS,
  EPUB_DISPLAY_TIMEOUT_MS,
  EPUB_STAGE_TIMEOUT_MS,
  EPUB_HIGHLIGHT_CLASS,
  EPUB_HIGHLIGHT_LIMIT,
  EPUB_HIGHLIGHT_OPACITY,
  EPUB_HIGHLIGHT_TEXT_LIMIT,
  EPUB_HIGHLIGHTS_PREFIX,
  EPUB_LAYOUT_KEY,
  EPUB_LAYOUT_MAX_FRAMES,
  EPUB_MIN_STAGE_PX,
  EPUB_PROGRESS_PREFIX,
  EPUB_PROGRESS_WRITE_INTERVAL_MS,
  EPUB_RENDITION_OPTIONS,
  EPUB_RTL_LANGS,
  EPUB_THEME,
} from "./tokens";

export { EpubOpenError } from "./types";

export type {
  EpubFailureCode,
  EpubHighlight,
  EpubHighlightControl,
  EpubMetadata,
  EpubReaderControls,
  EpubReaderLayout,
  EpubReaderState,
  EpubReaderStatus,
  EpubTocEntry,
  OpenEpubBook,
} from "./types";
