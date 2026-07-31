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

/** Millisecond patterns. `0` means "no vibration".
 * Note: Modern Android linear haptic motors require 15ms+ pulse width to
 * overcome physical inertia. Patterns below 15ms are silently ignored on many devices.
 */
export const HAPTIC_PATTERNS: Record<HapticPatternName, number | number[]> = {
  // Single short tap — focus / hover tick.
  tick: 15,
  // Light tap (20ms) — general button presses.
  light: 20,
  // Medium tap (35ms) — primary actions / submits.
  medium: 35,
  // Heavy tap (60ms) — destructive / important confirmations.
  heavy: 60,
  // Press feedback: distinct double tap.
  press: [20, 30, 15],
  // Selection change: quick crisp tick.
  selection: 15,
  // Success: two rising taps.
  success: [25, 40, 30],
  // Warning: double warning pulse.
  warning: [45, 50, 45],
  // Error: double heavy pulse.
  error: [50, 60, 50],
};

const HAPTICS_ENABLED_KEY = "osler-haptics-enabled";

let cachedEnabled: boolean | null = null;
let cachedReducedMotion: boolean | null = null;

function readEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(HAPTICS_ENABLED_KEY);
    // If not set, default to enabled if the browser supports vibration or touch
    cachedEnabled = v === null
      ? (typeof navigator !== "undefined" && typeof navigator.vibrate === "function")
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
    /* some browsers throw on cross-origin iframes or missing focus — ignore */
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
