"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "@/components/osler/admin/admin-shell";
import { LoadingState } from "@/components/osler/ui-primitives";
import { cloudEnabled } from "@/lib/osler/cloud";

/**
 * Admin layout — static-export compatible.
 *
 * The old version used `next/headers` (server-side) to read the
 * `CF-Access-Authenticated-User-Email` header injected by Cloudflare Access.
 * Static export has no server runtime, so we can't read headers server-side.
 *
 * Instead, the AdminShell fetches the CF Access email client-side via the
 * Worker endpoint `GET /v1/admin/access`. The Worker reads the
 * `CF-Access-Authenticated-User-Email` request header and returns it. This
 * requires Cloudflare Access to be configured to protect BOTH:
 *   - `your-app.pages.dev/admin*` (the Pages site)
 *   - `your-worker.workers.dev/v1/admin/*` (the Worker)
 *
 * Same Access app, multiple hostnames. See docs/cloudflare-backend.md.
 *
 * Admin auth itself (the bearer token + role check) is unchanged — the
 * client reads it from sessionStorage and calls `/v1/admin/me` to verify.
 *
 * Route gating: the admin panel is a cloud-only surface — it talks to the
 * Worker's `/v1/admin/*` endpoints and drives R2 content. On a non-cloud
 * instance there is NO admin route: the layout redirects to the app root
 * instead of rendering any admin UI.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [cloudOn, setCloudOn] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void cloudEnabled().then((enabled) => {
      if (!cancelled) {
        if (!enabled) router.replace("/");
        else setCloudOn(true);
      }
    });
    return () => { cancelled = true; };
  }, [router]);

  if (cloudOn !== true) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <LoadingState />
      </div>
    );
  }

  return <AdminShell>{children}</AdminShell>;
}
