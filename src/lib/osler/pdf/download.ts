/**
 * Download helper — filename sanitization (script-preserving) + save.
 */
import type { jsPDF } from "jspdf";

/** Sanitize a filename while preserving non-Latin scripts (Arabic titles
 *  previously collapsed to "export.pdf"). Strips filesystem-hostile
 *  characters only; falls back to "export" when nothing printable remains. */
function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "export";
}

export function downloadPdf(doc: jsPDF, filename: string): void {
  doc.save(`${safeFilename(filename)}.pdf`);
}

