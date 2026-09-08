/**
 * Osler Blur Effects — user preference for frosted (backdrop-blur) surfaces.
 *
 * Design notes:
 *  - Blur is OFF by default: backdrop-filter is the dominant GPU cost on
 *    budget hardware, and frosted surfaces are a garnish, not a necessity.
 *  - The preference is opt-in from Settings → Native Features and is
 *    mirrored onto `<html data-blur="on|off">` so a single CSS block in
 *    globals.css covers every blurred surface (modals, sheets, in-session
 *    top bars, popovers, toolbars) without touching component code.
 *  - When off, translucent neutral surfaces (bg-card/60, bg-background/80)
 *    resolve to their solid tokens — same design, frost-free. Accent tints
 *    (bg-primary/10) and dim scrims (bg-black/50) stay translucent: they're
 *    color, not material.
 *  - Explicit opt-in wins over everything: data-perf="low" and OS
 *    prefers-reduced-transparency only shape the blur-off default.
 */

const BLUR_KEY = "osler-blur-effects-enabled";
const BLUR_EVENT = "osler-blur-changed";

export function isBlurEffectsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(BLUR_KEY) === "true";
  } catch {
    return false;
  }
}

/** Reflect the flag on <html data-blur="off|on"> so CSS can react. */
export function applyBlurEffectsFlag(enabled: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-blur", enabled ? "on" : "off");
}

export function setBlurEffectsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BLUR_KEY, String(enabled));
  } catch {
    /* noop */
  }
  applyBlurEffectsFlag(enabled);
  window.dispatchEvent(new CustomEvent(BLUR_EVENT));
}