/**
 * Osler motion helpers — reusable framer-motion variants + a user-facing
 * animations toggle.
 *
 * Design:
 *   - All shared variants live here so animations are consistent across
 *     the app (same easing, same durations, same stagger cadence).
 *   - Durations stay under 0.3s per AGENTS.md rule 8.
 *   - A user can disable all UI animations from Settings → Native Features.
 *     When disabled, the `AnimationsProvider` wraps the tree in
 *     `<MotionConfig reducedMotion="always">` which makes every motion
 *     component instant. The CSS in globals.css also forces
 *     `transition-duration: 0.01ms` on everything under
 *     `[data-animations="off"]` so non-framer transitions are covered too.
 */

import * as React from "react";
import { type Variants, type Transition } from "framer-motion";

/* ───────────────────────── Storage ────────────────────────────── */

const ANIMATIONS_KEY = "osler-animations-enabled";
const ANIMATIONS_EVENT = "osler-animations-changed";

export function isAnimationsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(ANIMATIONS_KEY) !== "false";
}

export function setAnimationsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  if (enabled) localStorage.removeItem(ANIMATIONS_KEY);
  else localStorage.setItem(ANIMATIONS_KEY, "false");
  applyAnimationsFlag(enabled);
  window.dispatchEvent(new CustomEvent(ANIMATIONS_EVENT));
}

/** Reflect the flag on <html data-animations="off"> so CSS can react. */
export function applyAnimationsFlag(enabled: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (enabled) root.removeAttribute("data-animations");
  else root.setAttribute("data-animations", "off");
}

/** React hook — re-renders when the user toggles animations in Settings. */
export function useAnimationsEnabled(): boolean {
  const [enabled, setEnabled] = React.useState(true);
  React.useEffect(() => {
    const update = () => setEnabled(isAnimationsEnabled());
    update();
    window.addEventListener(ANIMATIONS_EVENT, update);
    return () => window.removeEventListener(ANIMATIONS_EVENT, update);
  }, []);
  return enabled;
}

/* ───────────────────────── Canonical tokens ─────────────────────
 * Single source of truth for every animation in the app. Components must
 * read from these tokens — never hardcode durations, easings, or spring
 * configs inline. This is what makes the whole site share one rhythm.
 *
 * Durations are ≤0.28s (≤0.3s rule) except for ambient loops (skeleton
 * shimmer, voice orb) which are exempt. One easing curve everywhere so
 * fades, slides, and disclosures feel like the same system.
 */

export const MOTION_DURATION = {
  /** Micro-interactions, icon pops, tooltip fades. */
  fast: 0.15,
  /** Quick fades, disclosure chevrons, inline feedback. */
  quick: 0.2,
  /** Default for cards, list items, loading states. */
  base: 0.22,
  /** Standard for fades and slides. */
  normal: 0.25,
  /** Hero, page-level, or larger surfaces. */
  slow: 0.28,
} as const;

export const MOTION_EASE = {
  /** The one easing curve for all UI motion. */
  standard: [0.32, 0.72, 0, 1] as const,
} as const;

export const MOTION_SPRING = {
  /** Layout, tab indicators, nav — snappy and precise. */
  snappy: { type: "spring" as const, stiffness: 380, damping: 30 },
  /** Cards and list items — softer settle. */
  soft: { type: "spring" as const, stiffness: 280, damping: 26 },
  /** Bouncy entrances — stat tiles, disclosure icons. */
  pop: { type: "spring" as const, stiffness: 450, damping: 24 },
} as const;

export const MOTION_TRANSITION = {
  fast: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.standard } as Transition,
  quick: { duration: MOTION_DURATION.quick, ease: MOTION_EASE.standard } as Transition,
  base: { duration: MOTION_DURATION.base, ease: MOTION_EASE.standard } as Transition,
  normal: { duration: MOTION_DURATION.normal, ease: MOTION_EASE.standard } as Transition,
  slow: { duration: MOTION_DURATION.slow, ease: MOTION_EASE.standard } as Transition,
  /**
   * Scroll-away chrome (app bar, QBank hub header). Height does the layout
   * work on a slightly longer, eased curve so the reclaim reads as one
   * smooth motion; opacity finishes earlier so content is gone before it
   * would be visible mid-squish.
   */
  collapseBar: {
    height: { duration: MOTION_DURATION.quick, ease: MOTION_EASE.standard },
    opacity: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.standard },
  } as Transition,
} as const;

/* ───────────────────────── Shared variants ────────────────────── */

/** Smooth, slightly-snappy spring used for layout-level animations. */
export const springSnappy: Transition = MOTION_SPRING.snappy;

/** Soft spring for cards / list items. */
export const springSoft: Transition = MOTION_SPRING.soft;

/** Bouncy spring for entrances that need a little pop. */
export const springPop: Transition = MOTION_SPRING.pop;

/** Standard ease for fades and slides. */
export const easeOut: Transition = MOTION_TRANSITION.normal;
export const easeOutSlow: Transition = MOTION_TRANSITION.slow;

/** Fade + lift up. Use for cards / list items entering the viewport. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

/** Fade + slide in from the inline-start side. Use for nested pages. */
export const fadeSlideStart: Variants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0 },
};

/** Fade + slide in from the inline-end side. Use for forward nav. */
export const fadeSlideEnd: Variants = {
  hidden: { opacity: 0, x: 12 },
  visible: { opacity: 1, x: 0 },
};

/** Pure fade — use when motion would be distracting (e.g. tooltips). */
export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

/** Scale-in — use for popovers / dialogs / sheets. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1 },
};

/**
 * Stagger container — children with `variants={fadeUp}` (or any variant
 * with `hidden`/`visible` keys) animate in sequence. Use on the parent
 * `<motion.div variants={staggerContainer} initial="hidden" animate="visible">`.
 *
 * `staggerChildren` is small so lists don't feel slow even with many items.
 */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02,
    },
  },
};

/** Slightly larger stagger for hero sections (fewer items, more drama). */
export const staggerContainerSlow: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.04,
    },
  },
};

/* ───────────────────────── Motion-Primitives-inspired recipes ────────
 * Adapted from Motion Primitives patterns (motion-primitives.com) per
 * `docs/design-library-roadmap.md` § "Establish an interaction layer".
 * Every duration is ≤0.3s and every pattern respects reduced-motion via
 * the `AnimationsProvider` wrapping the tree in `<MotionConfig
 * reducedMotion="always">` when the user opts out.
 */

/** List item enter — subtle fade + 4px lift. Use for grids of cards.
 * Smaller than `fadeUp` so a 6-card grid feels like a single sweep. */
export const listItemEnter: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0 },
};

/** Tab indicator — used by `<SegmentedControl>` and pill tabs.
 * Pair with `layoutId` on the moving element so Framer animates the
 * shared-layout transition between two positions. */
export const tabIndicator: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 30,
};

/** Disclosure / accordion open — animates height + opacity together.
 * Apply to the inner content wrapper of an expandable section. */
export const disclosureVariants: Variants = {
  hidden: { opacity: 0, height: 0 },
  visible: {
    opacity: 1,
    height: "auto",
    transition: MOTION_TRANSITION.normal,
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: MOTION_TRANSITION.quick,
  },
};

/** Press feedback — a 0.97 scale on tap, restored on release.
 * Use on `motion.button` with `whileTap="press"`. */
export const pressFeedback: Variants = {
  rest: { scale: 1 },
  press: { scale: 0.97, transition: MOTION_TRANSITION.fast },
};

/** Stacked panel enter — used by `<AnimatePresence>` for sheets, drawers,
 * and stacked modals that slide in from a consistent edge. */
export function stackedPanelEnter(edge: "start" | "end" | "bottom" | "top" = "bottom") {
  const dir =
    edge === "bottom" ? { y: 16 } :
    edge === "top" ? { y: -16 } :
    edge === "start" ? { x: -16 } :
    { x: 16 };
  return {
    initial: { opacity: 0, ...dir },
    animate: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, ...dir, transition: MOTION_TRANSITION.quick },
    transition: MOTION_TRANSITION.normal,
  };
}

/**
 * Page-level enter — used by AppShell's main content area when the View
 * Transitions API is unavailable. Keeps the feel of a native push nav.
 */
export const pageEnter: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: MOTION_TRANSITION.normal },
  exit: { opacity: 0, y: -6, transition: MOTION_TRANSITION.quick },
};

/**
 * Instagram-carousel-style slide transition for card-based views.
 * Returns `initial`/`animate`/`exit`/`transition` props for a `motion.div`
 * inside `<AnimatePresence mode="wait">`.
 *
 * @param dir  - navigation direction ("next" or "prev")
 * @param rtl  - right-to-left layout flag
 */
export function carouselSlide(dir: "next" | "prev", rtl: boolean) {
  const sign = rtl ? -1 : 1;
  const enterX = dir === "next" ? sign * 80 : -sign * 80;
  return {
    initial: { opacity: 0, scale: 0.92, x: enterX },
    animate: { opacity: 1, scale: 1, x: 0 },
    exit: { opacity: 0, scale: 0.92, x: -enterX },
    transition: MOTION_SPRING.snappy,
  };
}
