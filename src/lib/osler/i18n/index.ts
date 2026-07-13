/**
 * Osler i18n — UI translation + RTL helpers.
 *
 * This is the single public import surface for i18n. Existing imports from
 * `@/lib/osler/i18n` continue to work unchanged.
 *
 * Languages live in their own files:
 *   - `./languages.ts`  → metadata (LANGUAGES, UiLang, UI_LANGS, storage keys, dir helpers)
 *   - `./en.ts`         → English dictionary
 *   - `./ar.ts`         → Arabic dictionary
 *
 * To add a new language (e.g. `es`):
 *   1. Create `./es.ts` exporting `export const es = { ... } as const;`
 *      (mirror the keys in `en.ts`).
 *   2. Add `es` to `LANGUAGES` in `./languages.ts`.
 *   3. Import it here and add it to the `STRINGS` map below.
 *   4. Update the `LANG_INIT_SCRIPT` switch in this file if you want the
 *      pre-hydration script to honor it (one-line addition).
 *
 * Design choices preserved from the original i18n.ts:
 *  - The UI language and the *content* language are decoupled. A user can
 *    pick Arabic UI to navigate the chrome in Arabic while still reading
 *    English articles and quizzes; conversely an English UI user can open
 *    an Arabic content pack and the article/quiz will render RTL inside an
 *    English shell.
 *  - Each content pack (quiz / article / flashcard / OSCE) declares its own
 *    `lang` on its manifest node and/or its `ContentMeta`. The renderer is
 *    responsible for wrapping the content body in a `dir`/`lang` container.
 *  - The dictionary is a flat key→record map so missing keys fall back to
 *    English without crashing.
 */

import { en } from "./en";
import { ar } from "./ar";
// To add a language: import it here.
// import { es } from "./es";

import {
  type UiLang,
  type LangMeta,
  type ContentLangFilter,
  LANGUAGES,
  UI_LANGS,
  DEFAULT_UI_LANG,
  UI_LANG_STORAGE_KEY,
  CONTENT_LANG_STORAGE_KEY,
  DEFAULT_CONTENT_LANG_FILTER,
} from "./languages";

export {
  UiLang,
  LangMeta,
  ContentLangFilter,
  LANGUAGES,
  UI_LANGS,
  DEFAULT_UI_LANG,
  UI_LANG_STORAGE_KEY,
  CONTENT_LANG_STORAGE_KEY,
  DEFAULT_CONTENT_LANG_FILTER,
};

/* ─────────────────────────── Dictionary ──────────────────────────────── */

/**
 * The combined string dictionary. Each value is a flat key→string (or
 * key→string[]) map. To add a language, import its file above and add it
 * here — `UiLang` is derived from `LANGUAGES`, so TypeScript will tell you
 * if you forget.
 */
export const STRINGS = {
  en,
  ar,
  // es,  // ← uncomment after creating ./es.ts
} as const;

export type StringKey = keyof (typeof STRINGS)["en"];

/* ─────────────────────────── Translate ───────────────────────────────── */

/** Translate a key for the given UI language, with `{name}` placeholder interpolation. */
export function translate(
  lang: UiLang,
  key: StringKey,
  params?: Record<string, string | number>,
): string {
  const table = STRINGS[lang] as unknown as Record<string, string | string[]>;
  const fallback = STRINGS.en as unknown as Record<string, string | string[]>;
  let value = (table[key] ?? fallback[key] ?? key) as string;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return value;
}

/** Get a list value (used for the keyboard-shortcut tips list). */
export function translateList(lang: UiLang, key: StringKey): string[] {
  const table = STRINGS[lang] as unknown as Record<string, string | string[]>;
  const fallback = STRINGS.en as unknown as Record<string, string | string[]>;
  const value = table[key] ?? fallback[key];
  return Array.isArray(value) ? value : [];
}

/* ─────────────────────────── Storage helpers ────────────────────────── */

export function loadUiLang(): UiLang {
  if (typeof window === "undefined") return DEFAULT_UI_LANG;
  const v = localStorage.getItem(UI_LANG_STORAGE_KEY);
  return (v && v in LANGUAGES ? v : DEFAULT_UI_LANG) as UiLang;
}

export function saveUiLang(lang: UiLang): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(UI_LANG_STORAGE_KEY, lang);
}

export function loadContentLangFilter(): ContentLangFilter {
  if (typeof window === "undefined") return DEFAULT_CONTENT_LANG_FILTER;
  const v = localStorage.getItem(CONTENT_LANG_STORAGE_KEY);
  return v && v in LANGUAGES ? (v as ContentLangFilter) : DEFAULT_CONTENT_LANG_FILTER;
}

export function saveContentLangFilter(v: ContentLangFilter): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONTENT_LANG_STORAGE_KEY, v);
}

/* ─────────────────────────── Direction helpers ──────────────────────── */

export function dirFor(lang: UiLang): "ltr" | "rtl" {
  return LANGUAGES[lang].dir;
}

export function isRtl(lang: UiLang): boolean {
  return LANGUAGES[lang].dir === "rtl";
}

/**
 * Inline script that runs before React hydration to set <html lang> and <html dir>
 * from localStorage. Prevents a flash of LTR when the user previously picked Arabic.
 *
 * The language list is derived from `LANGUAGES` at module-eval time so adding a
 * new language only requires editing `languages.ts` — the script below already
 * accepts any registered code.
 */
const ALLOWED_LANGS = Object.keys(LANGUAGES).join("|");
const RTL_LANGS = Object.values(LANGUAGES)
  .filter((m) => m.dir === "rtl")
  .map((m) => m.code)
  .join("|");

export const LANG_INIT_SCRIPT = `
(function(){try{
  var v=localStorage.getItem('${UI_LANG_STORAGE_KEY}');
  var lang=(v && (${ALLOWED_LANGS ? `/${ALLOWED_LANGS}/.test(v)` : "false"}))?v:'${DEFAULT_UI_LANG}';
  var dir=/${RTL_LANGS}/.test(lang)?'rtl':'ltr';
  var html=document.documentElement;
  html.setAttribute('lang',lang);
  html.setAttribute('dir',dir);
  if(dir==='rtl'){html.classList.add('osler-ar');}else{html.classList.remove('osler-ar');}
}catch(e){}})();
`.trim();
