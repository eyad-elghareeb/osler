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
  const [state, setState] = React.useState(immersive);
  React.useEffect(() => {
    const l = () => setState(immersive);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return state;
}
