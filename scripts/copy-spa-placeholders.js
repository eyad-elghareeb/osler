#!/usr/bin/env node
/**
 * Post-build: copy dynamic-route placeholder HTML files to a non-conflicting
 * path so Cloudflare Pages `_redirects` can serve them without triggering
 * infinite-loop detection OR clean-URL redirects.
 *
 * WHY THIS EXISTS
 *
 * Next.js `output: "export"` + `generateStaticParams` emits one placeholder
 * HTML file per dynamic route, e.g.:
 *
 *   out/admin/content/_/index.html   ← generated for /admin/content/[id]
 *   out/qbank/_/index.html           ← generated for /qbank/[uid]
 *   out/library/_/index.html         ← generated for /library/[article]
 *   ...
 *
 * The original `public/_redirects` tried to serve those placeholders for any
 * matching URL:
 *
 *   /admin/content/*   /admin/content/_/index.html   200
 *
 * But Cloudflare Pages' redirect engine strips `.html` / `/index` from the
 * destination before re-evaluating it against the source pattern. The stripped
 * destination `/admin/content/_/` still matches the source `/admin/content/*`,
 * so Pages flags the rule as an infinite loop and **silently ignores it**.
 * The result: every dynamic URL (e.g. `/admin/content/<uuid>`) falls through
 * to the catch-all and returns 404.
 *
 * THE FIX
 *
 * Copy each placeholder HTML to a top-level `/_spa/<name>/index.html` path
 * whose URL does NOT match any source pattern. Two key constraints:
 *
 *   1. The destination path must not match the source pattern (avoids the
 *      infinite-loop detection that silently drops the rule).
 *   2. The destination must be a directory-style `index.html` (not a
 *      `name.html` file), because Cloudflare Pages automatically 308-
 *      redirects `name.html` to its clean URL `name`, which breaks the
 *      `200` rewrite. Directory-style URLs are already "clean" and are
 *      served directly without a redirect.
 *
 * The redirect rules then point at the new directory paths:
 *
 *   /admin/content/*   /_spa/admin-content/   200
 *
 * This script is idempotent and safe to re-run. It runs AFTER `next build`
 * (see `package.json` → `build` script).
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "out");
const SPA_DIR = path.join(OUT, "_spa");

/**
 * Map of source placeholder files (built by Next.js) to their non-conflicting
 * destination directories under `/_spa/`.
 *
 * Each dest is a directory name; the placeholder is copied to
 * `/_spa/<dest>/index.html`.
 *
 * Keep this in sync with `public/_redirects`.
 */
const PLACEHOLDERS = [
  // App dynamic routes
  { src: "qbank/_/index.html", dest: "qbank" },
  { src: "flashcards/_/index.html", dest: "flashcards" },
  { src: "osce/_/index.html", dest: "osce" },
  { src: "library/_/index.html", dest: "library" },
  { src: "videos/_/index.html", dest: "videos" },
  // Settings: unknown sections fall back to the settings hub shell.
  { src: "settings/index.html", dest: "settings" },
  // Admin dynamic routes (UUIDs not known at build time)
  { src: "admin/users/_/index.html", dest: "admin-users" },
  { src: "admin/content/_/index.html", dest: "admin-content" },
  { src: "admin/review/_/index.html", dest: "admin-review" },
];

if (!fs.existsSync(OUT)) {
  console.error("[copy-spa-placeholders] out/ directory not found. Run `next build` first.");
  process.exit(1);
}

fs.mkdirSync(SPA_DIR, { recursive: true });

let copied = 0;
let skipped = 0;

for (const { src, dest } of PLACEHOLDERS) {
  const srcPath = path.join(OUT, src);
  const destDir = path.join(SPA_DIR, dest);
  const destPath = path.join(destDir, "index.html");

  if (!fs.existsSync(srcPath)) {
    console.warn(`[copy-spa-placeholders] SKIP: source not found: ${src}`);
    skipped += 1;
    continue;
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  const size = fs.statSync(destPath).size;
  console.log(`[copy-spa-placeholders] ${src} → _spa/${dest}/index.html (${(size / 1024).toFixed(1)} KB)`);
  copied += 1;
}

console.log(`[copy-spa-placeholders] Done: ${copied} copied, ${skipped} skipped.`);
