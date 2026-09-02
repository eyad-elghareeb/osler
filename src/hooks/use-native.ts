"use client";

/**
 * React hooks wrapping the framework-agnostic native-feature libs.
 *
 * Keep all React-specific glue here so the underlying lib files stay
 * import-safe from non-component modules.
 */

import * as React from "react";
import {
  readNetworkInfo,
  subscribeNetworkInfo,
  type NetworkInfo,
  checkBiometricAvailability,
  type BiometricAvailability,
  queryMediaPermission,
  requestMediaPermission,
  type MediaPermissionKind,
  type MediaPermissionState,
} from "@/lib/osler/native";

/* ── Network Information ──────────────────────────────────────────── */

export function useNetworkInfo(): NetworkInfo {
  const [info, setInfo] = React.useState<NetworkInfo>(() => readNetworkInfo());
  React.useEffect(() => {
    setInfo(readNetworkInfo());
    const unsub = subscribeNetworkInfo(() => setInfo(readNetworkInfo()));
    return unsub;
  }, []);
  return info;
}

/* ── Biometric availability (async) ──────────────────────────────── */

export function useBiometricAvailability(): {
  availability: BiometricAvailability | null;
  refresh: () => void;
} {
  const [availability, setAvailability] = React.useState<BiometricAvailability | null>(null);
  const refresh = React.useCallback(() => {
    let cancelled = false;
    checkBiometricAvailability().then((a) => {
      if (!cancelled) setAvailability(a);
    });
    return () => { cancelled = true; };
  }, []);
  React.useEffect(() => {
    const cancel = refresh();
    return cancel;
  }, [refresh]);
  return { availability, refresh };
}

/* ── Media permissions (microphone / camera) ─────────────────────── */

export function useMediaPermissions(kinds: MediaPermissionKind[]): {
  states: Record<MediaPermissionKind, MediaPermissionState | null>;
  request: (kind: MediaPermissionKind) => Promise<MediaPermissionState>;
} {
  const key = kinds.join(",");
  const [states, setStates] = React.useState<Record<MediaPermissionKind, MediaPermissionState | null>>(
    () => Object.fromEntries(kinds.map((k) => [k, null])) as Record<MediaPermissionKind, MediaPermissionState | null>,
  );
  const refresh = React.useCallback(() => {
    let cancelled = false;
    key.split(",").forEach((kind) => {
      queryMediaPermission(kind as MediaPermissionKind).then((state) => {
        if (!cancelled) setStates((prev) => ({ ...prev, [kind]: state }));
      });
    });
    return () => { cancelled = true; };
  }, [key]);
  React.useEffect(() => {
    const cancel = refresh();
    return cancel;
  }, [refresh]);
  const request = React.useCallback(async (kind: MediaPermissionKind) => {
    const state = await requestMediaPermission(kind);
    setStates((prev) => ({ ...prev, [kind]: state }));
    return state;
  }, []);
  return { states, request };
}

/* ── Document visibility (used by wake-lock + viewport helpers) ──── */

export function useDocumentVisibility(): "visible" | "hidden" {
  const [state, setState] = React.useState<"visible" | "hidden">(
    typeof document !== "undefined" ? (document.visibilityState as "visible" | "hidden") : "visible"
  );
  React.useEffect(() => {
    const handler = () => setState(document.visibilityState as "visible" | "hidden");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);
  return state;
}
