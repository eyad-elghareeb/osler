#!/usr/bin/env node
/**
 * Generate public/assets/og-image.png from public/assets/og-image.svg
 * with proper font embedding for crisp rendering.
 *
 * Why not just `sharp(svg).png()`?
 *   librsvg (used by sharp) relies on fontconfig to resolve `system-ui`.
 *   On CI / Windows / minimal containers that often falls back to a
 *   mismatched font or renders text slightly blurry. Embedding the actual
 *   font files (Poppins) as base64 @font-face guarantees the PNG matches
 *   the SVG design on every machine.
 */

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const SVG_IN = path.join(ROOT, "public", "assets", "og-image.svg");
const PNG_OUT = path.join(ROOT, "public", "assets", "og-image.png");

function b64(filePath) {
  return fs.readFileSync(filePath).toString("base64");
}

async function main() {
  if (!fs.existsSync(SVG_IN)) {
    console.error(`[og-png] SVG not found: ${SVG_IN}`);
    process.exit(1);
  }

  let svg = fs.readFileSync(SVG_IN, "utf8");

  // Embed Poppins for weights used in the OG card.
  // Files are already vendored in public/fonts/poppins/.
  const poppinsDir = path.join(ROOT, "public", "fonts", "poppins");
  const fonts = [
    { file: "Poppins-Regular.ttf", weight: 400, style: "normal" },
    { file: "Poppins-Medium.ttf", weight: 500, style: "normal" },
    { file: "Poppins-Bold.ttf", weight: 700, style: "normal" },
  ];

  let fontCss = "";
  for (const f of fonts) {
    const fp = path.join(poppinsDir, f.file);
    if (!fs.existsSync(fp)) {
      console.warn(`[og-png] missing font ${f.file}, skipping`);
      continue;
    }
    const data = b64(fp);
    fontCss += `@font-face{font-family:'Poppins';font-style:${f.style};font-weight:${f.weight};src:url(data:font/ttf;base64,${data}) format('truetype');}\n`;
  }

  // Inject @font-face into <defs> and normalize font-family to Poppins.
  // Keep system-ui as fallback for environments that already render correctly,
  // but Poppins will be preferred because it's embedded.
  if (fontCss) {
    const styleTag = `<style>${fontCss}</style>`;
    if (svg.includes("</defs>")) {
      svg = svg.replace("</defs>", `${styleTag}</defs>`);
    } else if (svg.includes("<defs>")) {
      svg = svg.replace("<defs>", `<defs>${styleTag}`);
    } else {
      svg = svg.replace("<svg", `<svg><defs>${styleTag}</defs>`);
    }
    // Replace system-ui stacks with Poppins-first stack so embedded font is used.
    svg = svg.replaceAll(
      'font-family="system-ui, -apple-system, sans-serif"',
      'font-family="Poppins, system-ui, -apple-system, sans-serif"'
    );
    svg = svg.replaceAll(
      'font-family="system-ui, sans-serif"',
      'font-family="Poppins, system-ui, sans-serif"'
    );
  }

  // Render at 2x density for crisp text, then ensure output is exactly 1200x630.
  // density 144 = 2x for 72dpi base; sharp respects width/height in SVG viewBox.
  const pngBuffer = await sharp(Buffer.from(svg), { density: 300 })
    .resize(1200, 630, { fit: "contain", background: "#090d16" })
    .png({ compressionLevel: 9 })
    .toBuffer();

  fs.writeFileSync(PNG_OUT, pngBuffer);
  const stat = fs.statSync(PNG_OUT);
  console.log(`[og-png] ${path.relative(ROOT, PNG_OUT)} ${(stat.size / 1024).toFixed(1)} KB 1200x630`);
}

main().catch((e) => {
  console.error("[og-png] failed", e);
  process.exit(1);
});
