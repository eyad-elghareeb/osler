/**
 * Font resolution — the font-family map and the logic that swaps in
 * registered webfonts (with core-font fallback) for a document.
 */
import type { jsPDF } from "jspdf";

export const F = {
  H: "helvetica", // heading bold
  Hn: "helvetica", // heading normal
  Hm: "helvetica", // heading medium
  Hl: "helvetica", // heading light
  B: "times", // body normal (serif)
  Bi: "times", // body italic
  Bb: "helvetica", // body emphasis (sans, used inline within serif body)
  // Arabic font variants — filled by resolveFonts() when Cairo weights are registered
  Ar: "Cairo", // arabic body normal (style: "bold" for bold)
  Arm: "Cairo", // arabic medium/emphasis (Cairo-Medium when available)
};

export function resolveFonts(doc: jsPDF, fontType: "serif" | "sans" = "serif"): void {
  const fl = doc.getFontList();
  if (fl.Poppins) {
    F.H = "Poppins";
    F.Hn = "Poppins";
    F.Hm = fl["Poppins-Medium"] ? "Poppins-Medium" : "Poppins";
    F.Hl = fl["Poppins-Light"] ? "Poppins-Light" : "Poppins";
    F.Bb = fl["Poppins-Medium"] ? "Poppins-Medium" : "Poppins";
  }
  if (fontType === "sans") {
    F.B = fl.Poppins ? "Poppins" : "helvetica";
    F.Bi = fl.Poppins ? "Poppins" : "helvetica";
  } else {
    if (fl.Lora) {
      F.B = "Lora";
      F.Bi = "Lora";
    } else {
      F.B = "times";
      F.Bi = "times";
    }
  }
  // Cairo Arabic weight variants — maps to F.Ar / F.Arm
  if (fl.Cairo) {
    F.Ar = "Cairo";
    F.Arm = fl["Cairo-Medium"] ? "Cairo-Medium" : "Cairo";
  }
}

export function hs(style: string): string {
  if (style === "bold") return "bold";
  if (style === "italic") return "italic";
  if (style === "bolditalic") return "bolditalic";
  return "normal";
}

