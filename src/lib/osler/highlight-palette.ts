// Shared highlight palette — single source of truth for both the Library
// reader and the QBank studio highlighter.

export type HighlightColorKey =
  | "yellow"
  | "green"
  | "blue"
  | "pink"
  | "purple"
  | "orange";

export interface HighlightSwatch {
  key: HighlightColorKey;
  label: string;
  light: string;
  dark: string;
}

export const HIGHLIGHT_PALETTE: Record<HighlightColorKey, HighlightSwatch> = {
  yellow: { key: "yellow", label: "Yellow", light: "#fde047", dark: "#a16207" },
  green: { key: "green", label: "Green", light: "#86efac", dark: "#15803d" },
  blue: { key: "blue", label: "Blue", light: "#93c5fd", dark: "#1d4ed8" },
  pink: { key: "pink", label: "Pink", light: "#fbcfe8", dark: "#be185d" },
  purple: { key: "purple", label: "Purple", light: "#c4b5fd", dark: "#7c3aed" },
  orange: { key: "orange", label: "Orange", light: "#fdba74", dark: "#c2410c" },
};

export const HIGHLIGHT_COLOR_KEYS: HighlightColorKey[] = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
  "orange",
];

export const ERASER_TOOL = "eraser" as const;

export function isHighlightColorKey(value: string): value is HighlightColorKey {
  return Object.prototype.hasOwnProperty.call(HIGHLIGHT_PALETTE, value);
}

function isDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

// Resolve a stored highlight color. Stored values are either a palette key
// (theme-aware) or a legacy raw hex (returned unchanged for backwards compat).
export function resolveHighlightColor(value: string, dark?: boolean): string {
  if (!isHighlightColorKey(value)) return value;
  const swatch = HIGHLIGHT_PALETTE[value];
  const darkMode = dark ?? isDarkMode();
  return darkMode ? swatch.dark : swatch.light;
}
