"use client";

/**
 * Osler motion primitives — shared animation components.
 *
 * Every animated surface in the app should compose these instead of
 * hand-rolling `initial`/`animate`/`transition` inline. That guarantees
 * one rhythm everywhere: same durations, same easing, same stagger cadence.
 *
 * Design: Emil (primary) — speed and restraint, ≤0.28s; Jakub (secondary)
 * — subtle polish. All motion respects `prefers-reduced-motion` via
 * `AnimationsProvider` (`MotionConfig reducedMotion="always"`) and the
 * `data-animations="off"` CSS kill-switch. The primitives deliberately
 * animate only `opacity` / `transform` so they stay on the compositor.
 *
 * Rules for extending:
 *  - Read durations/easings/springs from `@/lib/osler/motion` tokens.
 *  - Never introduce a new `duration` or `ease` value here — add it to the
 *    token table in `motion.ts` first so it has a name and a rationale.
 *  - Exits are subtler than enters (smaller translate, shorter duration).
 *  - Use `transform` + `opacity` only; never `width`/`height`/`top`/`left`.
 */

import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import {
  MOTION_TRANSITION,
  MOTION_SPRING,
  staggerContainer,
  staggerContainerSlow,
  listItemEnter,
  fadeUp,
  pressFeedback,
} from "@/lib/osler/motion";

// ─── FadeIn ───────────────────────────────────────────────────────────

/**
 * Fade + lift on mount. Replaces the ubiquitous
 * `initial={{opacity:0,y:N}} animate={{opacity:1,y:0}} transition={{...}}`
 * pattern that was previously hand-rolled with 8 different durations.
 */
export interface FadeInProps extends Omit<HTMLMotionProps<"div">, "initial" | "animate" | "transition"> {
  /** Vertical offset at mount. Defaults to 8. Use 4 for dense grids, 12 for heroes. */
  y?: number;
  /** Horizontal offset (for slide variants). Defaults to 0. */
  x?: number;
  /** Delay in seconds before the enter starts. */
  delay?: number;
  /** Transition preset — `base` (0.22s), `normal` (0.25s), `slow` (0.28s), `fast` (0.15s). */
  preset?: "fast" | "quick" | "base" | "normal" | "slow";
}

export function FadeIn({
  y = 8,
  x = 0,
  delay = 0,
  preset = "normal",
  children,
  ...props
}: FadeInProps) {
  const transition =
    delay > 0
      ? { ...MOTION_TRANSITION[preset], delay }
      : MOTION_TRANSITION[preset];
  return (
    <motion.div
      initial={{ opacity: 0, y, x }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={transition}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// ─── Stagger ──────────────────────────────────────────────────────────

/**
 * Stagger container — wraps `staggerContainer` / `staggerContainerSlow`.
 * Children should be `StaggerItem`s (or any element with `variants` that has
 * `hidden`/`visible` keys). The container staggers them automatically.
 */
export interface StaggerProps extends Omit<HTMLMotionProps<"div">, "variants" | "initial" | "animate"> {
  /** Use the slower cadence (fewer items, more drama). Defaults to false. */
  slow?: boolean;
}

export function Stagger({ slow = false, children, ...props }: StaggerProps) {
  return (
    <motion.div
      variants={slow ? staggerContainerSlow : staggerContainer}
      initial="hidden"
      animate="visible"
      {...props}
    >
      {children}
    </motion.div>
  );
}

// ─── StaggerItem ──────────────────────────────────────────────────────

/**
 * Stagger item — the leaf that animates inside a `Stagger` container.
 * Defaults to the subtle `listItemEnter` (4px lift); pass `variant="fadeUp"`
 * for the slightly larger 8px lift used on page-level sections.
 */
export interface StaggerItemProps extends Omit<HTMLMotionProps<"div">, "variants"> {
  variant?: "listItem" | "fadeUp";
}

const STAGGER_VARIANTS = {
  listItem: listItemEnter,
  fadeUp: fadeUp,
} as const;

export function StaggerItem({ variant = "listItem", children, ...props }: StaggerItemProps) {
  return (
    <motion.div variants={STAGGER_VARIANTS[variant]} {...props}>
      {children}
    </motion.div>
  );
}

// ─── Pressable ────────────────────────────────────────────────────────

/**
 * Pressable — a button/div that scales down on tap for tactile feedback.
 * Replaces hand-rolled `whileTap={{ scale: 0.97 }}` / `whileTap={...}` patterns.
 * The scale is subtle (0.97) so it reads as physical, not bouncy.
 */
export interface PressableProps extends Omit<HTMLMotionProps<"button">, "whileTap"> {
  /** Render as a div instead of a button. */
  as?: "button" | "div";
}

export function Pressable({ as = "button", children, ...props }: PressableProps) {
  const Comp = as === "div" ? motion.div : motion.button;
  return (
    // @ts-expect-error — motion.button vs motion.div prop union is intentionally loose here.
    <Comp variants={pressFeedback} initial="rest" whileTap="press" {...props}>
      {children}
    </Comp>
  );
}

// ─── HoverLift ────────────────────────────────────────────────────────

/**
 * HoverLift — subtle lift + spring on hover for interactive cards.
 * Encapsulates the `whileHover` scale used in StatTile and QuickAction.
 */
export function HoverLift({
  children,
  ...props
}: Omit<HTMLMotionProps<"span">, "whileHover" | "transition">) {
  return (
    <motion.span
      whileHover={{ scale: 1.08 }}
      transition={MOTION_SPRING.pop}
      {...props}
    >
      {children}
    </motion.span>
  );
}
