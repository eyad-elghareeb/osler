"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  LayoutDashboard,
  ListChecks,
  Sun,
  Moon,
  LogOut,
  User as UserIcon,
  ChevronDown,
  Search,
  Settings as SettingsIcon,
  GraduationCap,
  Cloud,
} from "lucide-react";
import { readCloudSession, syncGeminiKeyFromCloud, type CloudSession } from "@/lib/osler/cloud";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useOslerTheme } from "./theme-provider";
import { useI18n } from "./i18n-provider";
import { MobileTabBar } from "./mobile-tab-bar";
import { useImmersiveMode } from "./immersive-mode";
import { PwaInstallButton } from "./pwa-install-button";
import { LightboxProvider } from "./lightbox-provider";
import { GlobalSearchPanel } from "./global-search-panel";
import { SwipeableSheetHandle } from "./ui-primitives";
import type { SearchResult } from "@/lib/osler/search";
import { VIEW_PLACEHOLDER_KEY } from "@/lib/osler/search";
import type { StringKey } from "@/lib/osler/i18n";
import { isTextInput } from "@/lib/osler/shortcuts";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  withViewTransition,
  isViewTransitionsSupported,
  haptic,
  type ViewTransitionDirection,
} from "@/lib/osler/native";

export type OslerView =
  | "dashboard"
  | "learn"
  | "library"
  | "qbank"
  | "flashcards"
  | "osce"
  | "videos"
  | "profile"
  | "settings";

/**
 * Views that live under the "Learn" hub. The Learn tab in both the desktop
 * nav and the mobile bottom bar stays highlighted while the user is inside
 * any of these sub-views.
 */
export const LEARN_SUBVIEWS: ReadonlySet<OslerView> = new Set([
  "learn",
  "library",
  "flashcards",
  "osce",
  "videos",
]);

/**
 * Stable order for top-level Osler views. We use this to decide whether a
 * nav change is a "forward" push (current index increases) or a "backward"
 * pop (current index decreases). This is what powers the slide transition
 * direction so the user feels native push/pop navigation.
 */
const VIEW_ORDER: OslerView[] = [
  "dashboard",
  "qbank",
  "learn",
  "library",
  "flashcards",
  "osce",
  "videos",
  "profile",
  "settings",
];

function viewIndex(v: OslerView): number {
  const i = VIEW_ORDER.indexOf(v);
  return i === -1 ? 99 : i;
}

/**
 * Decide the slide direction for a view transition. We compare the
 * "distance" between the two views in the canonical VIEW_ORDER list. A
 * jump of more than one step (e.g. dashboard → settings) still uses
 * "forward" because the user is moving deeper into the app. The only
 * "backward" case is when the new view has a strictly smaller index
 * AND the gap is at most 2 (so profile → dashboard reads as "back home"
 * but settings → dashboard also reads as "back home").
 */
function directionFor(from: OslerView, to: OslerView): ViewTransitionDirection {
  if (from === to) return "none";
  const fromIdx = viewIndex(from);
  const toIdx = viewIndex(to);
  if (toIdx < fromIdx) return "backward";
  return "forward";
}

import { useOslerSession } from "@/lib/osler/session-context";
import { useCurrentView, useOslerRouter } from "@/lib/osler/navigation";
import { loadContentByUid } from "@/lib/osler/content";
import { AutoResumeSessionDialog } from "./resume-session-dialog";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { theme, isDark, toggleTheme } = useOslerTheme();
  const { t, rtl } = useI18n();
  const isMobile = useIsMobile();
  const immersive = useImmersiveMode();
  const { username, cloudSession: sessionContextCloudSession, logout } = useOslerSession();
  const view = useCurrentView();
  const { navigate } = useOslerRouter();

  const [searchOpen, setSearchOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [cloudSession, setCloudSession] = React.useState<CloudSession | null>(() => sessionContextCloudSession || readCloudSession());
  const [syncStatus, setSyncStatus] = React.useState<"synced" | "syncing" | "offline">("synced");

  React.useEffect(() => {
    // Always sync from the session context — including when it becomes
    // null (logout/expiry). The previous code only updated when truthy,
    // which left a stale cloudSession in local state after logout.
    setCloudSession(sessionContextCloudSession ?? readCloudSession());
  }, [sessionContextCloudSession]);

  React.useEffect(() => {
    if (cloudSession?.token) {
      void syncGeminiKeyFromCloud();
    }
  }, [cloudSession?.token]);

  React.useEffect(() => {
    const onSyncStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.state) setSyncStatus(detail.state);
    };
    window.addEventListener("osler-cloud-sync-status", onSyncStatus);
    return () => window.removeEventListener("osler-cloud-sync-status", onSyncStatus);
  }, []);

  const [vtActive, setVtActive] = React.useState(false);
  React.useEffect(() => {
    setVtActive(isViewTransitionsSupported());
  }, []);

  const handleViewChange = React.useCallback(
    (next: OslerView) => {
      if (next === view) return;
      navigate(next);
    },
    [view, navigate],
  );

  React.useEffect(() => {
    if (!searchOpen) setQuery("");
  }, [searchOpen]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // Let Ctrl+K reach the markdown editor (bold) and other inputs —
        // the search toggle only responds outside text fields.
        if (isTextInput(e.target)) return;
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSearchSelect = React.useCallback(async (r: SearchResult) => {
    setSearchOpen(false);
    setQuery("");
    switch (r.payload.type) {
      case "article":
        navigate("library", { article: r.payload.file });
        return;
      case "pack": {
        try {
          const content = await loadContentByUid(r.payload.uid);
          if (content.type === "osce") navigate("osce", { uid: r.payload.uid });
          else if (content.type === "flashcard") navigate("flashcards", { uid: r.payload.uid });
          else navigate("qbank", { uid: r.payload.uid });
        } catch (e) {
          console.error("Search: failed to open pack", e);
        }
        return;
      }
      case "video":
        navigate("videos", { video: r.payload.id });
        return;
      case "setting":
        navigate("settings", { section: r.payload.section });
        return;
      case "nav":
        navigate(r.payload.view as OslerView);
        return;
    }
  }, [navigate]);

  const searchPlaceholder = t((VIEW_PLACEHOLDER_KEY[view] ?? "search.globalPlaceholder") as StringKey);

  const isDashboard = view === "dashboard";
  const isQbank = view === "qbank";
  // The Learn tab is highlighted while inside any Learn-hub sub-view
  // (learn hub itself, library, flashcards, osce, videos).
  const isLearnActive = LEARN_SUBVIEWS.has(view);

  // The search panel is rendered by GlobalSearchPanel — we just hand it
  // the controlled query + a select callback. Both desktop popover and
  // mobile sheet share the same component instance structure.

  return (
    <div className="h-screen md:h-screen h-[100dvh] flex flex-col bg-background overflow-hidden">
      {/* Top bar — desktop only on mobile. The mobile layout uses the
          scroll-away top bar (logo + search + user menu) plus the 4-tab
          bottom bar, so this header is hidden to reclaim screen space.
          The header stays mounted (just CSS-hidden) so the global search
          sheet + user dropdown state isn't reset on view changes. */}
      <header className={cn(
        "z-40 shrink-0 h-14 border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 safe-pt",
        "hidden md:flex",
        isMobile && immersive && "hidden",
      )}>
        <div className="h-full w-full px-3 sm:px-4 flex items-center gap-2 sm:gap-3">
          {/* Left section: logo + desktop nav */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => handleViewChange("dashboard")}
              aria-label={t("app.name")}
              className="flex items-center gap-2.5 shrink-0"
            >
              <div className="size-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
                <Activity className="size-4 text-primary" />
              </div>
              <div className="hidden lg:block leading-tight text-start">
                <div className="text-sm font-semibold">{t("app.name")}</div>
                <div className="text-[10px] text-muted-foreground">
                  {t("app.tagline")}
                </div>
              </div>
            </button>

            <nav className="flex items-center gap-1">
              <NavButton
                active={isDashboard}
                onClick={() => handleViewChange("dashboard")}
                icon={LayoutDashboard}
                label={t("nav.dashboard")}
                layoutId="nav-active"
              />
              <NavButton
                active={isQbank}
                onClick={() => handleViewChange("qbank")}
                icon={ListChecks}
                label={t("nav.qbank")}
                layoutId="nav-active"
              />
              <NavButton
                active={isLearnActive}
                onClick={() => handleViewChange("learn")}
                icon={GraduationCap}
                label={t("nav.learn")}
                layoutId="nav-active"
              />
            </nav>
          </div>

          {/* Center section: search pill (flex-1 centers it between left + right) */}
          <div className="flex-1 flex justify-center px-2 min-w-0">
            <Popover open={searchOpen && !isMobile} onOpenChange={(o) => setSearchOpen(o)}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-2 h-9 px-3 w-full max-w-md rounded-md border border-border bg-muted/40 hover:bg-muted/60 transition-colors text-sm text-muted-foreground">
                  <Search className="size-3.5 shrink-0" />
                  <span className="flex-1 text-start truncate min-w-0">
                    {searchPlaceholder}
                  </span>
                  <kbd className="hidden xl:inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-border bg-background/60 font-mono shrink-0">
                    Ctrl+K
                  </kbd>
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[min(640px,calc(100vw-2rem))] p-0"
                align="center"
                sideOffset={8}
              >
                <GlobalSearchPanel
                  query={query}
                  onQueryChange={setQuery}
                  onSelect={handleSearchSelect}
                  view={view}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Right section: cloud sync + PWA + user menu */}
          <div className="flex items-center gap-2 shrink-0">
            {cloudSession && (
              <button
                onClick={() => navigate("settings", { section: "account" })}
                aria-label={t("settings.account.syncTitle")}
                title={syncStatus === "synced" ? t("settings.account.syncSynced") : syncStatus === "syncing" ? t("settings.account.syncSyncing") : t("settings.account.syncOffline")}
                className="flex items-center gap-1.5 h-8 px-2 rounded-md border border-border bg-muted/40 hover:bg-muted/60 transition-colors shrink-0"
              >
                <span className={cn("size-2 rounded-full shrink-0", syncStatus === "synced" ? "bg-success animate-pulse" : syncStatus === "syncing" ? "bg-warning animate-spin" : "bg-muted")} />
                <Cloud className="size-3.5 text-muted-foreground" />
              </button>
            )}

            <PwaInstallButton />

            <UserMenu
              cloudSession={cloudSession}
              username={username}
              isDark={isDark}
              onToggleTheme={toggleTheme}
              onSignOut={logout}
            />
          </div>
        </div>
      </header>

      {/* Mobile search sheet — rendered outside the header so it doesn't
          interfere with the desktop flex layout. Slides up from the bottom
          so the keyboard has room and the result list is comfortably
          reachable with one thumb. */}
      <Sheet open={searchOpen && isMobile} onOpenChange={setSearchOpen}>
        <SheetContent side="bottom" className="h-[85vh] p-0">
          <SwipeableSheetHandle onClose={() => setSearchOpen(false)} />
          <SheetHeader className="sr-only">
            <SheetTitle>{t("common.search")}</SheetTitle>
            <SheetDescription>{t("search.globalPlaceholder")}</SheetDescription>
          </SheetHeader>
          <GlobalSearchPanel
            query={query}
            onQueryChange={setQuery}
            onSelect={handleSearchSelect}
            view={view}
            variant="sheet"
          />
        </SheetContent>
      </Sheet>

      {/* Main content — viewport container for views.
          Individual views control their own single scroll container (.osler-page).
          A single motion.div stays mounted across the vtActive flip so the view
          is never remounted (which reset all state and caused a flash). When the
          browser supports the View Transitions API we disable the framer enter/
          exit animation — the VT snapshot already crossfades the old and new
          views. */}
      <main className="flex-1 min-h-0 relative overflow-hidden flex flex-col safe-pt">
        {/* Mobile scroll-away top bar — a slim bar with the centered site name
            + search icon that hides when the user scrolls down and reappears
            on scroll up. Instagram-style collapse. Desktop uses the full top
            bar above. */}
        <MobileScrollAwayBar
          cloudSession={cloudSession}
          username={username}
          syncStatus={syncStatus}
          isDark={isDark}
          onSearchOpen={() => setSearchOpen(true)}
          onToggleTheme={toggleTheme}
          onSignOut={logout}
        />
        <LightboxProvider>
          <AnimatePresence mode="sync" initial={false}>
            <motion.div
              key={view}
              initial={vtActive ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={vtActive ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
              className="h-full w-full flex-1 flex flex-col min-h-0"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </LightboxProvider>
      </main>

      {/* Mobile tab bar — 4 tabs: Dashboard, Q-Bank, Learn, Profile.
          Search + user menu live in the scroll-away top bar. */}
      <MobileTabBar view={view} onViewChange={handleViewChange} />

      {/* Resume-session auto-pop — hidden on the dashboard (which has its
          own "Continue learning" card that opens the same dialog on click)
          AND on /qbank (where the user is either actively taking a quiz or
          can use the tracker's "In progress" panel). On all other pages
          (library, flashcards, osce, videos, profile, settings, learn) the
          auto-pop fires so the user is reminded of their unfinished session. */}
      {!isDashboard && !isQbank && <AutoResumeSessionDialog />}
    </div>
  );
}

function NavButton({
  active,
  onClick,
  icon: Icon,
  label,
  layoutId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  layoutId: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative h-9 px-3 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
        active
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      )}
    >
      <Icon className="size-4" />
      <span className="hidden md:inline">{label}</span>
      {active && (
        <motion.div
          layoutId={layoutId}
          className="absolute inset-0 rounded-md bg-primary/10 border border-primary/30 -z-10"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
    </button>
  );
}

/**
 * UserMenu — the avatar dropdown (Profile, Settings, Theme toggle, Sign out)
 * shared by the desktop top bar and the mobile scroll-away bar.
 */
function UserMenu({
  cloudSession,
  username,
  isDark,
  onToggleTheme,
  onSignOut,
  hideChevron = false,
}: {
  cloudSession: CloudSession | null;
  username?: string | null;
  isDark: boolean;
  onToggleTheme: () => void;
  onSignOut: () => void;
  hideChevron?: boolean;
}) {
  const { t } = useI18n();
  const { navigate } = useOslerRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("nav.profile")}
          className="flex items-center gap-2 h-9 px-2 rounded-md hover:bg-muted/60 transition-colors shrink-0"
        >
          <div className="size-7 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-xs font-semibold text-primary-foreground">
            {(cloudSession?.user.displayName || username || "U").slice(0, 2).toUpperCase()}
          </div>
          {!hideChevron && <ChevronDown className="size-3.5 text-muted-foreground" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{cloudSession?.user.displayName || username || "User"}</span>
          <span className="text-xs text-muted-foreground font-normal">
            {cloudSession ? `${cloudSession.user.email || `@${cloudSession.user.username}`} · ${cloudSession.user.role}` : t("nav.localSession")}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => navigate("profile")}
        >
          <UserIcon className="size-4 me-2" />
          {t("nav.profile")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => navigate("settings")}
        >
          <SettingsIcon className="size-4 me-2" />
          {t("nav.settings")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => { haptic("selection"); onToggleTheme(); }}
        >
          {isDark ? <Sun className="size-4 me-2" /> : <Moon className="size-4 me-2" />}
          {isDark ? t("theme.toggleToLight") : t("theme.toggleToDark")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer text-destructive focus:text-destructive"
          onClick={onSignOut}
        >
          <LogOut className="size-4 me-2" />
          {t("nav.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * MobileScrollAwayBar — the old top-bar split (logo + name, search, cloud
 * sync, PWA install, user menu) rebuilt in scroll-away form for mobile.
 * Hides when the user scrolls down and reappears on scroll up
 * (Instagram-style collapse).
 *
 * The bar is a normal flex child of <main> (not absolute) so content
 * flows below it naturally. When it collapses (height → 0, opacity → 0),
 * the content below moves up to fill the space.
 *
 * The scroll listener attaches to the .osler-page scroll container,
 * found via document.querySelector (the bar is a sibling of .osler-page
 * inside <main>, not a parent, so we search from the document root).
 */
function MobileScrollAwayBar({
  cloudSession,
  username,
  syncStatus,
  isDark,
  onSearchOpen,
  onToggleTheme,
  onSignOut,
}: {
  cloudSession: CloudSession | null;
  username?: string | null;
  syncStatus: "synced" | "syncing" | "offline";
  isDark: boolean;
  onSearchOpen: () => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const { navigate } = useOslerRouter();
  const immersive = useImmersiveMode();
  const lastScrollY = React.useRef(0);
  const [hidden, setHidden] = React.useState(false);

  React.useEffect(() => {
    let scrollEl: HTMLElement | null = null;
    let rafId = 0;

    const findScrollContainer = () => {
      // Search the document for .osler-page (the canonical scroll container).
      // The bar is a sibling of .osler-page inside <main>, so we can't search
      // downward from the bar's own ref — we search from document.
      const el = document.querySelector(".osler-page") as HTMLElement | null;
      if (el && el.scrollHeight > el.clientHeight) return el;
      // Also try any element with overflow-y auto/scroll that's a descendant of main
      const main = document.querySelector("main");
      if (main) {
        const scrollable = main.querySelector("[class*='overflow-y-auto'], [class*='overflow-auto']") as HTMLElement | null;
        if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) return scrollable;
      }
      return null;
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!scrollEl) return;
        const y = scrollEl.scrollTop;
        const delta = y - lastScrollY.current;
        if (y < 40) {
          setHidden(false);
        } else if (delta > 4) {
          setHidden(true);
        } else if (delta < -4) {
          setHidden(false);
        }
        lastScrollY.current = y;
      });
    };

    const attach = () => {
      const next = findScrollContainer();
      if (next !== scrollEl) {
        if (scrollEl) scrollEl.removeEventListener("scroll", onScroll);
        scrollEl = next;
        if (scrollEl) {
          scrollEl.addEventListener("scroll", onScroll, { passive: true });
          lastScrollY.current = scrollEl.scrollTop;
          setHidden(false);
        }
      }
    };

    // Re-find the scroll container on DOM mutations (view swaps) + poll.
    const observer = new MutationObserver(() => attach());
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = setInterval(attach, 500);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      clearInterval(interval);
      if (scrollEl) scrollEl.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <motion.div
      initial={false}
      animate={{
        height: hidden || immersive ? 0 : 52,
        opacity: hidden || immersive ? 0 : 1,
      }}
      transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      className={cn(
        "md:hidden shrink-0 overflow-hidden",
        "bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60",
        "border-b border-border",
      )}
    >
      <div className="h-13 flex items-center gap-2 px-3 sm:px-4">
        {/* Logo + brand name (name hidden on very narrow screens) */}
        <button
          onClick={() => navigate("dashboard")}
          aria-label={t("app.name")}
          className="flex items-center gap-2.5 shrink-0 min-w-0"
        >
          <div className="size-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <Activity className="size-4 text-primary" />
          </div>
          <div className="hidden sm:block leading-tight text-start min-w-0">
            <div className="text-sm font-semibold truncate">{t("app.name")}</div>
            <div className="text-[10px] text-muted-foreground truncate">
              {t("app.tagline")}
            </div>
          </div>
        </button>

        {/* Search — opens the mobile search sheet */}
        <button
          onClick={onSearchOpen}
          aria-label={t("common.search")}
          className="flex items-center gap-2 h-9 px-3 flex-1 min-w-0 rounded-md border border-border bg-muted/40 hover:bg-muted/60 transition-colors text-sm text-muted-foreground"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="flex-1 text-start truncate">{t("common.search")}…</span>
        </button>

        {/* Cloud sync indicator — tablet+ (hidden on phones like the old bar) */}
        {cloudSession && (
          <button
            onClick={() => navigate("settings", { section: "account" })}
            aria-label={t("settings.account.syncTitle")}
            title={syncStatus === "synced" ? t("settings.account.syncSynced") : syncStatus === "syncing" ? t("settings.account.syncSyncing") : t("settings.account.syncOffline")}
            className="hidden sm:flex items-center gap-1.5 h-8 px-2 rounded-md border border-border bg-muted/40 hover:bg-muted/60 transition-colors shrink-0"
          >
            <span className={cn("size-2 rounded-full shrink-0", syncStatus === "synced" ? "bg-success animate-pulse" : syncStatus === "syncing" ? "bg-warning animate-spin" : "bg-muted")} />
            <Cloud className="size-3.5 text-muted-foreground" />
          </button>
        )}

        {/* PWA install */}
        <PwaInstallButton />

        {/* User menu */}
        <UserMenu
          cloudSession={cloudSession}
          username={username}
          isDark={isDark}
          onToggleTheme={onToggleTheme}
          onSignOut={onSignOut}
          hideChevron
        />
      </div>
    </motion.div>
  );
}
