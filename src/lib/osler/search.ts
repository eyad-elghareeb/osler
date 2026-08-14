/**
 * Osler global search — unified search across every content type and the
 * settings/navigation surface.
 *
 * Sources:
 *   - Articles        → from `@/lib/osler/articles` (markdown library)
 *   - Question packs  → from `@/lib/osler/content` tree (quiz / bank / written)
 *   - Flashcard decks → from `@/lib/osler/content` tree (flashcard)
 *   - OSCE stations   → from `@/lib/osler/content` tree (osce)
 *   - Videos          → from `@/lib/osler/videos`
 *   - Settings        → static catalog below (labels + descriptions)
 *   - Navigation      → static catalog of top-level views
 *
 * The async loader is cached — repeat calls during a session are cheap.
 * The search function itself is synchronous and case-insensitive, matching
 * against a precomputed haystack per item so we don't recompute it on every
 * keystroke.
 */

import { listAllArticles, type ArticleMeta } from "@/lib/osler/articles";
import { loadContentForTypes, ENGINE_META } from "@/lib/osler/content";
import { loadConfig, enabledEngines } from "@/lib/osler/config";
import { listAllVideos } from "@/lib/osler/videos";
import { countQuestions } from "@/lib/osler/qbank-pool";
import type {
  AnyContent,
  ContentTreeNode,
  EngineType,
} from "@/lib/osler/types";
import type { UiLang, StringKey } from "@/lib/osler/i18n";

/* ───────────────────────── Result types ──────────────────────────────── */

export type SearchKind =
  | "article"
  | "qbank"
  | "flashcard"
  | "osce"
  | "video"
  | "setting"
  | "nav";

export interface SearchResult {
  kind: SearchKind;
  /** Stable identifier for keyboard navigation / React keys. */
  id: string;
  /** Primary title shown in the result row. */
  title: string;
  /** Secondary line (subtitle / specialty / description). */
  subtitle?: string;
  /** A short optional tag like "Cardiology · 5 min read". */
  meta?: string;
  /** Payload used by the consumer to dispatch navigation. */
  payload:
    | { type: "article"; file: string }
    | { type: "pack"; uid: string; engine: EngineType }
    | { type: "video"; id: string; nodeUid: string }
    | { type: "setting"; section: string }
    | { type: "nav"; view: string };
  /** Pre-computed lowercase haystack — used by `searchAll`. */
  _haystack: string;
}

/* ───────────────────────── Static catalogs ───────────────────────────── */

export interface NavCatalogItem {
  view: string;
  labelKey: StringKey;
  /** English keywords for matching, joined into the haystack. */
  keywords: string;
}

export const NAV_CATALOG: NavCatalogItem[] = [
  { view: "dashboard", labelKey: "nav.dashboard", keywords: "dashboard home overview" },
  { view: "qbank", labelKey: "nav.qbank", keywords: "qbank quiz question bank test exam" },
  { view: "learn", labelKey: "nav.learn", keywords: "learn hub study" },
  { view: "library", labelKey: "nav.library", keywords: "library articles reference notes" },
  { view: "flashcards", labelKey: "nav.flashcards", keywords: "flashcards decks spaced repetition" },
  { view: "osce", labelKey: "nav.osce", keywords: "osce clinical skills stations exam" },
  { view: "videos", labelKey: "nav.videos", keywords: "videos lectures player" },
  { view: "profile", labelKey: "nav.profile", keywords: "profile account stats" },
  { view: "settings", labelKey: "nav.settings", keywords: "settings preferences configuration" },
];

export interface SettingCatalogItem {
  section: string;
  /** i18n key for the section label. */
  labelKey: StringKey;
  /** i18n key for a short description (falls back gracefully if missing). */
  descKey?: StringKey;
  /** English keywords for matching. */
  keywords: string;
}

export const SETTINGS_CATALOG: SettingCatalogItem[] = [
  { section: "language", labelKey: "settings.section.language", keywords: "language arabic english rtl ui direction locale" },
  { section: "ai", labelKey: "settings.section.ai", keywords: "ai assistant gemini api key model osce voice" },
  { section: "shortcuts", labelKey: "settings.section.shortcuts", keywords: "keyboard shortcuts hotkeys bindings" },
  { section: "downloads", labelKey: "settings.section.downloads", keywords: "downloads offline cache storage service worker" },
  { section: "sync", labelKey: "settings.section.sync", keywords: "sync peer webrtc qr sync devices" },
  { section: "native", labelKey: "settings.section.native", keywords: "native haptics biometric fingerprint view transitions wake lock network" },
  { section: "backup", labelKey: "settings.section.backup", keywords: "backup restore export import file" },
  { section: "danger", labelKey: "settings.section.danger", keywords: "danger reset clear data delete wipe progress" },
];

/* ───────────────────────── Index loader ──────────────────────────────── */

let indexCache: SearchResult[] | null = null;
let indexPromise: Promise<SearchResult[]> | null = null;

async function buildIndex(): Promise<SearchResult[]> {
  const out: SearchResult[] = [];

  // Articles
  try {
    const articles = await listAllArticles();
    for (const a of articles) {
      out.push(articleResult(a));
    }
  } catch {
    // ignore — search just yields fewer articles
  }

  // Content packs (quiz / bank / written / flashcard / osce) — scoped to the
  // enabled engines; this runs lazily when the search index is first built.
  try {
    await loadConfig();
    const { items } = await loadContentForTypes(enabledEngines().filter((t) => t !== "library"));
    for (const { node, content } of items) {
      const r = packResult(node, content);
      if (r) out.push(r);
    }
  } catch {
    // ignore
  }

  // Videos
  try {
    const videos = await listAllVideos();
    for (const v of videos) {
      out.push({
        kind: "video",
        id: `video:${v.id}`,
        title: v.title,
        subtitle: v.specialty,
        meta: [v.topic, v.instructor].filter(Boolean).join(" · "),
        payload: { type: "video", id: v.id, nodeUid: v.nodeUid },
        _haystack: `${v.title} ${v.specialty ?? ""} ${v.topic ?? ""} ${v.instructor ?? ""} ${(v.tags ?? []).join(" ")} ${v.description ?? ""} video`.toLowerCase(),
      });
    }
  } catch {
    // ignore
  }

  // Settings — pure metadata, no async work.
  for (const s of SETTINGS_CATALOG) {
    out.push({
      kind: "setting",
      id: `setting:${s.section}`,
      title: s.section, // the panel translates the label key live
      subtitle: s.keywords,
      payload: { type: "setting", section: s.section },
      _haystack: `${s.section} ${s.keywords} setting`.toLowerCase(),
    });
  }

  // Navigation
  for (const n of NAV_CATALOG) {
    out.push({
      kind: "nav",
      id: `nav:${n.view}`,
      title: n.view,
      subtitle: n.keywords,
      payload: { type: "nav", view: n.view },
      _haystack: `${n.view} ${n.keywords} navigate go`.toLowerCase(),
    });
  }

  return out;
}

function articleResult(a: ArticleMeta): SearchResult {
  const meta = [a.specialty, a.system, a.readTimeMin ? `${a.readTimeMin} min` : ""]
    .filter(Boolean)
    .join(" · ");
  return {
    kind: "article",
    id: `article:${a.file}`,
    title: a.title,
    subtitle: a.specialty,
    meta,
    payload: { type: "article", file: a.file },
    _haystack: `${a.title} ${a.specialty ?? ""} ${a.system ?? ""} ${(a.tags ?? []).join(" ")} article`.toLowerCase(),
  };
}

function packResult(
  node: ContentTreeNode,
  content: AnyContent | null,
): SearchResult | null {
  if (!content) return null;
  const engine = content.type as EngineType;
  // Branch nodes (no files) aren't openable directly — skip.
  if ((node.files ?? []).length === 0 && node.items.length > 0) return null;
  const meta = ENGINE_META[engine];
  const cardCount =
    content.type === "flashcard" ? content.cards.length :
    content.type === "quiz" ? content.questions.length :
    content.type === "bank" ? countQuestions(content) :
    content.type === "written" ? content.prompts.length :
    content.type === "osce" ? content.stations.length :
    content.type === "video" ? content.videos.length : 0;
  return {
    kind: engine === "flashcard" ? "flashcard" :
          engine === "osce" ? "osce" :
          engine === "video" ? "video" : "qbank",
    id: `pack:${node.uid}`,
    title: node.title,
    subtitle: node.description ?? meta?.label,
    meta: `${meta?.singular ?? engine} · ${cardCount} item${cardCount === 1 ? "" : "s"}`,
    payload: { type: "pack", uid: node.uid, engine },
    _haystack: `${node.title} ${node.description ?? ""} ${meta?.label ?? ""} ${engine} pack`.toLowerCase(),
  };
}

/**
 * Load (and cache) the global search index. Safe to call repeatedly.
 * Returns the full list of searchable items — call `searchAll` to filter.
 */
export function loadSearchIndex(): Promise<SearchResult[]> {
  if (indexCache) return Promise.resolve(indexCache);
  if (indexPromise) return indexPromise;
  indexPromise = buildIndex().then((idx) => {
    indexCache = idx;
    indexPromise = null;
    return idx;
  });
  return indexPromise;
}

/**
 * Clear the cached index — call after content refresh so the next search
 * re-reads the manifests.
 */
export function clearSearchIndex(): void {
  indexCache = null;
  indexPromise = null;
}

/* ───────────────────────── Search ────────────────────────────────────── */

/**
 * Synchronous filter over the (already-loaded) index.
 *
 * Matching rules:
 *  - Empty query returns an empty array (callers show the "start typing"
 *    placeholder instead of a giant list).
 *  - Otherwise every whitespace-separated token must appear somewhere in
 *    the item's haystack. This gives AND-style multi-word search.
 *  - Results are sorted: title-prefix matches first, then title-contains,
 *    then everything else. Within a tier, shorter titles rank higher.
 */
export function searchAll(index: SearchResult[], query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const scored: Array<{ r: SearchResult; score: number }> = [];
  for (const r of index) {
    const hay = r._haystack;
    if (!tokens.every((t) => hay.includes(t))) continue;
    const title = r.title.toLowerCase();
    let score = 0;
    if (title.startsWith(q)) score += 100;
    else if (title.includes(q)) score += 50;
    // Token-level title match (helps multi-word queries).
    for (const t of tokens) {
      if (title.startsWith(t)) score += 10;
      else if (title.includes(t)) score += 4;
    }
    // Shorter titles rank higher when scores tie (more specific match).
    score -= r.title.length / 1000;
    scored.push({ r, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.r);
}

/**
 * Group results by kind, preserving the score-based order within each group.
 * The group order matches `SEARCH_GROUP_ORDER` so the UI renders a stable
 * layout regardless of which kinds happen to have matches.
 */
export const SEARCH_GROUP_ORDER: SearchKind[] = [
  "nav",
  "article",
  "qbank",
  "flashcard",
  "osce",
  "video",
  "setting",
];

export function groupResults(results: SearchResult[]): Array<{ kind: SearchKind; items: SearchResult[] }> {
  const groups: Record<SearchKind, SearchResult[]> = {
    nav: [],
    article: [],
    qbank: [],
    flashcard: [],
    osce: [],
    video: [],
    setting: [],
  };
  for (const r of results) groups[r.kind].push(r);
  return SEARCH_GROUP_ORDER
    .map((kind) => ({ kind, items: groups[kind] }))
    .filter((g) => g.items.length > 0);
}

/* ───────────────────────── i18n helpers ──────────────────────────────── */

export const SEARCH_GROUP_LABEL_KEY: Record<SearchKind, StringKey> = {
  article: "search.group.articles",
  qbank: "search.group.qbank",
  flashcard: "search.group.flashcards",
  osce: "search.group.osce",
  video: "search.group.videos",
  setting: "search.group.settings",
  nav: "search.group.navigation",
};

/* ───────────────────── View-aware filtering ────────────────────────── */

/** Which SearchKinds are relevant for each OslerView. */
const VIEW_KINDS: Record<string, SearchKind[]> = {
  dashboard: ["article", "qbank", "flashcard", "osce", "video", "setting", "nav"],
  learn:     ["article", "qbank", "flashcard", "osce", "video", "nav"],
  library:   ["article", "nav"],
  qbank:     ["qbank", "nav"],
  flashcards:["flashcard", "nav"],
  osce:      ["osce", "nav"],
  videos:    ["video", "nav"],
  profile:   ["nav", "setting"],
  settings:  ["setting", "nav"],
};

/** Placeholder i18n key for each view's search input. */
export const VIEW_PLACEHOLDER_KEY: Record<string, string> = {
  dashboard:  "search.globalPlaceholder",
  learn:      "search.placeholder.learn",
  library:    "search.placeholder.library",
  qbank:      "search.placeholder.qbank",
  flashcards: "search.placeholder.flashcards",
  osce:       "search.placeholder.osce",
  videos:     "search.placeholder.videos",
  profile:    "search.placeholder.profile",
  settings:   "search.placeholder.settings",
};

/**
 * Filter search results to only kinds relevant to the current view.
 * Falls back to showing everything if the view is unknown.
 */
export function filterByView(
  results: SearchResult[],
  view: string | undefined,
): SearchResult[] {
  if (!view) return results;
  const kinds = VIEW_KINDS[view];
  if (!kinds) return results;
  return results.filter((r) => kinds.includes(r.kind));
}

/** Translate the static catalog titles (settings sections + nav labels). */
export function localiseResultTitle(
  r: SearchResult,
  t: (key: StringKey) => string,
  lang: UiLang,
): string {
  if (r.kind === "nav") {
    const item = NAV_CATALOG.find((n) => n.view === r.id.slice(4));
    return item ? t(item.labelKey) : r.title;
  }
  if (r.kind === "setting") {
    const item = SETTINGS_CATALOG.find((s) => s.section === r.id.slice(8));
    return item ? t(item.labelKey) : r.title;
  }
  // Articles / packs / videos have natural-language titles already.
  return r.title;
}
