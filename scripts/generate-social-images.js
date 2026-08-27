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
 * Supersedes the old generate-og-png.js, which only rendered the single
 * default image from a hand-edited SVG with "Osler" hardcoded into the
 * pixels. Two things changed:
 *
 *  1. Every image here is generated from one template, driven by
 *     `public/osler.config.json` (site.name / site.tagline) — a self-hosted
 *     fork that rebrands the config gets correctly branded preview images
 *     without hand-editing SVG markup.
 *  2. There's now one real image per top-level section instead of a single
 *     generic image for the whole site. This app is a static export with no
 *     per-request server (see next.config.ts), so a genuinely dynamic,
 *     per-article/per-pack preview image is not achievable here — social
 *     crawlers only ever see whatever HTML/assets were baked in at build
 *     time. Per-section is the most specific thing that *is* achievable
 *     statically, and it degrades honestly: anything not covered by a
 *     section keeps the site-wide default.
 *
 * Why not render SVG directly as og:image? Most social crawlers that render
 * link-preview images — Facebook/Meta's, Twitter/X's — don't accept SVG
 * there at all. This script rasterizes to real PNG so previews actually
 * show up.
 *
 * Why embed fonts as base64 @font-face instead of `sharp(svg).png()` on the
 * raw markup? librsvg (which sharp uses for SVG) resolves generic font
 * families like "system-ui" via fontconfig, which is inconsistent across
 * CI/containers and tends to render slightly blurry or with the wrong
 * font. Embedding the actual Poppins files guarantees pixel-identical
 * output everywhere this script runs.
 *
 * Usage: node scripts/generate-social-images.js
 * Wired into `npm run build` — see package.json.
 */

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const OUT_DEFAULT = path.join(ROOT, "public", "assets", "og-image.png");
const OUT_DIR = path.join(ROOT, "public", "assets", "og");
const CONFIG_PATH = path.join(ROOT, "public", "osler.config.json");
const POPPINS_DIR = path.join(ROOT, "public", "fonts", "poppins");

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

/** Same palette as the worker's GET /og endpoint (cloudflare/worker/src/index.ts) — keep in sync. */
const SECTIONS = {
  quiz: { border: "#3b82f6", text: "#93c5fd", label: "Quiz", description: "Adaptive quizzes with instant feedback." },
  bank: { border: "#2563eb", text: "#93c5fd", label: "Question Bank", description: "Adaptive question bank with instant explanations and spaced review." },
  flashcard: { border: "#16a34a", text: "#86efac", label: "Flashcards", description: "Active recall flashcards with spaced repetition scheduling." },
  osce: { border: "#dc2626", text: "#fca5a5", label: "OSCE Stations", description: "Simulated OSCE clinical stations with structured mark schemes." },
  library: { border: "#7c3aed", text: "#d8b4fe", label: "Clinical Library", description: "Clinical reference library covering diagnosis and management." },
  video: { border: "#0891b2", text: "#67e8f9", label: "Video Lessons", description: "Curated video lessons organised by clinical topic." },
  written: { border: "#d97706", text: "#fcd34d", label: "Written Cases", description: "Written clinical cases with model answers." },
};

function fontFaceCss() {
  const fonts = [
    { file: "Poppins-Regular.ttf", weight: 400, style: "normal" },
    { file: "Poppins-Medium.ttf", weight: 500, style: "normal" },
    { file: "Poppins-Bold.ttf", weight: 700, style: "normal" },
  ];
  let css = "";
  for (const f of fonts) {
    const fp = path.join(POPPINS_DIR, f.file);
    if (!fs.existsSync(fp)) {
      console.warn(`[social-images] missing font ${f.file}, skipping`);
      continue;
    }
    const data = fs.readFileSync(fp).toString("base64");
    css += `@font-face{font-family:'Poppins';font-style:${f.style};font-weight:${f.weight};src:url(data:font/ttf;base64,${data}) format('truetype');}\n`;
  }
  return css;
}

/** Builds the site-wide default card — brand name, tagline, and the full engine lineup. */
function buildDefaultSvg({ name, tagline }, fontCss) {
  const badges = [
    { label: "Quiz & Bank", color: "#93c5fd" },
    { label: "Flashcards", color: "#86efac" },
    { label: "OSCE", color: "#fca5a5" },
    { label: "Library", color: "#c084fc" },
  ];
  let bx = 0;
  const badgeSvg = badges
    .map((b) => {
      const w = Math.max(110, b.label.length * 11 + 40);
      const cx = bx;
      bx += w + 15;
      return `<rect x="${cx}" y="0" width="${w}" height="42" rx="21" fill="#1e293b" stroke="#334155" stroke-width="1.5" />
        <text x="${cx + w / 2}" y="26" font-family="Poppins, system-ui, sans-serif" font-size="16" font-weight="600" fill="${b.color}" text-anchor="middle">${xmlEscape(b.label)}</text>`;
    })
    .join("\n");
  const offlineX = bx;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <style>${fontCss}</style>
    <linearGradient id="og-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090d16"/><stop offset="50%" stop-color="#0f172a"/><stop offset="100%" stop-color="#1e3a8a"/>
    </linearGradient>
    <linearGradient id="og-accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#93c5fd"/><stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="16" result="blur" /><feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#og-bg)" />
  <g opacity="0.04" stroke="#ffffff" stroke-width="1">
    <line x1="0" y1="105" x2="1200" y2="105" /><line x1="0" y1="210" x2="1200" y2="210" />
    <line x1="0" y1="315" x2="1200" y2="315" /><line x1="0" y1="420" x2="1200" y2="420" />
    <line x1="0" y1="525" x2="1200" y2="525" />
    <line x1="200" y1="0" x2="200" y2="630" /><line x1="400" y1="0" x2="400" y2="630" />
    <line x1="600" y1="0" x2="600" y2="630" /><line x1="800" y1="0" x2="800" y2="630" />
    <line x1="1000" y1="0" x2="1000" y2="630" />
  </g>
  <g transform="translate(140, 140)">
    <rect x="0" y="0" width="100" height="100" rx="24" fill="#1e3a8a" stroke="#3b82f6" stroke-width="2" />
    <path d="M 18 50 L 32 50 L 40 28 L 50 72 L 60 38 L 70 50 L 82 50" stroke="url(#og-accent)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none" filter="url(#glow)" />
  </g>
  <text x="270" y="195" font-family="Poppins, system-ui, sans-serif" font-size="52" font-weight="800" fill="#ffffff" letter-spacing="-0.02em">${xmlEscape(name)}</text>
  <text x="270" y="235" font-family="Poppins, system-ui, sans-serif" font-size="22" font-weight="500" fill="#94a3b8">${xmlEscape(tagline)}</text>
  <text x="140" y="340" font-family="Poppins, system-ui, sans-serif" font-size="44" font-weight="700" fill="#f8fafc" letter-spacing="-0.01em">Master Clinical Medicine with Precision</text>
  <text x="140" y="390" font-family="Poppins, system-ui, sans-serif" font-size="22" font-weight="400" fill="#94a3b8">High-yield question bank, active recall flashcards, OSCE simulation, and clinical reference library.</text>
  <g transform="translate(140, 470)">
    ${badgeSvg}
    <rect x="${offlineX}" y="0" width="150" height="42" rx="21" fill="#0f172a" stroke="#3b82f6" stroke-width="1.5" />
    <text x="${offlineX + 75}" y="26" font-family="Poppins, system-ui, sans-serif" font-size="16" font-weight="600" fill="#60a5fa" text-anchor="middle">⚡ Offline PWA</text>
  </g>
</svg>`;
}

/** Builds one section card — same visual language as the default, badged and captioned per section. */
function buildSectionSvg(type, { name, tagline }, fontCss) {
  const meta = SECTIONS[type];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <style>${fontCss}</style>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090d16"/><stop offset="50%" stop-color="#0f172a"/><stop offset="100%" stop-color="#1e3a8a"/>
    </linearGradient>
    <linearGradient id="ac" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#93c5fd"/><stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <g opacity="0.04" stroke="#fff" stroke-width="1">
    <line x1="0" y1="105" x2="1200" y2="105"/><line x1="0" y1="210" x2="1200" y2="210"/>
    <line x1="0" y1="315" x2="1200" y2="315"/><line x1="0" y1="420" x2="1200" y2="420"/>
    <line x1="0" y1="525" x2="1200" y2="525"/>
    <line x1="200" y1="0" x2="200" y2="630"/><line x1="400" y1="0" x2="400" y2="630"/>
    <line x1="600" y1="0" x2="600" y2="630"/><line x1="800" y1="0" x2="800" y2="630"/>
    <line x1="1000" y1="0" x2="1000" y2="630"/>
  </g>
  <g transform="translate(120,105)">
    <rect x="0" y="0" width="70" height="70" rx="18" fill="#1e3a8a" stroke="#3b82f6" stroke-width="2"/>
    <path d="M12 35 L22 35 L28 20 L35 50 L42 27 L49 35 L58 35" stroke="url(#ac)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>
  <text x="210" y="150" font-family="Poppins, system-ui, sans-serif" font-size="32" font-weight="800" fill="#ffffff">${xmlEscape(name)}</text>
  <g transform="translate(120,210)">
    <rect x="0" y="0" width="${Math.max(168, meta.label.length * 12 + 40)}" height="38" rx="19" fill="#1e293b" stroke="${meta.border}" stroke-width="1.5"/>
    <text x="${Math.max(168, meta.label.length * 12 + 40) / 2}" y="24" font-family="Poppins, system-ui, sans-serif" font-size="15" font-weight="700" fill="${meta.text}" text-anchor="middle">${xmlEscape(meta.label)}</text>
  </g>
  <text x="120" y="330" font-family="Poppins, system-ui, sans-serif" font-size="52" font-weight="800" fill="#f8fafc" letter-spacing="-0.02em">${xmlEscape(meta.label)}</text>
  <text x="120" y="395" font-family="Poppins, system-ui, sans-serif" font-size="24" font-weight="400" fill="#94a3b8">${xmlEscape(meta.description)}</text>
  <line x1="120" y1="520" x2="1080" y2="520" stroke="#334155" stroke-width="1"/>
  <text x="120" y="560" font-family="Poppins, system-ui, sans-serif" font-size="16" font-weight="500" fill="#64748b">${xmlEscape(name)} — ${xmlEscape(tagline)}</text>
</svg>`;
}

async function renderPng(svg, outPath) {
  const buf = await sharp(Buffer.from(svg), { density: 300 })
    .resize(1200, 630, { fit: "contain", background: "#090d16" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  const stat = fs.statSync(outPath);
  console.log(`[social-images] ${path.relative(ROOT, outPath)} ${(stat.size / 1024).toFixed(1)} KB 1200x630`);
}

async function main() {
  const site = readSiteConfig();
  const fontCss = fontFaceCss();

  await renderPng(buildDefaultSvg(site, fontCss), OUT_DEFAULT);
  for (const type of Object.keys(SECTIONS)) {
    await renderPng(buildSectionSvg(type, site, fontCss), path.join(OUT_DIR, `${type}.png`));
  }
}

main().catch((e) => {
  console.error("[social-images] failed", e);
  process.exit(1);
});
