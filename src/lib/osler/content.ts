/**
 * Osler content loader — fetches manifest + content packs from /public/osler-content/.
 * Mirrors Osler's src/lib/content-loader.js but typed and React-friendly.
 */

import type {
  AnyContent,
  BankContent,
  EngineType,
  FlashcardContent,
  Manifest,
  ManifestItem,
  OsceContent,
  QuizContent,
  WrittenContent,
} from "./types";

const BASE = "/osler-content";

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(`${BASE}/manifest.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
  return (await res.json()) as Manifest;
}

export async function loadContentByUid(uid: string): Promise<AnyContent> {
  const manifest = await loadManifest();
  const item = manifest.items.find((i) => i.uid === uid);
  if (!item) throw new Error(`Content not found: ${uid}`);
  return loadContent(item);
}

export async function loadContent(item: ManifestItem): Promise<AnyContent> {
  const res = await fetch(`${BASE}/${item.path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${item.path}: ${res.status}`);
  return (await res.json()) as AnyContent;
}

export async function loadAllContent(): Promise<{
  manifest: Manifest;
  items: Array<{ item: ManifestItem; content: AnyContent | null }>;
}> {
  const manifest = await loadManifest();
  const items = await Promise.all(
    manifest.items.map(async (item) => {
      try {
        const content = await loadContent(item);
        return { item, content };
      } catch (e) {
        console.warn(`Failed to load ${item.path}:`, e);
        return { item, content: null };
      }
    })
  );
  return { manifest, items };
}

/* ── Type guards ────────────────────────────────────────────────────── */
export function isQuiz(c: AnyContent): c is QuizContent {
  return c.type === "quiz";
}
export function isBank(c: AnyContent): c is BankContent {
  return c.type === "bank";
}
export function isFlashcard(c: AnyContent): c is FlashcardContent {
  return c.type === "flashcard";
}
export function isWritten(c: AnyContent): c is WrittenContent {
  return c.type === "written";
}
export function isOsce(c: AnyContent): c is OsceContent {
  return c.type === "osce";
}

/* ── Engine metadata helpers ────────────────────────────────────────── */
export const ENGINE_META: Record<
  EngineType,
  { label: string; singular: string; color: string; icon: string }
> = {
  quiz: { label: "Quiz", singular: "Quiz", color: "oklch(0.62 0.16 250)", icon: "clipboard" },
  bank: {
    label: "Question Bank",
    singular: "Bank",
    color: "oklch(0.58 0.14 245)",
    icon: "book",
  },
  flashcard: {
    label: "Flashcards",
    singular: "Deck",
    color: "oklch(0.7 0.18 145)",
    icon: "layers",
  },
  written: {
    label: "Written",
    singular: "Set",
    color: "oklch(0.78 0.16 80)",
    icon: "pen-tool",
  },
  osce: { label: "OSCE", singular: "OSCE", color: "oklch(0.7 0.2 16)", icon: "activity" },
};
