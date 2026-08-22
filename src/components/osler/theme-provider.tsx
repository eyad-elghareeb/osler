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
    root.classList.remove(`theme-${CSS.escape(ct.id)}`);
  }

  // Only known custom themes can apply their class; the id is escaped so a
  // hostile config id can't inject classes into <html>.
  const custom = customThemes.find((t) => t.id === id);
  if (custom) {
    // Custom theme: add the .theme-<id> class so the injected CSS overrides
    // take effect, and ALSO add the variant class so any code that checks
    // `.dark` / `.light` (e.g. Mermaid) still works.
    root.classList.add(`theme-${CSS.escape(custom.id)}`);
    root.classList.add(custom.variant);
  } else {
    // Built-in: just add the variant class.
    root.classList.add(id === "light" ? "light" : "dark");
  }
}

/**
 * Custom-theme color values land inside a <style> block's declarations, and
 * theme ids become class names. Both come from osler.config.json (which the
 * admin config editor can rewrite), so treat them as untrusted: a crafted
 * "color" like `red;} body{background:url(...)` could otherwise break out of
 * the declaration and append arbitrary CSS.
 */
function isSafeThemeColor(value: string): boolean {
  // oklch()/oklab(), hex (#rgb #rrggbb #rrggbbaa), rgb()/rgba(), hsl()/hsla(),
  // or a plain identifier (css color keywords). No braces, semicolons,
  // parentheses imbalance tricks survive these patterns.
  if (value.length > 100) return false;
  if (/[{};@\\/]/.test(value)) return false;
  return (
    /^#[0-9a-fA-F]{3,8}$/.test(value) ||
    /^(oklch|oklab|rgb|hsl)a?\([^\)]*\)$/.test(value) ||
    /^[a-zA-Z]+$/.test(value)
  );
}

function safeColor(value: string | undefined): string | null {
  if (!value || !isSafeThemeColor(value)) return null;
  return value;
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
    const push = (name: string, raw: string | undefined) => {
      const color = safeColor(raw);
      if (color) vars.push(`--${name}: ${color};`);
    };
    push("background", t.background);
    push("foreground", t.foreground);
    push("primary", t.primary);
    push("primary-foreground", t.primaryForeground);
    push("accent", t.accent);
    push("card", t.card);
    push("card-foreground", t.cardForeground);
    push("popover", t.popover);
    push("popover-foreground", t.popoverForeground);
    push("secondary", t.secondary);
    push("secondary-foreground", t.secondaryForeground);
    push("muted", t.muted);
    push("muted-foreground", t.mutedForeground);
    push("destructive", t.destructive);
    push("success", t.success);
    push("warning", t.warning);
    push("info", t.info);
    push("border", t.border);
    push("input", t.input);
    push("ring", t.ring);
    push("sidebar-primary", t.primary);
    push("sidebar-ring", t.ring);
    push("sidebar", t.sidebar);
    push("sidebar-foreground", t.sidebarForeground);
    push("sidebar-primary", t.sidebarPrimary);
    push("sidebar-primary-foreground", t.sidebarPrimaryForeground);
    push("sidebar-accent", t.sidebarAccent);
    push("sidebar-accent-foreground", t.sidebarAccentForeground);
    push("sidebar-border", t.sidebarBorder);
    push("sidebar-ring", t.sidebarRing);
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
      // Validate the stored theme id against the available themes. If the
      // user had previously selected a theme that was since removed from
      // the config (e.g. "navy-clinic" after the theme cleanup), fall
      // back to the configured default instead of leaving them on a
      // theme class with no matching CSS.
      const availableIds = new Set<string>(["dark", "light", ...cfg.themes.custom.map((t) => t.id)]);
      const valid = stored && availableIds.has(stored);
      const resolved = (valid ? stored : null) ?? cfg.themes.default ?? "dark";
      // If we fell back, persist the resolved id so we don't re-evaluate
      // the stale stored value on every mount.
      if (stored && !valid && typeof window !== "undefined") {
        localStorage.setItem("osler-theme", resolved);
      }
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
    const custom = customThemes.find((t) => t.id === theme);
    if (custom) {
      const oppositeVariant = custom.variant === "dark" ? "light" : "dark";
      // Find the specific counterpart by name pattern: strip -dark/-light
      // suffix from the current theme's name and look for a match with
      // the opposite variant. E.g. "navy-clinic" → look for "navy-clinic-light".
      const baseName = custom.id
        .replace(/-dark$/i, "")
        .replace(/-light$/i, "");
      const counterpart =
        customThemes.find(
          (t) => t.id !== custom.id && t.variant === oppositeVariant && t.id.startsWith(baseName),
        ) ??
        customThemes.find(
          (t) => t.id !== custom.id && t.variant === oppositeVariant,
        );
      if (counterpart) {
        setThemeId(counterpart.id);
        return;
      }
    }
    // Built-in theme or no custom counterpart: flip dark ↔ light.
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
