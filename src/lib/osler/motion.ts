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

/* ───────────────────────── Shared variants ────────────────────── */

/** Smooth, slightly-snappy spring used for layout-level animations. */
export const springSnappy: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 30,
};

/** Soft spring for cards / list items. */
export const springSoft: Transition = {
  type: "spring",
  stiffness: 280,
  damping: 26,
};

/** Standard ease for fades and slides. */
export const easeOut: Transition = { duration: 0.25, ease: [0.32, 0.72, 0, 1] };
export const easeOutSlow: Transition = { duration: 0.32, ease: [0.32, 0.72, 0, 1] };

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
    transition: { duration: 0.25, ease: [0.32, 0.72, 0, 1] },
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] },
  },
};

/** Feedback pulse — a single soft ring used to acknowledge a primary
 * action (e.g. flashcard rating, save). Apply to a motion.div with
 * `initial="rest"` and trigger via `animate="pulse"` on tap. */
export const feedbackPulse: Variants = {
  rest: { boxShadow: "0 0 0 0 color-mix(in oklch, var(--primary) 0%, transparent)" },
  pulse: {
    boxShadow: [
      "0 0 0 0 color-mix(in oklch, var(--primary) 45%, transparent)",
      "0 0 0 8px color-mix(in oklch, var(--primary) 0%, transparent)",
    ],
    transition: { duration: 0.45, ease: "easeOut" },
  },
};

/** Press feedback — a 0.97 scale on tap, restored on release.
 * Use on `motion.button` with `whileTap="press"`. */
export const pressFeedback: Variants = {
  rest: { scale: 1 },
  press: { scale: 0.97, transition: { duration: 0.08, ease: "easeOut" } },
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
    exit: { opacity: 0, ...dir, transition: { duration: 0.18 } },
    transition: { duration: 0.25, ease: [0.32, 0.72, 0, 1] as const },
  };
}

/**
 * Page-level enter — used by AppShell's main content area when the View
 * Transitions API is unavailable. Keeps the feel of a native push nav.
 */
export const pageEnter: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
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
    transition: { type: "spring" as const, stiffness: 380, damping: 32, mass: 0.8 },
  };
}
