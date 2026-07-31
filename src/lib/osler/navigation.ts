"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import type { OslerView } from "@/components/osler/app-shell";
import {
  withViewTransition,
  pushNavHistory,
  popNavHistory,
  haptic,
  type ViewTransitionDirection,
} from "@/lib/osler/native";

/**
 * Stable order for top-level Osler views. Used to calculate slide directions.
 */
export const VIEW_ORDER: OslerView[] = [
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

export function directionFor(from: OslerView, to: OslerView): ViewTransitionDirection {
  if (from === to) return "none";
  const fromIdx = viewIndex(from);
  const toIdx = viewIndex(to);
  if (toIdx < fromIdx) return "backward";
  return "forward";
}

/**
 * Derive the active OslerView from the current pathname.
 */
export function useCurrentView(): OslerView {
  const pathname = usePathname();
  if (!pathname || pathname === "/") return "dashboard";
  const segment = pathname.split("/")[1];

  switch (segment) {
    case "qbank":
      return "qbank";
    case "learn":
      return "learn";
    case "library":
      return "library";
    case "flashcards":
      return "flashcards";
    case "osce":
      return "osce";
    case "videos":
      return "videos";
    case "profile":
      return "profile";
    case "settings":
      return "settings";
    default:
      return "dashboard";
  }
}

/**
 * Build a path for a view and optional params (pack uid, article id, video id, settings section).
 */
export function routeFor(
  view: OslerView,
  params?: { uid?: string; article?: string; video?: string; section?: string }
): string {
  switch (view) {
    case "dashboard":
      return "/";
    case "learn":
      return "/learn";
    case "library":
      return params?.article ? `/library/${encodeURIComponent(params.article)}` : "/library";
    case "qbank":
      return params?.uid ? `/qbank/${encodeURIComponent(params.uid)}` : "/qbank";
    case "flashcards":
      return params?.uid ? `/flashcards/${encodeURIComponent(params.uid)}` : "/flashcards";
    case "osce":
      return params?.uid ? `/osce/${encodeURIComponent(params.uid)}` : "/osce";
    case "videos":
      return params?.video ? `/videos/${encodeURIComponent(params.video)}` : "/videos";
    case "profile":
      return "/profile";
    case "settings":
      return params?.section ? `/settings/${encodeURIComponent(params.section)}` : "/settings";
    default:
      return "/";
  }
}

/**
 * Hook returning navigation function with haptics and View Transitions support.
 */
export function useOslerRouter() {
  const router = useRouter();
  const currentView = useCurrentView();

  const navigate = React.useCallback(
    (view: OslerView, params?: { uid?: string; article?: string; video?: string; section?: string }) => {
      const targetPath = routeFor(view, params);
      const direction = directionFor(currentView, view);

      haptic("selection");

      withViewTransition(() => {
        router.push(targetPath);
      }, direction);

      if (direction === "backward") {
        popNavHistory();
      } else {
        pushNavHistory(view);
      }
    },
    [currentView, router]
  );

  return { navigate, routeFor, currentView };
}
