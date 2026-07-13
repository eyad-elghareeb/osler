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

/**
 * Page-level enter — used by AppShell's main content area when the View
 * Transitions API is unavailable. Keeps the feel of a native push nav.
 */
export const pageEnter: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};
