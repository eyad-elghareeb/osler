import { storage } from "@/lib/osler/storage";
import type { SyncPayload } from "./sync-protocol";

export async function buildExportPayload(): Promise<SyncPayload> {
  await storage.ensureCacheHydrated();
  const allProgress = storage.allProgress();
  const sessions = await import("@/lib/osler/storage").then((m) => m.sessions.list());
  const flashcards = (await import("@/lib/osler/storage")).flashcardReview.getAll();
  const notes = (await import("@/lib/osler/storage")).notes.listSync();

  const data: Record<string, unknown> = {};

  // Aggregate progress (for previews)
  for (const p of allProgress) {
    data[`osler_progress_${p.uid}`] = p;
  }

  // Full individual question records (for actual import)
  data["osler_raw_progress"] = storage.exportProgressRecords();

  // Sessions, flashcards, notes
  for (const s of sessions) {
    data[`osler_sessions_${s.id}`] = s;
  }
  if (Object.keys(flashcards).length > 0) {
    data["osler_flashcard_reviews"] = flashcards;
  }
  if (notes.length > 0) {
    data["osler_notes"] = notes;
  }

  // Article highlights (per-article keys)
  const articleHighlights = storage.exportArticleHighlights();
  for (const [articleId, items] of Object.entries(articleHighlights)) {
    data[`osler_article_highlights_${articleId}`] = items;
  }

  return {
    timestamp: Date.now(),
    senderName: typeof window !== "undefined"
      ? localStorage.getItem("osler_sync_device_name") ?? "Osler User"
      : "Osler User",
    data,
  };
}

export async function mergePayloadIntoStorage(payload: SyncPayload): Promise<void> {
  await storage.importData(payload.data);
}
