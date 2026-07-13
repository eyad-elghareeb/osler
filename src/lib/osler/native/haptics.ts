/**
 * Osler Haptics — Vibration API wrapper.
 *
 * Docs: https://whatpwacando.today/vibration
 * Spec: https://www.w3.org/TR/vibration/
 *
 * Design notes:
 *  - Vibration only fires on Android Chrome and a few other browsers; iOS
 *    Safari silently ignores `navigator.vibrate()` so we no-op there rather
 *    than warn (no graceful fallback exists).
 *  - Patterns are defined as named constants so callers never invent raw
 *    millisecond arrays at the call site. Centralizing patterns makes it
 *    trivial to tune them or strip them under reduced-motion.
 *  - The user can disable haptics from Settings ("native.haptics.enable"
 *    boolean in localStorage). When disabled, every call short-circuits.
 *  - We also honor `prefers-reduced-motion` automatically — if the OS says
 *    the user wants less motion, we suppress haptics too (they're a form
 *    of motion feedback).
 */

export type HapticPatternName =
  | "light"
  | "medium"
  | "heavy"
  | "success"
  | "warning"
  | "error"
  | "selection"
  | "tick"
  | "press";

/** Millisecond patterns. `0` means "no vibration". */
export const HAPTIC_PATTERNS: Record<HapticPatternName, number | number[]> = {
  // Single very short tap — used for hover-equivalent / focus feedback.
  tick: 8,
  // Light tap (10ms) — used for general button presses.
  light: 10,
  // Medium tap (20ms) — used for primary actions like submit.
  medium: 20,
  // Heavy tap (45ms) — used for destructive / important confirmations.
  heavy: 45,
  // Press feedback: short double tap, like a mechanical key actuation.
  press: [12, 18, 8],
  // Selection change: tiny single tick, like iOS picker.
  selection: 6,
  // Success: two short rising taps.
  success: [10, 40, 18],
  // Warning: longer single pulse.
  warning: 35,
  // Error: double heavy pulse.
  error: [40, 60, 40],
};

const HAPTICS_ENABLED_KEY = "osler-haptics-enabled";
const REDUCED_MOTION_KEY = "osler-haptics-reduced-motion";

let cachedEnabled: boolean | null = null;
let cachedReducedMotion: boolean | null = null;

function readEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(HAPTICS_ENABLED_KEY);
    // Default: enabled on touch devices, disabled on desktop.
    cachedEnabled = v === null
      ? ("ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0)
      : v === "true";
  } catch {
    cachedEnabled = false;
  }
  return cachedEnabled;
}

function readReducedMotion(): boolean {
  if (cachedReducedMotion !== null) return cachedReducedMotion;
  if (typeof window === "undefined" || !window.matchMedia) {
    cachedReducedMotion = false;
    return false;
  }
  try {
    cachedReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    cachedReducedMotion = false;
  }
  return cachedReducedMotion;
}

/** Subscribe to OS-level reduced-motion changes (runtime). */
if (typeof window !== "undefined" && window.matchMedia) {
  try {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => {
      cachedReducedMotion = e.matches;
    };
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else if ((mq as any).addListener) (mq as any).addListener(handler);
  } catch {
    /* noop */
  }
}

/** Public API — set the user preference from Settings. */
export function setHapticsEnabled(enabled: boolean): void {
  cachedEnabled = enabled;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HAPTICS_ENABLED_KEY, String(enabled));
  } catch {
    /* noop */
  }
}

export function isHapticsEnabled(): boolean {
  return readEnabled();
}

/**
 * Trigger a haptic pattern. Safe to call anywhere — no-ops on iOS Safari,
 * no-ops when the user has disabled haptics, no-ops under reduced-motion.
 */
export function haptic(pattern: HapticPatternName = "light"): void {
  if (!readEnabled()) return;
  if (readReducedMotion()) return;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(HAPTIC_PATTERNS[pattern]);
  } catch {
    /* some browsers throw on cross-origin iframes — ignore */
  }
}

/**
 * Convenience helper for component event handlers.
 * Returns the same handler so it can be composed inline.
 *
 * @example
 * <button onClick={withHaptic("medium", () => doThing())} />
 */
export function withHaptic<T extends (...args: any[]) => any>(
  pattern: HapticPatternName,
  fn: T,
): T {
  return ((...args: Parameters<T>) => {
    haptic(pattern);
    return fn(...args);
  }) as T;
}

/**
 * Imperative helper for the most common case — a button press.
 * Calling `pressHaptic()` is equivalent to `haptic("press")`.
 */
export function pressHaptic(): void {
  haptic("press");
}
