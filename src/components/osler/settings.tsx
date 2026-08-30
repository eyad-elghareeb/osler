"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings as SettingsIcon, Sparkles, AlertTriangle, Keyboard, Languages, Download, Smartphone, FileArchive, Fingerprint, ArrowLeft, ChevronRight, Info, Palette, User, Loader2, LifeBuoy, MonitorSmartphone } from "lucide-react";
import { storage } from "@/lib/osler/storage";
import { SyncSettingsSection } from "@/components/osler/sync/sync-settings-section";
import { useI18n } from "@/components/osler/i18n-provider";
import { type StringKey } from "@/lib/osler/i18n";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { NavigationStack } from "@/components/osler/navigation-stack";
import { haptic } from "@/lib/osler/native";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import dynamic from "next/dynamic";


/* ─── Section catalog ─────────────────────────────────────────────── */

export type SettingsSection = "account" | "sessions" | "appearance" | "language" | "ai" | "shortcuts" | "downloads" | "sync" | "backup" | "native" | "support" | "about" | "danger";

interface SectionMeta {
  id: SettingsSection;
  labelKey: StringKey;
  icon: React.ComponentType<{ className?: string }>;
  /** English keywords for settings search. */
  keywords: string;
}

const SECTIONS: SectionMeta[] = [
  { id: "account",    labelKey: "settings.section.account",   icon: User,         keywords: "account profile email password auth google sync status export delete logout cloud" },
  { id: "sessions",   labelKey: "settings.section.sessions",  icon: MonitorSmartphone, keywords: "sessions devices sign out logout security active login revoke" },
  { id: "appearance", labelKey: "settings.theme.title", icon: Palette, keywords: "theme appearance dark light color palette custom" },
  { id: "language",  labelKey: "settings.section.language",  icon: Languages,    keywords: "language arabic english rtl ui direction locale" },
  { id: "ai",        labelKey: "settings.section.ai",        icon: Sparkles,     keywords: "ai assistant gemini api key model osce voice" },
  { id: "shortcuts", labelKey: "settings.section.shortcuts", icon: Keyboard,     keywords: "keyboard shortcuts hotkeys bindings" },
  { id: "downloads", labelKey: "settings.section.downloads", icon: Download,     keywords: "downloads offline cache storage service worker" },
  { id: "sync",      labelKey: "settings.section.sync",      icon: Smartphone,   keywords: "sync peer webrtc qr sync devices" },
  { id: "native",    labelKey: "settings.section.native",    icon: Fingerprint,  keywords: "native haptics biometric fingerprint view transitions wake lock network animations" },
  { id: "support",   labelKey: "settings.section.support",   icon: LifeBuoy,     keywords: "support help report problem bug ticket feedback contact admin issue" },
  { id: "backup",    labelKey: "settings.section.backup",    icon: FileArchive,  keywords: "backup restore export import file" },
  { id: "about",     labelKey: "settings.section.about",     icon: Info,         keywords: "about github repo version site name theme plugins config" },
  { id: "danger",    labelKey: "settings.section.danger",    icon: AlertTriangle, keywords: "danger reset clear data delete wipe progress" },
];


/* Sections are code-split: each settings pane loads its own chunk when the
 * user opens it, keeping the app shell lean. Fallback matches LoadingState. */
const SectionFallback = (
  <div className="py-16 flex items-center justify-center">
    <Loader2 className="size-6 animate-spin text-muted-foreground" />
  </div>
);
const mkSection = (
  loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>,
) => dynamic(loader, { ssr: false, loading: () => SectionFallback });

const ThemeSettingsSection = mkSection(() => import("@/components/osler/settings/theme-section").then((m) => ({ default: m.ThemeSettingsSection })));
const LanguageSettingsSection = mkSection(() => import("@/components/osler/settings/language-section").then((m) => ({ default: m.LanguageSettingsSection })));
const AiSettingsSection = mkSection(() => import("@/components/osler/settings/ai-section").then((m) => ({ default: m.AiSettingsSection })));
const ShortcutsSettingsSection = mkSection(() => import("@/components/osler/settings/shortcuts-section").then((m) => ({ default: m.ShortcutsSettingsSection })));
const DownloadsSettingsSection = mkSection(() => import("@/components/osler/settings/downloads-section").then((m) => ({ default: m.DownloadsSettingsSection })));
const NativeSettingsSection = mkSection(() => import("@/components/osler/settings/backup-native-section").then((m) => ({ default: m.NativeSettingsSection })));
const BackupSettingsSection = mkSection(() => import("@/components/osler/settings/backup-native-section").then((m) => ({ default: m.BackupSettingsSection })));
const SupportSettingsSection = mkSection(() => import("@/components/osler/settings/support-section").then((m) => ({ default: m.SupportSettingsSection })));
const AboutSettingsSection = mkSection(() => import("@/components/osler/settings/about-section").then((m) => ({ default: m.AboutSettingsSection })));
const DangerZoneSection = mkSection(() => import("@/components/osler/settings/danger-section").then((m) => ({ default: m.DangerZoneSection })));
const AccountSettingsSection = mkSection(() => import("@/components/osler/settings/account-section").then((m) => ({ default: m.AccountSettingsSection })));
const SessionsSettingsSection = mkSection(() => import("@/components/osler/settings/sessions-section").then((m) => ({ default: m.SessionsSettingsSection })));

function renderSection(id: SettingsSection) {
  switch (id) {
    case "account":   return <AccountSettingsSection />;
    case "sessions":  return <SessionsSettingsSection />;
    case "appearance": return <ThemeSettingsSection />;
    case "language":  return <LanguageSettingsSection />;
    case "ai":        return <AiSettingsSection />;
    case "shortcuts": return <ShortcutsSettingsSection />;
    case "downloads": return <DownloadsSettingsSection />;
    case "sync":      return <SyncSettingsSection />;
    case "native":    return <NativeSettingsSection />;
    case "support":   return <SupportSettingsSection />;
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
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-1 mb-2">
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
          transition={MOTION_TRANSITION.slow}
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
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 mb-1.5">
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

            {/* Content pane — keyed motion.div with a direction-aware
                enter slide only; no exit animation (mode="wait" blanked the
                pane between section switches). */}
            <div className="min-w-0">
              <motion.div
                key={section}
                custom={sectionDirection}
                variants={{
                  enter: (dir: 1 | -1) => ({ opacity: 0, y: 10 * dir }),
                  center: { opacity: 1, y: 0 },
                }}
                initial="enter"
                animate="center"
                transition={MOTION_TRANSITION.quick}
              >
                {renderSection(section)}
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

