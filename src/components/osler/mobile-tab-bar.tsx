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

interface MobileTabBarProps {
  view: OslerView;
  onViewChange: (v: OslerView) => void;
}

interface TabItem {
  id: OslerView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabItem[] = [
  { id: "dashboard", label: "Home", icon: LayoutDashboard },
  { id: "library", label: "Library", icon: BookOpen },
  { id: "flashcards", label: "Cards", icon: Layers },
  { id: "qbank", label: "Q-Bank", icon: ListChecks },
  { id: "osce", label: "OSCE", icon: Stethoscope },
  { id: "profile", label: "Profile", icon: UserIcon },
];

function ProfileIcon({ className }: { className?: string }) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <UserIcon className={className} />
      <Cog className="absolute -bottom-0.5 -right-0.5 size-2.5 text-muted-foreground" />
    </span>
  );
}

export function MobileTabBar({ view, onViewChange }: MobileTabBarProps) {
  return (
    <nav
      className="medos-tabbar safe-bottom medos-tap-none md:hidden shrink-0 flex"
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
            aria-label={tab.label}
            onClick={() => active || onViewChange(tab.id)}
            className={`medos-tabbar-item medos-no-select ${active ? "active" : ""}`}
          >
            <Icon className="size-5" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
