/**
 * Build-time site config reader — Server Components / Node build scripts only.
 *
 * `getConfig()` in `./config.ts` is designed for the browser: it reads an
 * in-memory cache or `localStorage`, and when neither is available (which is
 * always true during `next build`, since that runs in Node with no
 * `window`) it silently falls back to `DEFAULT_CONFIG`. That's the right
 * behavior for client code, but it means anything that calls `getConfig()`
 * at build time — e.g. the root `layout.tsx`'s static `<title>`/`og:*`
 * metadata — never actually sees a self-hoster's edited
 * `public/osler.config.json`. It always renders the upstream "Osler /
 * Medical Study Platform" defaults, even on a fork that has fully rebranded
 * the in-app UI (which reads the file correctly at runtime via
 * `loadConfig()`). This is invisible upstream only because the shipped
 * `osler.config.json` happens to match `DEFAULT_CONFIG` byte-for-byte.
 *
 * This module reads the JSON file directly off disk with Node's `fs`, which
 * *is* available in Server Components during `next build`/`next dev` (it is
 * not bundled for the client, and `output: "export"` still executes layouts
 * as regular Node/Server Components at build time — there's just no server
 * left afterwards to run them again per-request). Use this — not
 * `getConfig()` — for anything that bakes site identity into static HTML.
 */
import fs from "node:fs";
import path from "node:path";

export interface BuildTimeSiteConfig {
  name: string;
  shortName: string;
  tagline: string;
  organisation: string;
}

const DEFAULTS: BuildTimeSiteConfig = {
  name: "Osler",
  shortName: "Osler",
  tagline: "Medical Study Platform",
  organisation: "Osler Team",
};

let cached: BuildTimeSiteConfig | null = null;

/**
 * Reads `public/osler.config.json` relative to the project root
 * (`process.cwd()` during `next build`) and returns the `site` block,
 * merged over sane defaults so a partial/malformed file degrades instead of
 * failing the build. Safe to call repeatedly — the result is memoized.
 */
export function getBuildTimeSiteConfig(): BuildTimeSiteConfig {
  if (cached) return cached;
  try {
    const configPath = path.join(process.cwd(), "public", "osler.config.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const site = parsed && typeof parsed === "object" ? parsed.site : null;
    cached = {
      name: typeof site?.name === "string" && site.name.trim() ? site.name.trim() : DEFAULTS.name,
      shortName: typeof site?.shortName === "string" && site.shortName.trim() ? site.shortName.trim() : DEFAULTS.shortName,
      tagline: typeof site?.tagline === "string" && site.tagline.trim() ? site.tagline.trim() : DEFAULTS.tagline,
      organisation: typeof site?.organisation === "string" && site.organisation.trim() ? site.organisation.trim() : DEFAULTS.organisation,
    };
  } catch {
    // Missing file, bad JSON, or running somewhere fs isn't available —
    // fall back to defaults rather than failing the build.
    cached = { ...DEFAULTS };
  }
  return cached;
}
