"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import {
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
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { OslerMark } from "@/components/osler/osler-mark";

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
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useOslerTheme } from "./theme-provider";
import { useI18n } from "./i18n-provider";
import { MobileTabBar } from "./mobile-tab-bar";
import { useImmersiveMode } from "./immersive-mode";
import { useHideOnScroll } from "@/hooks/use-hide-on-scroll";
import { PwaInstallButton } from "./pwa-install-button";
import { LightboxProvider } from "./lightbox-provider";
import { ContentContextMenu } from "./content-context-menu";
import { SwipeableSheetContent } from "./ui-primitives";
import type { SearchResult } from "@/lib/osler/search";
import { VIEW_PLACEHOLDER_KEY } from "@/lib/osler/search";
import type { StringKey } from "@/lib/osler/i18n";
import { isTextInput } from "@/lib/osler/shortcuts";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { APP_UPDATE_EVENT } from "./serwist-provider";
import { MOTION_TRANSITION, MOTION_SPRING } from "@/lib/osler/motion";
import {
  haptic,
  initViewTransitionFlags,
  wantsFallbackTransition,
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
import { startContentVersionSync, refreshContentVersion } from "@/lib/osler/content-version";
import { AutoResumeSessionDialog, warmLazySurfaces } from "./lazy-tools";
import { isConstrainedDevice } from "@/lib/osler/performance";

const GlobalSearchPanel = dynamic(
  () => import("./global-search-panel").then((module) => ({ default: module.GlobalSearchPanel })),
  { ssr: false, loading: () => null },
);

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
  const { navigate, prefetch, prefetchAll } = useOslerRouter();

  // Warm every top-level route (code + data) once at idle so the first visit
  // to each view commits from cache instead of paying a mid-transition
  // network round trip, and pin the lazy modal chunks (session start, quiz
  // settings, calculator…) so their first open works offline too.
  // requestIdleCallback keeps this off the critical path.
  React.useEffect(() => {
    const warm = () => {
      // A Galaxy Tab A-class device has little CPU/RAM headroom after the
      // initial render. Keep its first navigation intent-driven; capable
      // devices retain the complete route + overlay warm-up for instant opens.
      if (isConstrainedDevice()) return;
      prefetchAll();
      if (navigator.onLine) warmLazySurfaces();
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void };
    const schedule = () => {
      if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(warm, { timeout: 4000 });
      else window.setTimeout(warm, 1500);
    };
    // Warmed chunks are retained only by the SW's CacheFirst static handler,
    // so warming before the worker controls this page (first visit after a
    // deploy) is silently lost for offline use — rerun once it takes control.
    if ("serviceWorker" in navigator && !navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener("controllerchange", schedule, { once: true });
    }
    schedule();
  }, []);

  const [searchOpen, setSearchOpen] = React.useState(false);
  const [cloudSession, setCloudSession] = React.useState<CloudSession | null>(() => sessionContextCloudSession || readCloudSession());
  const [syncStatus, setSyncStatus] = React.useState<"off" | "synced" | "syncing" | "offline">("off");

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

  // Track remote content version changes so freshly published packs appear
  // without a hard refresh (see lib/osler/content-version.ts).
  React.useEffect(() => {
    startContentVersionSync();
  }, []);

  // Prompt for a reload when a newer app build takes control (a deploy
  // landed while the app was open) — otherwise this page keeps running
  // stale code and fresh fixes look like they never shipped.
  React.useEffect(() => {
    const onAppUpdate = () => {
      toast({
        title: t("app.updateAvailableTitle"),
        description: t("app.updateAvailableBody"),
        duration: 30000,
        action: (
          <ToastAction
            altText={t("app.reload")}
            onClick={() => { haptic("light"); window.location.reload(); }}
          >
            {t("app.reload")}
          </ToastAction>
        ),
      });
    };
    window.addEventListener(APP_UPDATE_EVENT, onAppUpdate);
    return () => window.removeEventListener(APP_UPDATE_EVENT, onAppUpdate);
  }, [t]);


  const handleViewChange = React.useCallback(
    (next: OslerView) => {
      if (next === view) return;
      void refreshContentVersion();
      // Tab-bar / top-nav hub switches are lateral moves, not stack pushes —
      // run the subtle tab crossfade instead of the directional slide.
      navigate(next, undefined, { viaTab: true });
    },
    [view, navigate],
  );

  // Mark <html data-vt="off"> when the native snapshot transition won't run
  // (Firefox, no VT API, low-perf) so CSS can apply the fallback enter.
  React.useEffect(() => {
    initViewTransitionFlags();
  }, []);

  // Fallback enter for non-VT browsers: restart the subtle rise animation on
  // the content wrapper after each view change. Imperative class restart (no
  // keyed remount) so the mounted studio subtree is never torn down — the
  // animation is opacity/transform only and stays on the compositor. Gated
  // per navigation so mid-session toggles (animations off / reduced motion)
  // take effect immediately.
  const contentRef = React.useRef<HTMLDivElement>(null);
  const prevViewRef = React.useRef(view);
  React.useEffect(() => {
    if (prevViewRef.current === view) return;
    prevViewRef.current = view;
    if (!wantsFallbackTransition()) return;
    const el = contentRef.current;
    if (!el) return;
    el.classList.remove("osler-view-enter");
    void el.offsetWidth;
    el.classList.add("osler-view-enter");
  }, [view]);

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

  // Standalone PWA: force WebKit to (re)compute safe-area insets on launch.
  // iOS initializes env() lazily and cold start frequently resolves every
  // inset to 0 (our iPadOS 26 readings); briefly flipping viewport-fit to
  // auto and back to cover around two frames forces a recalculation without
  // requiring device rotation (fullscreen-PWA community pattern for the
  // WebKit delayed-env-init bug class). No-op everywhere else.
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (!standalone) return;
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute("content") ?? "";
    if (!original.includes("viewport-fit=cover")) return;
    meta.setAttribute("content", original.replace("viewport-fit=cover", "viewport-fit=auto"));
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => meta.setAttribute("content", original));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (meta.getAttribute("content") !== original) meta.setAttribute("content", original);
    };
  }, []);

  const handleSearchSelect = React.useCallback(async (r: SearchResult) => {
    setSearchOpen(false);
    // The panel owns its query and unmounts on close, so it resets itself.
    switch (r.payload.type) {
      case "article":
        navigate("library", { article: r.payload.file });
        return;
      case "pack": {
        try {
          const { loadContentByUid } = await import("@/lib/osler/content");
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
  // Admins (and content admins) get a topbar shortcut to /admin. The role
  // comes from the local cloud session — the admin APIs re-verify it on
  // every request, so this is purely an entrance affordance.
  const isAdminUser =
    cloudSession?.user.role === "admin" || cloudSession?.user.role === "content_admin";
  // The Learn tab is highlighted while inside any Learn-hub sub-view
  // (learn hub itself, library, flashcards, osce, videos).
  const isLearnActive = LEARN_SUBVIEWS.has(view);

  // The search panel is rendered by GlobalSearchPanel — we just hand it
  // a select callback. The query lives inside the panel (not shell state)
  // so keystrokes never re-render the nav bars or the mounted view.

  return (
    <div className="osler-shell-height h-screen supports-[height:100dvh]:h-[100dvh] flex flex-col bg-background overflow-hidden">
      {/* Standalone PWA top-bleed probe (see globals.css): solid strip that
          keeps the header below the iPadOS 26 glass smear zone. */}
      <div aria-hidden className="osler-pwa-top-bleed" />
      {/* Top bar — desktop only on mobile. The mobile layout uses the
          scroll-away top bar (logo + search + user menu) plus the 4-tab
          bottom bar, so this header is hidden to reclaim screen space.
          The header stays mounted (just CSS-hidden) so the global search
          sheet + user dropdown state isn't reset on view changes. */}
      <header className={cn(
        // In-flow bar — nothing scrolls behind it; opaque background avoids
        // a pointless backdrop-filter pass every frame.
        // Height grows with the top inset (content row stays 56px) so the
        // bar is not crushed on inset tablets; identical to h-14 on desktop.
        "osler-vt-header z-40 shrink-0 h-[calc(3.5rem+env(safe-area-inset-top,0px))] border-b border-border bg-background safe-pt",
        // Immersive sessions (quiz, video player, …) hide this bar on ALL
        // form factors. Note the `md:flex` is dropped — not overridden with
        // `hidden` — because the responsive variant wins over `hidden` in
        // the cascade at desktop widths, so `hidden md:flex hidden` would
        // still show. `isMobile` intentionally plays no role here.
        immersive ? "hidden" : "hidden md:flex",
      )}>
        <div className="h-full w-full px-3 sm:px-4 flex items-center gap-2 sm:gap-3">
          {/* Left section: logo + desktop nav */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => handleViewChange("dashboard")}
              onPointerEnter={() => prefetch("dashboard")}
              onTouchStart={() => prefetch("dashboard")}
              onFocus={() => prefetch("dashboard")}
              data-pwa-debug-tap
              className="flex items-center gap-2.5 shrink-0"
            >
              <OslerMark variant="line" className="size-6 text-primary shrink-0" />
              <div className="hidden lg:block leading-tight text-start">
                <div className="text-sm font-semibold">{t("app.name")}</div>
                <div className="text-[11px] text-muted-foreground">
                  {t("app.tagline")}
                </div>
              </div>
            </button>

            <nav className="flex items-center gap-1">
              <NavButton
                active={isDashboard}
                onClick={() => handleViewChange("dashboard")}
                onPrefetch={() => prefetch("dashboard")}
                icon={LayoutDashboard}
                label={t("nav.dashboard")}
                layoutId="nav-active"
              />
              <NavButton
                active={isQbank}
                onClick={() => handleViewChange("qbank")}
                onPrefetch={() => prefetch("qbank")}
                icon={ListChecks}
                label={t("nav.qbank")}
                layoutId="nav-active"
              />
              <NavButton
                active={isLearnActive}
                onClick={() => handleViewChange("learn")}
                onPrefetch={() => prefetch("learn")}
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
                  <kbd className="hidden xl:inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded border border-border bg-background/60 font-mono shrink-0">
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
                  onSelect={handleSearchSelect}
                  view={view}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Right section: admin shortcut + cloud sync + PWA + user menu */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Admin panel shortcut — only surfaced to admins/content admins.
             * Access itself is enforced by the admin route guard + the
             * Worker's role checks on every /v1/admin endpoint; this button
             * merely hides the entrance for normal users. */}
            {/* Default Link prefetching warms the admin chunks on hover,
                so entering /admin doesn't cold-load them mid-transition. */}
            {isAdminUser && (
              <Link
                href="/admin"
                onClick={() => haptic("selection")}
                aria-label={t("nav.adminPanel")}
                title={t("nav.adminPanel")}
                className="flex items-center gap-1.5 h-8 px-2 rounded-md border border-border bg-muted/40 hover:bg-muted/60 transition-colors shrink-0"
              >
                <ShieldCheck className="size-3.5 text-primary" />
              </Link>
            )}
            {cloudSession && (
              <button
                onClick={() => navigate("settings", { section: "account" })}
                aria-label={t("settings.account.syncTitle")}
                title={syncStatus === "synced" ? t("settings.account.syncSynced") : syncStatus === "syncing" ? t("settings.account.syncSyncing") : syncStatus === "off" ? t("settings.account.syncOff") : t("settings.account.syncOffline")}
                className="flex items-center gap-1.5 h-8 px-2 rounded-md border border-border bg-muted/40 hover:bg-muted/60 transition-colors shrink-0"
              >
                <span className={cn("size-2 rounded-full shrink-0", syncStatus === "synced" ? "bg-success" : syncStatus === "syncing" ? "bg-warning animate-pulse" : "bg-muted")} />
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
        <SwipeableSheetContent onClose={() => setSearchOpen(false)} className="h-[85dvh] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("common.search")}</SheetTitle>
            <SheetDescription>{t("search.globalPlaceholder")}</SheetDescription>
          </SheetHeader>
          <GlobalSearchPanel
            onSelect={handleSearchSelect}
            view={view}
            variant="sheet"
          />
        </SwipeableSheetContent>
      </Sheet>

      {/* Main content — viewport container for views.
          Individual views control their own single scroll container (.osler-page).
          The container is a static div with NO key and NO enter animation:
          cross-view motion comes solely from the View Transitions API slide
          (see globals.css + navigate()). The previous keyed motion.div remounted
          the whole view subtree on every tab switch and started it at
          opacity 0 — on browsers without VT (or while a transition was
          in flight, or under reduced motion) every navigation blanked the
          page for ~200ms, and with VT active the extra fade stacked on top
          of the VT crossfade as a visible flicker. Without VT the swap is
          instant, which reads as faster than a fade-from-blank.
          Non-VT browsers instead get `.osler-view-enter` restarted on the
          inner wrapper (see the view effect above) — no remount, no blank. */}
      {/* Top-inset ownership: on phones the desktop header above is hidden,
          so main pads the notch for the scroll-away bar / MobileReader. On
          md+ the desktop header owns the inset itself — a second pad here
          left a dead notch-sized strip under the header on every view on
          inset tablets (iPad PWA). */}
      <main className="flex-1 min-h-0 relative overflow-hidden flex flex-col pt-[env(safe-area-inset-top,0px)] md:pt-0">
        {/* Mobile scroll-away top bar — a slim bar with the centered site name
            + search icon that hides when the user scrolls down and reappears
            on scroll up. Instagram-style collapse. Desktop uses the full top
            bar above. */}
        <MobileScrollAwayBar
          view={view}
          cloudSession={cloudSession}
          username={username}
          syncStatus={syncStatus}
          isDark={isDark}
          isAdminUser={isAdminUser}
          onSearchOpen={() => setSearchOpen(true)}
          onToggleTheme={toggleTheme}
          onSignOut={logout}
        />
        <LightboxProvider>
          <div ref={contentRef} className="osler-vt-content h-full w-full flex-1 flex flex-col min-h-0">
            {children}
          </div>
        </LightboxProvider>
        {/* Custom right-click menu for the content region (export PDF /
            share / copy link). Inputs and editors keep the native menu. */}
        <ContentContextMenu />
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
      <PwaDebugOverlay />
    </div>
  );
}

function NavButton({
  active,
  onClick,
  onPrefetch,
  icon: Icon,
  label,
  layoutId,
}: {
  active: boolean;
  onClick: () => void;
  onPrefetch?: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  layoutId: string;
}) {
  return (
    <button
      onClick={onClick}
      onPointerEnter={onPrefetch}
      onTouchStart={onPrefetch}
      onFocus={onPrefetch}
      className={cn(
        "relative h-9 px-3 rounded-md text-sm font-medium transition-colors flex items-center gap-2 active:scale-[0.97]",
        active
          ? "text-primary-bright"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      )}
    >
      <Icon className="size-4" />
      <span className="hidden md:inline">{label}</span>
      {active && (
        <motion.div
          layoutId={layoutId}
          className="absolute inset-0 rounded-md bg-primary/10 border border-primary/30 -z-10"
          transition={MOTION_SPRING.snappy}
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
  // Avatar initials are visible text — fold them into the accessible name so
  // voice control ("click Profile P E") matches what sighted users see.
  const initials = (cloudSession?.user.displayName || username || "U").slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`${t("nav.profile")} (${initials})`}
          className="flex items-center gap-2 h-9 px-2 rounded-md hover:bg-muted/60 transition-colors shrink-0"
        >
          <div aria-hidden="true" className="size-7 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-xs font-semibold text-primary-foreground">
            {initials}
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
  view,
  cloudSession,
  username,
  syncStatus,
  isDark,
  isAdminUser = false,
  onSearchOpen,
  onToggleTheme,
  onSignOut,
}: {
  /** Active view — re-finds the scroll container whenever it changes. */
  view: OslerView;
  cloudSession: CloudSession | null;
  username?: string | null;
  syncStatus: "off" | "synced" | "syncing" | "offline";
  isDark: boolean;
  /** Admins get the same shield shortcut the desktop top bar shows. */
  isAdminUser?: boolean;
  onSearchOpen: () => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const { navigate } = useOslerRouter();
  const immersive = useImmersiveMode();
  // Hysteresis hide-on-scroll — immune to short-scroll flapping, phantom
  // clamp deltas, and momentum jitter (see useHideOnScroll). reservePx is
  // this bar's layout height (h-13 + border): collapse is skipped when the
  // page would become unscrollable without it (spring-back band).
  const hidden = useHideOnScroll(view, { reservePx: 54 });

  return (
    <motion.div
      // Remount per view so the bar is always freshly expanded on arrival.
      // Without this, navigating while hidden played the 200ms expand tween
      // mid-transition, shifting the incoming page's layout as it painted.
      key={view}
      initial={false}
      animate={{
        height: hidden || immersive ? 0 : "auto",
        opacity: hidden || immersive ? 0 : 1,
      }}
      transition={MOTION_TRANSITION.collapseBar}
      className={cn(
        "osler-vt-mobile-topbar md:hidden shrink-0 overflow-hidden",
        // In-flow sibling above the scroller — nothing renders behind it, so
        // a backdrop blur would cost GPU time for no visual effect.
        "bg-background",
        "border-b border-border",
        // contain scopes the per-frame layout invalidation of the height
        // tween to this subtree; pointer-events-none keeps the collapsed
        // (invisible) content out of hit-testing.
        "[contain:layout_paint]",
        (hidden || immersive) && "pointer-events-none",
      )}
    >
      <div className="h-13 flex items-center gap-2 px-3 sm:px-4">
        {/* Logo + brand name (name hidden on very narrow screens) */}
        <button
          onClick={() => navigate("dashboard")}
          data-pwa-debug-tap
          className="flex items-center gap-2.5 shrink-0 min-w-0"
        >
          <OslerMark variant="line" className="size-6 text-primary shrink-0" />
          <div className="hidden sm:block leading-tight text-start min-w-0">
            <div className="text-sm font-semibold truncate">{t("app.name")}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {t("app.tagline")}
            </div>
          </div>
        </button>

        {/* Search — opens the mobile search sheet. No aria-label: the
            visible placeholder text names the button (an aria-label here
            must contain that text, ellipsis included). */}
        <button
          onClick={onSearchOpen}
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
            title={syncStatus === "synced" ? t("settings.account.syncSynced") : syncStatus === "syncing" ? t("settings.account.syncSyncing") : syncStatus === "off" ? t("settings.account.syncOff") : t("settings.account.syncOffline")}
            className="hidden sm:flex items-center gap-1.5 h-8 px-2 rounded-md border border-border bg-muted/40 hover:bg-muted/60 transition-colors shrink-0"
          >
            <span className={cn("size-2 rounded-full shrink-0", syncStatus === "synced" ? "bg-success" : syncStatus === "syncing" ? "bg-warning animate-pulse" : "bg-muted")} />
            <Cloud className="size-3.5 text-muted-foreground" />
          </button>
        )}

        {/* Admin panel shortcut — mirrors the desktop top-bar shield.
            Access itself is enforced by the admin route guard + the Worker's
            role checks; this button merely surfaces the entrance. */}
        {isAdminUser && (
          <Link
            href="/admin"
            onClick={() => haptic("selection")}
            aria-label={t("nav.adminPanel")}
            title={t("nav.adminPanel")}
            className="flex items-center justify-center size-8 rounded-md border border-border bg-muted/40 hover:bg-muted/60 transition-colors shrink-0"
          >
            <ShieldCheck className="size-3.5 text-primary" />
          </Link>
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

/**
 * TEMPORARY iPadOS 26 PWA diagnostic, armed via `?pwa-debug=1`. Overlays live
 * viewport + safe-area metrics so standalone presentation bugs can be read off
 * the device without a tethered Mac. English-only by design (dev tool, never
 * user-facing UI). REMOVE once the PWA blur/band investigation closes.
 */
function PwaDebugOverlay() {
  const [queryArmed] = React.useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("pwa-debug"),
  );
  // No-URL fallback: triple-tap either brand logo (both carry
  // data-pwa-debug-tap) toggles the panel — installed PWAs can't open links.
  const [tapArmed, setTapArmed] = React.useState(false);
  const armed = queryArmed || tapArmed;
  const [dismissed, setDismissed] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  const topProbe = React.useRef<HTMLDivElement>(null);
  const bottomProbe = React.useRef<HTMLDivElement>(null);
  const leftProbe = React.useRef<HTMLDivElement>(null);
  const rightProbe = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!armed) return;
    const refresh = () => setTick((n) => n + 1);
    window.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("resize", refresh);
    const timer = window.setInterval(refresh, 1500);
    return () => {
      window.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("resize", refresh);
      window.clearInterval(timer);
    };
  }, [armed]);

  // Triple-tap detector for the brand logos (PWA entry point).
  React.useEffect(() => {
    let taps = 0;
    let timer = 0;
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.("[data-pwa-debug-tap]")) return;
      taps += 1;
      window.clearTimeout(timer);
      if (taps >= 3) {
        taps = 0;
        setTapArmed((v) => !v);
        setDismissed(false);
        return;
      }
      timer = window.setTimeout(() => { taps = 0; }, 700);
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      window.clearTimeout(timer);
    };
  }, []);

  // Live bleed-height bisector: −/+ write --osler-pwa-bleed (px override),
  // tapping the value clears back to the smart default. Survives in-app
  // navigation (AppShell persists); a full reload resets to default unless
  // a value was stored this session.
  const [bleed, setBleed] = React.useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = window.sessionStorage.getItem("osler-pwa-bleed");
    const n = stored == null ? NaN : Number.parseInt(stored, 10);
    return Number.isFinite(n) ? Math.min(120, Math.max(0, n)) : null;
  });
  React.useEffect(() => {
    if (!armed || typeof document === "undefined") return;
    if (bleed == null) {
      document.documentElement.style.removeProperty("--osler-pwa-bleed");
      window.sessionStorage.removeItem("osler-pwa-bleed");
    } else {
      document.documentElement.style.setProperty("--osler-pwa-bleed", `${bleed}px`);
      window.sessionStorage.setItem("osler-pwa-bleed", String(bleed));
    }
  }, [armed, bleed]);
  const stepBleed = (delta: number) =>
    setBleed((prev) => {
      const base = prev ?? 56;
      return Math.min(120, Math.max(0, base + delta));
    });

  const rows = React.useMemo(() => {
    if (!armed || typeof window === "undefined") return [] as [string, string][];
    const vv = window.visualViewport;
    return [
      ["host", window.location.host],
      [
        "display-mode",
        window.matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser",
      ],
      [
        "navigator.standalone",
        String(
          (window.navigator as unknown as { standalone?: boolean }).standalone ?? "n/a",
        ),
      ],
      ["inner", `${window.innerWidth}x${window.innerHeight}`],
      [
        "visualViewport",
        vv
          ? `${Math.round(vv.width)}x${Math.round(vv.height)} @${Math.round(vv.offsetTop)},${Math.round(vv.offsetLeft)} scale ${vv.scale}`
          : "n/a",
      ],
      ["doc-client", `${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`],
      ["dpr", String(window.devicePixelRatio)],
      ["env-top", `${topProbe.current?.offsetHeight ?? -1}px`],
      ["env-bottom", `${bottomProbe.current?.offsetHeight ?? -1}px`],
      ["env-left", `${leftProbe.current?.offsetWidth ?? -1}px`],
      ["env-right", `${rightProbe.current?.offsetWidth ?? -1}px`],
      ["data-blur", document.documentElement.dataset.blur ?? "?"],
      ["ua-tail", window.navigator.userAgent.slice(-72)],
    ] as [string, string][];
    // Probes measure the previous commit's DOM; the interval refresh covers it.
  }, [armed, tick, dismissed]);

  if (!armed || dismissed) return null;
  return (
    <>
      {/* Safe-area probes — zero-size fixed divs sized purely by env(). */}
      <div ref={topProbe} aria-hidden style={{ position: "fixed", top: 0, left: 0, width: 0, height: "env(safe-area-inset-top, 0px)", pointerEvents: "none" }} />
      <div ref={bottomProbe} aria-hidden style={{ position: "fixed", bottom: 0, left: 0, width: 0, height: "env(safe-area-inset-bottom, 0px)", pointerEvents: "none" }} />
      <div ref={leftProbe} aria-hidden style={{ position: "fixed", top: 0, left: 0, height: 0, width: "env(safe-area-inset-left, 0px)", pointerEvents: "none" }} />
      <div ref={rightProbe} aria-hidden style={{ position: "fixed", top: 0, right: 0, height: 0, width: "env(safe-area-inset-right, 0px)", pointerEvents: "none" }} />
      <div
        role="status"
        style={{
          position: "fixed", left: 8, right: 8, bottom: 8, zIndex: 100,
          maxHeight: "46dvh", overflowY: "auto", background: "rgba(0,0,0,0.92)",
          color: "#fff", borderRadius: 12, padding: "10px 12px",
          fontFamily: "ui-monospace, monospace", fontSize: 11, lineHeight: 1.7,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <strong>pwa-debug</strong>
          <button type="button" onClick={() => setDismissed(true)} style={{ padding: "4px 10px", borderRadius: 8, background: "#333", color: "#fff" }}>
            Hide
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ color: "#8ab4ff" }}>bleed: </span>
          <button type="button" onClick={() => stepBleed(-4)} style={{ padding: "4px 12px", borderRadius: 8, background: "#333", color: "#fff" }}>
            −
          </button>
          <button
            type="button"
            title="Tap to reset to auto"
            onClick={() => setBleed(null)}
            style={{ minWidth: 64, textAlign: "center", padding: "4px 8px", borderRadius: 8, background: "#1c2b1c", color: "#fff" }}
          >
            {bleed == null ? "auto" : `${bleed}px`}
          </button>
          <button type="button" onClick={() => stepBleed(4)} style={{ padding: "4px 12px", borderRadius: 8, background: "#333", color: "#fff" }}>
            +
          </button>
        </div>
        {rows.map(([k, v]) => (
          <div key={k}>
            <span style={{ color: "#8ab4ff" }}>{k}: </span>
            <span style={{ overflowWrap: "anywhere" }}>{v}</span>
          </div>
        ))}
      </div>
    </>
  );
}
