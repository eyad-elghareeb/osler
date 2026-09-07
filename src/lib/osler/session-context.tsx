"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CLOUD_SYNC_PREF_EVENT,
  cloudEnabled,
  clearCloudSession,
  consumeGoogleLogin,
  fetchRemoteDataSummary,
  getCloudSyncEnabled,
  mergeNow,
  notifySyncStatus,
  pullAllFromCloud,
  pullSettingsFromCloud,
  pushAllToCloud,
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
import { getConfig, isConfigCached } from "@/lib/osler/config";
import { hasConflict, storage, type DataSummary } from "@/lib/osler/storage";

interface SessionContextType {
  username: string | null;
  cloudSession: CloudSession | null;
  loading: boolean;
  login: (name: string, session?: CloudSession | null) => void;
  logout: () => void;
  /** Pending account-switch / guest-upgrade conflict. Null when no conflict
   *  was detected or the user already resolved one. The dialog listens for
   *  this and renders the three-way choice. */
  pendingConflict: PendingConflict | null;
  resolveConflict: (resolution: ConflictResolution) => Promise<void>;
  /** True until the conflict-detection pass for the current cloudSession has
   *  completed (either set a conflict OR cleared it as "no conflict"). The
   *  /login redirect waits on this so a guest-upgrade prompt doesn't get
   *  lost to navigation. */
  conflictCheckPending: boolean;
  /** True while a conflict resolution is in flight (push or pull). Stays
   *  true until the network call resolves, so the /login redirect doesn't
   *  fire mid-push and leave the device in a half-applied state. */
  conflictResolving: boolean;
}

/** Snapshot of the local vs remote data shapes at the moment the conflict
 *  was detected — the dialog uses this to render per-kind counts. */
export interface PendingConflict {
  cloudSession: CloudSession;
  local: DataSummary;
  remote: DataSummary;
}

/** What the user chose in the conflict prompt. */
export type ConflictResolution = "keep-local" | "keep-cloud" | "merge";

const LOCAL_ACCOUNT_KEY = "osler-last-cloud-user-id";

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
/**
 * Whether a stored cloud session may paint the first frame. The async
 * restore below is the authority on cloud availability; this only guards the
 * pre-paint fast path. Distrust solely when a cached config explicitly
 * disables cloud (plus no env URL) — cold boots with no cache yet trust the
 * stored session and let the restore correct any drift.
 */
function cloudPlausibleSync(): boolean {
  try {
    if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLOUD_API_URL) return true;
  } catch {
    // ignore — fall through to the config check
  }
  try {
    if (!isConfigCached()) return true;
    const cloud = getConfig().cloud as { enabled?: boolean; apiUrl?: string } | undefined;
    return !!(cloud?.enabled && cloud?.apiUrl);
  } catch {
    return true;
  }
}

export function OslerSessionProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsername] = React.useState<string | null>(null);
  const [cloudSession, setCloudSession] = React.useState<CloudSession | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const router = useRouter();

  /**
   * Pre-paint bootstrap from the persisted storage mirrors. First render
   * intentionally matches the prerender (signed out + loading) so hydration
   * never mismatches; this layout effect restores the stored session
   * synchronously before the browser paints, so a returning user sees the
   * app — not the boot splash — on the very first frame.
   *
   * Trust rules mirror the async restore below, just earlier:
   * `readCloudSession()` already rejects expired sessions, local guests need
   * no backend, and cloud sessions are gated on `cloudPlausibleSync()`. The
   * restore still runs afterwards (refresh-if-expiring, presence reporting)
   * and its identical values bail out of re-rendering.
   */
  React.useLayoutEffect(() => {
    let cloud: CloudSession | null = null;
    try {
      if (cloudPlausibleSync()) cloud = readCloudSession();
    } catch {
      cloud = null;
    }
    if (cloud) {
      setCloudSession(cloud);
      setUsername(cloud.user.displayName);
      setLoading(false);
      return;
    }
    let local: string | null = null;
    try {
      local = sessionStorage.getItem(LOCAL_SESSION_KEY) ?? localStorage.getItem(LOCAL_SESSION_KEY);
    } catch {
      local = null;
    }
    if (local) {
      setUsername(local);
      setLoading(false);
      void maybeReportGuestPresence(local);
      return;
    }
    // No usable session. An expired stored cloud session may still revive via
    // refresh — stay loading until the restore resolves, unless cloud is
    // explicitly off (then nothing can revive it).
    let mayRevive = false;
    try {
      mayRevive = cloudPlausibleSync() && readStoredCloudSession() !== null;
    } catch {
      mayRevive = false;
    }
    if (!mayRevive) setLoading(false);
  }, []);

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

  // Conflict detection: when a fresh cloud session is established on a device
  // that already has local data, fetch the cloud's per-kind counts + max
  // timestamps. If BOTH sides have non-trivial data, surface the prompt so
  // the user can choose keep-local / keep-cloud / merge instead of letting
  // monotonic merge silently corrupt one or the other.
  //
  // Skipped when the new cloud session belongs to the SAME user that was
  // signed in here previously (the device-local data legitimately belongs
  // to this account) — only "I signed out and signed into a different
  // account" or "I was a guest and now I'm a fresh account" trigger the
  // prompt.
  const [pendingConflict, setPendingConflict] = React.useState<PendingConflict | null>(null);
  const [conflictCheckPending, setConflictCheckPending] = React.useState(false);
  const [conflictResolving, setConflictResolving] = React.useState(false);
  React.useEffect(() => {
    if (!cloudSession?.token) {
      setPendingConflict(null);
      setConflictCheckPending(false);
      return;
    }
    let cancelled = false;
    const lastUserId = (() => {
      try { return localStorage.getItem(LOCAL_ACCOUNT_KEY); } catch { return null; }
    })();
    const currentUserId = cloudSession.user.id;
    if (lastUserId === currentUserId) {
      // Same user as last time on this device — local data is theirs; no prompt.
      setConflictCheckPending(false);
      return;
    }
    setConflictCheckPending(true);
    void (async () => {
      try {
        // Wait for IndexedDB hydration BEFORE reading the local summary —
        // a fresh page load races the summary read against the hydration
        // pass, and reading zeroed cache would silently skip the prompt
        // for a guest who upgrades within the first few ms of page load.
        await storage.ensureCacheHydrated();
        if (cancelled) return;
        const local = storage.getLocalDataSummary();
        const remote = await fetchRemoteDataSummary(cloudSession);
        if (cancelled) return;
        if (hasConflict(local, remote)) {
          setPendingConflict({ cloudSession, local, remote });
        } else {
          // No conflict: either side is empty. Remember this user as the last
          // one on this device so a subsequent sign-out + sign-in of the SAME
          // account doesn't re-trigger the check.
          try { localStorage.setItem(LOCAL_ACCOUNT_KEY, currentUserId); } catch {}
        }
      } finally {
        if (!cancelled) setConflictCheckPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cloudSession]);

  const resolveConflict = React.useCallback(
    async (resolution: ConflictResolution) => {
      const current = pendingConflict;
      if (!current) return;
      // Guard against double-clicks — the dialog disables its buttons while
      // busy, but a stale event (or a programmatic call) could still get here.
      if (conflictResolving) return;
      // Guard against a stale snapshot: if the live session has been
      // refreshed or expired since detection, the captured token in
      // `current.cloudSession` may no longer work. The dialog's error UI
      // surfaces this case so the user can retry.
      const live = readCloudSession();
      if (!live) {
        // Signed out while the prompt was up — nothing left to resolve.
        setPendingConflict(null);
        return;
      }
      if (live.token !== current.cloudSession.token) {
        // Live session has moved on (token rotated or re-authed) — re-fetch
        // the remote summary so the dialog re-renders against the current
        // state instead of trying to push/pull with a dead token.
        setPendingConflict(null);
        setConflictCheckPending(true);
        void (async () => {
          try {
            await storage.ensureCacheHydrated();
            const local = storage.getLocalDataSummary();
            const remote = await fetchRemoteDataSummary(live);
            if (hasConflict(local, remote)) {
              setPendingConflict({ cloudSession: live, local, remote });
            } else {
              try { localStorage.setItem(LOCAL_ACCOUNT_KEY, live.user.id); } catch {}
            }
          } catch {
            // Stale-session refetch failed (e.g. 401 after revocation) —
            // leave the conflict cleared; the sync status surfaces the
            // auth failure and the user can sign in again.
          } finally {
            setConflictCheckPending(false);
          }
        })();
        return;
      }
      setConflictResolving(true);
      try {
        if (resolution === "keep-local") {
          await pushAllToCloud(current.cloudSession);
          notifySyncStatus("syncing");
        } else if (resolution === "keep-cloud") {
          await pullAllFromCloud(current.cloudSession);
        } else {
          // "merge" — actually merge (do the pull + push that the normal
          // sync loop would do, but do it RIGHT NOW even if cloud sync is
          // opt-in and disabled on this device). Without this the button
          // was a no-op and the user assumed their cloud data would land
          // on this device, which it wouldn't until they manually enabled
          // sync in Settings.
          await mergeNow(current.cloudSession);
        }
        try {
          localStorage.setItem(LOCAL_ACCOUNT_KEY, current.cloudSession.user.id);
        } catch {}
        // Only NOW is it safe to clear the conflict — the network call has
        // either succeeded or thrown, and the dialog has surfaced the error.
        setPendingConflict(null);
      } catch (err) {
        // Re-surface the conflict so the user can retry — silent failure
        // here would leave the device in a half-applied state.
        setPendingConflict(current);
        throw err;
      } finally {
        setConflictResolving(false);
      }
    },
    [pendingConflict, conflictResolving]
  );

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
    setPendingConflict(null);
    setConflictResolving(false);
    persistLocalUsername(null);
    // NOTE: do NOT clear `osler-last-cloud-user-id` here. The marker is
    // intentionally preserved device-local state across logout (and the
    // danger-zone reset, which keeps it in LOCALSTORAGE_PRESERVE) so the
    // same user signing back into the same account on this device is
    // recognised (no conflict prompt). A different account gets a
    // different user.id and the check fires anyway.
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
        pendingConflict,
        resolveConflict,
        conflictCheckPending,
        conflictResolving,
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
