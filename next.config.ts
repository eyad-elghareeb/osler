import type { NextConfig } from "next";

/**
 * Osler runs as a fully static export (`output: "export"`).
 *
 * Architecture:
 *   - Frontend: built to `out/` and deployed to Cloudflare Pages (.pages.dev).
 *     No server runtime, no middleware, no SSR. All UI is client-rendered.
 *   - Backend: a single Cloudflare Worker (see `cloudflare/worker/`) hosts
 *     auth, sync, admin, and content endpoints. The frontend talks to it
 *     cross-origin via `cloud.apiUrl` (set in `public/osler.config.json`)
 *     or `NEXT_PUBLIC_CLOUD_API_URL` at build time.
 *
 * Notes:
 *   - `images.unoptimized = true` — Next.js Image Optimization requires a
 *     server runtime; static export must serve images as-is.
 *   - `trailingSlash = true` — Cloudflare Pages serves `/path/index.html`
 *     for `/path`, and a trailing slash keeps client-side navigation
 *     consistent with the static file layout.
 *   - The service worker is built separately by `scripts/build-sw.js`
 *     (esbuild) and emitted to `public/sw.js`. The provider loads it
 *     directly; there is no Next.js turbopack SW integration.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
