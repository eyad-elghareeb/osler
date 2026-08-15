"use client";

import * as React from "react";
import {
  LayoutDashboard,
  ListChecks,
  GraduationCap,
  Search,
  User as UserIcon,
  Settings as SettingsIcon,
  Sun,
  Moon,
  LogOut,
  Cloud,
} from "lucide-react";
import { type OslerView, LEARN_SUBVIEWS } from "./app-shell";
import { useI18n } from "./i18n-provider";
import { cn } from "@/lib/utils";
import { useImmersiveMode } from "./immersive-mode";
import { haptic } from "@/lib/osler/native";
import { useLongPress } from "@/hooks/use-gestures";
import { useCurrentView, useOslerRouter } from "@/lib/osler/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

interface MobileTabBarProps {
  view?: OslerView;
  onViewChange?: (v: OslerView) => void;
  /** Open the global search sheet. */
  onSearchOpen?: () => void;
  /** User info for the avatar + menu. */
  user?: { displayName?: string; username?: string; email?: string; role?: string } | null;
  /** Whether a cloud session is active (affects menu label). */
  isCloudSession?: boolean;
  /** Theme toggle controls. */
  isDark?: boolean;
  onToggleTheme?: () => void;
  /** Sign out handler. */
  onSignOut?: () => void;
}

interface TabItem {
  id: OslerView;
  labelKey:
    | "nav.dashboard"
    | "nav.qbank"
    | "nav.learn"
    | "nav.profile";
  icon: React.ComponentType<{ className?: string }>;
  isActive?: (view: OslerView) => boolean;
}

const TABS: TabItem[] = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { id: "qbank", labelKey: "nav.qbank", icon: ListChecks },
  {
    id: "learn",
    labelKey: "nav.learn",
    icon: GraduationCap,
    isActive: (v) => LEARN_SUBVIEWS.has(v),
  },
];

export function MobileTabBar({
  view: propView,
  onViewChange,
  onSearchOpen,
  user,
  isCloudSession,
  isDark,
  onToggleTheme,
  onSignOut,
}: MobileTabBarProps) {
  const immersive = useImmersiveMode();
  const { t } = useI18n();
  const currentView = useCurrentView();
  const { navigate } = useOslerRouter();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const activeView = propView ?? currentView;
  const handleNav = onViewChange ?? navigate;

  const initials = (user?.displayName || user?.username || "U").slice(0, 2).toUpperCase();

  // Long-press on the User tab opens the quick menu (Settings, Theme, Sign out).
  // A normal tap navigates to the Profile page.
  const userTabRef = useLongPress<HTMLButtonElement>({
    duration: 400,
    onLongPress: () => {
      haptic("warning");
      setMenuOpen(true);
    },
  });

  const isProfileActive = activeView === "profile" || activeView === "settings";

  return (
    <>
      <nav
        className={cn(
          "medos-tabbar medos-tap-none md:hidden fixed inset-x-0 bottom-0 z-50 flex",
          immersive && "hidden"
        )}
        role="tablist"
        aria-label="Primary"
      >
        {/* Main nav tabs: Dashboard, Q-Bank, Learn */}
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.isActive ? tab.isActive(activeView) : tab.id === activeView;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={t(tab.labelKey)}
              onClick={() => {
                if (active) return;
                handleNav(tab.id);
              }}
              className={`medos-tabbar-item medos-no-select ${active ? "active" : ""}`}
            >
              <Icon className="size-5" />
              <span>{t(tab.labelKey)}</span>
            </button>
          );
        })}

        {/* Search tab — opens the global search sheet */}
        <button
          type="button"
          role="tab"
          aria-selected={false}
          aria-label={t("common.search")}
          onClick={() => {
            haptic("selection");
            onSearchOpen?.();
          }}
          className="medos-tabbar-item medos-no-select"
        >
          <Search className="size-5" />
          <span>{t("common.search")}</span>
        </button>

        {/* User tab — tap goes to Profile, long-press opens quick menu */}
        <button
          ref={userTabRef}
          type="button"
          role="tab"
          aria-selected={isProfileActive}
          aria-label={t("nav.profile")}
          onClick={() => {
            if (!isProfileActive) {
              handleNav("profile");
            }
          }}
          className={`medos-tabbar-item medos-no-select ${isProfileActive ? "active" : ""}`}
        >
          <span className="relative inline-flex items-center justify-center">
            <span className="size-5 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-[9px] font-bold text-primary-foreground">
              {initials}
            </span>
          </span>
          <span>{t("nav.profile")}</span>
        </button>
      </nav>

      {/* Long-press quick menu — a bottom sheet with Settings, Theme, Sign out */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl p-0 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {/* Grab handle */}
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-border shrink-0" />
          <SheetHeader className="px-5 pt-3 pb-2">
            <SheetTitle className="flex items-center gap-3">
              <span className="size-10 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">
                {initials}
              </span>
              <span className="min-w-0 flex flex-col">
                <span className="text-sm font-semibold truncate">{user?.displayName || user?.username || "User"}</span>
                <span className="text-xs text-muted-foreground font-normal truncate">
                  {isCloudSession
                    ? (user?.email || `@${user?.username}`) + (user?.role ? ` · ${user.role}` : "")
                    : t("nav.localSession")}
                </span>
              </span>
            </SheetTitle>
            <SheetDescription className="sr-only">{t("nav.profile")}</SheetDescription>
          </SheetHeader>
          <div className="px-3 pb-3 flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                handleNav("profile");
              }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted transition-colors text-sm font-medium text-foreground"
            >
              <UserIcon className="size-4 text-muted-foreground" />
              {t("nav.profile")}
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                handleNav("settings");
              }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted transition-colors text-sm font-medium text-foreground"
            >
              <SettingsIcon className="size-4 text-muted-foreground" />
              {t("nav.settings")}
            </button>
            {isCloudSession && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  navigate("settings", { section: "account" });
                }}
                className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted transition-colors text-sm font-medium text-foreground"
              >
                <Cloud className="size-4 text-muted-foreground" />
                {t("settings.account.syncTitle")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                haptic("selection");
                onToggleTheme?.();
              }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted transition-colors text-sm font-medium text-foreground"
            >
              {isDark ? <Sun className="size-4 text-muted-foreground" /> : <Moon className="size-4 text-muted-foreground" />}
              {isDark ? t("theme.toggleToLight") : t("theme.toggleToDark")}
            </button>
            <div className="h-px bg-border my-1.5" />
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onSignOut?.();
              }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-destructive/10 transition-colors text-sm font-medium text-destructive"
            >
              <LogOut className="size-4" />
              {t("nav.signOut")}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
