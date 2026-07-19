import type { jsPDF } from "jspdf";

interface FontCache {
  [key: string]: string;
}

let cache: FontCache | null = null;

const FONT_PATHS = {
  "Poppins-Regular.ttf": "/fonts/poppins/Poppins-Regular.ttf",
  "Poppins-Bold.ttf": "/fonts/poppins/Poppins-Bold.ttf",
  "Poppins-Italic.ttf": "/fonts/poppins/Poppins-Italic.ttf",
  "Poppins-BoldItalic.ttf": "/fonts/poppins/Poppins-BoldItalic.ttf",
  "Poppins-Medium.ttf": "/fonts/poppins/Poppins-Medium.ttf",
  "Poppins-Light.ttf": "/fonts/poppins/Poppins-Light.ttf",
  "Poppins-LightItalic.ttf": "/fonts/poppins/Poppins-LightItalic.ttf",
  "Cairo-Regular.ttf": "/fonts/cairo/Cairo-Regular.ttf",
  "Cairo-Bold.ttf": "/fonts/cairo/Cairo-Bold.ttf",
};

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result as string;
      resolve(data.split(",")[1]);
    };
    reader.onerror = () => reject(new Error("Failed to read font blob"));
    reader.readAsDataURL(blob);
  });
}

async function loadAllFonts(): Promise<FontCache> {
  const c: FontCache = {};
  const entries = Object.entries(FONT_PATHS);
  const results = await Promise.allSettled(
    entries.map(async ([name, path]) => {
      c[name] = await fetchBase64(path);
    })
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) console.warn(`[pdf] ${failed}/${entries.length} fonts failed to load`);
  return c;
}

export async function loadPdfFonts(): Promise<void> {
  if (cache) return;
  cache = await loadAllFonts();
}

export function registerPdfFonts(doc: jsPDF): boolean {
  if (!cache) return false;
  try {
    if (cache["Poppins-Regular.ttf"]) {
      doc.addFileToVFS("Poppins-Regular.ttf", cache["Poppins-Regular.ttf"]);
      doc.addFont("Poppins-Regular.ttf", "Poppins", "normal");
    }
    if (cache["Poppins-Bold.ttf"]) {
      doc.addFileToVFS("Poppins-Bold.ttf", cache["Poppins-Bold.ttf"]);
      doc.addFont("Poppins-Bold.ttf", "Poppins", "bold");
    }
    if (cache["Poppins-Italic.ttf"]) {
      doc.addFileToVFS("Poppins-Italic.ttf", cache["Poppins-Italic.ttf"]);
      doc.addFont("Poppins-Italic.ttf", "Poppins", "italic");
    }
    if (cache["Poppins-BoldItalic.ttf"]) {
      doc.addFileToVFS("Poppins-BoldItalic.ttf", cache["Poppins-BoldItalic.ttf"]);
      doc.addFont("Poppins-BoldItalic.ttf", "Poppins", "bolditalic");
    }
    if (cache["Poppins-Medium.ttf"]) {
      doc.addFileToVFS("Poppins-Medium.ttf", cache["Poppins-Medium.ttf"]);
      doc.addFont("Poppins-Medium.ttf", "Poppins-Medium", "normal");
    }
    if (cache["Poppins-Light.ttf"]) {
      doc.addFileToVFS("Poppins-Light.ttf", cache["Poppins-Light.ttf"]);
      doc.addFont("Poppins-Light.ttf", "Poppins-Light", "normal");
    }
    if (cache["Poppins-LightItalic.ttf"]) {
      doc.addFileToVFS("Poppins-LightItalic.ttf", cache["Poppins-LightItalic.ttf"]);
      doc.addFont("Poppins-LightItalic.ttf", "Poppins-Light", "italic");
    }
    if (cache["Cairo-Regular.ttf"]) {
      doc.addFileToVFS("Cairo-Regular.ttf", cache["Cairo-Regular.ttf"]);
      doc.addFont("Cairo-Regular.ttf", "Cairo", "normal");
    }
    if (cache["Cairo-Bold.ttf"]) {
      doc.addFileToVFS("Cairo-Bold.ttf", cache["Cairo-Bold.ttf"]);
      doc.addFont("Cairo-Bold.ttf", "Cairo", "bold");
    }
    return true;
  } catch {
    return false;
  }
}

export function pdfFontsLoaded(): boolean {
  return cache !== null;
}
