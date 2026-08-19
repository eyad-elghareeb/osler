"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { Activity, Loader2 } from "lucide-react";
import { useOslerSession } from "@/lib/osler/session-context";
import { cloudEnabled } from "@/lib/osler/cloud";
import { useI18n } from "@/components/osler/i18n-provider";

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
 */
const PUBLIC_PATH_PREFIXES = [
  "/_next/",
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
 * Branded first-paint screen shown while the session is being restored.
 *
 * The static export has no server runtime, so the boot HTML can't know
 * whether a visitor is signed in. Rendering this splash (never app content)
 * until the session resolves means a guest goes splash → login and a
 * signed-in user goes splash → app — never content → login.
 */
function BootScreen() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-label={t("common.loading")}
      className="min-h-dvh w-full flex flex-col items-center justify-center gap-4 bg-background px-6"
    >
      <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground shadow-e2 relative overflow-hidden">
        {/* Subtle inner highlight — reads as a polished glass tile */}
        <span
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{
            background:
              "linear-gradient(160deg, color-mix(in oklch, var(--primary-foreground) 25%, transparent), transparent 55%)",
          }}
        />
        <Activity className="size-8 relative" />
      </div>
      <div className="text-center">
        <div className="text-base font-semibold">{t("app.name")}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{t("app.tagline")}</div>
      </div>
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * Wrap the app with this guard to enforce session-based route gating on the
 * client. Place it inside `<OslerSessionProvider>` and outside the AppShell.
 *
 * Behavior:
 *   - Public paths (`/admin/*`, `/_next/*`, …) always pass through — admin
 *     auth is enforced separately by the AdminShell.
 *   - While the session is restoring, render the branded `BootScreen` — never
 *     app content, so the static export can't flash protected UI to a guest.
 *   - On `/login`: if the user IS logged in, redirect to `next` (or `/`),
 *     keeping the boot screen up while the redirect happens. Otherwise render
 *     the login page.
 *   - On protected routes: if the user is NOT logged in, keep the boot screen
 *     up while the redirect to `/login?next=<current-path>` fires. App content
 *     only ever mounts once a session is confirmed.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { username, loading } = useOslerSession();
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [isCloudEnabled, setIsCloudEnabled] = React.useState<boolean | null>(null);
  const hasSession = !!username;

  // Determine whether cloud is enabled (one-time).
  React.useEffect(() => {
    let cancelled = false;
    void cloudEnabled().then((enabled) => {
      if (!cancelled) setIsCloudEnabled(enabled);
    });
    return () => { cancelled = true; };
  }, []);

// Session-based redirects. These fire after the render below has already
  // chosen the safe surface (boot screen), so a redirect never reveals
  // protected UI to a guest.
  React.useEffect(() => {
    if (loading || isCloudEnabled === null) return;
    if (isPublicPath(pathname)) return;

    const search = window.location.search || "";
    const params = new URLSearchParams(search);
    // A password-reset link (/?reset=TOKEN) or email-verify link
    // (/?verify=TOKEN) is a bearer credential that must reach the form on
    // /login — never get dropped or buried.
    const resetToken = params.get("reset");
    const verifyToken = params.get("verify");
    const bearerToken = resetToken ?? verifyToken;

    // /login handling: redirect to `next` (or `/`) if already logged in —
    // unless a reset/verify link is pending, in which case the form must
    // render even for a signed-in user (the link is what authorizes it).
    if (isLoginPath(pathname)) {
      if (hasSession && !bearerToken) {
        const nextRaw = params.get("next") || "/";
        const safeNext = isSafeLocalPath(nextRaw) && !isLoginPath(nextRaw) ? nextRaw : "/";
        router.replace(safeNext);
      }
      return;
    }

    // A signed-in user arriving on a protected route with a reset/verify link
    // is redirected to the form, never left stranded on the dashboard.
    if (hasSession && bearerToken) {
      const loginUrl = new URL("/login", window.location.origin);
      if (resetToken) loginUrl.searchParams.set("reset", resetToken);
      if (verifyToken) loginUrl.searchParams.set("verify", verifyToken);
      loginUrl.searchParams.set("next", pathname);
      router.replace(`${loginUrl.pathname}${loginUrl.search}`);
      return;
    }

    // Protected route — require a session.
    if (!hasSession) {
      const loginUrl = new URL("/login", window.location.origin);
      if (pathname !== "/" || search !== "") {
        if (bearerToken) {
          // Surface the reset/verify token at the TOP level of the login URL.
          // Burying it inside `next` (/login?next=/?reset=TOKEN) would lose it
          // — the login screen reads these from the search string.
          if (resetToken) loginUrl.searchParams.set("reset", resetToken);
          if (verifyToken) loginUrl.searchParams.set("verify", verifyToken);
          const nextPath = `${pathname}${search.replace(/[?&](reset|verify)=[^&#]*/g, "")}`;
          loginUrl.searchParams.set("next", nextPath || "/");
        } else {
          loginUrl.searchParams.set("next", `${pathname}${search}`);
        }
      }
      router.replace(`${loginUrl.pathname}${loginUrl.search}`);
    }
  }, [loading, isCloudEnabled, hasSession, pathname, router]);

  // Public paths (admin, assets, service worker, …) always pass through —
  // AdminShell gates its own auth.
  if (isPublicPath(pathname)) return <>{children}</>;

  // Session not restored yet — branded boot screen, never content.
  if (loading || isCloudEnabled === null) return <BootScreen />;

  // /login: signed-in users are redirected to `next`; guests get the login.
  if (isLoginPath(pathname)) {
    if (hasSession) return <BootScreen />;
    return <>{children}</>;
  }

  // Protected route with no session — keep the boot screen up while the
  // redirect to /login fires. Never mount app content for a guest.
  if (!hasSession) return <BootScreen />;

  return <>{children}</>;
}