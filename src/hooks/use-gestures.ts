"use client";

/**
 * useGestures — lightweight touch-gesture hooks for the MedOS mobile UX.
 *
 * Three independent hooks are exported:
 *
 *   • `useSwipe(options)`            — directional swipes on an element.
 *   • `usePinch(options)`            — pinch-to-zoom on an element.
 *   • `useEdgeSwipe(options)`        — swipe in from a screen edge to trigger
 *                                       an action (e.g. open sidebar drawer).
 *
 * All hooks are no-ops on devices without touch support, and gracefully
 * degrade on the desktop (mouse events aren't translated to swipes).
 *
 * Design notes:
 *   • We use Pointer Events where available (so the same handler works for
 *     touch, pen, and mouse). For multi-touch (pinch) we fall back to
 *     Touch Events because Pointer Events don't expose multiple contacts
 *     per element cleanly.
 *   • Thresholds (min distance, max duration, max orthogonal drift) are
 *     tuned for a 360–414px-wide phone viewport.
 *   • We never call `e.preventDefault()` on the document root — only on the
 *     bound element, and only after a gesture is recognized, so the browser's
 *     native scrolling isn't blocked during exploration.
 */

import * as React from "react";

// ─── Types ────────────────────────────────────────────────────────────────

export interface SwipeHandlers {
  onSwipeLeft?: (e: PointerEvent) => void;
  onSwipeRight?: (e: PointerEvent) => void;
  onSwipeUp?: (e: PointerEvent) => void;
  onSwipeDown?: (e: PointerEvent) => void;
  /** Called for every pointermove during a potential swipe — useful for live UI feedback. */
  onSwipeProgress?: (dx: number, dy: number) => void;
  /** Called when a swipe gesture starts (pointerdown + minimal move). */
  onSwipeStart?: (e: PointerEvent) => void;
  /** Called when a swipe ends without meeting the threshold (gesture cancelled). */
  onSwipeCancel?: () => void;
}

export interface SwipeOptions extends SwipeHandlers {
  /** Minimum displacement in px to qualify as a swipe. Default 50. */
  threshold?: number;
  /** Maximum gesture duration in ms. Default 600. */
  maxDuration?: number;
  /** Max ratio of orthogonal-to-primary drift. Default 0.6 (i.e. primary axis must be ≥ 1.66× the orthogonal). */
  maxDriftRatio?: number;
  /** Only recognize swipes that start on this element (not bubbled from children). Default false. */
  exactTarget?: boolean;
  /** Disable the gesture hook entirely. */
  disabled?: boolean;
}

export interface PinchHandlers {
  onPinchStart?: (e: TouchEvent) => void;
  onPinchMove?: (scale: number, e: TouchEvent) => void;
  onPinchEnd?: (e: TouchEvent) => void;
}

export interface PinchOptions extends PinchHandlers {
  /** Minimum scale change before onPinchMove fires. Default 1.02. */
  threshold?: number;
  disabled?: boolean;
}

export interface EdgeSwipeOptions {
  /** Edge to watch: "left" | "right" | "top" | "bottom". */
  edge: "left" | "right" | "top" | "bottom";
  /** Width/height in px of the edge zone that initiates the swipe. Default 24. */
  edgeZone?: number;
  /** Min displacement to commit the action. Default 80. */
  threshold?: number;
  onSwipe: (e: PointerEvent) => void;
  onSwipeProgress?: (progress: number) => void;
  onSwipeCancel?: () => void;
  disabled?: boolean;
}

// ─── useSwipe ─────────────────────────────────────────────────────────────

export function useSwipe<T extends HTMLElement = HTMLDivElement>(
  options: SwipeOptions
): React.RefObject<T | null> {
  const ref = React.useRef<T | null>(null);
  const optsRef = React.useRef(options);
  optsRef.current = options;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (options.disabled) return;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let tracking = false;
    let startPointerId = -1;

    const onDown = (e: PointerEvent) => {
      // Only react to touch + pen + mouse left-button.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (optsRef.current.exactTarget && e.target !== el) return;
      // Don't start tracking if the user is interacting with a text input or
      // contentEditable — they're trying to position the caret, not swipe.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      tracking = true;
      startX = e.clientX;
      startY = e.clientY;
      startT = Date.now();
      startPointerId = e.pointerId;
    };

    const onMove = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== startPointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      optsRef.current.onSwipeProgress?.(dx, dy);
    };

    const onUp = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== startPointerId) return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const dt = Date.now() - startT;
      const o = optsRef.current;
      const threshold = o.threshold ?? 50;
      const maxDuration = o.maxDuration ?? 600;
      const maxDriftRatio = o.maxDriftRatio ?? 0.6;

      if (dt > maxDuration) {
        o.onSwipeCancel?.();
        return;
      }

      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      // Determine primary axis.
      if (absX >= threshold && absX > absY * (1 / maxDriftRatio)) {
        if (dx > 0) o.onSwipeRight?.(e);
        else o.onSwipeLeft?.(e);
      } else if (absY >= threshold && absY > absX * (1 / maxDriftRatio)) {
        if (dy > 0) o.onSwipeDown?.(e);
        else o.onSwipeUp?.(e);
      } else {
        o.onSwipeCancel?.();
      }
    };

    const onCancel = () => {
      if (!tracking) return;
      tracking = false;
      optsRef.current.onSwipeCancel?.();
    };

    el.addEventListener("pointerdown", onDown, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerup", onUp, { passive: true });
    el.addEventListener("pointercancel", onCancel, { passive: true });
    el.addEventListener("pointerleave", onCancel, { passive: true });

    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("pointerleave", onCancel);
    };
  }, [options.disabled]);

  return ref;
}

// ─── usePinch ─────────────────────────────────────────────────────────────

export function usePinch<T extends HTMLElement = HTMLDivElement>(
  options: PinchOptions
): React.RefObject<T | null> {
  const ref = React.useRef<T | null>(null);
  const optsRef = React.useRef(options);
  optsRef.current = options;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (options.disabled) return;

    let initialDist = 0;
    let lastScale = 1;
    let pinching = false;

    const dist = (t1: Touch, t2: Touch) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.hypot(dx, dy);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinching = true;
      initialDist = dist(e.touches[0], e.touches[1]);
      lastScale = 1;
      optsRef.current.onPinchStart?.(e);
    };

    const onMove = (e: TouchEvent) => {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault();
      const d = dist(e.touches[0], e.touches[1]);
      if (initialDist <= 0) return;
      const scale = d / initialDist;
      const threshold = optsRef.current.threshold ?? 1.02;
      if (Math.abs(scale - lastScale) >= threshold - 1 || Math.abs(scale - 1) >= threshold - 1) {
        optsRef.current.onPinchMove?.(scale, e);
        lastScale = scale;
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (!pinching) return;
      if (e.touches.length < 2) {
        pinching = false;
        optsRef.current.onPinchEnd?.(e);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [options.disabled]);

  return ref;
}

// ─── useEdgeSwipe ─────────────────────────────────────────────────────────

export function useEdgeSwipe<T extends HTMLElement = HTMLDivElement>(
  options: EdgeSwipeOptions
): React.RefObject<T | null> {
  const ref = React.useRef<T | null>(null);
  const optsRef = React.useRef(options);
  optsRef.current = options;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (options.disabled) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let startPointerId = -1;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const o = optsRef.current;
      const zone = o.edgeZone ?? 24;
      const rect = el.getBoundingClientRect();
      let inEdge = false;
      switch (o.edge) {
        case "left":   inEdge = e.clientX - rect.left <= zone; break;
        case "right":  inEdge = rect.right - e.clientX <= zone; break;
        case "top":    inEdge = e.clientY - rect.top <= zone; break;
        case "bottom": inEdge = rect.bottom - e.clientY <= zone; break;
      }
      if (!inEdge) return;
      // Avoid hijacking inputs.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      tracking = true;
      startX = e.clientX;
      startY = e.clientY;
      startPointerId = e.pointerId;
    };

    const onMove = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== startPointerId) return;
      const o = optsRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const threshold = o.threshold ?? 80;
      let progress = 0;
      switch (o.edge) {
        case "left":   progress = Math.min(1, Math.max(0, dx / threshold)); break;
        case "right":  progress = Math.min(1, Math.max(0, -dx / threshold)); break;
        case "top":    progress = Math.min(1, Math.max(0, dy / threshold)); break;
        case "bottom": progress = Math.min(1, Math.max(0, -dy / threshold)); break;
      }
      o.onSwipeProgress?.(progress);
    };

    const onUp = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== startPointerId) return;
      tracking = false;
      const o = optsRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const threshold = o.threshold ?? 80;
      let triggered = false;
      switch (o.edge) {
        case "left":   triggered = dx >= threshold; break;
        case "right":  triggered = -dx >= threshold; break;
        case "top":    triggered = dy >= threshold; break;
        case "bottom": triggered = -dy >= threshold; break;
      }
      if (triggered) o.onSwipe(e);
      else o.onSwipeCancel?.();
    };

    const onCancel = () => {
      if (!tracking) return;
      tracking = false;
      optsRef.current.onSwipeCancel?.();
    };

    el.addEventListener("pointerdown", onDown, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerup", onUp, { passive: true });
    el.addEventListener("pointercancel", onCancel, { passive: true });
    el.addEventListener("pointerleave", onCancel, { passive: true });

    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("pointerleave", onCancel);
    };
  }, [options.disabled, options.edge]);

  return ref;
}

// ─── useLongPress ─────────────────────────────────────────────────────────

export interface LongPressOptions {
  /** Duration in ms before the long-press fires. Default 500. */
  duration?: number;
  /** Max drift in px before the long-press is cancelled. Default 10. */
  maxDrift?: number;
  onLongPress: (e: PointerEvent) => void;
  onCancel?: () => void;
  disabled?: boolean;
}

export function useLongPress<T extends HTMLElement = HTMLButtonElement>(
  options: LongPressOptions
): React.RefObject<T | null> {
  const ref = React.useRef<T | null>(null);
  const optsRef = React.useRef(options);
  optsRef.current = options;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (options.disabled) return;

    let startX = 0;
    let startY = 0;
    let timer: number | null = null;
    let startPointerId = -1;

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      startPointerId = e.pointerId;
      const o = optsRef.current;
      const dur = o.duration ?? 500;
      timer = window.setTimeout(() => {
        timer = null;
        o.onLongPress(e);
      }, dur);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== startPointerId) return;
      const o = optsRef.current;
      const maxDrift = o.maxDrift ?? 10;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > maxDrift) {
        clear();
        o.onCancel?.();
      }
    };

    const onUp = () => {
      clear();
    };

    el.addEventListener("pointerdown", onDown, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerup", onUp, { passive: true });
    el.addEventListener("pointercancel", onUp, { passive: true });
    el.addEventListener("pointerleave", onUp, { passive: true });

    return () => {
      clear();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onUp);
    };
  }, [options.disabled]);

  return ref;
}

// ─── useHaptics (lazy, optional) ──────────────────────────────────────────

/**
 * useHaptics — fire a haptic feedback pulse on supported Tauri mobile builds.
 *
 * On web/desktop this is a no-op. On Tauri mobile (iOS/Android) with the
 * `@tauri-apps/plugin-haptics` plugin installed in the Rust shell, it calls
 * the plugin's `impact` / `notification` command via invoke.
 *
 * The plugin is OPTIONAL — if not installed, the call silently no-ops. This
 * keeps the frontend forward-compatible: a future mobile build can add the
 * plugin without any frontend changes.
 */
export function useHaptics() {
  return React.useCallback(async (style: "light" | "medium" | "heavy" | "soft" | "rigid" = "light") => {
    if (typeof window === "undefined") return;
    const w = window as any;
    if (!w.__TAURI_INTERNALS__ && !w.__TAURI__) return;
    try {
      // @ts-expect-error — Tauri module only available in Tauri builds
      const m: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } = await import("@tauri-apps/api/core");
      // The haptics plugin exposes `impact` with a `style` arg.
      // Wrapped in try/catch because the plugin may not be installed.
      await m.invoke("plugin:haptics|impact", { style }).catch(() => {});
    } catch {
      /* no-op — haptics plugin not available */
    }
  }, []);
}

