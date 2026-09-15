/**
 * EPUB highlight persistence.
 *
 * Highlights live in the synced settings store under
 * `epub-highlights:<fileKey>` — the same tier as the reading position
 * (`epub-progress:<fileKey>`), so a book's highlights travel with the user's
 * data, exports, and cross-device sync without a schema change. Payloads are
 * treated as untrusted (they can arrive from another device), so every read
 * is validated and capped before it reaches the rendition.
 */

import { settings } from "@/lib/osler/storage";
import { isHighlightColorKey } from "@/lib/osler/highlight-palette";
import {
  EPUB_HIGHLIGHT_LIMIT,
  EPUB_HIGHLIGHTS_PREFIX,
  EPUB_HIGHLIGHT_TEXT_LIMIT,
  EPUB_PROGRESS_PREFIX,
} from "./tokens";
import type { EpubHighlight } from "./types";

/** Reading-position key for a book (`fileKey` is the article file path). */
export function epubProgressKey(fileKey: string): string {
  return `${EPUB_PROGRESS_PREFIX}${fileKey}`;
}

function highlightsKey(fileKey: string): string {
  return `${EPUB_HIGHLIGHTS_PREFIX}${fileKey}`;
}

function newHighlightId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Insecure context — fall through to the timestamp id.
  }
  return `hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Validate one stored record (synced payloads are untrusted). */
function readHighlight(value: unknown): EpubHighlight | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const cfi = typeof raw.cfi === "string" ? raw.cfi : "";
  const id = typeof raw.id === "string" && raw.id ? raw.id : "";
  const color = typeof raw.color === "string" ? raw.color : "";
  if (!cfi || !id) return null;
  // A color is either a palette key or a legacy hex value.
  if (!isHighlightColorKey(color) && !/^#[0-9a-fA-F]{3,8}$/.test(color)) return null;
  return {
    id,
    cfi,
    color,
    text: (typeof raw.text === "string" ? raw.text : "").slice(0, EPUB_HIGHLIGHT_TEXT_LIMIT),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
  };
}

/** Parse a stored payload into a safe, capped highlight list. */
export function parseEpubHighlights(raw: string | null): EpubHighlight[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: EpubHighlight[] = [];
    for (const entry of parsed) {
      if (out.length >= EPUB_HIGHLIGHT_LIMIT) break;
      const item = readHighlight(entry);
      if (item) out.push(item);
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadEpubHighlights(fileKey: string): Promise<EpubHighlight[]> {
  if (!fileKey) return [];
  try {
    return parseEpubHighlights(await settings.get(highlightsKey(fileKey)));
  } catch {
    return [];
  }
}

export async function saveEpubHighlights(fileKey: string, items: EpubHighlight[]): Promise<void> {
  if (!fileKey) return;
  await settings.set(highlightsKey(fileKey), JSON.stringify(items.slice(0, EPUB_HIGHLIGHT_LIMIT)));
}

export function createEpubHighlight(input: { cfi: string; text: string; color: string }): EpubHighlight {
  return {
    id: newHighlightId(),
    cfi: input.cfi,
    text: input.text.slice(0, EPUB_HIGHLIGHT_TEXT_LIMIT),
    color: input.color,
    createdAt: new Date().toISOString(),
  };
}

/** Append a highlight (replacing any existing one on the same CFI range). */
export function upsertEpubHighlight(items: EpubHighlight[], next: EpubHighlight): EpubHighlight[] {
  return [...items.filter((item) => item.cfi !== next.cfi), next].slice(-EPUB_HIGHLIGHT_LIMIT);
}

export function dropEpubHighlight(items: EpubHighlight[], cfi: string): EpubHighlight[] {
  return items.filter((item) => item.cfi !== cfi);
}