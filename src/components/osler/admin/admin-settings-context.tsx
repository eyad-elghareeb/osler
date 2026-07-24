"use client";

/**
 * Admin settings context — persists admin-specific UI/UX preferences.
 *
 * These settings live in localStorage and are independent from the user's
 * main-app preferences. They control how the admin panel looks and behaves
 * for the signed-in admin user.
 *
 * Settings exposed:
 *  - language: UI language for the admin panel (en/ar)
 *  - theme: dark | light
 *  - workingMode: compact | comfortable — controls density
 *  - reducedMotion: boolean — disables framer-motion transitions
 *  - defaultLanding: which admin page to land on after sign-in
 *  - pageSize: how many rows to show in tables (10/25/50)
 *  - autoSaveDrafts: boolean — auto-save content drafts every N seconds
 *  - showAdvancedFields: boolean — show "advanced" metadata in editors
 *  - sidebarCollapsed: boolean — collapse the desktop sidebar
 */

import * as React from "react";

export type AdminLang = "en" | "ar";
export type AdminTheme = "dark" | "light";
export type AdminWorkingMode = "compact" | "comfortable";
export type AdminLanding = "dashboard" | "content" | "review" | "audit";

export interface AdminSettings {
  language: AdminLang;
  theme: AdminTheme;
  workingMode: AdminWorkingMode;
  reducedMotion: boolean;
  defaultLanding: AdminLanding;
  pageSize: number;
  autoSaveDrafts: boolean;
  showAdvancedFields: boolean;
  sidebarCollapsed: boolean;
}

const DEFAULT_SETTINGS: AdminSettings = {
  language: "en",
  theme: "dark",
  workingMode: "comfortable",
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
    return { ...DEFAULT_SETTINGS, ...parsed };
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
  update: <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => void;
  reset: () => void;
}

const AdminSettingsContext = React.createContext<AdminSettingsContextValue | null>(null);

export function AdminSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = React.useState<AdminSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = React.useState(false);

  // Hydrate from localStorage on mount.
  React.useEffect(() => {
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  // Apply theme + working mode + reduced motion to <html> immediately on
  // every settings change (after hydration).
  React.useEffect(() => {
    if (!hydrated) return;
    const html = document.documentElement;
    html.classList.toggle("dark", settings.theme === "dark");
    html.classList.toggle("admin-compact", settings.workingMode === "compact");
    html.classList.toggle("admin-reduced-motion", settings.reducedMotion);
    html.setAttribute("lang", settings.language);
    html.setAttribute("dir", settings.language === "ar" ? "rtl" : "ltr");
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

  const reset = React.useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
  }, []);

  const value = React.useMemo(
    () => ({ settings, update, reset }),
    [settings, update, reset],
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
      update: () => {},
      reset: () => {},
    };
  }
  return ctx;
}
