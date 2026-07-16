"use client";

import * as React from "react";
import {
  type UiLang,
  type ContentLangFilter,
  type StringKey,
  LANGUAGES,
  DEFAULT_UI_LANG,
  DEFAULT_CONTENT_LANG_FILTER,
  loadUiLang,
  saveUiLang,
  loadContentLangFilter,
  saveContentLangFilter,
  translate,
  translateList,
  isRtl,
  dirFor,
} from "@/lib/osler/i18n";
import { loadConfig, getConfig, getSiteName, getSiteTagline } from "@/lib/osler/config";

interface I18nContextValue {
  /** Current UI language. */
  lang: UiLang;
  /** Current content-language filter. */
  contentFilter: ContentLangFilter;
  /** "rtl" when lang is Arabic, else "ltr". */
  dir: "ltr" | "rtl";
  /** Convenience boolean. */
  rtl: boolean;
  /** Translation function with optional {name} interpolation. */
  t: (key: StringKey, params?: Record<string, string | number>) => string;
  /** Translation helper for list-valued keys (e.g. tips). */
  tList: (key: StringKey) => string[];
  /** Switch UI language; persists to localStorage and updates <html lang/dir>. */
  setLang: (lang: UiLang) => void;
  /** Switch content-language filter; persists to localStorage. */
  setContentFilter: (v: ContentLangFilter) => void;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

export function OslerI18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<UiLang>(DEFAULT_UI_LANG);
  const [contentFilter, setContentFilterState] = React.useState<ContentLangFilter>(
    DEFAULT_CONTENT_LANG_FILTER,
  );
  // Whether the osler.config has been loaded — used to force a re-render of
  // any consumer that reads site name / tagline via t("app.name") etc.
  const [, setConfigVersion] = React.useState(0);

  // Hydrate from localStorage on mount.
  React.useEffect(() => {
    setLangState(loadUiLang());
    setContentFilterState(loadContentLangFilter());
  }, []);

  // Load osler.config.json on mount so the brand mark / tagline reflect the
  // user's customisation. We bump a version counter to force consumers to
  // re-render with the new site name.
  React.useEffect(() => {
    let cancelled = false;
    loadConfig().then(() => {
      if (!cancelled) setConfigVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Whenever lang changes, apply to <html> and persist.
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    html.setAttribute("lang", LANGUAGES[lang].bcp47);
    html.setAttribute("dir", dirFor(lang));
    if (lang === "ar") html.classList.add("osler-ar");
    else html.classList.remove("osler-ar");
  }, [lang]);

  const setLang = React.useCallback((next: UiLang) => {
    setLangState(next);
    saveUiLang(next);
  }, []);

  const setContentFilter = React.useCallback((next: ContentLangFilter) => {
    setContentFilterState(next);
    saveContentLangFilter(next);
  }, []);

  const t = React.useCallback(
    (key: StringKey, params?: Record<string, string | number>) => {
      // Overlay config-driven site identity on the i18n keys. The user can
      // customise the site name in osler.config.json without touching i18n.
      if (key === "app.name") return getSiteName() || translate(lang, key, params);
      if (key === "app.tagline") return getSiteTagline() || translate(lang, key, params);
      return translate(lang, key, params);
    },
    [lang],
  );
  const tList = React.useCallback((key: StringKey) => translateList(lang, key), [lang]);

  const value = React.useMemo<I18nContextValue>(
    () => ({
      lang,
      contentFilter,
      dir: dirFor(lang),
      rtl: isRtl(lang),
      t,
      tList,
      setLang,
      setContentFilter,
    }),
    [lang, contentFilter, t, tList, setLang, setContentFilter],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) {
    // Fall back to a no-op default so components rendered outside the provider
    // (e.g. during SSR or in tests) don't crash.
    return {
      lang: DEFAULT_UI_LANG,
      contentFilter: DEFAULT_CONTENT_LANG_FILTER,
      dir: "ltr",
      rtl: false,
      t: (k) => {
        // Same overlay as above — so SSR / pre-provider renders also see the
        // config-driven site name when available.
        if (k === "app.name") {
          try {
            return getSiteName() || (k as string);
          } catch {
            return k as string;
          }
        }
        if (k === "app.tagline") {
          try {
            return getSiteTagline() || (k as string);
          } catch {
            return k as string;
          }
        }
        return k as string;
      },
      tList: () => [],
      setLang: () => {},
      setContentFilter: () => {},
    };
  }
  return ctx;
}

// Re-export config helpers for consumers that need direct access without
// going through the i18n layer.
export { getConfig, loadConfig };
