"use client";

/**
 * AnimationsProvider — wraps the app in framer-motion's MotionConfig so the
 * user's "Enable UI animations" toggle (Settings → Native Features) takes
 * effect across every motion component instantly.
 *
 * Also mirrors the flag onto `<html data-animations="off">` so CSS-only
 * transitions can be disabled in parallel (see globals.css).
 *
 * Honors the OS `prefers-reduced-motion` setting automatically — when the
 * user has reduced motion enabled at the OS level, framer-motion's
 * `reducedMotion="user"` (the default) already makes animations instant.
 */

import * as React from "react";
import { MotionConfig } from "framer-motion";
import {
  useAnimationsEnabled,
  applyAnimationsFlag,
  isAnimationsEnabled,
  MOTION_TRANSITION,
} from "@/lib/osler/motion";

export function AnimationsProvider({ children }: { children: React.ReactNode }) {
  const enabled = useAnimationsEnabled();

  // Apply the html data attribute on mount + whenever the flag changes.
  React.useEffect(() => {
    applyAnimationsFlag(enabled);
  }, [enabled]);

  // Set the initial attribute before first paint to avoid a flash of
  // animated content when the user has previously disabled animations.
  React.useEffect(() => {
    applyAnimationsFlag(isAnimationsEnabled());
  }, []);

  return (
    <MotionConfig reducedMotion={enabled ? "user" : "always"} transition={MOTION_TRANSITION.normal}>
      {children}
    </MotionConfig>
  );
}
