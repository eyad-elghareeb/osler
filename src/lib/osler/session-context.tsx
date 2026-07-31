"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  cloudEnabled,
  clearCloudSession,
  consumeGoogleLogin,
  readCloudSession,
  startCloudSync,
  logoutCloudAccount,
  type CloudSession,
} from "@/lib/osler/cloud";
import { loadPdfFonts } from "@/lib/osler/pdf-fonts";

/**
 * Redacted view of the session returned by GET /api/auth/session.
 * NOTE: the bearer `token` is intentionally NOT included — the client can
 * only get the token from sessionStorage (where `saveCloudSession` put it
 * on login). When the cookie says "cloud" but sessionStorage has no token
 * (new tab), the user must re-authenticate.
 */
type CookieSessionView =
  | { kind: "cloud"; user: CloudSession["user"]; expiresAt: number }
  | { kind: "local"; username: string; expiresAt: number }
  | null;

interface SessionContextType {
  username: string | null;
  cloudSession: CloudSession | null;
  loading: boolean;
  login: (name: string, session?: CloudSession | null) => void;
  logout: () => void;
}

const OslerSessionContext = React.createContext<SessionContextType | null>(null);

const LOCAL_SESSION_KEY = "osler-session";
const LOCAL_USERNAME_KEY = "osler-local-username";

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
   * POST a cloud session to /api/auth/session and return true on success.
   * On failure, clears the sessionStorage entry so the next restore doesn't
   * pick up a stale session. Extracted as a helper so `persistSession` can
   * call it from multiple branches without duplicating the fetch logic.
   */
  const postCloudSession = React.useCallback((cSession: CloudSession): Promise<boolean> => {
    return fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: cSession }),
    })
      .then((res) => {
        if (!res.ok) {
          sessionStorage.removeItem("osler-cloud-session-v1");
          return false;
        }
        return true;
      })
      .catch(() => false);
  }, []);

  /**
   * Persist the session to sessionStorage + the httpOnly cookie.
   * Returns a promise that resolves to `true` if the cookie POST succeeded
   * (HTTP 2xx), or `false` if it failed (network error, 401, 403, etc.).
   *
   * Callers MUST check the return value before updating UI state — if the
   * cookie POST fails, the middleware will not see the session and will
   * bounce the user back to /login. Setting `username` state in that case
   * causes a redirect loop.
   *
   * Cloud sessions: `saveCloudSession()` (in cloud.ts) is called by
   * `loginCloudAccount` / `registerCloudAccount` / `consumeGoogleLogin`
   * BEFORE `login()` is called. It stores the session to sessionStorage and
   * fires its own POST to /api/auth/session. To avoid a double-POST (which
   * doubles the Worker verification load and can hit rate limits), we
   * detect whether the session is already in sessionStorage. If so, we
   * skip the POST and just verify the cookie is set via GET. If the GET
   * shows no cookie (POST failed or is still in-flight), we re-POST as a
   * fallback. If the session is NOT in sessionStorage (e.g. the restore
   * effect is refreshing an existing session), we POST as usual.
   *
   * - Local session: store username in sessionStorage; POST { username } to
   *   /api/auth/session (only succeeds when cloud is disabled).
   * - Null/null: clear everything (logout). Always resolves true — clearing
   *   the cookie is best-effort and a failure doesn't block logout.
   */
  const persistSession = React.useCallback(
    (name: string | null, cSession: CloudSession | null): Promise<boolean> => {
      if (typeof window === "undefined") return Promise.resolve(false);
      if (cSession) {
        // Check if `saveCloudSession` already stored this session.
        const existingRaw = sessionStorage.getItem("osler-cloud-session-v1");
        const alreadyStored =
          existingRaw !== null &&
          (() => {
            try {
              const existing = JSON.parse(existingRaw);
              return existing?.token === cSession.token;
            } catch {
              return false;
            }
          })();

        if (alreadyStored) {
          // `saveCloudSession` already fired the POST. We can't await it here
          // (we don't have a handle to its promise), so we do a lightweight
          // check: GET /api/auth/session to see if the cookie landed. If it
          // didn't (POST failed or is still in-flight), re-POST as a fallback.
          return fetch("/api/auth/session", { cache: "no-store" })
            .then((res) => (res.ok ? res.json() : null))
            .then((data: { session: CookieSessionView } | null) => {
              if (
                data?.session &&
                data.session.kind === "cloud" &&
                data.session.user.id === cSession.user.id
              ) {
                return true; // Cookie is set — no re-POST needed.
              }
              // Cookie not set yet — POST as a fallback.
              return postCloudSession(cSession);
            })
            .catch(() => postCloudSession(cSession));
        }

        // Not already in sessionStorage — store + POST.
        sessionStorage.setItem("osler-cloud-session-v1", JSON.stringify(cSession));
        return postCloudSession(cSession);
      }
      if (name) {
        return fetch("/api/auth/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: name }),
        })
          .then((res) => {
            if (!res.ok) return false;
            // Only persist to sessionStorage/localStorage if the cookie POST
            // succeeded — otherwise we'd have a stale local session that
            // makes the user appear logged in without a valid cookie.
            sessionStorage.setItem(LOCAL_SESSION_KEY, name);
            // localStorage is only a username HINT for the login form — it
            // does NOT auto-login. We store it here so the login screen can
            // pre-fill the username field, but the restore effect never
            // auto-creates a session from it.
            localStorage.setItem(LOCAL_USERNAME_KEY, name);
            return true;
          })
          .catch(() => false);
      }
      // Logout: clear ALL storage so the session can't be re-created.
      // `clearCloudSession()` fires its own DELETE; we don't duplicate it.
      sessionStorage.removeItem(LOCAL_SESSION_KEY);
      sessionStorage.removeItem("osler-cloud-session-v1");
      localStorage.removeItem(LOCAL_USERNAME_KEY);
      clearCloudSession();
      return fetch("/api/auth/session", { method: "DELETE" })
        .then(() => true)
        .catch(() => true); // logout succeeds even if the DELETE fails
    },
    [postCloudSession]
  );

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
            // Refresh the cookie in case it expired. Only set state if the
            // cookie POST succeeds — if the Worker rejected the token, we
            // must NOT show the user as logged in.
            const ok = await persistSession(cSession.user.displayName, cSession);
            if (cancelled) return;
            if (ok) {
              setCloudSession(cSession);
              setUsername(cSession.user.displayName);
              setLoading(false);
            } else {
              // Token rejected — clear the stale session and fall through
              // to the unauthenticated state.
              setCloudSession(null);
              setUsername(null);
              setLoading(false);
            }
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

        // 3. Cookie-based restore via GET /api/auth/session (cross-tab).
        //    Returns a REDACTED view — no bearer token. For cloud sessions
        //    this means we know the user is logged in but can't call Worker
        //    APIs from this tab until they re-authenticate. We surface the
        //    username so the UI can render; the cloud sync starts only when
        //    a real CloudSession (with token) is established.
        const res = await fetch("/api/auth/session", { cache: "no-store" }).catch(() => null);
        if (res?.ok) {
          const data = (await res.json().catch(() => null)) as { session: CookieSessionView };
          if (!cancelled && data?.session) {
            const view = data.session;
            if (view.kind === "cloud") {
              // We have a cloud cookie but no token in this tab. Show the
              // user as logged in (so middleware doesn't bounce them) but
              // do NOT start cloud sync — there's no token to use.
              setUsername(view.user.displayName);
              setLoading(false);
              return;
            }
            if (view.kind === "local") {
              setUsername(view.username);
              sessionStorage.setItem(LOCAL_SESSION_KEY, view.username);
              setLoading(false);
              return;
            }
          }
        }

        // NOTE: We deliberately do NOT auto-login from localStorage. The
        // localStorage value is only a username hint for the login form
        // (LoginScreen reads it to pre-fill the input). Auto-creating a
        // session from localStorage would defeat cookie expiry — the
        // cookie could expire and the user would silently get a new one.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [persistSession]);

  // Handle Google Auth ticket flow (?cloudAuth=<ticket>).
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const ticket = new URLSearchParams(window.location.search).get("cloudAuth");
    if (!ticket) return;

    let cancelled = false;
    void consumeGoogleLogin(ticket)
      .then((session) => {
        if (cancelled) return;
        // Await the cookie POST before updating state so the redirect
        // effect doesn't fire before the middleware can see the cookie.
        persistSession(session.user.displayName, session).then((ok) => {
          if (cancelled) return;
          if (ok) {
            setCloudSession(session);
            setUsername(session.user.displayName);
          }
          // Whether or not the cookie POST succeeded, clean up the URL.
          // If it failed, the user stays on /login with an error.
          const url = new URL(window.location.href);
          url.searchParams.delete("cloudAuth");
          if (!ok) url.searchParams.set("cloudAuthError", "google");
          router.replace(`${url.pathname}${url.search}`);
        });
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
  }, [persistSession, router]);

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
      // `persistSession(null, null)` clears sessionStorage, localStorage,
      // and fires the cookie DELETE. We don't call `clearCloudSession()`
      // separately because that would fire a duplicate DELETE.
      void persistSession(null, null);
      router.push("/login");
    };
    window.addEventListener("osler-cloud-session-expired", expire);
    return () => window.removeEventListener("osler-cloud-session-expired", expire);
  }, [router, persistSession]);

  /**
   * Login: persist the session (await the cookie POST) THEN update state.
   * The redirect effect in login/page.tsx watches `username` — by deferring
   * the state update until after the POST resolves, we guarantee the
   * middleware sees the cookie before the redirect fires. This eliminates
   * the login→redirect race.
   *
   * If the cookie POST fails (network error, 401, 403), `username` is NOT
   * set — the user stays on the login page. This prevents a redirect loop
   * where the middleware bounces the user back to /login.
   *
   * UX limitation: because `login` returns void (not a promise), the caller
   * can't tell when it fails. The LoginScreen's cloud-login paths handle
   * Worker-side errors via try/catch (they call `loginCloudAccount` etc.
   * directly). The only paths that call `login(name)` without a session are
   * local-mode "Guest" / biometric — and those only succeed if the Pages
   * backend is up (no Worker dependency). If the Pages backend is down, the
   * user sees nothing happen (no error). This is a known trade-off; fixing
   * it requires changing `login`'s signature to return a promise, which
   * would ripple through every caller.
   */
  const login = React.useCallback(
    (name: string, cSession?: CloudSession | null) => {
      const sessionToUse = cSession ?? readCloudSession();
      // Persist first (sets the cookie), then update state (triggers redirect).
      // `persistSession` also writes the localStorage username hint on
      // local-mode success, so we don't duplicate it here.
      void persistSession(name, sessionToUse).then((ok) => {
        if (!ok) return; // Cookie POST failed — don't set state, don't navigate.
        setUsername(name);
        if (sessionToUse) setCloudSession(sessionToUse);
      });
    },
    [persistSession]
  );

  const logout = React.useCallback(() => {
    const currentSession = cloudSession;
    setUsername(null);
    setCloudSession(null);
    // For cloud sessions, `logoutCloudAccount` calls the Worker's /v1/auth/logout
    // (to revoke the server-side session) and then `clearCloudSession()` which
    // fires the cookie DELETE. For local sessions, `persistSession(null, null)`
    // clears storage + fires the DELETE. We call both — the duplicate DELETE
    // is harmless (idempotent), and this covers both code paths.
    void persistSession(null, null);
    void logoutCloudAccount(currentSession);
    router.push("/login");
  }, [cloudSession, router, persistSession]);

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
