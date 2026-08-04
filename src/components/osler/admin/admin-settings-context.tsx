"use client";

/**
 * Admin settings context — persists admin-specific UI/UX preferences.
 *
 * Theme and language changes are delegated to the main app providers
 * (OslerThemeProvider / OslerI18nProvider) so the admin and main app
 * always share a single source of truth for <html> class/attr state.
 *
 * Settings exposed:
 *  - reducedMotion: boolean — disables framer-motion transitions
 *  - defaultLanding: which admin page to land on after sign-in
 *  - pageSize: how many rows to show in tables (10/25/50)
 *  - autoSaveDrafts: boolean — auto-save content drafts every N seconds
 *  - showAdvancedFields: boolean — show "advanced" metadata in editors
 *  - sidebarCollapsed: boolean — collapse the desktop sidebar
 */

import * as React from "react";
import { useOslerTheme } from "@/components/osler/theme-provider";
import { useI18n } from "@/components/osler/i18n-provider";

export type AdminLanding = "dashboard" | "content" | "review" | "audit";

export interface AdminSettings {
  reducedMotion: boolean;
  defaultLanding: AdminLanding;
  pageSize: number;
  autoSaveDrafts: boolean;
  showAdvancedFields: boolean;
  sidebarCollapsed: boolean;
}

const DEFAULT_SETTINGS: AdminSettings = {
  reducedMotion: false,
  defaultLanding: "content",
  pageSize: 25,
  autoSaveDrafts: true,
  showAdvancedFields: false,
  sidebarCollapsed: false,
};

const STORAGE_KEY = "osler-admin-settings-v1";

function loadSettings(): AdminSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    // Migrate: remove deprecated language/theme keys from old persisted data
    const { language: _, theme: __, ...rest } = parsed;
    void _;
    void __;
    return { ...DEFAULT_SETTINGS, ...rest };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: AdminSettings) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

interface AdminSettingsContextValue {
  settings: AdminSettings;
  /** Read-only: current UI language (delegated to main i18n provider). */
  language: "en" | "ar";
  /** Read-only: current theme (delegated to main theme provider). */
  theme: "dark" | "light";
  /** Switch the admin UI language — delegates to OslerI18nProvider. */
  setLanguage: (lang: "en" | "ar") => void;
  /** Toggle dark/light — delegates to OslerThemeProvider. */
  toggleTheme: () => void;
  update: <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => void;
  reset: () => void;
}

const AdminSettingsContext = React.createContext<AdminSettingsContextValue | null>(null);

export function AdminSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = React.useState<AdminSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = React.useState(false);
  const { isDark, toggleTheme: mainToggleTheme } = useOslerTheme();
  const { lang, setLang } = useI18n();

  // Hydrate from localStorage on mount.
  React.useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  // Apply reduced motion to <html> (theme/language are handled
  // by the main providers — we must NOT touch those here).
  React.useEffect(() => {
    if (!hydrated) return;
    const html = document.documentElement;
    html.classList.toggle("admin-reduced-motion", settings.reducedMotion);
  }, [settings, hydrated]);

  const update = React.useCallback(
    <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        saveSettings(next);
        return next;
      });
    },
    [],
  );

  const setLanguage = React.useCallback(
    (next: "en" | "ar") => {
      setLang(next);
    },
    [setLang],
  );

  const reset = React.useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
  }, []);

  const value = React.useMemo(
    () => ({
      settings,
      language: lang,
      theme: (isDark ? "dark" : "light") as "dark" | "light",
      setLanguage,
      toggleTheme: mainToggleTheme,
      update,
      reset,
    }),
    [settings, lang, isDark, setLanguage, mainToggleTheme, update, reset],
  );

  return (
    <AdminSettingsContext.Provider value={value}>
      {children}
    </AdminSettingsContext.Provider>
  );
}

export function useAdminSettings() {
  const ctx = React.useContext(AdminSettingsContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider.
    return {
      settings: DEFAULT_SETTINGS,
      language: "en" as const,
      theme: "dark" as const,
      setLanguage: () => {},
      toggleTheme: () => {},
      update: () => {},
      reset: () => {},
    };
  }
  return ctx;
}
