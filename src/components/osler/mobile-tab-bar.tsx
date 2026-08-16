"use client";

import * as React from "react";
import {
  LayoutDashboard,
  ListChecks,
  GraduationCap,
  User as UserIcon,
  Cog,
} from "lucide-react";
import { type OslerView, LEARN_SUBVIEWS } from "./app-shell";
import { useI18n } from "./i18n-provider";
import { cn } from "@/lib/utils";
import { useImmersiveMode } from "./immersive-mode";

import { useCurrentView, useOslerRouter } from "@/lib/osler/navigation";

interface MobileTabBarProps {
  view?: OslerView;
  onViewChange?: (v: OslerView) => void;
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
  { id: "profile", labelKey: "nav.profile", icon: UserIcon },
];

function ProfileIcon({ className }: { className?: string }) {
  const { rtl } = useI18n();
  return (
    <span className="relative inline-flex items-center justify-center">
      <UserIcon className={className} />
      <Cog className={cn("absolute -bottom-0.5 size-2.5 text-muted-foreground", rtl ? "-left-0.5" : "-right-0.5")} />
    </span>
  );
}

export function MobileTabBar({ view: propView, onViewChange }: MobileTabBarProps) {
  const immersive = useImmersiveMode();
  const { t } = useI18n();
  const currentView = useCurrentView();
  const { navigate } = useOslerRouter();

  const activeView = propView ?? currentView;
  const handleNav = onViewChange ?? navigate;

  return (
    <nav
      className={cn(
        "osler-tabbar osler-tap-none md:hidden fixed inset-x-0 bottom-0 z-50 flex",
        immersive && "hidden"
      )}
      role="tablist"
      aria-label="Primary"
    >
      {TABS.map((tab) => {
        const Icon = tab.id === "profile" ? ProfileIcon : tab.icon;
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
            className={`osler-tabbar-item osler-no-select ${active ? "active" : ""}`}
          >
            <Icon className="size-5" />
            <span>{t(tab.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}