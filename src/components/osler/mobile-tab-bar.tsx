"use client";

import * as React from "react";
import {
  LayoutDashboard,
  BookOpen,
  ListChecks,
  User as UserIcon,
  Settings as SettingsIcon,
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
  { id: "qbank", label: "Q-Bank", icon: ListChecks },
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export function MobileTabBar({ view, onViewChange }: MobileTabBarProps) {
  return (
    <nav
      className="medos-tabbar safe-bottom medos-tap-none md:hidden shrink-0 flex"
      role="tablist"
      aria-label="Primary"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
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
