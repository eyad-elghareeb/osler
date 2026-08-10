/**
 * Osler UI language metadata.
 *
 * Each entry describes one supported UI language. To add a new language:
 *   1. Create `src/lib/osler/i18n/<code>.ts` exporting a `const <code> = { ... }`
 *      that mirrors the shape of `en.ts` (every key in `en.ts` must be present).
 *   2. Add an entry to `LANGUAGES` below.
 *   3. Import + register it in `src/lib/osler/i18n/index.ts` (one import, one line in STRINGS).
 *
 * That's it — the Settings → Language selector and the content-language filter
 * both derive their options from `LANGUAGES`, so no other file needs editing.
 *
 * Optional: add a `settings.language.contentLang<Code>` key to `en.ts` and
 * `ar.ts` for a custom content-filter label. If absent, the filter falls back
 * to the generic `settings.language.contentLangOnly` template with the
 * language's English name interpolated.
 *
 * `UiLang` is derived from `LANGUAGES`, so adding the metadata entry is what
 * makes TypeScript accept the new code as a valid `UiLang`.
 */

export interface LangMeta {
  code: string;
  /** English name of the language (used as a stable label in selectors). */
  name: string;
  /** Endonym — how the language writes its own name. */
  nativeName: string;
  dir: "ltr" | "rtl";
  /** BCP-47 tag for <html lang=...> */
  bcp47: string;
}

export const LANGUAGES = {
  en: {
    code: "en",
    name: "English",
    nativeName: "English",
    dir: "ltr",
    bcp47: "en",
  },
  ar: {
    code: "ar",
    name: "Arabic",
    nativeName: "العربية",
    dir: "rtl",
    bcp47: "ar",
  },
} as const satisfies Record<string, LangMeta>;

export type UiLang = keyof typeof LANGUAGES;

export const UI_LANGS: UiLang[] = Object.keys(LANGUAGES) as UiLang[];

export const DEFAULT_UI_LANG: UiLang = "en";

export const UI_LANG_STORAGE_KEY = "osler-ui-lang";

/** Content language filter — `all` means "show content in any language". */
export type ContentLangFilter = "all" | UiLang;
export const CONTENT_LANG_STORAGE_KEY = "osler-content-lang-filter";
export const DEFAULT_CONTENT_LANG_FILTER: ContentLangFilter = "all";
