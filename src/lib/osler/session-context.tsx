"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  cloudEnabled,
  clearCloudSession,
  consumeGoogleLogin,
  readCloudSession,
  readLocalUsernameHint,
  startCloudSync,
  logoutCloudAccount,
  subscribeSessionChanges,
  type CloudSession,
} from "@/lib/osler/cloud";
import { loadPdfFonts } from "@/lib/osler/pdf-fonts";

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
 *   - CloudSession (bearer token + user) lives in `sessionStorage` (per-tab).
 *   - A redacted username hint lives in `localStorage` (cross-tab, no token)
 *     so the login form can pre-fill on the next visit.
 *   - Route gating is enforced client-side by `RouteGuard` which redirects
 *     unauthenticated users to /login.
 *   - Cross-tab logout is broadcast via BroadcastChannel (see cloud.ts).
 *
 * Restore flow on mount:
 *   1. If cloud is enabled AND there's a valid CloudSession in sessionStorage,
 *      restore it and start sync. The bearer token is per-tab.
 *   2. Otherwise check sessionStorage for a local username (local-mode guest).
 *   3. Otherwise check localStorage for a cross-tab username hint — show the
 *      user as logged-in by name only, but the cloud sync won't start until
 *      they re-authenticate on this tab. This matches the old cookie-based
 *      restore UX without requiring a server.
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
   * (cross-tab hint for the login form pre-fill). Cloud sessions are handled
   * by `saveCloudSession()` in cloud.ts and are NOT re-persisted here.
   */
  const persistLocalUsername = React.useCallback((name: string | null) => {
    if (typeof window === "undefined") return;
    if (name) {
      sessionStorage.setItem(LOCAL_SESSION_KEY, name);
      try {
        localStorage.setItem("osler-local-username", name);
      } catch {
        // ignore
      }
    } else {
      sessionStorage.removeItem(LOCAL_SESSION_KEY);
      try {
        localStorage.removeItem("osler-local-username");
      } catch {
        // ignore
      }
    }
  }, []);

  // Restore session on mount.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    void (async () => {
      try {
        const isCloud = await cloudEnabled();

        // 1. Cloud session in sessionStorage (fast, per-tab) — has the token.
        if (isCloud) {
          const cSession = readCloudSession();
          if (!cancelled && cSession) {
            // Trust the sessionStorage entry for initial render. If it's
            // stale, the cloud sync loop detects the 401 and fires
            // `osler-cloud-session-expired`, which logs the user out.
            setCloudSession(cSession);
            setUsername(cSession.user.displayName);
            setLoading(false);
            return;
          }
        }

        // 2. Local username in sessionStorage (fast, per-tab).
        const storedLocal = sessionStorage.getItem(LOCAL_SESSION_KEY);
        if (!cancelled && storedLocal) {
          setUsername(storedLocal);
          setLoading(false);
          return;
        }

        // 3. localStorage username hint (cross-tab). We show the user as
        //    "logged in by name" so the UI doesn't bounce them to /login
        //    on every cold load. The bearer token isn't available in this
        //    tab — they'll need to re-authenticate to actually use cloud
        //    features. RouteGuard treats this as authenticated for display.
        if (isCloud) {
          const hint = readLocalUsernameHint();
          if (!cancelled && hint) {
            setUsername(hint);
            setLoading(false);
            return;
          }
        }

        // 4. No session at all — leave username null. RouteGuard will
        //    redirect to /login on protected routes.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Handle Google Auth ticket flow (?cloudAuth=<ticket>).
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const ticket = new URLSearchParams(window.location.search).get("cloudAuth");
    if (!ticket) return;

    let cancelled = false;
    void consumeGoogleLogin(ticket)
      .then((session) => {
        if (cancelled) return;
        setCloudSession(session);
        setUsername(session.user.displayName);
        // Clean up the URL.
        const url = new URL(window.location.href);
        url.searchParams.delete("cloudAuth");
        router.replace(`${url.pathname}${url.search}`);
      })
      .catch(() => {
        if (cancelled) return;
        const url = new URL(window.location.href);
        url.searchParams.delete("cloudAuth");
        url.searchParams.set("cloudAuthError", "google");
        router.replace(`${url.pathname}${url.search}`);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  // Start cloud sync only when we have a real CloudSession with a token.
  React.useEffect(() => {
    if (!cloudSession?.token) return;
    return startCloudSync(cloudSession);
  }, [cloudSession]);

  // Cloud session expiration listener (fired by sync on 401).
  React.useEffect(() => {
    const expire = () => {
      setCloudSession(null);
      setUsername(null);
      persistLocalUsername(null);
      router.push("/login");
    };
    window.addEventListener("osler-cloud-session-expired", expire);
    return () => window.removeEventListener("osler-cloud-session-expired", expire);
  }, [router, persistLocalUsername]);

  // Cross-tab session change listener (BroadcastChannel).
  // When another tab logs out, this tab also clears its UI state. The
  // sessionStorage entry is per-tab so it survives — but the username
  // hint in localStorage is cleared, which is what we observe here.
  React.useEffect(() => {
    const unsub = subscribeSessionChanges((kind, name) => {
      if (kind === "logout") {
        setCloudSession(null);
        setUsername(null);
        // The sessionStorage entry (with token) for THIS tab is preserved —
        // a logout on another tab shouldn't kick this tab out mid-session.
        // The next sync 401 will handle this tab's logout.
      } else if (kind === "login" && name) {
        // Another tab logged in. We don't have the bearer token here, so
        // we just surface the username hint for display. The user can
        // refresh this tab to pick up the real session.
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
