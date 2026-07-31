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
  saveCloudSession,
  type CloudSession,
} from "@/lib/osler/cloud";
import { loadPdfFonts } from "@/lib/osler/pdf-fonts";

const SESSION_KEY = "osler-session";

interface SessionContextType {
  username: string | null;
  cloudSession: CloudSession | null;
  loading: boolean;
  login: (name: string, session?: CloudSession | null) => void;
  logout: () => void;
}

const OslerSessionContext = React.createContext<SessionContextType | null>(null);

export function OslerSessionProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsername] = React.useState<string | null>(null);
  const [cloudSession, setCloudSession] = React.useState<CloudSession | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const router = useRouter();

  // Load PDF fonts once
  React.useEffect(() => {
    loadPdfFonts();
  }, []);

  // Sync session state to server cookie
  const setCookieSession = React.useCallback((name: string | null, cSession: CloudSession | null) => {
    if (typeof window === "undefined") return;
    if (cSession) {
      saveCloudSession(cSession);
    } else if (name) {
      sessionStorage.setItem(SESSION_KEY, name);
      void fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: name }),
      }).catch(() => {});
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      clearCloudSession();
      void fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
    }
  }, []);

  // Restore session
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    void (async () => {
      try {
        // 1. Check cloud session
        if (await cloudEnabled()) {
          const cSession = readCloudSession();
          if (!cancelled && cSession) {
            setCloudSession(cSession);
            setUsername(cSession.user.displayName);
            setLoading(false);
            return;
          }
        }

        // 2. Check sessionStorage
        const stored = sessionStorage.getItem(SESSION_KEY);
        if (!cancelled && stored) {
          setUsername(stored);
          setLoading(false);
          return;
        }

        // 3. Check /api/auth/session endpoint (for cross-tab cookie restore)
        const res = await fetch("/api/auth/session", { cache: "no-store" }).catch(() => null);
        if (res?.ok) {
          const data = await res.json().catch(() => null);
          if (!cancelled && data?.session) {
            if ("user" in data.session) {
              setCloudSession(data.session as CloudSession);
              setUsername((data.session as CloudSession).user.displayName);
              sessionStorage.setItem("osler-cloud-session-v1", JSON.stringify(data.session));
            } else if ("username" in data.session) {
              setUsername(data.session.username);
              sessionStorage.setItem(SESSION_KEY, data.session.username);
            }
            setLoading(false);
            return;
          }
        }

        // 4. LocalStorage settings fallback
        const savedUsername = localStorage.getItem("osler-local-username");
        if (!cancelled && savedUsername) {
          setUsername(savedUsername);
          sessionStorage.setItem(SESSION_KEY, savedUsername);
          setCookieSession(savedUsername, null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setCookieSession]);

  // Handle Google Auth ticket flow
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
        setCookieSession(session.user.displayName, session);
        const url = new URL(window.location.href);
        url.searchParams.delete("cloudAuth");
        window.history.replaceState(null, "", `${url.pathname}${url.search}`);
      })
      .catch(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete("cloudAuth");
        url.searchParams.set("cloudAuthError", "google");
        window.history.replaceState(null, "", `${url.pathname}${url.search}`);
      });

    return () => {
      cancelled = true;
    };
  }, [setCookieSession]);

  // Start cloud sync when cloudSession is present
  React.useEffect(() => {
    if (!cloudSession) return;
    return startCloudSync(cloudSession);
  }, [cloudSession]);

  // Cloud session expiration listener
  React.useEffect(() => {
    const expire = () => {
      clearCloudSession();
      setCloudSession(null);
      setUsername(null);
      void fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
      router.push("/login");
    };
    window.addEventListener("osler-cloud-session-expired", expire);
    return () => window.removeEventListener("osler-cloud-session-expired", expire);
  }, [router]);

  const login = React.useCallback(
    (name: string, cSession?: CloudSession | null) => {
      setUsername(name);
      if (cSession) {
        setCloudSession(cSession);
        setCookieSession(name, cSession);
      } else {
        const currentCloudSession = readCloudSession();
        if (currentCloudSession) setCloudSession(currentCloudSession);
        setCookieSession(name, currentCloudSession);
      }
      localStorage.setItem("osler-local-username", name);
    },
    [setCookieSession]
  );

  const logout = React.useCallback(() => {
    const currentSession = cloudSession;
    setUsername(null);
    setCloudSession(null);
    setCookieSession(null, null);
    void logoutCloudAccount(currentSession);
    router.push("/login");
  }, [cloudSession, router, setCookieSession]);

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
