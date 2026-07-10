"use client";

import * as React from "react";
import {
  LayoutDashboard,
  BookOpen,
  ListChecks,
  Layers,
  User as UserIcon,
  Cog,
  Stethoscope,
} from "lucide-react";
import type { OslerView } from "./app-shell";
import { useI18n } from "./i18n-provider";
import { cn } from "@/lib/utils";
import { useImmersiveMode } from "./immersive-mode";

interface MobileTabBarProps {
  view: OslerView;
  onViewChange: (v: OslerView) => void;
}

interface TabItem {
  id: OslerView;
  labelKey: "nav.dashboard" | "nav.qbank" | "nav.library" | "nav.flashcards" | "nav.profile" | "nav.osce";
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabItem[] = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { id: "qbank", labelKey: "nav.qbank", icon: ListChecks },
  { id: "library", labelKey: "nav.library", icon: BookOpen },
  { id: "flashcards", labelKey: "nav.flashcards", icon: Layers },
  { id: "osce", labelKey: "nav.osce", icon: Stethoscope },
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

export function MobileTabBar({ view, onViewChange }: MobileTabBarProps) {
  // Hide only while an engine view is running an active session (a question,
  // a studying flashcard, an OSCE scenario). The hub/landing screens of those
  // views keep the bar. Desktop is unaffected (md:hidden).
  const immersive = useImmersiveMode();
  const { t } = useI18n();
  return (
    <nav
      className={cn(
        "medos-tabbar medos-tap-none md:hidden fixed inset-x-0 bottom-0 z-50 flex",
        immersive && "hidden"
      )}
      role="tablist"
      aria-label="Primary"
    >
      {TABS.map((tab) => {
        const Icon = tab.id === "profile" ? ProfileIcon : tab.icon;
        const active = tab.id === view;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={t(tab.labelKey)}
            onClick={() => active || onViewChange(tab.id)}
            className={`medos-tabbar-item medos-no-select ${active ? "active" : ""}`}
          >
            <Icon className="size-5" />
            <span>{t(tab.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
