"use client";

import * as React from "react";
import {
  getConfig,
  loadConfig,
  getCustomThemes,
  getDefaultTheme,
  type CustomThemeConfig,
} from "@/lib/osler/config";

type Theme = "dark" | "light";

interface OslerThemeContextValue {
  /** Currently active theme id. May be a built-in ("dark"/"light") or a custom id. */
  theme: string;
  /** Convenience: is the active theme a dark variant? */
  isDark: boolean;
  /** Switch to a built-in theme. */
  setTheme: (t: Theme) => void;
  /** Switch to any theme id (built-in or custom). */
  setThemeId: (id: string) => void;
  /** Toggle between dark and light (the legacy behaviour). Custom themes are
   *  not toggled — use `setThemeId` from the theme switcher. */
  toggleTheme: () => void;
  /** All available themes: built-in + custom from osler.config. */
  availableThemes: Array<{ id: string; name: string; variant: "dark" | "light" }>;
}

const OslerThemeContext = React.createContext<OslerThemeContextValue | null>(null);

/**
 * Apply a theme by id. Built-in ids ("dark", "light") toggle the .dark / .light
 * class on <html>. Custom themes add their own class (`theme-<id>`) and the
 * CSS variable overrides are injected into a <style> tag in <head>.
 */
function applyThemeClass(id: string, customThemes: CustomThemeConfig[]) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // Strip every theme class we might have added previously.
  root.classList.remove("dark", "light");
  for (const ct of customThemes) {
    root.classList.remove(`theme-${ct.id}`);
  }

  const custom = customThemes.find((t) => t.id === id);
  if (custom) {
    // Custom theme: add the .theme-<id> class so the injected CSS overrides
    // take effect, and ALSO add the variant class so any code that checks
    // `.dark` / `.light` (e.g. Mermaid) still works.
    root.classList.add(`theme-${custom.id}`);
    root.classList.add(custom.variant);
  } else {
    // Built-in: just add the variant class.
    root.classList.add(id === "light" ? "light" : "dark");
  }
}

/**
 * Inject a <style id="osler-custom-themes"> block into <head> containing the
 * CSS variable overrides for every custom theme. Called once after the config
 * loads. Re-running it replaces the previous block.
 */
function injectCustomThemeStyles(customThemes: CustomThemeConfig[]) {
  if (typeof document === "undefined") return;
  const STYLE_ID = "osler-custom-themes";
  const existing = document.getElementById(STYLE_ID);
  if (existing) existing.remove();
  if (customThemes.length === 0) return;

  const lines: string[] = [];
  for (const t of customThemes) {
    const vars: string[] = [];
    if (t.background) vars.push(`--background: ${t.background};`);
    if (t.foreground) vars.push(`--foreground: ${t.foreground};`);
    if (t.primary) vars.push(`--primary: ${t.primary};`);
    if (t.primaryForeground) vars.push(`--primary-foreground: ${t.primaryForeground};`);
    if (t.accent) vars.push(`--accent: ${t.accent};`);
    if (t.card) vars.push(`--card: ${t.card};`);
    if (t.cardForeground) vars.push(`--card-foreground: ${t.cardForeground};`);
    if (t.popover) vars.push(`--popover: ${t.popover};`);
    if (t.popoverForeground) vars.push(`--popover-foreground: ${t.popoverForeground};`);
    if (t.secondary) vars.push(`--secondary: ${t.secondary};`);
    if (t.secondaryForeground) vars.push(`--secondary-foreground: ${t.secondaryForeground};`);
    if (t.muted) vars.push(`--muted: ${t.muted};`);
    if (t.mutedForeground) vars.push(`--muted-foreground: ${t.mutedForeground};`);
    if (t.destructive) vars.push(`--destructive: ${t.destructive};`);
    if (t.border) vars.push(`--border: ${t.border};`);
    if (t.input) vars.push(`--input: ${t.input};`);
    if (t.ring) vars.push(`--ring: ${t.ring};`);
    if (t.primary) vars.push(`--sidebar-primary: ${t.primary};`);
    if (t.ring) vars.push(`--sidebar-ring: ${t.ring};`);
    if (t.sidebar) vars.push(`--sidebar: ${t.sidebar};`);
    if (t.sidebarForeground) vars.push(`--sidebar-foreground: ${t.sidebarForeground};`);
    if (t.sidebarPrimary) vars.push(`--sidebar-primary: ${t.sidebarPrimary};`);
    if (t.sidebarPrimaryForeground) vars.push(`--sidebar-primary-foreground: ${t.sidebarPrimaryForeground};`);
    if (t.sidebarAccent) vars.push(`--sidebar-accent: ${t.sidebarAccent};`);
    if (t.sidebarAccentForeground) vars.push(`--sidebar-accent-foreground: ${t.sidebarAccentForeground};`);
    if (t.sidebarBorder) vars.push(`--sidebar-border: ${t.sidebarBorder};`);
    if (t.sidebarRing) vars.push(`--sidebar-ring: ${t.sidebarRing};`);
    if (vars.length === 0) continue;
    lines.push(`.theme-${CSS.escape(t.id)} {`);
    lines.push(`  ${vars.join("\n  ")}`);
    lines.push(`}`);
  }
  if (lines.length === 0) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = lines.join("\n");
  document.head.appendChild(style);
}

export function OslerThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to "dark" until the config loads — this matches the legacy behaviour.
  const [theme, setThemeState] = React.useState<string>("dark");
  const [customThemes, setCustomThemes] = React.useState<CustomThemeConfig[]>([]);

  React.useEffect(() => {
    // 1. Read the user's persisted choice (if any).
    const stored =
      (typeof window !== "undefined" &&
        (localStorage.getItem("osler-theme") as string | null)) ||
      null;
    // 2. Load the config to discover the default theme + custom palettes.
    loadConfig().then((cfg) => {
      setCustomThemes(cfg.themes.custom);
      injectCustomThemeStyles(cfg.themes.custom);
      const resolved = stored ?? cfg.themes.default ?? "dark";
      setThemeState(resolved);
      applyThemeClass(resolved, cfg.themes.custom);
    });
  }, []);

  const setThemeId = React.useCallback(
    (id: string) => {
      setThemeState(id);
      if (typeof window !== "undefined") {
        localStorage.setItem("osler-theme", id);
      }
      applyThemeClass(id, customThemes);
    },
    [customThemes],
  );

  const setTheme = React.useCallback(
    (t: Theme) => setThemeId(t),
    [setThemeId],
  );

  const toggleTheme = React.useCallback(() => {
    // Toggle between dark and light, regardless of any custom theme active.
    // If a custom theme is active, fall back to the opposite of its variant.
    const custom = customThemes.find((t) => t.id === theme);
    const isDark = custom ? custom.variant === "dark" : theme === "dark";
    setThemeId(isDark ? "light" : "dark");
  }, [theme, customThemes, setThemeId]);

  const isDark = React.useMemo(() => {
    const custom = customThemes.find((t) => t.id === theme);
    return custom ? custom.variant === "dark" : theme === "dark";
  }, [theme, customThemes]);

  const availableThemes = React.useMemo<
    Array<{ id: string; name: string; variant: "dark" | "light" }>
  >(
    () => [
      { id: "dark", name: "Dark", variant: "dark" },
      { id: "light", name: "Light", variant: "light" },
      ...customThemes.map((t) => ({ id: t.id, name: t.name, variant: t.variant })),
    ],
    [customThemes],
  );

  const value = React.useMemo<OslerThemeContextValue>(
    () => ({ theme, isDark, setTheme, setThemeId, toggleTheme, availableThemes }),
    [theme, isDark, setTheme, setThemeId, toggleTheme, availableThemes],
  );

  return (
    <OslerThemeContext.Provider value={value}>
      {children}
    </OslerThemeContext.Provider>
  );
}

const DEFAULT_THEME_VALUE: OslerThemeContextValue = {
  theme: "dark",
  isDark: true,
  setTheme: () => {},
  setThemeId: () => {},
  toggleTheme: () => {},
  availableThemes: [
    { id: "dark", name: "Dark", variant: "dark" },
    { id: "light", name: "Light", variant: "light" },
  ],
};

export function useOslerTheme() {
  const ctx = React.useContext(OslerThemeContext);
  return ctx ?? DEFAULT_THEME_VALUE;
}

// Re-export config helpers for theme switchers.
export { getConfig as getOslerConfig, getCustomThemes, getDefaultTheme };
