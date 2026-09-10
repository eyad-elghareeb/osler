"use client";

import * as React from "react";

// Lightweight global signal for "immersive mode": when an engine view is
// running an active session (a question, a studying flashcard, an OSCE
// scenario) it hides the global mobile tab bar so it never overlaps the
// full-screen experience. The hub/landing screens of those views stay normal.
let immersive = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setImmersiveMode(value: boolean) {
  if (immersive === value) return;
  immersive = value;
  emit();
}

export function useImmersiveMode(): boolean {
  // useSyncExternalStore (not useState + effect subscription): the studios
  // set the flag in their own mount effects, which run BEFORE the shell's
  // subscription effects on first mount (child-first effect order). A
  // useState-seeded hook missed that initial emit and stayed stuck showing
  // the bars whenever a session started already-active (deep link, restored
  // session) — the store re-reads the snapshot on subscribe, so the current
  // value is never missed.
  return React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => immersive,
    () => false,
  );
}
