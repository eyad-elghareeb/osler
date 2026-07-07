"use client";

import * as React from "react";
import {
  loadBindings,
  defaultBindings,
  subscribeShortcuts,
  matchShortcut,
  clearShortcutSequence,
  type ShortcutMatchOptions,
} from "@/lib/osler/shortcuts";

export function useShortcutBindings(): Record<string, string> {
  const [bindings, setBindings] = React.useState<Record<string, string>>(() =>
    typeof window === "undefined" ? defaultBindings() : loadBindings(),
  );
  React.useEffect(() => {
    return subscribeShortcuts(setBindings);
  }, []);
  return bindings;
}

export interface ShortcutHandler {
  (actionId: string, e: KeyboardEvent): void;
}

export interface UseShortcutListenerOptions extends ShortcutMatchOptions {
  enabled?: boolean;
}

export function useShortcutListener(
  handler: ShortcutHandler,
  options: UseShortcutListenerOptions = {},
): void {
  const handlerRef = React.useRef(handler);
  React.useEffect(() => {
    handlerRef.current = handler;
  });

  const { enabled = true, ignoreInputs = true, allowRepeat = false } = options;

  React.useEffect(() => {
    if (!enabled) return;
    const bindings = loadBindings();
    let currentBindings = bindings;
    const unsub = subscribeShortcuts((b) => { currentBindings = b; });

    const onKeyDown = (e: KeyboardEvent) => {
      const actionId = matchShortcut(e, currentBindings, { ignoreInputs, allowRepeat });
      if (actionId) {
        const h = handlerRef.current;
        h(actionId, e);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unsub();
    };
  }, [enabled, ignoreInputs, allowRepeat]);
}

export function useShortcutSequenceReset(active: boolean): void {
  React.useEffect(() => {
    if (active) return;
    clearShortcutSequence();
  }, [active]);
}
