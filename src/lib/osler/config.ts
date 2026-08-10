/**
 * Osler configuration system — runtime-loaded, user-editable config file.
 *
 * The config file lives at `/osler.config.json` (served from `public/`). It is
 * fetched once on app boot and cached in-memory for the lifetime of the page.
 * The Tauri admin panel writes to the file on disk; in dev the user can edit
 * `public/osler.config.json` directly and reload.
 *
 * The config drives:
 *   - Site name / tagline / short name (modular brand)
 *   - Engine plugin enable/disable (quiz, bank, written, flashcard, osce, library, video)
 *   - Default theme + custom theme palettes
 *   - Default UI / content language
 *   - Default landing view
 *   - GitHub repo reference (always surfaced in admin + about)
 *   - First-time wizard completion state
 *   - Misc defaults (quiz length, timer mode, AI model, sync method, etc.)
 *
 * Design rules:
 *   - Every field is OPTIONAL. The loader merges the user's config over a hard
 *     `DEFAULT_CONFIG`, so missing keys always fall back to a sane default.
 *   - The loader NEVER throws — a fetch failure or parse error returns the
 *     default config so the app always boots.
 *   - Consumers import `getConfig()` for the resolved config, or the typed
 *     helpers (`getSiteName()`, `isEngineEnabled()`, `getActiveTheme()`).
 */

import type { EngineType } from "./types";
import type { UiLang, ContentLangFilter } from "./i18n/languages";

/* ─────────────────────────── Types ────────────────────────────────── */

/**
 * A plugin entry for an engine. The simplest form is `{ enabled: true }`.
 * Optional fields let the user override the default label/icon/color used in
 * `ENGINE_META` (useful for white-labelling).
 */
export interface EnginePluginConfig {
  /** Whether the engine is enabled. Disabled engines are hidden from the UI
   *  and their content is never loaded. */
  enabled: boolean;
  /** Optional override for the engine's display label (e.g. "Question Bank"
   *  instead of "Bank"). Falls back to `ENGINE_META[type].label`. */
  label?: string;
  /** Optional override for the engine's singular label. */
  singular?: string;
  /** Optional override for the engine's accent color (oklch string). */
  color?: string;
  /** Optional override for the engine's lucide icon name. */
  icon?: string;
}

/** A custom theme palette. All color values are oklch strings. */
export interface CustomThemeConfig {
  /** Stable id — used in `data-theme` attribute and the theme switcher. */
  id: string;
  /** Display name in the theme switcher. */
  name: string;
  /** "dark" or "light" — controls base background/foreground defaults. */
  variant: "dark" | "light";
  /** Primary accent color (oklch). */
  primary?: string;
  /** Primary foreground color (oklch). */
  primaryForeground?: string;
  /** Secondary accent color (oklch). */
  accent?: string;
  /** Background color (oklch). */
  background?: string;
  /** Foreground (text) color (oklch). */
  foreground?: string;
  /** Card background color (oklch). */
  card?: string;
  /** Card foreground color (oklch). */
  cardForeground?: string;
  /** Popover background color (oklch). */
  popover?: string;
  /** Popover foreground color (oklch). */
  popoverForeground?: string;
  /** Secondary background color (oklch). */
  secondary?: string;
  /** Secondary foreground color (oklch). */
  secondaryForeground?: string;
  /** Muted background color (oklch). */
  muted?: string;
  /** Muted foreground color (oklch). */
  mutedForeground?: string;
  /** Destructive color (oklch). */
  destructive?: string;
  /** Positive status color (oklch). */
  success?: string;
  /** Caution status color (oklch). */
  warning?: string;
  /** Informational status color (oklch). */
  info?: string;
  /** Border color (oklch). */
  border?: string;
  /** Input border color (oklch). */
  input?: string;
  /** Ring/focus color (oklch). */
  ring?: string;
  /** Sidebar background color (oklch). */
  sidebar?: string;
  /** Sidebar foreground color (oklch). */
  sidebarForeground?: string;
  /** Sidebar primary color (oklch). */
  sidebarPrimary?: string;
  /** Sidebar primary foreground color (oklch). */
  sidebarPrimaryForeground?: string;
  /** Sidebar accent color (oklch). */
  sidebarAccent?: string;
  /** Sidebar accent foreground color (oklch). */
  sidebarAccentForeground?: string;
  /** Sidebar border color (oklch). */
  sidebarBorder?: string;
  /** Sidebar ring color (oklch). */
  sidebarRing?: string;
}

/** Site identity — drives `<title>`, brand mark, PWA manifest name, etc. */
export interface SiteConfig {
  /** Full site name shown in the header and login screen. */
  name: string;
  /** Short name shown on mobile home screens / PWA install. */
  shortName: string;
  /** Tagline shown under the brand mark. */
  tagline: string;
  /** Canonical GitHub repo URL. Always surfaced in admin + about. */
  githubRepo: string;
  /** Optional organisation / author name. */
  organisation?: string;
  /** Optional support / contact email. */
  supportEmail?: string;
}

/** Quiz/QBank defaults applied on first use of the quiz builder. */
export interface QuizDefaultsConfig {
  /** Default number of questions per test. */
  questionCount: number;
  /** Default time-per-question in seconds (0 = untimed). */
  secondsPerQuestion: number;
  /** Default tutor mode (show explanation after each question). */
  tutorMode: boolean;
  /** Default shuffle questions. */
  shuffle: boolean;
}

/** AI assistant defaults. */
export interface AiDefaultsConfig {
  /** Default Gemini model id. */
  model: string;
  /** Whether the AI assistant panel is visible by default. */
  enabled: boolean;
  /** Default temperature (0..1). */
  temperature: number;
}

/** Sync defaults. */
export interface SyncDefaultsConfig {
  /** Default transport: "network" | "qr" | "file". */
  method: "network" | "qr" | "file";
  /** Default room name for network sync. */
  defaultRoom: string;
}

/** Optional Cloudflare Worker account and progress-sync service. */
export interface CloudConfig {
  /** Cloud mode remains fully opt-in; local IndexedDB works when disabled. */
  enabled: boolean;
  /** Absolute Worker URL, for example https://study-api.example.com. */
  apiUrl: string;
  /** Optional public Turnstile site key used to protect authentication forms. */
  turnstileSiteKey?: string;
  /** Sync only the requested learning data, keeping D1 writes small. */
  syncQbank: boolean;
  syncFlashcards: boolean;
  /** Sync the remaining content types (sessions, notes, highlights,
   *  article highlights, bookmarks) alongside qbank/flashcards. */
  syncContent: boolean;
}

/** First-time wizard state. */
export interface WizardConfig {
  /** Has the wizard been completed (either in admin or in-app)? */
  completed: boolean;
  /** ISO timestamp of completion. */
  completedAt?: string;
  /** Schema version for forward migrations. */
  version: number;
}

/** Default options for content language filter and UI language. */
export interface LanguageDefaultsConfig {
  /** Default UI language code (must exist in LANGUAGES). */
  ui: UiLang;
  /** Default content-language filter. */
  content: ContentLangFilter;
}

/** Default landing view after login. */
export type DefaultView =
  | "dashboard"
  | "learn"
  | "library"
  | "qbank"
  | "flashcards"
  | "osce"
  | "videos"
  | "profile"
  | "settings";

/** Top-level Osler config shape. */
export interface OslerConfig {
  /** Schema version of the config file itself. */
  schemaVersion: number;
  site: SiteConfig;
  /** Engine plugins — keyed by EngineType. Missing = default enabled. */
  engines: Partial<Record<EngineType, EnginePluginConfig>>;
  /** Built-in dark/light + custom themes. */
  themes: {
    /** Default theme id (must match a built-in id or a custom theme id). */
    default: string;
    /** Custom theme palettes in addition to dark/light. */
    custom: CustomThemeConfig[];
  };
  /** Default options applied on first use. */
  defaults: {
    view: DefaultView;
    language: LanguageDefaultsConfig;
    quiz: QuizDefaultsConfig;
    ai: AiDefaultsConfig;
    sync: SyncDefaultsConfig;
  };
  /** Optional cloud accounts and cross-device progress sync. */
  cloud: CloudConfig;
  /** First-time wizard state. */
  wizard: WizardConfig;
}

/* ─────────────────────────── Defaults ─────────────────────────────── */

export const DEFAULT_CONFIG: OslerConfig = {
  schemaVersion: 1,
  site: {
    name: "Osler",
    shortName: "Osler",
    tagline: "Medical Study Platform",
    githubRepo: "https://github.com/eyad-elghareeb/osler",
    organisation: "Osler Team",
  },
  engines: {
    quiz: { enabled: true },
    bank: { enabled: true },
    written: { enabled: true },
    flashcard: { enabled: true },
    osce: { enabled: true },
    library: { enabled: true },
    video: { enabled: true },
  },
  themes: {
    default: "dark",
    custom: [
      /* ── Curated theme families ───────────────────────────────────────────
       * Each family has a distinct color identity — no two families share
       * the same primary hue. Removed during cleanup:
       *   • Navy Clinic (dark + light) — near-duplicate of the built-in
       *     Dark + Light themes.
       *   • Cream Journal (light) — byte-identical to Navy Clinic Light.
       *   • Cream Journal Dark — orphaned after Cream Journal Light was
       *     removed; its warm-dark + blue-primary combo wasn't distinct
       *     enough to keep as a standalone family.
       *
       * Remaining families (each dark + light unless noted):
       *   • Forest Rounds — green primary, nature-themed.
       *   • Crimson ED   — red primary, emergency-medicine-themed.
       *   • Midnight     — violet primary, deep indigo dark. Calmest dark.
       *   • Slate        — neutral gray, lowest chroma. Distraction-free.
       *   • Warm Sand    — terracotta primary, warm light. Easiest on eyes.
       */
      {
        id: "forest-rounds",
        name: "Forest Rounds",
        variant: "dark",
        primary: "oklch(0.7 0.18 145)",
        accent: "oklch(0.55 0.15 150)",
        background: "oklch(0.16 0.02 160)",
        foreground: "oklch(0.96 0.01 150)",
        card: "oklch(0.21 0.025 160)",
        cardForeground: "oklch(0.96 0.01 150)",
        popover: "oklch(0.21 0.025 160)",
        popoverForeground: "oklch(0.96 0.01 150)",
        primaryForeground: "oklch(0.16 0.02 160)",
        secondary: "oklch(0.28 0.03 160)",
        secondaryForeground: "oklch(0.96 0.01 150)",
        muted: "oklch(0.25 0.025 160)",
        mutedForeground: "oklch(0.72 0.02 150)",
        destructive: "oklch(0.68 0.21 22)",
        border: "oklch(1 0 0 / 8%)",
        input: "oklch(1 0 0 / 10%)",
        ring: "oklch(0.7 0.18 145)",
        sidebar: "oklch(0.19 0.022 160)",
        sidebarForeground: "oklch(0.96 0.01 150)",
        sidebarPrimary: "oklch(0.7 0.18 145)",
        sidebarPrimaryForeground: "oklch(0.16 0.02 160)",
        sidebarAccent: "oklch(0.28 0.03 160)",
        sidebarAccentForeground: "oklch(0.96 0.01 150)",
        sidebarBorder: "oklch(1 0 0 / 6%)",
        sidebarRing: "oklch(0.7 0.18 145)",
      },
      {
        id: "forest-rounds-light",
        name: "Forest Rounds Light",
        variant: "light",
        primary: "oklch(0.45 0.14 150)",
        accent: "oklch(0.6 0.14 145)",
        background: "oklch(0.98 0.008 155)",
        foreground: "oklch(0.2 0.025 155)",
        card: "oklch(1 0 0)",
        cardForeground: "oklch(0.2 0.025 155)",
        popover: "oklch(1 0 0)",
        popoverForeground: "oklch(0.2 0.025 155)",
        primaryForeground: "oklch(0.99 0 0)",
        secondary: "oklch(0.95 0.01 155)",
        secondaryForeground: "oklch(0.22 0.02 155)",
        muted: "oklch(0.95 0.01 155)",
        mutedForeground: "oklch(0.48 0.02 155)",
        destructive: "oklch(0.58 0.24 27)",
        border: "oklch(0.92 0.01 155)",
        input: "oklch(0.92 0.01 155)",
        ring: "oklch(0.45 0.14 150)",
        sidebar: "oklch(0.96 0.008 155)",
        sidebarForeground: "oklch(0.2 0.025 155)",
        sidebarPrimary: "oklch(0.45 0.14 150)",
        sidebarPrimaryForeground: "oklch(0.99 0 0)",
        sidebarAccent: "oklch(0.93 0.02 155)",
        sidebarAccentForeground: "oklch(0.22 0.02 155)",
        sidebarBorder: "oklch(0.92 0.01 155)",
        sidebarRing: "oklch(0.45 0.14 150)",
      },
      {
        id: "crimson-ed",
        name: "Crimson ED",
        variant: "dark",
        primary: "oklch(0.65 0.22 16)",
        accent: "oklch(0.5 0.2 20)",
        background: "oklch(0.15 0.025 20)",
        foreground: "oklch(0.96 0.01 20)",
        card: "oklch(0.2 0.03 20)",
        cardForeground: "oklch(0.96 0.01 20)",
        popover: "oklch(0.2 0.03 20)",
        popoverForeground: "oklch(0.96 0.01 20)",
        primaryForeground: "oklch(0.99 0 0)",
        secondary: "oklch(0.28 0.03 20)",
        secondaryForeground: "oklch(0.96 0.01 20)",
        muted: "oklch(0.26 0.025 20)",
        mutedForeground: "oklch(0.7 0.02 20)",
        destructive: "oklch(0.68 0.21 22)",
        border: "oklch(1 0 0 / 8%)",
        input: "oklch(1 0 0 / 10%)",
        ring: "oklch(0.65 0.22 16)",
        sidebar: "oklch(0.18 0.027 20)",
        sidebarForeground: "oklch(0.96 0.01 20)",
        sidebarPrimary: "oklch(0.65 0.22 16)",
        sidebarPrimaryForeground: "oklch(0.99 0 0)",
        sidebarAccent: "oklch(0.28 0.03 20)",
        sidebarAccentForeground: "oklch(0.96 0.01 20)",
        sidebarBorder: "oklch(1 0 0 / 6%)",
        sidebarRing: "oklch(0.65 0.22 16)",
      },
      {
        id: "crimson-ed-light",
        name: "Crimson ED Light",
        variant: "light",
        primary: "oklch(0.5 0.18 16)",
        accent: "oklch(0.65 0.15 20)",
        background: "oklch(0.99 0.005 20)",
        foreground: "oklch(0.18 0.02 20)",
        card: "oklch(1 0 0)",
        cardForeground: "oklch(0.18 0.02 20)",
        popover: "oklch(1 0 0)",
        popoverForeground: "oklch(0.18 0.02 20)",
        primaryForeground: "oklch(0.99 0 0)",
        secondary: "oklch(0.96 0.008 20)",
        secondaryForeground: "oklch(0.2 0.02 20)",
        muted: "oklch(0.96 0.008 20)",
        mutedForeground: "oklch(0.48 0.015 20)",
        destructive: "oklch(0.58 0.24 27)",
        border: "oklch(0.92 0.008 20)",
        input: "oklch(0.92 0.008 20)",
        ring: "oklch(0.5 0.18 16)",
        sidebar: "oklch(0.97 0.005 20)",
        sidebarForeground: "oklch(0.18 0.02 20)",
        sidebarPrimary: "oklch(0.5 0.18 16)",
        sidebarPrimaryForeground: "oklch(0.99 0 0)",
        sidebarAccent: "oklch(0.93 0.02 20)",
        sidebarAccentForeground: "oklch(0.2 0.02 20)",
        sidebarBorder: "oklch(0.92 0.008 20)",
        sidebarRing: "oklch(0.5 0.18 16)",
      },
      {
        id: "midnight",
        name: "Midnight",
        variant: "dark",
        primary: "oklch(0.62 0.16 285)",
        accent: "oklch(0.5 0.14 290)",
        background: "oklch(0.13 0.022 285)",
        foreground: "oklch(0.96 0.008 280)",
        card: "oklch(0.18 0.026 285)",
        cardForeground: "oklch(0.96 0.008 280)",
        popover: "oklch(0.2 0.028 285)",
        popoverForeground: "oklch(0.96 0.008 280)",
        primaryForeground: "oklch(0.99 0 0)",
        secondary: "oklch(0.26 0.028 285)",
        secondaryForeground: "oklch(0.96 0.008 280)",
        muted: "oklch(0.24 0.024 285)",
        mutedForeground: "oklch(0.7 0.018 280)",
        destructive: "oklch(0.68 0.21 22)",
        border: "oklch(1 0 0 / 8%)",
        input: "oklch(1 0 0 / 10%)",
        ring: "oklch(0.62 0.16 285)",
        sidebar: "oklch(0.16 0.024 285)",
        sidebarForeground: "oklch(0.96 0.008 280)",
        sidebarPrimary: "oklch(0.62 0.16 285)",
        sidebarPrimaryForeground: "oklch(0.99 0 0)",
        sidebarAccent: "oklch(0.26 0.028 285)",
        sidebarAccentForeground: "oklch(0.96 0.008 280)",
        sidebarBorder: "oklch(1 0 0 / 6%)",
        sidebarRing: "oklch(0.62 0.16 285)",
      },
      {
        id: "midnight-light",
        name: "Midnight Light",
        variant: "light",
        primary: "oklch(0.42 0.13 285)",
        accent: "oklch(0.7 0.12 280)",
        background: "oklch(0.99 0.006 280)",
        foreground: "oklch(0.18 0.025 285)",
        card: "oklch(1 0 0)",
        cardForeground: "oklch(0.18 0.025 285)",
        popover: "oklch(1 0 0)",
        popoverForeground: "oklch(0.18 0.025 285)",
        primaryForeground: "oklch(0.99 0 0)",
        secondary: "oklch(0.95 0.012 280)",
        secondaryForeground: "oklch(0.2 0.025 285)",
        muted: "oklch(0.95 0.012 280)",
        mutedForeground: "oklch(0.5 0.018 280)",
        destructive: "oklch(0.58 0.24 27)",
        border: "oklch(0.9 0.012 280)",
        input: "oklch(0.9 0.012 280)",
        ring: "oklch(0.42 0.13 285)",
        sidebar: "oklch(0.97 0.006 280)",
        sidebarForeground: "oklch(0.18 0.025 285)",
        sidebarPrimary: "oklch(0.42 0.13 285)",
        sidebarPrimaryForeground: "oklch(0.99 0 0)",
        sidebarAccent: "oklch(0.92 0.025 280)",
        sidebarAccentForeground: "oklch(0.2 0.025 285)",
        sidebarBorder: "oklch(0.9 0.012 280)",
        sidebarRing: "oklch(0.42 0.13 285)",
      },
      {
        id: "slate",
        name: "Slate",
        variant: "dark",
        primary: "oklch(0.68 0.02 250)",
        accent: "oklch(0.55 0.015 250)",
        background: "oklch(0.15 0.005 250)",
        foreground: "oklch(0.93 0.003 250)",
        card: "oklch(0.2 0.006 250)",
        cardForeground: "oklch(0.93 0.003 250)",
        popover: "oklch(0.22 0.006 250)",
        popoverForeground: "oklch(0.93 0.003 250)",
        primaryForeground: "oklch(0.13 0.005 250)",
        secondary: "oklch(0.26 0.008 250)",
        secondaryForeground: "oklch(0.93 0.003 250)",
        muted: "oklch(0.24 0.006 250)",
        mutedForeground: "oklch(0.68 0.005 250)",
        destructive: "oklch(0.62 0.18 22)",
        border: "oklch(1 0 0 / 8%)",
        input: "oklch(1 0 0 / 10%)",
        ring: "oklch(0.68 0.02 250)",
        sidebar: "oklch(0.17 0.005 250)",
        sidebarForeground: "oklch(0.93 0.003 250)",
        sidebarPrimary: "oklch(0.68 0.02 250)",
        sidebarPrimaryForeground: "oklch(0.13 0.005 250)",
        sidebarAccent: "oklch(0.26 0.008 250)",
        sidebarAccentForeground: "oklch(0.93 0.003 250)",
        sidebarBorder: "oklch(1 0 0 / 6%)",
        sidebarRing: "oklch(0.68 0.02 250)",
      },
      {
        id: "slate-light",
        name: "Slate Light",
        variant: "light",
        primary: "oklch(0.45 0.015 250)",
        accent: "oklch(0.7 0.008 250)",
        background: "oklch(0.98 0.003 250)",
        foreground: "oklch(0.2 0.006 250)",
        card: "oklch(1 0 0)",
        cardForeground: "oklch(0.2 0.006 250)",
        popover: "oklch(1 0 0)",
        popoverForeground: "oklch(0.2 0.006 250)",
        primaryForeground: "oklch(0.99 0 0)",
        secondary: "oklch(0.95 0.004 250)",
        secondaryForeground: "oklch(0.2 0.006 250)",
        muted: "oklch(0.95 0.004 250)",
        mutedForeground: "oklch(0.5 0.005 250)",
        destructive: "oklch(0.55 0.2 27)",
        border: "oklch(0.9 0.004 250)",
        input: "oklch(0.9 0.004 250)",
        ring: "oklch(0.45 0.015 250)",
        sidebar: "oklch(0.97 0.003 250)",
        sidebarForeground: "oklch(0.2 0.006 250)",
        sidebarPrimary: "oklch(0.45 0.015 250)",
        sidebarPrimaryForeground: "oklch(0.99 0 0)",
        sidebarAccent: "oklch(0.93 0.006 250)",
        sidebarAccentForeground: "oklch(0.2 0.006 250)",
        sidebarBorder: "oklch(0.9 0.004 250)",
        sidebarRing: "oklch(0.45 0.015 250)",
      },
      {
        id: "warm-sand",
        name: "Warm Sand",
        variant: "light",
        primary: "oklch(0.55 0.14 40)",
        accent: "oklch(0.72 0.08 60)",
        background: "oklch(0.97 0.012 75)",
        foreground: "oklch(0.22 0.02 50)",
        card: "oklch(0.99 0.008 75)",
        cardForeground: "oklch(0.22 0.02 50)",
        popover: "oklch(0.99 0.008 75)",
        popoverForeground: "oklch(0.22 0.02 50)",
        primaryForeground: "oklch(0.99 0 0)",
        secondary: "oklch(0.94 0.014 70)",
        secondaryForeground: "oklch(0.25 0.022 50)",
        muted: "oklch(0.94 0.014 70)",
        mutedForeground: "oklch(0.52 0.018 60)",
        destructive: "oklch(0.55 0.2 27)",
        border: "oklch(0.88 0.014 70)",
        input: "oklch(0.88 0.014 70)",
        ring: "oklch(0.55 0.14 40)",
        sidebar: "oklch(0.96 0.012 75)",
        sidebarForeground: "oklch(0.22 0.02 50)",
        sidebarPrimary: "oklch(0.55 0.14 40)",
        sidebarPrimaryForeground: "oklch(0.99 0 0)",
        sidebarAccent: "oklch(0.93 0.018 70)",
        sidebarAccentForeground: "oklch(0.25 0.022 50)",
        sidebarBorder: "oklch(0.88 0.014 70)",
        sidebarRing: "oklch(0.55 0.14 40)",
      },
      {
        id: "warm-sand-dark",
        name: "Warm Sand Dark",
        variant: "dark",
        primary: "oklch(0.7 0.15 40)",
        accent: "oklch(0.55 0.1 60)",
        background: "oklch(0.16 0.015 60)",
        foreground: "oklch(0.94 0.012 70)",
        card: "oklch(0.21 0.018 60)",
        cardForeground: "oklch(0.94 0.012 70)",
        popover: "oklch(0.23 0.02 60)",
        popoverForeground: "oklch(0.94 0.012 70)",
        primaryForeground: "oklch(0.16 0.015 60)",
        secondary: "oklch(0.28 0.02 60)",
        secondaryForeground: "oklch(0.94 0.012 70)",
        muted: "oklch(0.25 0.018 60)",
        mutedForeground: "oklch(0.7 0.015 70)",
        destructive: "oklch(0.65 0.2 22)",
        border: "oklch(1 0 0 / 8%)",
        input: "oklch(1 0 0 / 10%)",
        ring: "oklch(0.7 0.15 40)",
        sidebar: "oklch(0.18 0.017 60)",
        sidebarForeground: "oklch(0.94 0.012 70)",
        sidebarPrimary: "oklch(0.7 0.15 40)",
        sidebarPrimaryForeground: "oklch(0.16 0.015 60)",
        sidebarAccent: "oklch(0.28 0.02 60)",
        sidebarAccentForeground: "oklch(0.94 0.012 70)",
        sidebarBorder: "oklch(1 0 0 / 6%)",
        sidebarRing: "oklch(0.7 0.15 40)",
      },
    ],
  },
  defaults: {
    view: "dashboard",
    language: {
      ui: "en",
      content: "all",
    },
    quiz: {
      questionCount: 10,
      secondsPerQuestion: 60,
      tutorMode: false,
      shuffle: true,
    },
    ai: {
      model: "gemini-2.5-flash",
      enabled: true,
      temperature: 0.4,
    },
    sync: {
      method: "network",
      defaultRoom: "osler-default",
    },
  },
  cloud: {
    enabled: false,
    apiUrl: "",
    syncQbank: true,
    syncFlashcards: true,
    syncContent: true,
  },
  wizard: {
    completed: false,
    version: 1,
  },
};

/** The 7 engine plugin ids in canonical order. */
export const ENGINE_PLUGIN_IDS: EngineType[] = [
  "quiz",
  "bank",
  "written",
  "flashcard",
  "osce",
  "library",
  "video",
];

/** Built-in theme ids (always available). */
export const BUILTIN_THEME_IDS = ["dark", "light"] as const;
export type BuiltinThemeId = (typeof BUILTIN_THEME_IDS)[number];

/* ─────────────────────────── Loader ───────────────────────────────── */

const CONFIG_URL = "/osler.config.json";
const STORAGE_KEY = "osler-config-cache";

let cached: OslerConfig | null = null;
let loadingPromise: Promise<OslerConfig> | null = null;

/**
 * Deep-merge a partial user config over the defaults. Arrays are replaced,
 * not concatenated (themes.custom is taken from the user config verbatim
 * if present).
 */
function mergeConfig(user: unknown): OslerConfig {
  if (!user || typeof user !== "object") return structuredClone(DEFAULT_CONFIG);
  const u = user as Partial<OslerConfig>;
  const out: OslerConfig = structuredClone(DEFAULT_CONFIG);

  // schemaVersion — take user value if present
  if (typeof u.schemaVersion === "number") out.schemaVersion = u.schemaVersion;

  // site — merge field-by-field
  if (u.site && typeof u.site === "object") {
    out.site = { ...out.site, ...u.site };
  }

  // engines — merge per-engine
  if (u.engines && typeof u.engines === "object") {
    for (const id of ENGINE_PLUGIN_IDS) {
      const incoming = (u.engines as Record<string, unknown>)[id];
      if (incoming && typeof incoming === "object") {
        const base = out.engines[id] ?? { enabled: true };
        out.engines[id] = { ...base, ...(incoming as EnginePluginConfig) };
      }
    }
  }

  // themes — replace custom array, default if present
  if (u.themes && typeof u.themes === "object") {
    if (typeof u.themes.default === "string") out.themes.default = u.themes.default;
    if (Array.isArray(u.themes.custom)) out.themes.custom = u.themes.custom;
  }

  // defaults — deep-ish merge
  if (u.defaults && typeof u.defaults === "object") {
    if (u.defaults.view) out.defaults.view = u.defaults.view;
    if (u.defaults.language && typeof u.defaults.language === "object") {
      out.defaults.language = { ...out.defaults.language, ...u.defaults.language };
    }
    if (u.defaults.quiz && typeof u.defaults.quiz === "object") {
      out.defaults.quiz = { ...out.defaults.quiz, ...u.defaults.quiz };
    }
    if (u.defaults.ai && typeof u.defaults.ai === "object") {
      out.defaults.ai = { ...out.defaults.ai, ...u.defaults.ai };
    }
    if (u.defaults.sync && typeof u.defaults.sync === "object") {
      out.defaults.sync = { ...out.defaults.sync, ...u.defaults.sync };
    }
  }

  if (u.cloud && typeof u.cloud === "object") {
    out.cloud = { ...out.cloud, ...u.cloud };
  }

  // wizard
  if (u.wizard && typeof u.wizard === "object") {
    out.wizard = { ...out.wizard, ...u.wizard };
  }

  return out;
}

/**
 * Load the Osler config. Fetches `/osler.config.json` once, caches the result
 * in-memory. On any failure (fetch error, parse error), returns the default
 * config so the app always boots.
 *
 * Safe to call from client components only.
 */
export async function loadConfig(): Promise<OslerConfig> {
  if (cached) return cached;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const res = await fetch(CONFIG_URL, { cache: "no-store" });
      if (!res.ok) {
        cached = structuredClone(DEFAULT_CONFIG);
        return cached;
      }
      const json = (await res.json()) as unknown;
      cached = mergeConfig(json);
      // Persist a copy to localStorage so subsequent boots can read it
      // synchronously (avoids a flash of default config before fetch resolves).
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
      } catch {
        // ignore quota errors
      }
      return cached;
    } catch {
      // Network/parse failure — fall back to cached localStorage value if any,
      // otherwise the default config.
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          cached = mergeConfig(JSON.parse(stored));
          return cached;
        }
      } catch {
        // ignore
      }
      cached = structuredClone(DEFAULT_CONFIG);
      return cached;
    }
  })();

  return loadingPromise;
}

/**
 * Synchronously get the cached config. Returns the default config if
 * `loadConfig()` has not resolved yet. Use this in render paths where you
 * can't await; prefer `loadConfig()` in effects.
 */
export function getConfig(): OslerConfig {
  if (cached) return cached;
  // Try localStorage cache (synchronous) so first paint matches last boot.
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        cached = mergeConfig(JSON.parse(stored));
        return cached;
      }
    } catch {
      // ignore
    }
  }
  return DEFAULT_CONFIG;
}

/** Replace the in-memory cache (used after admin writes a new config). */
export function setCachedConfig(cfg: OslerConfig): void {
  cached = cfg;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

/* ─────────────────────────── Helpers ──────────────────────────────── */

/** True if the given engine plugin is enabled (defaults to true if absent). */
export function isEngineEnabled(type: EngineType): boolean {
  const cfg = getConfig();
  const entry = cfg.engines[type];
  return entry?.enabled ?? true;
}

/** List of enabled engine ids (in canonical order). */
export function enabledEngines(): EngineType[] {
  return ENGINE_PLUGIN_IDS.filter(isEngineEnabled);
}

/** Get the site name (falls back to default if config not loaded yet). */
export function getSiteName(): string {
  return getConfig().site.name;
}

/** Get the site tagline. */
export function getSiteTagline(): string {
  return getConfig().site.tagline;
}

/** Get the site short name (for PWA / mobile home screen). */
export function getSiteShortName(): string {
  return getConfig().site.shortName;
}

/** Get the canonical GitHub repo URL. */
export function getGithubRepo(): string {
  return getConfig().site.githubRepo;
}

/** Get the default theme id. */
export function getDefaultTheme(): string {
  return getConfig().themes.default;
}

/** Get the list of custom themes (in addition to dark/light). */
export function getCustomThemes(): CustomThemeConfig[] {
  return getConfig().themes.custom;
}

/** True if the first-time wizard has been completed. */
export function isWizardCompleted(): boolean {
  return getConfig().wizard.completed;
}

/** Look up a specific engine plugin's override (label/icon/color) or null. */
export function getEngineOverride(type: EngineType): EnginePluginConfig | null {
  return getConfig().engines[type] ?? null;
}
