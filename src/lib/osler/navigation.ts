"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import type { OslerView } from "@/components/osler/app-shell";
import {
  pushWithViewTransition,
  haptic,
  type ViewTransitionDirection,
} from "@/lib/osler/native";
import { warmViewData } from "@/lib/osler/precache";
import { isConstrainedDevice } from "@/lib/osler/performance";

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
 *
 * Dynamic content (pack uid, article, video, settings section) is carried in
 * QUERY PARAMS, not path segments. This keeps every route a real static file
 * (`/qbank`, `/library`, `/admin/content`, …) so the static export needs NO
 * dynamic-route placeholder pages and NO `_redirects` SPA-fallback rules.
 * The page reads its param via `useSearchParams()` and renders the content.
 */
export interface OslerRouteParams {
  uid?: string;
  article?: string;
  video?: string;
  section?: string;
  /** Force-resume the active Q-Bank session on arrival (adds ?resume=1). */
  resume?: boolean;
}

export function routeFor(
  view: OslerView,
  params?: OslerRouteParams
): string {
  switch (view) {
    case "dashboard":
      return "/";
    case "learn":
      return "/learn";
    case "library":
      return params?.article ? `/library?article=${encodeURIComponent(params.article)}` : "/library";
    case "qbank":
      if (params?.uid) return `/qbank?uid=${encodeURIComponent(params.uid)}${params.resume ? "&resume=1" : ""}`;
      return params?.resume ? "/qbank?resume=1" : "/qbank";
    case "flashcards":
      return params?.uid ? `/flashcards?uid=${encodeURIComponent(params.uid)}` : "/flashcards";
    case "osce":
      return params?.uid ? `/osce?uid=${encodeURIComponent(params.uid)}` : "/osce";
    case "videos":
      return params?.video ? `/videos?video=${encodeURIComponent(params.video)}` : "/videos";
    case "profile":
      return "/profile";
    case "settings":
      return params?.section ? `/settings?section=${encodeURIComponent(params.section)}` : "/settings";
    default:
      return "/";
  }
}

/**
 * Hook returning navigation function with haptics and View Transitions support.
 *
 * NOTE: We deliberately do NOT push/pop a custom nav history stack here.
 * The previous implementation called `pushNavHistory(view)` / `popNavHistory()`
 * alongside `router.push()`, but nothing synced that stack with the browser's
 * real history (no popstate listener). Browser back/forward would change the
 * URL via Next's router but leave the custom stack stale, causing the slide
 * direction heuristic to drift. The `directionFor(currentView, view)` call
 * below computes the direction from the static VIEW_ORDER, which is correct
 * for push navigation and a reasonable approximation for back/forward. The
 * custom stack is still available for components that explicitly manage it
 * (e.g. NavigationStack), but the router hook no longer touches it.
 */
export function useOslerRouter() {
  const router = useRouter();
  const currentView = useCurrentView();

  const prefetch = React.useCallback(
    (view: OslerView, params?: OslerRouteParams) => {
      // On constrained tablets, speculative code/data work competes with the
      // tap that triggered this intent. The route still loads normally after
      // navigation; capable devices retain eager hover/focus prefetching.
      if (isConstrainedDevice()) return;
      try {
        const targetPath = routeFor(view, params);
        router.prefetch(targetPath);
      } catch {
        // Ignore prefetch error
      }
      // Warm the view's data too: router prefetch only fetches code, so
      // without this the hub still hangs on its first manifest round trip
      // after commit. Memoized/SW-cached — free on repeat hovers.
      warmViewData(view);
    },
    [router]
  );

  const prefetchAll = React.useCallback(() => {
    for (const view of VIEW_ORDER) prefetch(view);
  }, [prefetch]);

  const navigate = React.useCallback(
    (view: OslerView, params?: OslerRouteParams, opts?: { viaTab?: boolean }) => {
      const targetPath = routeFor(view, params);
      const ordered = directionFor(currentView, view);

      haptic("selection");

      // Same-view navigation (e.g. qbank → qbank?uid=X) is NOT a view change,
      // so it must not run a full-page View Transition. Running one here
      // cross-fades the entire page — including any dialog/overlay that opens
      // or closes in the same tick — and double-fades against that surface's
      // own enter/exit animation (visible as a flicker when a modal closes
      // during pack navigation). The studio stays mounted and re-renders the
      // new param in place, so no global crossfade is needed.
      if (ordered === "none") {
        router.push(targetPath);
        return;
      }

      // Hub switches from the bottom tab bar / desktop top nav are lateral
      // moves, not stack pushes — a full slide implies depth that isn't there
      // and reads as sluggish on every tap. They run the subtle "tab"
      // crossfade (quick fade + whisper of lift, no horizontal travel) with
      // a tight commit budget so the animation starts immediately instead of
      // holding the old page, while drill navigation (search results, pack
      // opens, back) keeps the directional slide and the full budget.
      const direction: ViewTransitionDirection =
        opts?.viaTab ? "tab" : ordered;

      // Cross-view: transition old→new (not old→old). pushWithViewTransition
      // awaits the actual route commit + paint before letting the browser
      // capture the "new" snapshot, so the crossfade never blanks the page.
      pushWithViewTransition((p) => router.push(p), targetPath, direction, opts?.viaTab ? 80 : undefined);
    },
    [currentView, router]
  );

  return { navigate, prefetch, prefetchAll, routeFor, currentView };
}
