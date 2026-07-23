/**
 * Loads and registers the webfonts used by the Osler PDF engine:
 *   · Poppins  — headings, labels, running chrome (Latin)
 *   · Lora     — body serif (Latin)
 *   · Cairo    — Arabic (headings + body) — 8 weights (200–900)
 *
 * Fonts are fetched once, cached as base64 in memory, and registered into
 * every new jsPDF document. `loadPdfFonts()` is safe to call repeatedly or
 * concurrently — a single in-flight request is shared by all callers.
 */

import type { jsPDF } from "jspdf";

interface FontFile {
  family: string;
  style: "normal" | "italic" | "bold" | "bolditalic";
  path: string;
}

const FONT_FILES: FontFile[] = [
  { family: "Poppins", style: "normal", path: "/fonts/poppins/Poppins-Regular.ttf" },
  { family: "Poppins", style: "bold", path: "/fonts/poppins/Poppins-Bold.ttf" },
  { family: "Poppins", style: "italic", path: "/fonts/poppins/Poppins-Italic.ttf" },
  { family: "Poppins", style: "bolditalic", path: "/fonts/poppins/Poppins-BoldItalic.ttf" },
  { family: "Poppins-Medium", style: "normal", path: "/fonts/poppins/Poppins-Medium.ttf" },
  { family: "Poppins-Light", style: "normal", path: "/fonts/poppins/Poppins-Light.ttf" },
  { family: "Poppins-Light", style: "italic", path: "/fonts/poppins/Poppins-LightItalic.ttf" },
  { family: "Lora", style: "normal", path: "/fonts/lora/Lora-Regular.ttf" },
  { family: "Lora", style: "italic", path: "/fonts/lora/Lora-Italic.ttf" },
  { family: "Cairo", style: "normal", path: "/fonts/cairo/Cairo-Regular.ttf" },
  { family: "Cairo", style: "bold", path: "/fonts/cairo/Cairo-Bold.ttf" },
  { family: "Cairo-ExtraLight", style: "normal", path: "/fonts/cairo/Cairo-ExtraLight.ttf" },
  { family: "Cairo-Light", style: "normal", path: "/fonts/cairo/Cairo-Light.ttf" },
  { family: "Cairo-Medium", style: "normal", path: "/fonts/cairo/Cairo-Medium.ttf" },
  { family: "Cairo-SemiBold", style: "normal", path: "/fonts/cairo/Cairo-SemiBold.ttf" },
  { family: "Cairo-ExtraBold", style: "normal", path: "/fonts/cairo/Cairo-ExtraBold.ttf" },
  { family: "Cairo-Black", style: "normal", path: "/fonts/cairo/Cairo-Black.ttf" },
];

type FontCache = Map<string, string>; // path -> base64

let cache: FontCache | null = null;
let inFlight: Promise<void> | null = null;

/**
 * This module only ever runs in the browser (every caller is a "use client"
 * component), so a plain `btoa` pass is enough — no FileReader round-trip,
 * no Node fallback to carry around.
 */
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchFontBase64(path: string): Promise<string | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return bufferToBase64(buf);
  } catch {
    return null;
  }
}

async function loadAllFonts(): Promise<FontCache> {
  const next: FontCache = new Map();
  await Promise.all(
    FONT_FILES.map(async (f) => {
      const b64 = await fetchFontBase64(f.path);
      if (b64) next.set(f.path, b64);
    }),
  );
  return next;
}

/**
 * Fetches and caches every PDF webfont. Safe to call from multiple places
 * (e.g. on app mount and again right before an export) — concurrent calls
 * share one in-flight request, and once fonts are cached this resolves
 * immediately.
 */
export async function loadPdfFonts(): Promise<void> {
  if (cache) return;
  if (inFlight) return inFlight;
  inFlight = loadAllFonts()
    .then((result) => {
      cache = result;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function pdfFontsLoaded(): boolean {
  return cache !== null;
}

/**
 * Registers every cached font family/style into a jsPDF document.
 * Returns `true` if fonts were available to register, `false` if the
 * cache hasn't finished loading yet (caller falls back to core fonts).
 */
export function registerPdfFonts(doc: jsPDF): boolean {
  if (!cache) return false;
  let any = false;
  for (const f of FONT_FILES) {
    const b64 = cache.get(f.path);
    if (!b64) continue;
    const vfsName = f.path.split("/").pop() as string;
    doc.addFileToVFS(vfsName, b64);
    doc.addFont(vfsName, f.family, f.style);
    any = true;
  }
  return any;
}
