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

  // Hydrate from localStorage on mount.
  React.useEffect(() => {
    setLangState(loadUiLang());
    setContentFilterState(loadContentLangFilter());
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
    (key: StringKey, params?: Record<string, string | number>) =>
      translate(lang, key, params),
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
      t: (k) => k as string,
      tList: () => [],
      setLang: () => {},
      setContentFilter: () => {},
    };
  }
  return ctx;
}
