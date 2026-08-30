#!/usr/bin/env node
/**
 * Generates every static social-preview PNG the site ships:
 *
 *   public/assets/og-image.png   — site-wide default (home, settings, login, …)
 *   public/assets/og/bank.png    — Question Bank section
 *   public/assets/og/flashcard.png
 *   public/assets/og/osce.png
 *   public/assets/og/library.png
 *   public/assets/og/video.png
 *   public/assets/og/quiz.png    — kept for API/worker parity (see cloudflare
 *                                   worker's GET /og?format=png), no page uses
 *                                   it directly today
 *   public/assets/og/written.png — same as above
 *
 * Every image is generated from one template, driven by
 * `public/osler.config.json` (site.name / site.tagline) — a self-hosted fork
 * that rebrands the config gets correctly branded preview images without
 * hand-editing SVG markup.
 *
 * Why not render SVG directly as og:image? Most social crawlers that render
 * link-preview images — Facebook/Meta's, Twitter/X's — don't accept SVG
 * there at all. This script rasterizes to real PNG so previews actually
 * show up.
 *
 * Why @resvg/resvg-js instead of sharp/librsvg? librsvg resolves fonts through
 * fontconfig, which is inconsistent across CI/containers and on some builds
 * has no fonts at all — text silently falls back to a generic mono face.
 * resvg loads the exact Poppins files passed to it (loadSystemFonts: false),
 * so output is pixel-identical everywhere this script runs.
 *
 * Colors: all values below are converted at runtime from the app's own design
 * tokens — the dark-theme surface/ink colors from `src/app/globals.css` and
 * the per-engine accent colors from `ENGINE_META` in `src/lib/osler/content.ts`.
 * The worker's GET /og endpoint mirrors the resulting hexes — keep in sync.
 *
 * Usage: node scripts/generate-social-images.js
 * Wired into `npm run build` — see package.json.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Resvg } = require("@resvg/resvg-js");

const ROOT = path.resolve(__dirname, "..");
const OUT_DEFAULT = path.join(ROOT, "public", "assets", "og-image.png");
const OUT_DIR = path.join(ROOT, "public", "assets", "og");
const CONFIG_PATH = path.join(ROOT, "public", "osler.config.json");
const POPPINS_DIR = path.join(ROOT, "public", "fonts", "poppins");
const POPPINS_FILES = ["Poppins-Regular.ttf", "Poppins-Medium.ttf", "Poppins-Bold.ttf"].map((f) =>
  path.join(POPPINS_DIR, f),
);

const DEFAULT_SITE = { name: "Osler", tagline: "Medical Study Platform" };

/** Same fallback behaviour as src/lib/osler/config.server.ts, kept in sync deliberately. */
function readSiteConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    const site = parsed && typeof parsed === "object" ? parsed.site : null;
    return {
      name: typeof site?.name === "string" && site.name.trim() ? site.name.trim() : DEFAULT_SITE.name,
      tagline: typeof site?.tagline === "string" && site.tagline.trim() ? site.tagline.trim() : DEFAULT_SITE.tagline,
    };
  } catch {
    return { ...DEFAULT_SITE };
  }
}

function xmlEscape(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));
}

/** oklch() -> sRGB hex (CSS Color 4 → gamut-clamped). Keeps this script and
 *  the worker's /og endpoint on the app's exact design tokens. */
function oklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const lr = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mg = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sb = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const chan = (v) => {
    let x = 4.0767416621 * lr - 3.3077115913 * mg + 0.2309699292 * sb;
    if (v === 1) x = -1.2684380046 * lr + 2.6097574011 * mg - 0.3413193965 * sb;
    if (v === 2) x = -0.0041960863 * lr - 0.7034186147 * mg + 1.707614701 * sb;
    x = Math.min(1, Math.max(0, x));
    const g = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(g * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${chan(0)}${chan(1)}${chan(2)}`;
}

// Brand identity. The mark is the app icon (public/assets/icon.svg) redrawn
// faithfully — navy gradient square, subtle medical cross, azure gradient
// pulse — and the card background is the icon's own dark stop (#0f172a, the
// default dark theme's slate-navy family), so every card reads as the product.
// Ink/muted values stay on the theme tokens (globals.css .dark); per-engine
// accents (ENGINE_META) color only the section rule.
const BRAND = {
  markFrom: "#1e3a8a",
  markTo: "#0f172a",
  pulseFrom: "#60a5fa",
  pulseTo: "#3b82f6",
  cross: "#60a5fa",
};

const INK = {
  bg: "#0f172a",
  text: oklchToHex(0.97, 0.004, 250),
  muted: oklchToHex(0.7, 0.015, 240),
  mutedDim: oklchToHex(0.62, 0.012, 240),
};

const SECTIONS = {
  quiz: { color: "oklch(0.62 0.16 250)", label: "Quiz", description: "Adaptive quizzes with instant feedback." },
  bank: { color: "oklch(0.58 0.14 245)", label: "Question Bank", description: "Adaptive questions with instant explanations." },
  flashcard: { color: "oklch(0.7 0.18 145)", label: "Flashcards", description: "Active recall with spaced repetition scheduling." },
  osce: { color: "oklch(0.7 0.2 16)", label: "OSCE Stations", description: "Simulated stations with structured mark schemes." },
  library: { color: "oklch(0.65 0.15 280)", label: "Clinical Library", description: "Clinical reference covering diagnosis and management." },
  video: { color: "oklch(0.68 0.18 195)", label: "Video Lessons", description: "Curated video lessons by clinical topic." },
  written: { color: "oklch(0.78 0.16 80)", label: "Written Cases", description: "Written clinical cases with model answers." },
};
for (const meta of Object.values(SECTIONS)) meta.hex = oklchToHex(...meta.color.match(/[\d.]+/g).map(Number));

/** The Osler app icon (public/assets/icon.svg) redrawn in a 100×100 box:
 *  navy gradient square, subtle medical cross, azure gradient pulse. One
 *  brand mark everywhere — per-engine accents never recolor it. */
function pulseMark(x, y, size) {
  return `<g transform="translate(${x} ${y}) scale(${size / 100})">
    <rect width="100" height="100" rx="22" fill="url(#mark-bg)"/>
    <g fill="${BRAND.cross}" opacity="0.18">
      <rect x="44.1" y="28.5" width="11.7" height="43" rx="2.7"/>
      <rect x="28.5" y="44.1" width="43" height="11.7" rx="2.7"/>
    </g>
    <path d="M18.75 50 L32.42 50 L40.23 34.37 L48.05 65.63 L55.86 42.19 L63.67 50 L81.25 50" fill="none" stroke="url(#mark-pulse)" stroke-width="4.7" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
}

function cardShell(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <radialGradient id="depth" cx="0.16" cy="0.06" r="0.9">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.045"/>
      <stop offset="55%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mark-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BRAND.markFrom}"/><stop offset="100%" stop-color="${BRAND.markTo}"/>
    </linearGradient>
    <linearGradient id="mark-pulse" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BRAND.pulseFrom}"/><stop offset="100%" stop-color="${BRAND.pulseTo}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="${INK.bg}"/>
  <rect width="1200" height="630" fill="url(#depth)"/>
  ${inner}
</svg>`;
}

/** Site-wide default card — brand lockup, headline, one-line sub, footer. */
function buildDefaultSvg({ name, tagline }) {
  const inner = `
  <g transform="translate(96 92)">
    ${pulseMark(0, 0, 72)}
    <text x="96" y="47" font-family="Poppins" font-size="42" font-weight="700" fill="${INK.text}" letter-spacing="-0.5">${xmlEscape(name)}</text>
  </g>
  <text x="96" y="340" font-family="Poppins" font-size="62" font-weight="700" fill="${INK.text}" letter-spacing="-1.2">Master clinical medicine</text>
  <text x="96" y="416" font-family="Poppins" font-size="62" font-weight="700" fill="${INK.text}" letter-spacing="-1.2">with precision.</text>
  <text x="96" y="478" font-family="Poppins" font-size="23" font-weight="400" fill="${INK.muted}">Question bank, flashcards, OSCE simulation, and a clinical reference library.</text>
  <line x1="96" y1="548" x2="1104" y2="548" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="1"/>
  <text x="96" y="583" font-family="Poppins" font-size="16" font-weight="500" fill="${INK.mutedDim}">${xmlEscape(tagline)} · Offline-ready</text>`;
  return cardShell(inner);
}

/** Section card — quiet brand row, one accent rule, the engine name as the
 *  display line, one-line description, footer. */
function buildSectionSvg(type, { name, tagline }) {
  const meta = SECTIONS[type];
  const inner = `
  <g transform="translate(96 84)">
    ${pulseMark(0, 0, 52)}
    <text x="72" y="34" font-family="Poppins" font-size="22" font-weight="500" fill="${INK.muted}">${xmlEscape(name)}</text>
  </g>
  <rect x="96" y="266" width="72" height="6" rx="3" fill="${meta.hex}"/>
  <text x="96" y="366" font-family="Poppins" font-size="64" font-weight="700" fill="${INK.text}" letter-spacing="-1.2">${xmlEscape(meta.label)}</text>
  <text x="96" y="424" font-family="Poppins" font-size="23" font-weight="400" fill="${INK.muted}">${xmlEscape(meta.description)}</text>
  <line x1="96" y1="548" x2="1104" y2="548" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="1"/>
  <text x="96" y="583" font-family="Poppins" font-size="16" font-weight="500" fill="${INK.mutedDim}">${xmlEscape(name)} · ${xmlEscape(tagline)}</text>`;
  return cardShell(inner);
}

async function renderPng(svg, outPath) {
  // No fitTo needed: the SVG declares width/height 1200x630, so render() is
  // 1:1. (fitTo:"original" hits a broken path in resvg-js 2.x that mis-selects
  // the font face — leave it unset.)
  const resvg = new Resvg(svg, {
    font: { fontFiles: POPPINS_FILES, defaultFontFamily: "Poppins", loadSystemFonts: false },
  });
  const buf = resvg.render().asPng();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  const stat = fs.statSync(outPath);
  console.log(`[social-images] ${path.relative(ROOT, outPath)} ${(stat.size / 1024).toFixed(1)} KB 1200x630`);
}

async function main() {
  const site = readSiteConfig();
  await renderPng(buildDefaultSvg(site), OUT_DEFAULT);
  for (const type of Object.keys(SECTIONS)) {
    await renderPng(buildSectionSvg(type, site), path.join(OUT_DIR, `${type}.png`));
  }
}

main().catch((e) => {
  console.error("[social-images] failed", e);
  process.exit(1);
});
