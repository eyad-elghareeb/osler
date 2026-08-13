"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginScreen } from "@/components/osler/login-screen";
import { useOslerSession } from "@/lib/osler/session-context";

/**
 * Validate that a `next` redirect target is a same-origin relative path.
 * Blocks open-redirect via `?next=https://evil.com` or `?next=//evil.com`.
 * Also rejects `next=/login` to prevent infinite redirect loops.
 * Must match the RouteGuard's `isSafeLocalPath` exactly.
 */
function isSafeLocalPath(input: string | null | undefined): input is string {
  if (!input || typeof input !== "string") return false;
  if (input.length === 0 || input.length > 1024) return false;
  if (!input.startsWith("/")) return false;
  if (input.startsWith("//")) return false;
  if (input.startsWith("/\\")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) return false;
  // Reject next=/login (or /login?...) to prevent redirect loops.
  if (input === "/login" || input.startsWith("/login?") || input.startsWith("/login/")) return false;
  return true;
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, username, loading } = useOslerSession();

  // Read & validate `next` once. The RouteGuard already validates this when
  // redirecting logged-in users away from /login, but we re-validate here so
  // a crafted link can't navigate the user off-site after a manual login.
  const nextRaw = searchParams.get("next") || "/";
  const next = isSafeLocalPath(nextRaw) ? nextRaw : "/";

  // Redirect to `next` when the session is established. The `login()`
  // function in session-context updates the React state synchronously
  // (no cookie roundtrip — the static export has no server), so by the
  // time this effect fires the RouteGuard already sees the session.
  React.useEffect(() => {
    if (loading) return;
    if (username) {
      router.replace(next);
    }
  }, [username, loading, router, next]);

  const handleLogin = React.useCallback(
    (name: string) => {
      // Just call login — it sets the session in React state, which
      // triggers the effect above to navigate. No router.push here
      // to avoid racing the state update.
      login(name);
    },
    [login]
  );

  const cloudAuthError = searchParams.get("cloudAuthError");

  return (
    <LoginScreen
      onLogin={handleLogin}
      cloudAuthError={cloudAuthError === "google" || cloudAuthError === "email_claimed" ? cloudAuthError : undefined}
    />
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginContent />
    </React.Suspense>
  );
}
