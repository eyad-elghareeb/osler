import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, readSessionFromRequest } from "@/lib/osler/server-session";

/**
 * Public paths that never require an Osler session.
 * - `/login` — the login page itself (handled below with a redirect if logged in)
 * - `/api/*` — API routes handle their own auth
 * - `/_next/*`, `/serwist/*` — Next.js internals & Serwist SW assets
 * - `/osler-content/*`, `/assets/*` — static content & PWA assets
 * - `/admin/*` — admin panel auth is enforced by Cloudflare Access (CF-Access-*
 *   headers) when deployed behind Access; in local dev the admin panel runs
 *   unauthenticated by design (the admin route guard shows a "sign in" prompt).
 * - PWA manifest, icons, favicon
 *
 * NOTE: This list must stay in sync with the matcher below. Anything not
 * listed here is treated as an app route and requires a valid session cookie.
 */
const PUBLIC_PATH_PREFIXES = [
  "/api/",
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
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 1. Public paths — always pass through.
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // 2. Verify the session cookie (HMAC-signed, expiry-checked).
  const session = await readSessionFromRequest(request);
  const hasSession = session !== null;

  // 3. /login handling: redirect to `next` (or `/`) if already logged in.
  if (pathname === "/login") {
    if (hasSession) {
      // Validate the `next` param so we don't redirect off-site, and reject
      // `next=/login` (or `/login?...`) to prevent an infinite redirect loop.
      const nextRaw = request.nextUrl.searchParams.get("next") || "/";
      const safeNext = isSafeLocalPath(nextRaw) && !isLoginPath(nextRaw) ? nextRaw : "/";
      const url = new URL(safeNext, request.url);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // 4. App routes — require a valid session.
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/" || search !== "") {
      loginUrl.searchParams.set("next", pathname + search);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

/**
 * Validate that a `next` redirect target is a same-origin relative path.
 * Blocks open-redirect via `?next=https://evil.com` or `?next=//evil.com`.
 */
function isSafeLocalPath(input: string): boolean {
  if (typeof input !== "string" || input.length === 0) return false;
  // Must start with `/` but not `//` (protocol-relative URL).
  if (!input.startsWith("/")) return false;
  if (input.startsWith("//")) return false;
  // Reject backslash-based protocol-relative URLs (`/\evil.com`).
  if (input.startsWith("/\\")) return false;
  // No scheme-like prefix (e.g. `javascript:`, `data:`).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) return false;
  // Cap length to avoid abuse.
  if (input.length > 1024) return false;
  return true;
}

/**
 * Check whether a path points to the login page (exact or with a query string).
 * Used to reject `next=/login` and prevent infinite redirect loops.
 */
function isLoginPath(input: string): boolean {
  if (input === "/login") return true;
  if (input.startsWith("/login?")) return true;
  if (input.startsWith("/login/")) return true;
  return false;
}

export const config = {
  // Match all paths except Next.js internal static/image/favicon paths.
  // The middleware function itself decides which paths are public; this
  // matcher just controls which requests invoke the middleware at all.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
