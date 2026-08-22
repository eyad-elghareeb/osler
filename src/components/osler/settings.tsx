"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  AlertTriangle,
  Check,
  Keyboard,
  Save,
  Undo2,
  RotateCcw,
  CornerDownLeft,
  Globe,
  Languages,
  Download,
  HardDrive,
  FolderTree,
  Layers,
  Smartphone,
  FileArchive,
  Fingerprint,
  Vibrate,
  SwitchCamera,
  Sun,
  Wifi,
  ArrowLeft,
  ChevronRight,
  Github,
  Info,
  ExternalLink,
  Palette,
  User,
  Cloud,
  LogOut,
  KeyRound,
  Database,
  ShieldCheck,
  Loader2,
  Puzzle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnimatedDisclosure } from "@/components/osler/ui-primitives";
import { storage } from "@/lib/osler/storage";
import { SyncSettingsSection } from "./sync/sync-settings-section";
import { CloudSyncStatusCard } from "./sync/cloud-sync-status";
import { FileSyncPanel } from "./sync/file-sync-panel";
import {
  SHORTCUT_ACTIONS,
  loadBindings,
  saveBindings,
  resetBindings,
  defaultBindings,
  findConflicts,
  describeBinding,
  type ShortcutScope,
} from "@/lib/osler/shortcuts";
import { useI18n } from "./i18n-provider";
import { LANGUAGES, UI_LANGS, type UiLang, type ContentLangFilter, type StringKey } from "@/lib/osler/i18n";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { NavigationStack } from "./navigation-stack";
import {
  isHapticsEnabled,
  setHapticsEnabled,
  haptic,
  isViewTransitionsSupported,
  isWakeLockSupported,
  checkBiometricAvailability,
  enrollBiometric,
  disableBiometric,
} from "@/lib/osler/native";
import {
  isAnimationsEnabled,
  setAnimationsEnabled,
} from "@/lib/osler/motion";
import { getConfig, getGithubRepo, getSiteName, getSiteTagline } from "@/lib/osler/config";
import { loadCategoryTrees, getEngineMeta, nodeUrls } from "@/lib/osler/content";
import type { EngineType, ContentTreeNode } from "@/lib/osler/types";
import { useContentCache, type DownloadState } from "@/hooks/use-content-cache";
import { ContentCacheButton } from "./content-cache-button";
import { ENGINE_PLUGIN_IDS } from "@/lib/osler/config";
import { useOslerTheme } from "./theme-provider";
import {
  readCloudSession,
  getCloudAccount,
  updateCloudAccount,
  changeCloudPassword,
  exportCloudAccount,
  deleteCloudAccount,
  logoutCloudAccount,
  cloudEnabled,
  applyGeminiKeyInfo,
  GEMINI_CLOUD_SYNCED_FLAG,
  CloudApiError,
  type CloudSession,
  type CloudAccount,
} from "@/lib/osler/cloud";

/* ─── Models & storage keys (shared with ai-assistant.tsx) ──────────── */

const MODELS = [
  ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite (default, fastest & cost-efficient)"],
  ["gemini-3.7-flash", "Gemini 3.7 Flash (newest, most capable Flash)"],
  ["gemini-3.6-flash", "Gemini 3.6 Flash (fast & efficient)"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash (stable, high-throughput)"],
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite (fast & modern)"],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview (most capable, premium)"],
  ["gemini-3-flash-preview", "Gemini 3 Flash Preview (experimental)"],
  ["gemma-4-26b-a4b-it", "Gemma 4 26B IT (open model, strong & free)"],
  ["gemma-4-31b-it", "Gemma 4 31B IT (larger open model)"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite (budget fallback)"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash (older fallback)"],
] as const;

const STORAGE_KEYS = {
  apiKey: "osler_gemini_api_key",
  model: "osler_gemini_model",
  maxWait: "osler_gemini_max_wait",
} as const;

const OSCE_VOICE_MODELS = [
  ["gemini-3.1-flash-live-preview", "Gemini 3.1 Flash Live (default, recommended)"],
  ["gemini-2.5-flash-native-audio-preview-12-2025", "Gemini 2.5 Flash Live — native audio"],
] as const;

const OSCE_STORAGE_KEYS = {
  liveModel: "osler_osce_live_model",
  voiceOn: "osler_osce_voice_on",
  ttsVoice: "osler_osce_tts_voice",
  ttsRate: "osler_osce_tts_rate",
  // Opt-in Live transcripts (default off — see STORAGE in osce-studio.tsx).
  liveTranscripts: "osler_osce_live_transcripts",
} as const;

/* ─── Section catalog ─────────────────────────────────────────────── */

export type SettingsSection = "account" | "appearance" | "language" | "ai" | "shortcuts" | "downloads" | "sync" | "backup" | "native" | "about" | "danger";

interface SectionMeta {
  id: SettingsSection;
  labelKey: StringKey;
  icon: React.ComponentType<{ className?: string }>;
  /** English keywords for settings search. */
  keywords: string;
}

const SECTIONS: SectionMeta[] = [
  { id: "account",    labelKey: "settings.section.account",   icon: User,         keywords: "account profile email password auth google sync status export delete logout cloud" },
  { id: "appearance", labelKey: "settings.theme.title", icon: Palette, keywords: "theme appearance dark light color palette custom" },
  { id: "language",  labelKey: "settings.section.language",  icon: Languages,    keywords: "language arabic english rtl ui direction locale" },
  { id: "ai",        labelKey: "settings.section.ai",        icon: Sparkles,     keywords: "ai assistant gemini api key model osce voice" },
  { id: "shortcuts", labelKey: "settings.section.shortcuts", icon: Keyboard,     keywords: "keyboard shortcuts hotkeys bindings" },
  { id: "downloads", labelKey: "settings.section.downloads", icon: Download,     keywords: "downloads offline cache storage service worker" },
  { id: "sync",      labelKey: "settings.section.sync",      icon: Smartphone,   keywords: "sync peer webrtc qr sync devices" },
  { id: "native",    labelKey: "settings.section.native",    icon: Fingerprint,  keywords: "native haptics biometric fingerprint view transitions wake lock network animations" },
  { id: "backup",    labelKey: "settings.section.backup",    icon: FileArchive,  keywords: "backup restore export import file" },
  { id: "about",     labelKey: "settings.section.about",     icon: Info,         keywords: "about github repo version site name theme plugins config" },
  { id: "danger",    labelKey: "settings.section.danger",    icon: AlertTriangle, keywords: "danger reset clear data delete wipe progress" },
];

function renderSection(id: SettingsSection) {
  switch (id) {
    case "account":   return <AccountSettingsSection />;
    case "appearance": return <ThemeSettingsSection />;
    case "language":  return <LanguageSettingsSection />;
    case "ai":        return <AiSettingsSection />;
    case "shortcuts": return <ShortcutsSettingsSection />;
    case "downloads": return <DownloadsSettingsSection />;
    case "sync":      return <SyncSettingsSection />;
    case "native":    return <NativeSettingsSection />;
    case "backup":    return <BackupSettingsSection />;
    case "about":     return <AboutSettingsSection />;
    case "danger":    return <DangerZoneSection />;
  }
}

/**
 * Settings — sidebar layout on desktop (md+), stacked pages on mobile.
 *
 * Desktop: a sticky left sidebar lists every section; the right pane shows
 * the active section. A search input at the top filters the sidebar list
 * by label/keywords and jumps to the first match on Enter.
 *
 * Mobile: the home page lists every section as a tappable row (iOS-style).
 * Tapping a row pushes a sub-page with a back button. AnimatePresence
 * slides the sub-page in from the inline-end side for a native push feel.
 */
export function Settings({
  initialSection = "language",
}: {
  initialSection?: SettingsSection;
}) {
  const { t, rtl } = useI18n();
  const isMobile = useIsMobile();
  // On desktop `section` always holds the visible section. On mobile we
  // also track whether we're on the home list (`mobileHome`) — when true
  // the home list is shown and `section` is the *next* section to open.
  const [section, setSection] = React.useState<SettingsSection>(initialSection);
  // +1 = new section is below the previous one in SECTIONS order (content
  // slides up-in from below), -1 = above (slides down-in from above).
  const [sectionDirection, setSectionDirection] = React.useState<1 | -1>(1);
  // On mobile, the home list is the landing page (the "main settings page").
  // We always start there unless the caller explicitly requests a non-default
  // section via initialSection.
  //
  // BUG FIX: The previous logic used `useIsMobile()` in the initializer, but
  // `useIsMobile()` returns false on the very first render (its internal
  // useState starts as undefined → !!undefined = false). This caused
  // mobileHome to initialize as false, so the language subpage showed first
  // on mobile. The effect `if (!isMobile) setMobileHome(false)` then ran on
  // mount with the stale isMobile=false, cementing the wrong value.
  //
  // FIX: Use a lazy initializer that reads window.innerWidth synchronously.
  // Since Settings only mounts when the user navigates to it (view === "settings"),
  // window is always available — no SSR concern. The prevIsMobileRef effect
  // handles form-factor changes (desktop ↔ mobile resize) without touching
  // mobileHome on the initial mount.
  const [mobileHome, setMobileHome] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 768 && initialSection === "language";
  });

  // Handle form-factor transitions (desktop ↔ mobile resize). We skip the
  // initial mount to avoid clobbering the lazy initializer's value — the
  // stale isMobile=false on the first render would otherwise set
  // mobileHome=false before the real isMobile value arrives.
  const prevIsMobileRef = React.useRef(isMobile);
  React.useEffect(() => {
    if (prevIsMobileRef.current === isMobile) return;
    prevIsMobileRef.current = isMobile;
    if (isMobile) {
      // Transitioned to mobile — show home list unless a specific section
      // was explicitly requested.
      setMobileHome(initialSection === "language");
    } else {
      // Transitioned to desktop — reset (desktop doesn't use mobileHome).
      setMobileHome(false);
    }
  }, [isMobile, initialSection]);

  // Sync external `initialSection` changes (e.g. user picked a section from
  // the global search). On mobile this also pushes onto the page stack.
  // Skip the initial mount — useState already handles the correct initial state.
  const prevInitialRef = React.useRef(initialSection);
  React.useEffect(() => {
    if (prevInitialRef.current === initialSection) return;
    prevInitialRef.current = initialSection;
    setSection(initialSection);
    setMobileHome(false);
  }, [initialSection]);

  const pickSection = (id: SettingsSection) => {
    haptic("selection");
    // Direction-aware transition (Cult UI "Direction Aware Tabs" pattern —
    // see design-library-roadmap.md § "Next-wave candidate additions").
    // Settings' section switcher is a vertical sidebar, not a horizontal
    // tab strip, so "direction" here means down/up through SECTIONS'
    // order rather than left/right — the content pane slides toward
    // wherever the newly picked section sits relative to the current one,
    // which reads as spatial continuity instead of a generic fade.
    const fromIdx = SECTIONS.findIndex((s) => s.id === section);
    const toIdx = SECTIONS.findIndex((s) => s.id === id);
    if (fromIdx !== -1 && toIdx !== -1 && toIdx !== fromIdx) {
      setSectionDirection(toIdx > fromIdx ? 1 : -1);
    }
    setSection(id);
    setMobileHome(false);
  };

  const goHome = () => {
    haptic("selection");
    setMobileHome(true);
  };

  // The iOS NavigationController-style back swipe, parallax, and stacked
  // page animations are handled by the reusable NavigationStack component.

  // ── Mobile: iOS NavigationController-style stacked pages ──────────
  // The home list is always rendered underneath. Subpages slide in from
  // the inline-end side and can be dragged back to reveal the home list
  // with a parallax effect — exactly like iOS Settings / Mail / Messages.
  // The animation logic lives in the reusable NavigationStack component.
  if (isMobile) {
    const activeMeta = SECTIONS.find((s) => s.id === section);
    return (
      <div className="h-full flex flex-col">
        {/* Page stack — NavigationStack handles the home-underneath +
            subpage-overlay layout, drag-to-go-back, and parallax. */}
        <NavigationStack
          className="flex-1 min-h-0"
          homeClassName="osler-page"
          subpageClassName="osler-page"
          rtl={rtl}
          home={
            <div className="max-w-2xl mx-auto px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-2">
                {t("settings.mobileHomeSubtitle")}
              </div>
              <div className="rounded-lg border border-border overflow-hidden bg-card">
                {SECTIONS.map((s, idx) => {
                  const I = s.icon;
                  return (
                    <button
                      key={s.id}
                      onClick={() => pickSection(s.id)}
                      className={cn(
                        "w-full text-start px-4 py-3 flex items-center gap-3 hover:bg-muted/60 transition-colors",
                        idx > 0 && "border-t border-border",
                      )}
                    >
                      <span className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <I className="size-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{t(s.labelKey)}</span>
                        <span className="block text-[11px] text-muted-foreground truncate">{s.keywords}</span>
                      </span>
                      <ChevronRight className={cn("size-4 text-muted-foreground shrink-0", rtl && "rtl-flip-x")} />
                    </button>
                  );
                })}
              </div>
            </div>
          }
          subpage={
            mobileHome ? null : (
              <div className="px-4 py-4">
                {/* Section header with back button */}
                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={goHome}
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors osler-touch-target -ms-1 ps-1"
                    aria-label={t("settings.backToList")}
                  >
                    <ArrowLeft className={cn("size-4", rtl && "rtl-flip-x")} />
                    <span>{t("settings.backToList")}</span>
                  </button>
                </div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2 mb-4">
                  {(() => {
                    const I = activeMeta?.icon ?? SettingsIcon;
                    return <I className="size-5 text-primary" />;
                  })()}
                  {activeMeta ? t(activeMeta.labelKey) : t("settings.title")}
                </h1>
                {renderSection(section)}
              </div>
            )
          }
          onBack={goHome}
        />
      </div>
    );
  }

  // ── Desktop: sidebar + content pane ────────────────────────────────
  return (
    <div className="h-full overflow-y-auto osler-scroll">
      <div className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 py-6 md:py-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
        >
          <div className="osler-page-header--inline">
            <div className="size-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
              <SettingsIcon className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="osler-page-header__title">{t("settings.title")}</h1>
              <p className="osler-page-header__subtitle">{t("settings.subtitle")}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr] gap-6">
            {/* Sidebar */}
            <aside className="md:sticky md:top-6 md:self-start">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 mb-1.5">
                {t("settings.sidebarTitle")}
              </div>
              <nav className="space-y-0.5">
                {SECTIONS.map((s) => {
                    const I = s.icon;
                    const active = section === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => pickSection(s.id)}
                        className={cn(
                          "relative w-full text-start h-9 px-3 rounded-md text-sm font-medium flex items-center gap-2 transition-colors",
                          active
                            ? "text-primary bg-primary/10"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                        )}
                      >
                        <I className="size-4 shrink-0" />
                        <span className="truncate">{t(s.labelKey)}</span>
                        </button>
                      );
                    })}
              </nav>
            </aside>

            {/* Content pane */}
            <div className="min-w-0">
              <AnimatePresence mode="wait" custom={sectionDirection}>
                <motion.div
                  key={section}
                  custom={sectionDirection}
                  variants={{
                    enter: (dir: 1 | -1) => ({ opacity: 0, y: 10 * dir }),
                    center: { opacity: 1, y: 0 },
                    exit: (dir: 1 | -1) => ({ opacity: 0, y: -10 * dir }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                >
                  {renderSection(section)}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* ─── Theme / Appearance section ─────────────────────────────────────── */

type ThemeOption = { id: string; name: string; variant: "dark" | "light" };

interface ThemeFamily {
  id: string;
  name: string;
  variants: ThemeOption[];
}

export function ThemeSettingsSection() {
  const { t } = useI18n();
  const { theme, setThemeId, availableThemes } = useOslerTheme();

  const themeFamilies = React.useMemo<ThemeFamily[]>(() => {
    const families = new Map<string, ThemeFamily>();
    for (const option of availableThemes) {
      const id = option.id === "dark" || option.id === "light"
        ? "osler-default"
        : option.id.replace(/-(dark|light)$/i, "");
      const current = families.get(id);
      if (current) {
        current.variants.push(option);
      } else {
        families.set(id, {
          id,
          name: id === "osler-default" ? t("app.name") : option.name.replace(/\s+(dark|light)$/i, ""),
          variants: [option],
        });
      }
    }
    return Array.from(families.values()).map((family) => ({
      ...family,
      variants: [...family.variants].sort((a, b) => (a.variant === "dark" ? -1 : 1) - (b.variant === "dark" ? -1 : 1)),
    }));
  }, [availableThemes, t]);

  const builtinFamilies = themeFamilies.filter((family) => family.id === "osler-default");
  const customFamilies = themeFamilies.filter((family) => family.id !== "osler-default");
  const activeFamily = themeFamilies.find((family) => family.variants.some((option) => option.id === theme));
  const activeOption = activeFamily?.variants.find((option) => option.id === theme);
  const variantLabel = (variant: "dark" | "light") =>
    variant === "dark" ? t("settings.theme.darkVariant") : t("settings.theme.lightVariant");

  /**
   * Mini app-surface preview — a richer alternative to flat color dots.
   * Renders a scaled-down mock of an app surface: background → card →
   * primary accent bar → muted text line → secondary tint. Reads as
   * "this is what the theme looks like" instead of "these are its colors".
   *
   * The preview is scoped to the theme's CSS class (`.dark`, `.light`,
   * or `.theme-<id>`) so the CSS variables resolve to the theme's actual
   * values. A 1px border separates the preview from the button chrome.
   */
  const renderThemePreview = (themeScope: string) => (
    <div
      className={cn(
        "w-full h-12 rounded-md border border-border overflow-hidden flex flex-col gap-1 p-1.5",
        themeScope,
      )}
      style={{ backgroundColor: "var(--background)" }}
      aria-hidden
    >
      {/* Card surface row — represents a card on the background */}
      <div
        className="h-3 rounded-sm flex items-center px-1 gap-1"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        {/* Primary accent dot */}
        <span
          className="size-1.5 rounded-full shrink-0"
          style={{ backgroundColor: "var(--primary)" }}
        />
        {/* Muted text line */}
        <span
          className="h-0.5 rounded-full flex-1 max-w-[40%]"
          style={{ backgroundColor: "var(--muted-foreground)", opacity: 0.5 }}
        />
      </div>
      {/* Bottom row — primary bar + secondary tint */}
      <div className="flex items-center gap-1 h-3">
        <span
          className="h-2.5 rounded-sm flex-[3]"
          style={{ backgroundColor: "var(--primary)" }}
        />
        <span
          className="h-2.5 rounded-sm flex-1"
          style={{
            backgroundColor: "var(--primary)",
            opacity: 0.25,
          }}
        />
        <span
          className="h-2.5 rounded-sm flex-1"
          style={{ backgroundColor: "var(--accent)" }}
        />
      </div>
    </div>
  );

  const renderThemeFamily = (family: ThemeFamily) => (
    <div key={family.id} className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-sm font-semibold truncate">{family.name}</span>
        {activeFamily?.id === family.id && activeOption && (
          <span className="text-[11px] text-muted-foreground shrink-0">{variantLabel(activeOption.variant)}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={family.name}>
        {family.variants.map((option) => {
          const active = option.id === theme;
          const themeScope = option.id === "dark" || option.id === "light" ? option.id : `theme-${option.id}`;
          return (
            <Button
              key={option.id}
              type="button"
              variant={active ? "default" : "outline"}
              aria-label={`${t("settings.theme.selectTheme")}: ${family.name} (${variantLabel(option.variant)})`}
              aria-pressed={active}
              onClick={() => { haptic("light"); setThemeId(option.id); }}
              className={cn(
                "h-auto min-w-0 flex-col items-stretch gap-2 p-2.5 rounded-lg",
                !active && "bg-background",
              )}
            >
              {renderThemePreview(themeScope)}
              <span className="flex items-center justify-between gap-2 text-xs font-medium">
                <span>{variantLabel(option.variant)}</span>
                {active && <Check className="size-3.5 shrink-0" />}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
          <Palette className="size-4 text-primary" />
          {t("settings.theme.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-5">
          {t("settings.theme.currentTheme")}:{" "}
          <span className="font-medium text-foreground">
            {activeFamily && activeOption ? `${activeFamily.name} · ${variantLabel(activeOption.variant)}` : theme}
          </span>
        </p>

        {/* Built-in themes */}
        <div className="space-y-3">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t("settings.theme.builtinTitle")}
            </h3>
            <p className="text-[11px] text-muted-foreground mb-3">
              {t("settings.theme.builtinDesc")}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
              {builtinFamilies.map(renderThemeFamily)}
            </div>
          </div>

          {/* Custom themes */}
          {customFamilies.length > 0 && (
            <div className="pt-4 border-t border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t("settings.theme.customTitle")}
              </h3>
              <p className="text-[11px] text-muted-foreground mb-3">
                {t("settings.theme.customDesc")}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                {customFamilies.map(renderThemeFamily)}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ─── Language section ─────────────────────────────────────────────── */

export function LanguageSettingsSection() {
  const { t, lang, setLang, contentFilter, setContentFilter, rtl } = useI18n();

  const uiLangOptions: Array<{ id: UiLang; label: string; native: string; dir: "ltr" | "rtl" }> = UI_LANGS.map(
    (code) => ({
      id: code,
      label: LANGUAGES[code].name,
      native: LANGUAGES[code].nativeName,
      dir: LANGUAGES[code].dir,
    }),
  );

  // Content-language filter options are derived entirely from `LANGUAGES`
  // so adding a new language is a one-file edit (languages.ts). The label
  // falls back to a generic `contentLangOnly` template keyed by the
  // language's English name, with a per-language override key
  // (`contentLangEn`, `contentLangAr`, …) when it exists.
  const contentFilterOptions: Array<{ id: ContentLangFilter; label: string }> = [
    { id: "all", label: t("settings.language.contentLangAll") },
    ...UI_LANGS.map((code) => {
      // Build the per-language override key (e.g. "en" → "contentLangEn").
      // If the override exists in the i18n table, use it; otherwise fall
      // back to the generic `contentLangOnly` template with the language's
      // English name interpolated.
      const overrideKey = `settings.language.contentLang${code.toUpperCase().slice(0, 1)}${code.slice(1)}` as StringKey;
      const generic = t("settings.language.contentLangOnly", { name: LANGUAGES[code].name });
      const override = t(overrideKey);
      return { id: code, label: override === overrideKey ? generic : override };
    }),
  ];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
          <Languages className="size-4 text-primary" />
          {t("settings.section.language")}
        </h2>
        <p className="text-xs text-muted-foreground mb-5">
          {t("settings.language.uiLangDesc")}
        </p>

        {/* UI language selector — large radio-card style */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">
            {t("settings.language.uiLang")}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {uiLangOptions.map((opt) => {
              const active = lang === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setLang(opt.id)}
                  className={cn(
                    "text-start p-3 rounded-lg border-2 transition-all flex items-center gap-3",
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40",
                  )}
                >
                  <div
                    className={cn(
                      "size-9 rounded-full flex items-center justify-center shrink-0",
                      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {/* Show the first letter of the native name for non-Latin
                     * scripts; use a globe icon for Latin-script languages. */}
                    {/^[\u0000-\u007F]+$/.test(opt.native)
                      ? <Globe className="size-4" />
                      : <span className="text-sm font-bold">{opt.native.charAt(0)}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{opt.label}</div>
                    <div className="text-xs text-muted-foreground" dir={opt.dir} lang={opt.id}>
                      {opt.native} · {opt.dir.toUpperCase()}
                    </div>
                  </div>
                  {active && <Check className="size-4 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content-language filter */}
        <div className="space-y-2 mt-6">
          <label className="text-xs font-semibold text-muted-foreground">
            {t("settings.language.contentLang")}
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            {t("settings.language.contentLangDesc")}
          </p>
          <div className="flex flex-wrap gap-2">
            {contentFilterOptions.map((opt) => {
              const active = contentFilter === opt.id;
              // Look up the language direction for RTL pills. `opt.id` is
              // either "all" (no dir) or a UiLang code.
              const langDir = opt.id === "all" ? undefined : LANGUAGES[opt.id as UiLang]?.dir;
              const isRtl = langDir === "rtl";
              return (
                <button
                  key={opt.id}
                  onClick={() => setContentFilter(opt.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40",
                    isRtl && !active && "osler-content-ar",
                  )}
                  dir={isRtl ? "rtl" : undefined}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* RTL note */}
        <div className="mt-6 p-3 rounded-lg bg-muted/30 border border-border flex items-start gap-2 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 mt-0.5 shrink-0 text-primary" />
          <span>{t("settings.language.rtlNote")}</span>
        </div>
      </Card>

      {/* Quick preview block — shows the current UI direction live */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-2">{t("settings.section.language")}</h3>
        <div
          className={cn(
            "rounded-lg border border-border p-4 bg-card text-sm",
            rtl && "osler-content-ar",
          )}
          dir={rtl ? "rtl" : "ltr"}
          lang={lang}
        >
          <div className="font-semibold mb-1">
            {lang === "ar" ? "معاينة الواجهة" : "UI preview"}
          </div>
          <p className="text-muted-foreground">
            {lang === "ar"
              ? "هذه معاينة مباشرة لكيفية ظهور النص العربي ضمن الواجهة. لاحظ كيف تنعكس اتجاهات المحاذاة والأيقونات تلقائيًا."
              : "This is a live preview of how your UI language renders. Notice how text alignment and icon directions flip automatically when you switch to Arabic."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <div className="size-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-semibold">
              {lang === "ar" ? "ع" : "EN"}
            </div>
            <div className="flex-1">
              <div className="text-xs font-medium">
                {lang === "ar" ? "العربية" : "English"}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {rtl ? "RTL" : "LTR"} · {lang}
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ─── AI Assistant section ──────────────────────────────────────────── */

interface AiFormState {
  apiKey: string;
  model: string;
  maxWait: string;
}

function loadAiForm(): AiFormState {
  return {
    apiKey: (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEYS.apiKey)) || "",
    model: (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEYS.model)) || MODELS[0][0],
    maxWait: (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEYS.maxWait)) || "30",
  };
}

function saveAiForm(state: AiFormState): void {
  localStorage.setItem(STORAGE_KEYS.apiKey, state.apiKey);
  localStorage.setItem(STORAGE_KEYS.model, state.model);
  localStorage.setItem(STORAGE_KEYS.maxWait, state.maxWait);
  // A locally-edited key is no longer a pristine cloud-synced copy, so the
  // removal-reconciliation flag no longer applies.
  localStorage.removeItem(GEMINI_CLOUD_SYNCED_FLAG);
}

/**
 * Pull the user's saved Gemini key from the cloud DB (if cloud is enabled).
 * This is the "saved once" path — when a user signs in on a new device, we
 * fetch the key from /v1/account/gemini-key and write it to localStorage so
 * the AI assistant / qbank-studio / osce-studio pick it up.
 *
 * Best-effort: if the fetch fails we silently fall back to localStorage.
 */
async function syncAiFormFromCloud(onUpdate: (next: AiFormState) => void) {
  if (typeof window === "undefined") return;
  try {
    const { cloudEnabled } = await import("@/lib/osler/cloud");
    if (!(await cloudEnabled())) return;
    const { geminiApi } = await import("@/components/osler/admin/admin-api");
    const info = await geminiApi.get();
    if (info.hasKey && info.apiKey) {
      // Write to localStorage so the AI assistant etc. pick it up, flagged as
      // cloud-synced so a future removal can be reconciled across devices.
      applyGeminiKeyInfo(info);
      onUpdate({
        apiKey: info.apiKey,
        model: info.model || MODELS[0][0],
        maxWait: info.maxWait != null ? String(info.maxWait) : "30",
      });
    }
  } catch {
    // Cloud not configured or session expired — fall back to localStorage.
  }
}

/**
 * Push the user's Gemini key to the cloud DB so it's available on every
 * device they sign in from. Best-effort — if the push fails we still keep
 * the localStorage copy.
 */
async function syncAiFormToCloud(state: AiFormState) {
  if (typeof window === "undefined") return;
  try {
    const { cloudEnabled } = await import("@/lib/osler/cloud");
    if (!(await cloudEnabled())) return;
    const { geminiApi } = await import("@/components/osler/admin/admin-api");
    const key = state.apiKey.trim();
    const maxWaitNum = Number(state.maxWait);
    if (!key) {
      // Explicitly remove the cloud copy — PUT with null now means "keep",
      // so clearing an emptied field needs the DELETE endpoint.
      await geminiApi.clear();
    } else {
      await geminiApi.save(key, state.model || null, Number.isFinite(maxWaitNum) ? maxWaitNum : null);
    }
  } catch {
    // Silent fail — localStorage is still the source of truth for the session.
  }
}

function validateAiForm(
  state: AiFormState,
  t: (key: StringKey, params?: Record<string, string | number>) => string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (state.apiKey && !/^[A-Za-z0-9_\-.]{20,}$/.test(state.apiKey.trim())) {
    errors.apiKey = t("settings.ai.keyLengthError");
  }
  const mw = Number(state.maxWait);
  if (!Number.isFinite(mw) || mw < 5 || mw > 300) {
    errors.maxWait = t("settings.ai.maxWaitError");
  }
  return errors;
}

export function AiSettingsSection() {
  const { t } = useI18n();
  const [saved, setSaved] = React.useState<AiFormState>(() => loadAiForm());
  const [draft, setDraft] = React.useState<AiFormState>(() => saved);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [justSaved, setJustSaved] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<string | null>(null);
  const [cloudSynced, setCloudSynced] = React.useState(false);
  // Opt-in Live transcripts toggle. Defaults to OFF. Lives in localStorage so
  // the Live API WebSocket setup can read it on every connection without a
  // round-trip through the cloud DB.
  const [liveTranscripts, setLiveTranscripts] = React.useState<boolean>(() =>
    typeof window !== "undefined" && localStorage.getItem(OSCE_STORAGE_KEYS.liveTranscripts) === "true"
  );
  const toggleLiveTranscripts = React.useCallback(() => {
    setLiveTranscripts((prev) => {
      const next = !prev;
      localStorage.setItem(OSCE_STORAGE_KEYS.liveTranscripts, String(next));
      return next;
    });
  }, []);

  // On mount: try to pull the saved key from the cloud DB so the user doesn't
  // have to re-enter it on a new device.
  React.useEffect(() => {
    syncAiFormFromCloud((next) => {
      setSaved(next);
      setDraft(next);
      setCloudSynced(true);
    });
  }, []);

  const isDirty = React.useMemo(
    () => draft.apiKey !== saved.apiKey || draft.model !== saved.model || draft.maxWait !== saved.maxWait,
    [draft, saved],
  );

  const setField = <K extends keyof AiFormState>(key: K, value: AiFormState[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  const handleSave = () => {
    const errs = validateAiForm(draft, t);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    saveAiForm(draft);
    setSaved(draft);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
    // Async-push to cloud DB (best-effort)
    syncAiFormToCloud(draft).then(() => setCloudSynced(true));
  };

  const handleDiscard = () => {
    setDraft(saved);
    setErrors({});
  };

  const handleClearKey = () => {
    const next = { ...draft, apiKey: "" };
    setDraft(next);
    setErrors((prev) => { const n = { ...prev }; delete n.apiKey; return n; });
    saveAiForm(next);
    setSaved(next);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
    // Also clear the cloud copy
    (async () => {
      try {
        const { cloudEnabled } = await import("@/lib/osler/cloud");
        if (await cloudEnabled()) {
          const { geminiApi } = await import("@/components/osler/admin/admin-api");
          await geminiApi.clear();
        }
      } catch {}
    })();
  };

  const handleTestKey = async () => {
    if (!draft.apiKey.trim()) {
      setTestResult(t("settings.ai.noKeyEntered"));
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": draft.apiKey },
      });
      const data = await res.json();
      if (data?.models?.length) {
        setTestResult(t("settings.ai.keyValid", { n: data.models.length }));
      } else {
        setTestResult(t("settings.ai.unexpectedResponse"));
      }
    } catch {
      setTestResult(t("settings.ai.connectionFailed"));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
        <Sparkles className="size-4 text-primary" />
        {t("settings.ai.title")}
      </h2>
      <p className="text-xs text-muted-foreground mb-5">
        {t("settings.ai.subtitle")}
        {cloudSynced && (
          <span className="ml-2 inline-flex items-center gap-1 text-success">
            <Cloud className="size-3" /> {t("settings.ai.savedToAccount")}
          </span>
        )}
      </p>

      <div className="space-y-4">
        {/* API Key */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
            <span>{t("settings.ai.apiKey")}</span>
            {draft.apiKey !== saved.apiKey && (
              <span className="text-[10px] text-warning font-normal">{t("settings.ai.unsaved")}</span>
            )}
          </label>
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => setField("apiKey", e.target.value)}
            placeholder={t("settings.ai.apiKeyPlaceholder")}
            className={`flex-1 w-full h-9 rounded-lg border bg-card px-3 text-sm outline-none transition-colors ${
              errors.apiKey ? "border-destructive focus:border-destructive" : "border-border focus:border-primary"
            }`}
          />
          {errors.apiKey && <p className="text-[11px] text-destructive">{errors.apiKey}</p>}
          {!errors.apiKey && (
            <p className="text-[11px] text-muted-foreground">
              {t("settings.ai.getKey")}
            </p>
          )}
        </div>

        {/* Model + Max wait */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">{t("settings.ai.model")}</label>
            <select
              value={draft.model}
              onChange={(e) => setField("model", e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
            >
              {MODELS.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">{t("settings.ai.maxWait")}</label>
            <select
              value={draft.maxWait}
              onChange={(e) => setField("maxWait", e.target.value)}
              className={`w-full h-9 rounded-lg border bg-card px-3 text-sm outline-none transition-colors ${
                errors.maxWait ? "border-destructive" : "border-border focus:border-primary"
              }`}
            >
              <option value="15">{t("settings.ai.maxWait.15")}</option>
              <option value="30">{t("settings.ai.maxWait.30")}</option>
              <option value="60">{t("settings.ai.maxWait.60")}</option>
              <option value="120">{t("settings.ai.maxWait.120")}</option>
            </select>
            {errors.maxWait && <p className="text-[11px] text-destructive">{errors.maxWait}</p>}
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <p className={cn("text-xs", testResult.startsWith("✓") ? "text-success" : "text-destructive")}>
            {testResult}
          </p>
        )}

        {/* ── OSCE Voice Settings ── */}
        <div className="pt-4 border-t border-border">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-1">
            <Sparkles className="size-4 text-primary" />
            {t("settings.ai.osceVoice")}
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            {t("settings.ai.osceVoiceDesc")}
          </p>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">{t("settings.ai.liveModel")}</label>
                <select
                  value={typeof window !== "undefined" ? localStorage.getItem(OSCE_STORAGE_KEYS.liveModel) || OSCE_VOICE_MODELS[0][0] : OSCE_VOICE_MODELS[0][0]}
                  onChange={(e) => { localStorage.setItem(OSCE_STORAGE_KEYS.liveModel, e.target.value); }}
                  className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
                >
                  {OSCE_VOICE_MODELS.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.ai.liveModelDesc")}
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">{t("settings.ai.ttsRate")}</label>
                <select
                  value={typeof window !== "undefined" ? localStorage.getItem(OSCE_STORAGE_KEYS.ttsRate) || "0.95" : "0.95"}
                  onChange={(e) => { localStorage.setItem(OSCE_STORAGE_KEYS.ttsRate, e.target.value); }}
                  className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="0.5">{t("settings.ai.ttsRate.slow")}</option>
                  <option value="0.75">{t("settings.ai.ttsRate.slowPlus")}</option>
                  <option value="0.95">{t("settings.ai.ttsRate.normal")}</option>
                  <option value="1.2">{t("settings.ai.ttsRate.fast")}</option>
                  <option value="1.5">{t("settings.ai.ttsRate.fastest")}</option>
                </select>
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.ai.ttsRateDesc")}
                </p>
              </div>
            </div>

            {/* Live transcripts opt-in (default off) */}
            <div className="flex items-start justify-between gap-3 pt-3 mt-1 border-t border-border/60">
              <div className="min-w-0 space-y-1">
                <div className="text-xs font-semibold text-foreground">{t("settings.ai.liveTranscripts")}</div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {t("settings.ai.liveTranscriptsDesc")}
                </p>
              </div>
              <ToggleSwitch
                checked={liveTranscripts}
                onChange={toggleLiveTranscripts}
                label={t("settings.ai.liveTranscripts")}
              />
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
          <Button size="sm" variant="default" onClick={handleSave} disabled={!isDirty} className="h-8 text-xs">
            {justSaved ? (
              <><Check className="size-3 me-1" /> {t("common.saved")}</>
            ) : (
              <><Save className="size-3 me-1" /> {t("common.saveChanges")}</>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDiscard} disabled={!isDirty} className="h-8 text-xs">
            <Undo2 className="size-3 me-1" /> {t("common.discard")}
          </Button>
          <Button size="sm" variant="secondary" onClick={handleTestKey} disabled={testing} className="h-8 text-xs">
            {testing ? t("settings.ai.testing") : t("settings.ai.testConnection")}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleClearKey} className="h-8 text-xs ms-auto">
            <Trash2 className="size-3 me-1" /> {t("settings.ai.clearKey")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ─── Keyboard shortcuts section ────────────────────────────────────── */

function ShortcutsSettingsSection() {
  const { t, tList } = useI18n();
  const [saved, setSaved] = React.useState<Record<string, string>>(() => loadBindings());
  const [draft, setDraft] = React.useState<Record<string, string>>(() => saved);
  const [justSaved, setJustSaved] = React.useState(false);

  const isDirty = React.useMemo(() => {
    for (const a of SHORTCUT_ACTIONS) {
      if ((draft[a.id] ?? "") !== (saved[a.id] ?? "")) return true;
    }
    return false;
  }, [draft, saved]);

  const setBinding = (actionId: string, binding: string) => {
    setDraft((d) => ({ ...d, [actionId]: binding }));
  };

  const handleSave = () => {
    saveBindings(draft);
    setSaved(draft);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const handleDiscard = () => {
    setDraft(saved);
  };

  const handleResetAll = () => {
    setDraft(defaultBindings());
  };

  const handleResetOne = (actionId: string) => {
    const def = defaultBindings()[actionId] ?? "";
    setDraft((d) => ({ ...d, [actionId]: def }));
  };

  const scopeMeta: Record<ShortcutScope, { label: string; description: string }> = {
    global: { label: t("settings.shortcuts.scope.global"), description: t("settings.shortcuts.scope.globalDesc") },
    qbank: { label: t("settings.shortcuts.scope.qbank"), description: t("settings.shortcuts.scope.qbankDesc") },
    flashcard: { label: t("settings.shortcuts.scope.flashcard"), description: t("settings.shortcuts.scope.flashcardDesc") },
    reader: { label: t("settings.shortcuts.scope.reader"), description: t("settings.shortcuts.scope.readerDesc") },
    videos: { label: t("settings.shortcuts.scope.videos"), description: t("settings.shortcuts.scope.videosDesc") },
  };

  const scopes: ShortcutScope[] = ["global", "qbank", "flashcard", "reader", "videos"];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Keyboard className="size-4 text-primary" />
            {t("settings.shortcuts.title")}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          {t("settings.shortcuts.subtitle")}
        </p>

        <div className="space-y-6">
          {scopes.map((scope) => {
            const actions = SHORTCUT_ACTIONS.filter((a) => a.scope === scope);
            const meta = scopeMeta[scope];
            if (!actions.length) return null;
            return (
              <div key={scope}>
                <div className="mb-2">
                  <h3 className="text-sm font-semibold">{meta.label}</h3>
                  <p className="text-[11px] text-muted-foreground">{meta.description}</p>
                </div>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full">
                    <tbody>
                      {actions.map((a, idx) => {
                        const currentBinding = draft[a.id] ?? "";
                        const conflicts = findConflicts(draft, a.id, currentBinding);
                        const isDefault = currentBinding === a.defaultBinding;
                        const conflictNames = conflicts
                          .map((c) => {
                            const act = SHORTCUT_ACTIONS.find((x) => x.id === c);
                            return act ? t(act.labelKey) : c;
                          })
                          .join(", ");
                        return (
                          <tr key={a.id} className={idx > 0 ? "border-t border-border" : ""}>
                            <td className="py-2.5 px-3 align-middle w-1/2">
                              <div className="text-sm font-medium">{t(a.labelKey)}</div>
                              <div className="text-[11px] text-muted-foreground">{t(a.descriptionKey)}</div>
                              {conflicts.length > 0 && (
                                <div className="text-[11px] text-warning mt-1">
                                  ⚠ {t("settings.shortcuts.conflictsWith", { names: conflictNames })}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 align-middle">
                              <KeyCaptureInput
                                value={currentBinding}
                                onChange={(b) => setBinding(a.id, b)}
                                onReset={() => handleResetOne(a.id)}
                              />
                              {!isDefault && currentBinding && (
                                <div className="text-[10px] text-muted-foreground mt-1">
                                  {t("settings.shortcuts.default")}: <span className="font-mono">{describeBinding(a.defaultBinding)}</span>
                                </div>
                              )}
                              {!currentBinding && (
                                <div className="text-[10px] text-muted-foreground mt-1">{t("settings.shortcuts.disabled")}</div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-4 mt-5 border-t border-border">
          <Button size="sm" variant="default" onClick={handleSave} disabled={!isDirty} className="h-8 text-xs">
            {justSaved ? (
              <><Check className="size-3 me-1" /> {t("common.saved")}</>
            ) : (
              <><Save className="size-3 me-1" /> {t("common.saveChanges")}</>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDiscard} disabled={!isDirty} className="h-8 text-xs">
            <Undo2 className="size-3 me-1" /> {t("common.discard")}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleResetAll} className="h-8 text-xs ms-auto">
            <RotateCcw className="size-3 me-1" /> {t("settings.shortcuts.resetAll")}
          </Button>
        </div>
      </Card>

      <Card className="p-4 bg-muted/30">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <CornerDownLeft className="size-3.5 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-foreground mb-1">{t("settings.shortcuts.tipsTitle")}</p>
            <ul className="space-y-1 list-disc list-inside">
              {tList("settings.shortcuts.tips").map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
            <p className="mt-2 text-foreground/80">{t("settings.shortcuts.scopeConflictNote")}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ─── Key capture input (inline) ────────────────────────────────────── */

function KeyCaptureInput({
  value,
  onChange,
  onReset,
}: {
  value: string;
  onChange: (binding: string) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const [capturing, setCapturing] = React.useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { setCapturing(false); return; }
    if (e.key === "Backspace") { onChange(""); setCapturing(false); return; }

    const parts: string[] = [];
    if (e.metaKey) parts.push("mod");
    else if (e.ctrlKey) parts.push("ctrl");
    if (e.altKey) parts.push("alt");
    if (e.shiftKey && !["Shift", "Control", "Alt", "Meta"].includes(e.key)) parts.push("shift");
    const key = e.key;
    if (!["Shift", "Control", "Alt", "Meta"].includes(key)) {
      parts.push(key.toLowerCase());
      onChange(parts.join("+"));
      setCapturing(false);
    }
  };

  if (capturing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          onKeyDown={handleKeyDown}
          onBlur={() => setCapturing(false)}
          className="w-full h-8 px-2 rounded border-2 border-primary bg-card text-xs font-mono outline-none"
          placeholder={t("settings.shortcuts.pressKeys")}
          value=""
          readOnly
        />
        <button
          onClick={() => setCapturing(false)}
          className="text-[10px] text-muted-foreground hover:text-foreground shrink-0"
        >
          {t("settings.shortcuts.cancel")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setCapturing(true)}
        className="w-full h-8 px-2 rounded border border-border bg-card text-xs font-mono text-left hover:border-primary/60 transition-colors"
      >
        {value ? describeBinding(value) : <span className="text-muted-foreground italic">{t("settings.shortcuts.clickToSet")}</span>}
      </button>
      {value && (
        <button
          onClick={onReset}
          className="size-6 rounded flex items-center justify-center hover:bg-muted shrink-0"
          title={t("settings.shortcuts.resetOne")}
          aria-label={t("settings.shortcuts.resetOne")}
        >
          <RotateCcw className="size-3" />
        </button>
      )}
    </div>
  );
}

/* ─── Downloads section (offline content cache management) ──────────── */

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function DownloadsSettingsSection() {
  const { t, rtl } = useI18n();
  const { getState, checkStatus, precache, remove } = useContentCache();
  const [stats, setStats] = React.useState<{ count: number; size: number } | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const [trees, setTrees] = React.useState<Record<string, ContentTreeNode[]> | null>(null);
  const [typeFilter, setTypeFilter] = React.useState<EngineType | "all">("all");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const swAvailable =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    !!navigator.serviceWorker.controller;

  const refreshStats = React.useCallback(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (!navigator.serviceWorker.controller) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "CONTENT_CACHE_STATS") {
        setStats({ count: event.data.count, size: event.data.size });
        navigator.serviceWorker.removeEventListener("message", handler);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    navigator.serviceWorker.controller.postMessage({ type: "GET_CONTENT_CACHE_STATS" });
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", handler);
    }, 3000);
  }, []);

  React.useEffect(() => {
    loadCategoryTrees()
      .then(setTrees)
      .catch(() => setTrees({}));
  }, []);

  React.useEffect(() => {
    refreshStats();
    const timer = setTimeout(refreshStats, 2000);
    return () => clearTimeout(timer);
  }, [refreshStats]);

  // Check cache status for visible leaf packs once trees load / SW becomes ready
  React.useEffect(() => {
    if (!trees || !swAvailable) return;
    const leaves: ContentTreeNode[] = [];
    const walk = (nodes: ContentTreeNode[]) => {
      for (const n of nodes) {
        if (n.items.length === 0) leaves.push(n);
        else walk(n.items);
      }
    };
    for (const nodes of Object.values(trees)) walk(nodes);
    for (const leaf of leaves) {
      const urls = nodeUrls(leaf);
      if (urls.length > 0) checkStatus(leaf.uid, urls);
    }
  }, [trees, swAvailable, checkStatus]);

  const handleClear = React.useCallback(() => {
    if (!swAvailable) return;
    setClearing(true);
    navigator.serviceWorker.controller!.postMessage({ type: "CLEAR_CONTENT_CACHE" });
    setTimeout(() => {
      setClearing(false);
      setConfirmClear(false);
      refreshStats();
      if (trees) {
        const walk = (nodes: ContentTreeNode[]) => {
          for (const n of nodes) {
            if (n.items.length === 0) checkStatus(n.uid, nodeUrls(n));
            else walk(n.items);
          }
        };
        for (const nodes of Object.values(trees)) walk(nodes);
      }
    }, 800);
  }, [swAvailable, refreshStats, trees, checkStatus]);

  const visibleTypes = React.useMemo<EngineType[]>(() => {
    if (!trees) return [];
    const order: EngineType[] = ["quiz", "bank", "written", "flashcard", "osce", "library", "video"];
    return order.filter((et) => (trees[et]?.length ?? 0) > 0);
  }, [trees]);

  const filteredTypes = typeFilter === "all" ? visibleTypes : [typeFilter];

  const collapsedAll = () => {
    const next = new Set<string>();
    setExpanded(next);
  };
  const expandAll = () => {
    const next = new Set<string>();
    if (trees) {
      const walk = (nodes: ContentTreeNode[]) => {
        for (const n of nodes) {
          if (n.items.length > 0) {
            next.add(n.uid);
            walk(n.items);
          }
        }
      };
      for (const et of filteredTypes) walk(trees[et] ?? []);
    }
    setExpanded(next);
  };

  const toggle = (uid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  const bulkAction = (action: "download" | "remove") => {
    if (!trees) return;
    const walk = (nodes: ContentTreeNode[]) => {
      for (const n of nodes) {
        const urls = nodeUrls(n);
        if (urls.length > 0) {
          if (action === "download") precache(n.uid, urls);
          else remove(n.uid, urls);
        }
        if (n.items.length > 0) walk(n.items);
      }
    };
    for (const et of filteredTypes) walk(trees[et] ?? []);
    haptic(action === "download" ? "success" : "warning");
  };

  const renderNode = (node: ContentTreeNode, depth: number): React.ReactNode => {
    const isBranch = node.items.length > 0;
    const urls = nodeUrls(node);
    const state = getState(node.uid);
    if (isBranch) {
      const open = expanded.has(node.uid);
      const leafCount = countLeaves(node);
      const cachedCount = countCached(node, getState);
      return (
        <div key={node.uid}>
          <button
            type="button"
            onClick={() => toggle(node.uid)}
            className="w-full flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-muted/60 transition-colors text-start"
            style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
          >
            <ChevronRight
              className={cn("size-4 text-muted-foreground shrink-0 transition-transform", open && "rotate-90", rtl && "rtl-flip-x")}
            />
            <FolderTree className="size-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">{node.title}</span>
            <span className="text-[11px] text-muted-foreground ms-auto shrink-0">
              {t("settings.downloads.cachedCount", { cached: cachedCount, total: leafCount })}
            </span>
          </button>
          {open && <div>{node.items.map((c) => renderNode(c, depth + 1))}</div>}
        </div>
      );
    }
    return (
      <div
        key={node.uid}
        className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-muted/40 transition-colors"
        style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
      >
        <Layers className="size-4 text-muted-foreground/60 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm truncate">{node.title}</div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{t("settings.downloads.leafCount", { n: node.files?.length ?? 0 })}</span>
            {(node.images?.length ?? 0) > 0 && (
              <span>· {t("settings.downloads.images", { n: node.images!.length })}</span>
            )}
            <StatusBadge state={state} t={t} />
          </div>
        </div>
        <ContentCacheButton packId={node.uid} urls={urls} />
      </div>
    );
  };

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
        <Download className="size-4 text-primary" />
        {t("settings.downloads.title")}
      </h2>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        {t("settings.downloads.subtitle")}
      </p>

      {!swAvailable ? (
        <div className="bg-muted/40 border border-border rounded-lg p-4 text-sm text-muted-foreground">
          {t("settings.downloads.swUnavailable")}
        </div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <HardDrive className="size-5" />
              </div>
              <div>
                <div className="text-sm font-medium">
                  {stats
                    ? stats.count === 1
                      ? t("settings.downloads.oneFileCached")
                      : t("settings.downloads.filesCached", { n: stats.count })
                    : t("settings.downloads.loading")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {stats ? formatBytes(stats.size) : ""}
                </div>
              </div>
            </div>
          </div>

          {!confirmClear ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmClear(true)}
              disabled={!stats || stats.count === 0 || clearing}
            >
              <Trash2 className="size-3.5 me-1.5" />
              {t("settings.downloads.clearAll")}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{t("settings.downloads.confirm")}</span>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                onClick={handleClear}
                disabled={clearing}
              >
                {clearing ? t("settings.downloads.clearing") : t("settings.downloads.confirmYes")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setConfirmClear(false)}
                disabled={clearing}
              >
                {t("settings.downloads.cancel")}
              </Button>
            </div>
          )}

          <div className="mt-6">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold">{t("settings.downloads.managerTitle")}</h3>
              {trees && visibleTypes.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={expandAll}>
                    {t("settings.downloads.expandAll")}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={collapsedAll}>
                    {t("settings.downloads.collapseAll")}
                  </Button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              {t("settings.downloads.managerSubtitle")}
            </p>

            {!trees ? (
              <div className="text-sm text-muted-foreground py-4">{t("settings.downloads.loading")}</div>
            ) : visibleTypes.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">{t("settings.downloads.empty")}</div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <FilterPill
                    active={typeFilter === "all"}
                    onClick={() => setTypeFilter("all")}
                    label={t("settings.downloads.allTypes")}
                  />
                  {visibleTypes.map((et) => (
                    <FilterPill
                      key={et}
                      active={typeFilter === et}
                      onClick={() => setTypeFilter(et)}
                      label={t(`engine.${et}` as any)}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => bulkAction("download")}>
                    <Download className="size-3.5 me-1.5" />
                    {t("settings.downloads.downloadAll")}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => bulkAction("remove")}>
                    <Trash2 className="size-3.5 me-1.5" />
                    {t("settings.downloads.removeAll")}
                  </Button>
                </div>

                <div className="border border-border rounded-lg p-1 max-h-[420px] overflow-y-auto osler-scroll">
                  {filteredTypes.map((et) => (
                    <div key={et} className="py-1">
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ background: getEngineMeta(et).color }}
                        />
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {t("settings.downloads.typeLabel", {
                            label: t(`engine.${et}` as any),
                            n: countLeaves({ uid: "", title: "", type: et, path: "", items: trees[et] ?? [] }),
                          })}
                        </span>
                      </div>
                      {(trees[et] ?? []).map((n) => renderNode(n, 0))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onClick();
        haptic("selection");
      }}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/60 text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function StatusBadge({
  state,
  t,
}: {
  state: DownloadState;
  t: (key: StringKey, params?: Record<string, string | number>) => string;
}) {
  if (state === "cached") {
    return <span className="text-success">{t("settings.downloads.cachedBadge")}</span>;
  }
  if (state === "partial") {
    return <span className="text-warning">{t("settings.downloads.cachedBadge")}</span>;
  }
  if (state === "downloading") {
    return <span className="text-primary">{t("cache.downloadingSimple")}</span>;
  }
  if (state === "error") {
    return <span className="text-destructive">{t("cache.error")}</span>;
  }
  return <span className="text-muted-foreground">{t("settings.downloads.notCachedBadge")}</span>;
}

function countLeaves(node: ContentTreeNode): number {
  if (node.items.length === 0) return 1;
  return node.items.reduce((sum, c) => sum + countLeaves(c), 0);
}

function countCached(
  node: ContentTreeNode,
  getState: (id: string) => string
): number {
  if (node.items.length === 0) {
    return getState(node.uid) === "cached" || getState(node.uid) === "partial" ? 1 : 0;
  }
  return node.items.reduce((sum, c) => sum + countCached(c, getState), 0);
}

/* ─── Backup & Restore section (file export/import) ──────────────────── */

function BackupSettingsSection() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <FileArchive className="size-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold">{t("settings.section.backup")}</h2>
          <p className="text-xs text-muted-foreground">{t("sync.tab.fileDesc")}</p>
        </div>
      </div>
      <FileSyncPanel />
    </div>
  );
}

/* ─── Native features section (haptics / biometric / view transitions) ─ */

function NativeSettingsSection() {
  const { t } = useI18n();
  const [hapticsOn, setHapticsOn] = React.useState(false);
  const [vtOn, setVtOn] = React.useState(false);
  const [animationsOn, setAnimationsOn] = React.useState(true);
  const [biometricSupported, setBiometricSupported] = React.useState(false);
  const [biometricPlatform, setBiometricPlatform] = React.useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = React.useState(false);
  const [biometricEnabled, setBiometricEnabled] = React.useState(false);
  const [biometricCloud, setBiometricCloud] = React.useState(false);
  const [biometricBusy, setBiometricBusy] = React.useState(false);
  const [biometricMsg, setBiometricMsg] = React.useState<string>("");

  // Hydrate initial state from the lib helpers.
  React.useEffect(() => {
    setHapticsOn(isHapticsEnabled());
    setVtOn(isViewTransitionsSupported());
    setAnimationsOn(isAnimationsEnabled());
    let cancelled = false;
    checkBiometricAvailability().then((a) => {
      if (cancelled) return;
      setBiometricSupported(a.supported);
      setBiometricPlatform(a.platformAuthenticator);
      setBiometricEnrolled(a.enrolled);
      setBiometricEnabled(a.enabled);
      setBiometricCloud(a.cloudBacked);
    });
    return () => { cancelled = true; };
  }, []);

  const toggleHaptics = () => {
    const next = !hapticsOn;
    setHapticsOn(next);
    setHapticsEnabled(next);
    // Fire a test vibration so the user can feel the effect immediately.
    if (next) haptic("success");
  };

  const toggleAnimations = () => {
    const next = !animationsOn;
    setAnimationsOn(next);
    setAnimationsEnabled(next);
    haptic(next ? "success" : "light");
  };

  const testHaptics = () => {
    if (!hapticsOn) return;
    haptic("success");
  };

  const handleEnrollBiometric = async () => {
    setBiometricBusy(true);
    setBiometricMsg("");
    // When signed into a cloud account, enrollment is server-backed: the
    // Worker mints the challenge and stores the credential against the
    // account so it can quick-unlock from the login screen.
    const cloudSession = readCloudSession();
    const username =
      cloudSession?.user.username ??
      ((typeof window !== "undefined" && window.localStorage.getItem("osler-session")) || "User");
    const result = await enrollBiometric(username, cloudSession);
    setBiometricBusy(false);
    if (result.ok) {
      haptic("success");
      const a = await checkBiometricAvailability();
      setBiometricEnrolled(a.enrolled);
      setBiometricEnabled(a.enabled);
      setBiometricCloud(a.cloudBacked);
    } else {
      setBiometricMsg(
        result.message && !cloudSession
          ? result.message
          : result.reason === "cancelled"
            ? t("native.biometric.cancelled")
            : t("native.biometric.cloudError"),
      );
      haptic("error");
    }
  };

  const handleDisableBiometric = async () => {
    setBiometricBusy(true);
    setBiometricMsg("");
    await disableBiometric();
    setBiometricEnrolled(false);
    setBiometricEnabled(false);
    setBiometricCloud(false);
    setBiometricBusy(false);
    haptic("warning");
  };

  return (
    <div className="space-y-6">
      {/* Section header */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <Fingerprint className="size-4 text-primary" />
          <h2 className="text-base font-semibold">{t("native.sectionTitle")}</h2>
        </div>
        <p className="text-xs text-muted-foreground">{t("native.sectionDesc")}</p>
      </Card>

      {/* Haptics */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Vibrate className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{t("native.haptics.title")}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              {t("native.haptics.desc")}
            </p>
            <div className="flex items-center gap-2">
              <ToggleSwitch checked={hapticsOn} onChange={toggleHaptics} label={t("native.haptics.enable")} />
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={testHaptics}
                disabled={!hapticsOn}
              >
                {t("native.haptics.test")}
              </Button>
            </div>
            {!hapticsOn && (
              <p className="text-[10px] text-muted-foreground/70 mt-2">
                {t("native.haptics.unsupported")}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* View Transitions */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <SwitchCamera className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{t("native.viewTransitions.title")}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              {t("native.viewTransitions.desc")}
            </p>
            <ToggleSwitch
              checked={vtOn}
              onChange={() => {
                // View Transitions are auto-detected — we just show the
                // current state. There's no user toggle because the API
                // is either supported or not.
                haptic("light");
              }}
              label={t("native.viewTransitions.enable")}
              disabled
            />
            {!vtOn && (
              <p className="text-[10px] text-muted-foreground/70 mt-2">
                {t("native.viewTransitions.desc")}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* UI Animations — user-controlled master switch for framer-motion +
          CSS transitions across the whole app. See @/lib/osler/motion.ts. */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Sparkles className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{t("animations.title")}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              {t("animations.desc")}
            </p>
            <ToggleSwitch
              checked={animationsOn}
              onChange={toggleAnimations}
              label={t("animations.enable")}
            />
            {!animationsOn && (
              <p className="text-[10px] text-muted-foreground/70 mt-2">
                {t("animations.reduceHint")}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Biometric */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Fingerprint className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{t("native.biometric.title")}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              {t("native.biometric.desc")}
            </p>

            {!biometricSupported || !biometricPlatform ? (
              <p className="text-[11px] text-muted-foreground/80">
                {t("native.biometric.unsupported")}
              </p>
            ) : biometricEnrolled ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-success">
                  <Check className="size-3.5" />
                  <span>{t("native.biometric.enrolled", { user: "user" })}</span>
                </div>
                {biometricCloud && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("native.biometric.cloudSynced")}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs text-destructive hover:text-destructive"
                  onClick={handleDisableBiometric}
                  disabled={biometricBusy}
                >
                  {biometricBusy ? t("native.biometric.disabling") : t("native.biometric.disable")}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={handleEnrollBiometric}
                disabled={biometricBusy}
              >
                {biometricBusy ? t("native.biometric.unlocking") : t("native.biometric.enroll")}
              </Button>
            )}

            {biometricMsg && (
              <p className="text-[11px] text-destructive mt-2">{biometricMsg}</p>
            )}
          </div>
        </div>
      </Card>

      {/* Wake Lock info (read-only) */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Sun className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{t("native.wakeLock.title")}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              {t("native.wakeLock.desc")}
            </p>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "size-2 rounded-full",
                  isWakeLockSupported() ? "bg-success" : "bg-muted-foreground",
                )}
              />
              <span className="text-muted-foreground">
                {isWakeLockSupported()
                  ? t("native.wakeLock.acquired")
                  : t("native.wakeLock.unsupported")}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Network Info (read-only) */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Wifi className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{t("native.network.title")}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              {t("native.network.unavailable")}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

/**
 * Minimal accessible toggle switch — we don't pull in the shadcn Switch
 * here to avoid adding a new import cycle; this is a self-contained
 * visual equivalent with proper aria semantics.
 */
function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 transform rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/* ─── Danger Zone section ───────────────────────────────────────────── */

function DangerZoneSection() {
  const { t } = useI18n();
  const [progressCount, setProgressCount] = React.useState(0);
  const [confirmClear, setConfirmClear] = React.useState(false);

  React.useEffect(() => {
    const update = () => setProgressCount(storage.allProgress().length);
    update();
    const unsub = storage.subscribe(update);
    const unsubHydrated = storage.onHydrated(update);
    return () => {
      unsub();
      unsubHydrated();
    };
  }, []);

  const handleClearProgress = () => {
    if (typeof window !== "undefined") {
      storage.clearAll();
      setProgressCount(0);
      setConfirmClear(false);
    }
  };

  return (
    <Card className="p-5 border-destructive/30">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-3 text-destructive">
        <AlertTriangle className="size-4" />
        {t("settings.danger.title")}
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        {t("settings.danger.subtitle")}
        <br />
        <strong className="text-destructive">{t("settings.danger.warning")}</strong>
      </p>

      <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-sm font-medium">{t("settings.danger.packsWithProgress", { n: progressCount })}</div>
          <div className="text-xs text-muted-foreground">{t("settings.danger.packsWithProgressSub")}</div>
        </div>
      </div>

      {!confirmClear ? (
        <Button variant="destructive" size="sm" onClick={() => setConfirmClear(true)} disabled={progressCount === 0}>
          <Trash2 className="size-3.5 me-1.5" />
          {t("settings.danger.clearAll")}
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-destructive font-medium">{t("settings.danger.confirm")}</span>
          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleClearProgress}>
            {t("settings.danger.confirmYes")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmClear(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ─── About section (site identity, plugins, themes, GitHub repo) ──── */

/**
 * AboutSettingsSection — surfaces the osler.config-driven site identity, the
 * enabled engine plugins, the available themes, and the canonical GitHub repo
 * link. Always present, even if the user hasn't customised anything — the
 * GitHub repo link is mandatory per the project policy.
 */
function AboutSettingsSection() {
  const { t } = useI18n();
  const { availableThemes, theme: activeTheme } = useOslerTheme();
  const cfg = React.useMemo(() => getConfig(), []);
  const repo = getGithubRepo();

  const enabledPlugins = ENGINE_PLUGIN_IDS.filter((id) => cfg.engines[id]?.enabled ?? true);
  const disabledPlugins = ENGINE_PLUGIN_IDS.filter((id) => !(cfg.engines[id]?.enabled ?? true));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Info className="size-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold">{t("settings.section.about")}</h2>
          <p className="text-xs text-muted-foreground">{t("settings.about.subtitle")}</p>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("settings.about.siteIdentity")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">{t("settings.about.name")}</div>
            <div className="font-medium">{getSiteName()}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">{t("settings.about.tagline")}</div>
            <div className="font-medium">{getSiteTagline()}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">{t("settings.about.shortName")}</div>
            <div className="font-medium">{cfg.site.shortName}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">{t("settings.about.organisation")}</div>
            <div className="font-medium">{cfg.site.organisation || "—"}</div>
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Palette className="size-3.5" />
          {t("settings.about.themes")}
        </div>
        <div className="text-xs text-muted-foreground">
          {t("settings.about.activeTheme", { name: availableThemes.find((x) => x.id === activeTheme)?.name ?? activeTheme })}
        </div>
        <div className="text-xs text-muted-foreground">
          {t("settings.about.themesCount", { n: availableThemes.length })}
        </div>
      </Card>

      <AnimatedDisclosure
        label={t("settings.about.plugins")}
        icon={Puzzle}
        defaultOpen
        actions={
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-border bg-muted/40 text-muted-foreground">
            {t("settings.about.adminControlled")}
          </span>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {enabledPlugins.map((id) => (
            <span key={id} className="text-xs px-2 py-1 rounded-full border border-primary/30 bg-primary-soft text-primary">
              {id}
            </span>
          ))}
        </div>
        {disabledPlugins.length > 0 && (
          <div className="text-xs text-muted-foreground mt-2">
            {t("settings.about.disabled", { n: disabledPlugins.length })}: {disabledPlugins.join(", ")}
          </div>
        )}
        <div className="text-xs text-muted-foreground mt-2">
          {t("settings.about.pluginsNote")}
        </div>
      </AnimatedDisclosure>

      <AnimatedDisclosure
        label={t("settings.about.github")}
        icon={Github}
      >
        <a
          href={repo}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          {repo}
          <ExternalLink className="size-3" />
        </a>
        <div className="text-xs text-muted-foreground mt-2">
          {t("settings.about.githubDesc")}
        </div>
      </AnimatedDisclosure>

      <Card className="p-4">
        <div className="text-xs text-muted-foreground">
          {t("settings.about.configPath", { path: "/osler.config.json" })}
        </div>
      </Card>
    </div>
  );
}

/* ─── Account & Security section ─────────────────────────────────────── */

function AccountSettingsSection() {
  const { t } = useI18n();
  const [session, setSession] = React.useState<CloudSession | null>(() => readCloudSession());
  const [account, setAccount] = React.useState<CloudAccount | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [cloudActive, setCloudActive] = React.useState(false);

  // Profile Form state
  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [profileSaving, setProfileSaving] = React.useState(false);
  const [profileMsg, setProfileMsg] = React.useState<{ text: string; error?: boolean } | null>(null);

  // Password Form state
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [passwordSaving, setPasswordSaving] = React.useState(false);
  const [passwordMsg, setPasswordMsg] = React.useState<{ text: string; error?: boolean } | null>(null);

  // Delete Account Modal state
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = React.useState("");
  const [deletePassword, setDeletePassword] = React.useState("");
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState("");

  // Export state
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void cloudEnabled().then((enabled) => {
      if (!cancelled) setCloudActive(enabled);
    });
    if (session) {
      getCloudAccount(session)
        .then((acc) => {
          if (cancelled) return;
          setAccount(acc);
          setDisplayName(acc.user.displayName);
          setEmail(acc.user.email || "");
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const updated = await updateCloudAccount(session, {
        displayName: displayName.trim(),
        email: email.trim() || null,
      });
      setAccount(updated);
      setProfileMsg({ text: t("settings.account.profileUpdated") });
      haptic("success");
    } catch (err) {
      setProfileMsg({ text: err instanceof CloudApiError ? err.message : t("login.cloud.error"), error: true });
      haptic("error");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setPasswordSaving(true);
    setPasswordMsg(null);
    try {
      const updatedSession = await changeCloudPassword(session, {
        currentPassword: account?.user.hasPassword ? currentPassword : undefined,
        password: newPassword,
      });
      setSession(updatedSession);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordMsg({ text: t("settings.account.passwordChanged") });
      haptic("success");
    } catch (err) {
      setPasswordMsg({ text: err instanceof CloudApiError ? err.message : t("login.cloud.error"), error: true });
      haptic("error");
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleExport = async () => {
    if (!session) return;
    setExporting(true);
    haptic("light");
    try {
      const data = await exportCloudAccount(session);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `osler-account-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      haptic("success");
    } catch {
      haptic("error");
    } finally {
      setExporting(false);
    }
  };

  const handleSignOut = async () => {
    haptic("warning");
    await logoutCloudAccount(session);
    window.location.reload();
  };

  const handleDelete = async () => {
    if (!session) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteCloudAccount(session, {
        password: account?.user.hasPassword ? deletePassword : undefined,
      });
      haptic("success");
      window.location.reload();
    } catch (err) {
      setDeleteError(err instanceof CloudApiError ? err.message : t("login.cloud.error"));
      haptic("error");
    } finally {
      setDeleteBusy(false);
    }
  };

  if (!cloudActive) {
    return (
      <Card className="p-5">
        <h2 className="text-base font-semibold flex items-center gap-2 mb-2">
          <User className="size-4 text-primary" />
          {t("settings.account.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.account.localGuestDesc")}
        </p>
        <div className="p-4 rounded-lg bg-muted/30 border border-border text-xs text-muted-foreground space-y-1">
          <div className="font-semibold text-foreground">{t("settings.account.localGuest")}</div>
          <p>{t("login.demoNote")}</p>
        </div>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin me-2" />
        <span>{t("common.loading")}</span>
      </Card>
    );
  }

  if (!session || !account) {
    return (
      <Card className="p-5">
        <h2 className="text-base font-semibold flex items-center gap-2 mb-2">
          <User className="size-4 text-primary" />
          {t("settings.account.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.account.localGuestDesc")}
        </p>
        <Button onClick={() => window.location.reload()} size="default" className="gap-2">
          <User className="size-4" />
          {t("login.signIn")}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Account Overview Header */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="size-14 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-xl font-bold text-primary-foreground shrink-0 shadow-sm">
            {account.user.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold truncate">{account.user.displayName}</h2>
              <span className={cn(
                "text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border",
                account.user.role === "admin"
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-muted text-muted-foreground border-border"
              )}>
                {account.user.role === "admin" ? t("settings.account.admin") : t("settings.account.student")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              @{account.user.username} {account.user.email ? `· ${account.user.email}` : ""}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut} className="gap-1.5 shrink-0 text-xs">
            <LogOut className="size-3.5" />
            {t("settings.account.signOut")}
          </Button>
        </div>
      </Card>

      {/* Cloud Sync Status */}
      <CloudSyncStatusCard />

      {/* Profile Details Form */}
      <Card className="p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {t("login.displayName")} & {t("login.email")}
        </h3>
        <form onSubmit={handleUpdateProfile} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("settings.account.displayName")}</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="mt-1 w-full h-9 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("settings.account.email")}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("login.emailPlaceholder")}
              className="mt-1 w-full h-9 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary"
            />
            <p className="text-[11px] text-muted-foreground mt-1">{t("login.emailOptional")}</p>
          </div>
          {profileMsg && (
            <p className={cn("text-xs", profileMsg.error ? "text-destructive" : "text-success")}>
              {profileMsg.text}
            </p>
          )}
          <Button type="submit" size="sm" disabled={profileSaving} className="gap-1.5">
            {profileSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {t("settings.account.updateProfile")}
          </Button>
        </form>
      </Card>

      {/* Password & Security */}
      <Card className="p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          {t("settings.account.security")}
        </h3>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-muted/40 border border-border flex items-center justify-between text-xs">
            <div>
              <div className="font-semibold text-foreground mb-0.5">{t("settings.account.providers")}</div>
              <div className="text-muted-foreground flex items-center gap-2">
                {account.providers.includes("google") && (
                  <span className="flex items-center gap-1 text-primary font-medium">
                    <ShieldCheck className="size-3 text-success" />
                    {t("settings.account.providerGoogle")}
                  </span>
                )}
                {account.user.hasPassword && (
                  <span className="flex items-center gap-1 text-foreground font-medium">
                    <ShieldCheck className="size-3 text-success" />
                    {t("settings.account.providerPassword")}
                  </span>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-3 pt-2">
            {account.user.hasPassword && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t("settings.account.currentPassword")}</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="mt-1 w-full h-9 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {account.user.hasPassword ? t("settings.account.newPassword") : t("settings.account.setPassword")}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
                placeholder={t("login.passwordSecurePlaceholder")}
                className="mt-1 w-full h-9 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary"
              />
            </div>
            {passwordMsg && (
              <p className={cn("text-xs", passwordMsg.error ? "text-destructive" : "text-success")}>
                {passwordMsg.text}
              </p>
            )}
            <Button type="submit" size="sm" variant="outline" disabled={passwordSaving} className="gap-1.5">
              {passwordSaving ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
              {account.user.hasPassword ? t("settings.account.changePassword") : t("settings.account.setPassword")}
            </Button>
          </form>
        </div>
      </Card>

      {/* Export & Danger Zone */}
      <Card className="p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Database className="size-4 text-primary" />
          {t("settings.section.backup")} & {t("settings.account.deleteAccount")}
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 p-3.5 rounded-lg border border-border">
            <div>
              <div className="text-sm font-semibold">{t("settings.account.exportData")}</div>
              <div className="text-xs text-muted-foreground">{t("settings.account.exportDesc")}</div>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="gap-1.5 shrink-0 text-xs">
              {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {t("settings.account.exportButton")}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 p-3.5 rounded-lg border border-destructive/30 bg-destructive/5">
            <div>
              <div className="text-sm font-semibold text-destructive">{t("settings.account.deleteAccount")}</div>
              <div className="text-xs text-muted-foreground">{t("settings.account.deleteDesc")}</div>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} className="gap-1.5 shrink-0 text-xs">
              <Trash2 className="size-3.5" />
              {t("settings.account.deleteAccount")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Delete Account Dialog */}
      <AnimatePresence>
        {deleteOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-4 shadow-xl"
            >
              <div className="flex items-center gap-3 text-destructive">
                <AlertTriangle className="size-6 shrink-0" />
                <h3 className="text-lg font-bold">{t("settings.account.deleteConfirmTitle")}</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("settings.account.deleteConfirmPrompt")}
              </p>

              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("settings.account.typeDelete")}
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  className="mt-1 w-full h-9 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-destructive"
                />
              </div>

              {account.user.hasPassword && (
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {t("settings.account.currentPassword")}
                  </label>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    required
                    className="mt-1 w-full h-9 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-destructive"
                  />
                </div>
              )}

              {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => { setDeleteOpen(false); setDeleteConfirmText(""); setDeletePassword(""); setDeleteError(""); }}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteConfirmText !== "DELETE" || (account.user.hasPassword && !deletePassword) || deleteBusy}
                  onClick={handleDelete}
                  className="gap-1.5"
                >
                  {deleteBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  {t("settings.account.deleteConfirmButton")}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
