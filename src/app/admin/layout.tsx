"use client";

import * as React from "react";
import { AdminShell } from "@/components/osler/admin/admin-shell";

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
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
