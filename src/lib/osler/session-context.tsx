"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CLOUD_SYNC_PREF_EVENT,
  cloudEnabled,
  clearCloudSession,
  consumeGoogleLogin,
  getCloudSyncEnabled,
  notifySyncStatus,
  pullSettingsFromCloud,
  readCloudSession,
  readStoredCloudSession,
  refreshCloudSession,
  SESSION_EXPIRED_FLAG,
  startCloudSync,
  logoutCloudAccount,
  subscribeSessionChanges,
  type CloudSession,
} from "@/lib/osler/cloud";
import { loadPdfFonts } from "@/lib/osler/pdf-fonts";
import { maybeReportGuestPresence } from "@/lib/osler/guest-presence";

interface SessionContextType {
  username: string | null;
  cloudSession: CloudSession | null;
  loading: boolean;
  login: (name: string, session?: CloudSession | null) => void;
  logout: () => void;
}

const OslerSessionContext = React.createContext<SessionContextType | null>(null);

const LOCAL_SESSION_KEY = "osler-local-session";

/**
 * OslerSessionProvider — pure client-side session state.
 *
 * ARCHITECTURE (static-export mode):
 *   - No httpOnly cookie. No server-side middleware. No /api/auth/session
 *     route. The static export has no server runtime at all.
 *   - CloudSession (bearer token + user) is stored in `sessionStorage`
 *     (per-tab fast path) AND mirrored to `localStorage` so the account
 *     survives new tabs and browser restarts.
 *   - Cross-tab logout is broadcast via BroadcastChannel (see cloud.ts).
 *   - Route gating is enforced client-side by `RouteGuard` which redirects
 *     unauthenticated users to /login.
 *
 * Restore flow on mount:
 *   1. If cloud is enabled and there's a valid CloudSession, restore it
 *      (sessionStorage first, then the localStorage mirror). Cloud sync
 *      itself is opt-in — it only starts if the user enabled it (see the
 *      sync effect below).
 *   2. If the persisted session is expired, rotate it via /v1/auth/refresh.
 *      Only a truly dead session falls through to the login screen.
 *   3. Otherwise check for a local-mode guest session (sessionStorage, then
 *      localStorage mirror).
 *   4. Nothing usable → RouteGuard redirects to /login. There is deliberately
 *      NO "logged in by name only" half-state: a user is either fully
 *      authenticated (cloud or local) or on the login screen.
 */
export function OslerSessionProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsername] = React.useState<string | null>(null);
  const [cloudSession, setCloudSession] = React.useState<CloudSession | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const router = useRouter();

  // Load PDF fonts once on the client (cheap; cached).
  React.useEffect(() => {
    loadPdfFonts();
  }, []);

  /**
   * Persist a local-mode username to sessionStorage (per-tab) + localStorage
   * (cross-tab mirror). Cloud sessions are handled by `saveCloudSession()` in
   * cloud.ts and are NOT re-persisted here.
   */
  const persistLocalUsername = React.useCallback((name: string | null) => {
    if (typeof window === "undefined") return;
    try {
      if (name) {
        sessionStorage.setItem(LOCAL_SESSION_KEY, name);
        localStorage.setItem(LOCAL_SESSION_KEY, name);
      } else {
        sessionStorage.removeItem(LOCAL_SESSION_KEY);
        localStorage.removeItem(LOCAL_SESSION_KEY);
      }
    } catch {
      // ignore storage failures (private mode)
    }
  }, []);

  // Restore session on mount.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    void (async () => {
      let refreshFailed = false;
      try {
        const isCloud = await cloudEnabled();

        // 1. Valid cloud session — sessionStorage fast path, then the
        //    localStorage mirror (so a new tab / browser restart keeps the
        //    account signed in instead of silently degrading to local mode).
        if (isCloud) {
          const cSession = readCloudSession();
          if (!cancelled && cSession) {
            // Trust the stored session for initial render. If it turns out
            // stale/revoked, the cloud sync loop detects the 401 and fires
            // `osler-cloud-session-expired`, which logs the user out.
            setCloudSession(cSession);
            setUsername(cSession.user.displayName);
            setLoading(false);
            return;
          }

          // 2. Expired/expiring persisted session — try the sliding refresh
          //    before giving up. A genuinely revoked token (password change,
          //    sign-out on another device) falls through to /login — we never
          //    show a "logged in" shell without a usable token.
          const stored = readStoredCloudSession();
          if (!cancelled && stored) {
            const refreshed = await refreshCloudSession(stored);
            if (!cancelled && refreshed) {
              setCloudSession(refreshed);
              setUsername(refreshed.user.displayName);
              setLoading(false);
              return;
            }
            refreshFailed = true;
          }
        }

        // 3. Local guest session (no cloud, or no valid cloud session on this
        //    device). sessionStorage fast path, then the localStorage mirror.
        const storedLocal = sessionStorage.getItem(LOCAL_SESSION_KEY) ?? localStorage.getItem(LOCAL_SESSION_KEY);
        if (!cancelled && storedLocal) {
          setUsername(storedLocal);
          setLoading(false);
          // Count the guest by name for admin statistics (throttled,
          // best-effort — never blocks the restore).
          void maybeReportGuestPresence(storedLocal);
          return;
        }

        // 4. No session at all — leave username null. RouteGuard will
        //    redirect to /login on protected routes. If a stored cloud
        //    session was present but couldn't be refreshed, flag it so the
        //    login screen can explain why (instead of a confusing drop to
        //    local mode).
        if (refreshFailed) {
          try {
            sessionStorage.setItem(SESSION_EXPIRED_FLAG, "1");
          } catch {
            // ignore
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Handle Google Auth ticket flow (#cloudAuth=<ticket> — fragment, not query,
  // so the ticket never reaches server logs or the Referer header).
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    const match = hash.match(/^#cloudAuth=([^&]+)/);
    if (!match) return;
    const ticket = decodeURIComponent(match[1]);

    let cancelled = false;
    void consumeGoogleLogin(ticket)
      .then((session) => {
        if (cancelled) return;
        setCloudSession(session);
        setUsername(session.user.displayName);
        // Clean up the URL.
        history.replaceState(null, "", window.location.pathname + window.location.search);
      })
      .catch(() => {
        if (cancelled) return;
        const url = new URL(window.location.href);
        url.searchParams.set("cloudAuthError", "google");
        history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Cloud sync is opt-in per device: the loop only runs while the user
  // enabled it (Settings → Sync). A signed-in user who never opts in makes
  // zero sync requests, so the free-tier DB/bandwidth is spent only on the
  // devices that actually use cross-device sync.
  const [syncPref, setSyncPref] = React.useState<{ loaded: boolean; enabled: boolean }>({ loaded: false, enabled: false });
  React.useEffect(() => {
    let cancelled = false;
    void getCloudSyncEnabled().then((enabled) => {
      if (!cancelled) setSyncPref({ loaded: true, enabled });
    });
    const onPref = (e: Event) => setSyncPref({ loaded: true, enabled: (e as CustomEvent).detail?.enabled === true });
    window.addEventListener(CLOUD_SYNC_PREF_EVENT, onPref);
    return () => {
      cancelled = true;
      window.removeEventListener(CLOUD_SYNC_PREF_EVENT, onPref);
    };
  }, []);

  // Pull account-level settings on every authenticated session (restore or
  // fresh login) so a device that enabled sync elsewhere picks up
  // `cloud-sync-enabled=true` without manual toggle. This runs even when
  // the local sync pref is still `false` — the merge dispatches
  // `osler-cloud-sync-pref` which flips `syncPref` and starts the loop.
  React.useEffect(() => {
    if (!cloudSession?.token) return;
    void pullSettingsFromCloud(cloudSession);
  }, [cloudSession]);

  // Start cloud sync only when we have a real CloudSession with a token AND
  // the user opted in. When a session exists but sync is off, surface an
  // explicit "off" status so the shell's sync dot never claims a phantom
  // "synced" state.
  React.useEffect(() => {
    if (!cloudSession?.token || !syncPref.loaded) return;
    if (!syncPref.enabled) {
      notifySyncStatus("off");
      return;
    }
    return startCloudSync(cloudSession);
  }, [cloudSession, syncPref]);

  // Cloud session expiration listener (fired by sync on 401).
  React.useEffect(() => {
    const expire = () => {
      try {
        sessionStorage.setItem(SESSION_EXPIRED_FLAG, "1");
      } catch {
        // ignore
      }
      setCloudSession(null);
      setUsername(null);
      persistLocalUsername(null);
      router.push("/login");
    };
    window.addEventListener("osler-cloud-session-expired", expire);
    return () => window.removeEventListener("osler-cloud-session-expired", expire);
  }, [router, persistLocalUsername]);

  // Token-rotation listener (fired by `refreshCloudSession`). Keeps the
  // context's session in sync with the rotated credential so the app keeps
  // using the fresh token everywhere (profile, settings, analytics).
  React.useEffect(() => {
    const onRefreshed = (e: Event) => {
      const session = (e as CustomEvent).detail?.session as CloudSession | undefined;
      if (session?.token) {
        setCloudSession(session);
        setUsername(session.user.displayName);
      }
    };
    window.addEventListener("osler-cloud-session-refreshed", onRefreshed);
    return () => window.removeEventListener("osler-cloud-session-refreshed", onRefreshed);
  }, []);

  // Cross-tab session change listener (BroadcastChannel).
  // When another tab logs out, it clears the shared localStorage session AND
  // broadcasts `logout`. This tab keeps its per-tab sessionStorage entry so a
  // logout on another tab doesn't kick this tab out mid-session — the next
  // sync 401 (revoked server-side) handles this tab's logout.
  React.useEffect(() => {
    const unsub = subscribeSessionChanges((kind, name) => {
      if (kind === "logout") {
        setCloudSession(null);
        setUsername(null);
      } else if (kind === "login" && name) {
        // Another tab logged in — the full session was written to the shared
        // localStorage mirror, so this tab's UI can safely surface the name
        // (the next readCloudSession / refresh picks up the real token).
        if (!username) setUsername(name);
      }
    });
    return unsub;
  }, [username]);

  /**
   * Login — pure client-side. No cookie roundtrip, no server dependency.
   *
   * For cloud sessions: `saveCloudSession()` was already called by
   * `loginCloudAccount` / `registerCloudAccount` / `consumeGoogleLogin`
   * BEFORE `login()` is invoked. We just update React state.
   *
   * For local-mode: persist the username to sessionStorage + localStorage.
   */
  const login = React.useCallback(
    (name: string, cSession?: CloudSession | null) => {
      const sessionToUse = cSession ?? readCloudSession();
      if (sessionToUse) {
        setCloudSession(sessionToUse);
        setUsername(sessionToUse.user.displayName);
      } else {
        persistLocalUsername(name);
        setUsername(name);
        // Fresh guest login — report the display name for admin statistics.
        void maybeReportGuestPresence(name);
      }
    },
    [persistLocalUsername]
  );

  const logout = React.useCallback(() => {
    const currentSession = cloudSession;
    setUsername(null);
    setCloudSession(null);
    persistLocalUsername(null);
    void logoutCloudAccount(currentSession);
    router.push("/login");
  }, [cloudSession, router, persistLocalUsername]);

  return (
    <OslerSessionContext.Provider
      value={{
        username,
        cloudSession,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </OslerSessionContext.Provider>
  );
}

export function useOslerSession(): SessionContextType {
  const context = React.useContext(OslerSessionContext);
  if (!context) {
    throw new Error("useOslerSession must be used within an OslerSessionProvider");
  }
  return context;
}
