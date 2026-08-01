"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useOslerSession } from "@/lib/osler/session-context";
import { cloudEnabled } from "@/lib/osler/cloud";

/**
 * Public paths that never require an Osler session.
 *
 * NOTE: This list must stay in sync with `isPublicPath` below. Anything not
 * listed here is treated as an app route and requires a valid session.
 *
 * In static-export mode there is no server-side middleware. Route gating is
 * enforced purely client-side by this component. The trade-off vs. the old
 * middleware is that a user can navigate directly to a protected URL and
 * briefly see the page render before the redirect fires — but the page's
 * data is gated by the Worker (no bearer token = no API access), so the
 * brief flash is just the chrome, not actual content.
 *
 * Mitigation: the AppShell and AdminShell render a loading spinner until
 * the session is restored, so the redirect usually fires before any real
 * UI is painted.
 */
const PUBLIC_PATH_PREFIXES = [
  "/_next/",
  "/osler-content/",
  "/assets/",
  "/admin/",
  "/serwist/",
] as const;

const PUBLIC_EXACT_PATHS = new Set([
  "/sw.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon.png",
  "/favicon.ico",
  "/robots.txt",
  "/site.webmanifest",
]);

function isPublicPath(pathname: string): boolean {
  // Strip trailing slash so "/login/" matches "/login".
  const p = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  if (PUBLIC_EXACT_PATHS.has(p)) return true;
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Validate that a `next` redirect target is a same-origin relative path.
 * Blocks open-redirect via `?next=https://evil.com` or `?next=//evil.com`.
 * Also rejects `next=/login` to prevent infinite redirect loops.
 */
function isSafeLocalPath(input: string | null | undefined): input is string {
  if (!input || typeof input !== "string") return false;
  if (input.length === 0 || input.length > 1024) return false;
  if (!input.startsWith("/")) return false;
  if (input.startsWith("//")) return false;
  if (input.startsWith("/\\")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) return false;
  if (input === "/login" || input.startsWith("/login?") || input.startsWith("/login/")) return false;
  return true;
}

function isLoginPath(input: string): boolean {
  if (input === "/login" || input === "/login/") return true;
  if (input.startsWith("/login?") || input.startsWith("/login/")) return true;
  return false;
}

/**
 * Wrap the app with this guard to enforce session-based route gating on the
 * client. Place it inside `<OslerSessionProvider>` and outside the AppShell.
 *
 * Behavior:
 *   - While `loading` is true, render `null` (the AppShell shows its own
 *     loading state once mounted).
 *   - On `/login`: if the user IS logged in, redirect to `next` (or `/`).
 *   - On protected routes: if the user is NOT logged in, redirect to
 *     `/login?next=<current-path>`.
 *   - On public routes (`/admin/*`, `/_next/*`, `/osler-content/*`, etc.):
 *     always pass through. Admin auth is enforced separately by the
 *     AdminShell via a bearer token + role check.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { username, loading } = useOslerSession();
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [isCloudEnabled, setIsCloudEnabled] = React.useState<boolean | null>(null);

  // Determine whether cloud is enabled (one-time).
  React.useEffect(() => {
    let cancelled = false;
    void cloudEnabled().then((enabled) => {
      if (!cancelled) setIsCloudEnabled(enabled);
    });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (loading || isCloudEnabled === null) return;
    if (isPublicPath(pathname)) return;

    const hasSession = !!username;

    // /login handling: redirect to `next` (or `/`) if already logged in.
    if (isLoginPath(pathname)) {
      if (hasSession) {
        const params = new URLSearchParams(window.location.search);
        const nextRaw = params.get("next") || "/";
        const safeNext = isSafeLocalPath(nextRaw) && !isLoginPath(nextRaw) ? nextRaw : "/";
        router.replace(safeNext);
      }
      return;
    }

    // Protected route — require a session.
    if (!hasSession) {
      const loginUrl = new URL("/login", window.location.origin);
      const search = window.location.search || "";
      if (pathname !== "/" || search !== "") {
        loginUrl.searchParams.set("next", `${pathname}${search}`);
      }
      router.replace(`${loginUrl.pathname}${loginUrl.search}`);
    }
  }, [loading, isCloudEnabled, username, pathname, router]);

  // Render nothing while loading — avoids a flash of protected content
  // before the redirect fires. The AppShell + page components also have
  // their own loading states, so this is a thin top-level guard.
  if (loading || isCloudEnabled === null) return null;
  return <>{children}</>;
}
