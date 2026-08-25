#!/usr/bin/env node
/**
 * Build the Osler service worker.
 *
 * Why a custom build step?
 *   - `@serwist/turbopack` is tightly coupled to Next.js's build pipeline
 *     and doesn't support `output: "export"`. We removed it.
 *   - Instead we use the plain `serwist` runtime + a small esbuild script
 *     that bundles `src/sw.ts` into a single `public/sw.js` file.
 *   - This runs BEFORE `next build` (see `package.json` → `build` script)
 *     so the static export picks up the generated `public/sw.js` and
 *     serves it at `/sw.js`.
 *
 * Output:  public/sw.js   (and public/sw.js.map for debugging)
 */

const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src", "sw.ts");
const OUTDIR = path.join(ROOT, "public");
const OUTFILE = path.join(OUTDIR, "sw.js");

if (!fs.existsSync(ENTRY)) {
  console.error(`[build-sw] Entry not found: ${ENTRY}`);
  process.exit(1);
}

if (!fs.existsSync(OUTDIR)) {
  fs.mkdirSync(OUTDIR, { recursive: true });
}

const isProd = process.env.NODE_ENV === "production";

/**
 * Per-build identity baked into sw.js. Every `npm run build` produces
 * different SW bytes, so browsers (and any intermediate cache) always see
 * a "new" worker and activate it immediately — no stale-worker window
 * after a deploy. Content caches are NOT keyed by this id (rotating them
 * would wipe users' downloaded packs); it exists purely for update
 * detection and diagnostics.
 */
function gitShortSha() {
  try {
    return require("node:child_process")
      .execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "nogit";
  }
}
const BUILD_ID = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12)}-${gitShortSha()}`;

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [ENTRY],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100", "firefox100", "safari16", "edge100"],
  outfile: OUTFILE,
  sourcemap: !isProd ? "linked" : false,
  minify: isProd,
  logLevel: "info",
  banner: {
    js: `/* osler service worker — build ${BUILD_ID} */`,
  },
  // serwist uses `process.env.NODE_ENV` to toggle dev logs.
  define: {
    "process.env.NODE_ENV": JSON.stringify(isProd ? "production" : "development"),
    "__OSLER_SW_BUILD_ID__": JSON.stringify(BUILD_ID),
  },
  // Don't bundle the serwist package - bundle it inline. The `serwist`
  // package is ESM and esbuild handles the interop.
  mainFields: ["browser", "module", "main"],
  conditions: ["browser", "import", "module", "default"],
};

esbuild
  .build(options)
  .then(() => {
    const stat = fs.statSync(OUTFILE);
    console.log(`[build-sw] ${path.relative(ROOT, OUTFILE)} (${(stat.size / 1024).toFixed(1)} KB)`);
  })
  .catch((err) => {
    console.error("[build-sw] build failed:", err);
    process.exit(1);
  });
