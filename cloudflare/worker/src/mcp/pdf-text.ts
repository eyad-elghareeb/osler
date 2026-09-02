/**
 * MCP PDF text extraction (serverless).
 *
 * Uses `unpdf` (serverless PDF.js build) — lazy-imported so the MCP bundle's
 * startup cost only pays for it when a parse tool actually runs. Input is a
 * base64 or data-URI PDF carried in the tool arguments; arbitrary URL
 * fetching is deliberately NOT supported (SSRF surface on the worker).
 */

/** Decoded-PDF hard cap. Base64 inflates by 4/3, so ~27 MB of arguments. */
const MAX_PDF_BYTES = 20_000_000;

export function decodePdfInput(raw: string): Uint8Array {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("pdfDataUri is required (data:application/pdf;base64,… or raw base64)");
  const b64 = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  const clean = b64.replace(/\s+/g, "");
  let binary: string;
  try {
    binary = atob(clean);
  } catch {
    throw new Error("Invalid base64 PDF payload");
  }
  if (binary.length > MAX_PDF_BYTES) {
    throw new Error(`PDF too large (${(binary.length / 1e6).toFixed(1)} MB) — limit is ${MAX_PDF_BYTES / 1e6} MB`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // Cheap header check — a wrong payload should fail fast with a clear
  // message instead of a cryptic PDF.js parse error.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw new Error("Payload does not look like a PDF (missing %PDF- header)");
  }
  return bytes;
}

export interface PdfPages {
  pageCount: number;
  /** Per-page text; index 0 = page 1. */
  pages: string[];
  truncated: boolean;
}

/** Extract text per page. Throws with an agent-readable message on failure. */
export async function extractPdfPages(bytes: Uint8Array, maxPages: number): Promise<PdfPages> {
  let pdfjs: typeof import("unpdf");
  try {
    pdfjs = await import("unpdf");
  } catch {
    throw new Error("PDF engine failed to load — retry the request");
  }
  let pdf: unknown;
  try {
    pdf = await pdfjs.getDocumentProxy(bytes);
  } catch {
    throw new Error("Could not open the PDF — it may be corrupt, encrypted, or password-protected");
  }
  const result = await pdfjs.extractText(pdf as never, { mergePages: false });
  const all = Array.isArray(result.text) ? result.text : [String(result.text ?? "")];
  const capped = all.slice(0, Math.max(1, maxPages));
  return { pageCount: result.totalPages ?? all.length, pages: capped, truncated: all.length > capped.length };
}

/** Joins pages with page markers so downstream heuristics and the agent both see provenance. */
export function joinPages(pages: string[]): string {
  return pages.map((text, i) => `\f=== Page ${i + 1} ===\n${text}`).join("\n");
}
