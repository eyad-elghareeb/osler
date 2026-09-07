/**
 * FileSync — file-based backup and restore for Osler data.
 *
 * Exports: Downloads a `.osler-backup` file containing the wire-format
 *   encoded progress data.
 * Imports: Reads a backup file and returns the decoded wire data for
 *   the caller to merge into IndexedDB.
 */

import * as SyncProtocol from "./sync-protocol";

export type ImportMode = "merge" | "replace";

export interface ImportResult {
  success: boolean;
  payload?: SyncProtocol.SyncPayload;
  error?: string;
}

/**
 * Download a backup file with the given wire data.
 */
export function downloadBackup(wireData: string, filename?: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([wireData], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().split("T")[0];
  a.href = url;
  a.download = filename ?? `Osler_Backup_${date}.osler-backup`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read a File object and return the decoded sync data.
 * Caller is responsible for merging the data into storage.
 */
export function readBackupFile(file: File): Promise<ImportResult> {
  // Hard cap on file size — a 25 MB compressed backup decodes to roughly
  // 100 MB of JSON, which is plenty for a multi-year history of progress,
  // notes, and flashcards. Anything bigger is rejected before the read so
  // we never buffer a malicious or corrupted file into memory.
  const MAX_BYTES = 25 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return Promise.resolve({
      success: false,
      error: `Backup file too large: ${(file.size / 1048576).toFixed(1)} MB (max ${MAX_BYTES / 1048576} MB)`,
    });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content) {
        resolve({ success: false, error: "Failed to read file" });
        return;
      }
      try {
        const payload = SyncProtocol.decode(content);
        resolve({ success: true, payload });
      } catch (err) {
        resolve({ success: false, error: (err as Error).message });
      }
    };
    reader.onerror = () => {
      resolve({ success: false, error: "Failed to read file" });
    };
    reader.readAsText(file);
  });
}

/** Lightweight metadata read of a backup file — sender + counts only — so the
 *  UI can show a confirmation card before the caller commits to merging. */
export interface BackupPreview {
  senderName: string;
  timestamp: number;
  sizeBytes: number;
  progressCount: number;
  sessionsCount: number;
  flashcardsCount: number;
  notesCount: number;
  achievementsCount: number;
  articleHighlightsCount: number;
}

export async function previewBackupFile(file: File): Promise<BackupPreview> {
  const MAX_BYTES = 25 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    throw new Error(`Backup file too large: ${(file.size / 1048576).toFixed(1)} MB`);
  }
  const content = await file.text();
  const payload = SyncProtocol.decode(content);
  const data = (payload.data ?? {}) as Record<string, unknown>;
  let progressCount = 0;
  let sessionsCount = 0;
  let flashcardsCount = 0;
  let notesCount = 0;
  let achievementsCount = 0;
  let articleHighlightsCount = 0;
  for (const key of Object.keys(data)) {
    if (key === "osler_raw_progress") {
      progressCount = Object.keys((data[key] as Record<string, unknown>) ?? {}).length;
    } else if (key.startsWith("osler_progress_")) {
      progressCount++;
    } else if (key.startsWith("osler_sessions_")) {
      sessionsCount++;
    } else if (key === "osler_flashcard_reviews") {
      flashcardsCount = Object.keys((data[key] as Record<string, unknown>) ?? {}).length;
    } else if (key === "osler_notes") {
      notesCount = Array.isArray(data[key]) ? (data[key] as unknown[]).length : 0;
    } else if (key === "osler_achievements") {
      achievementsCount = Object.keys((data[key] as Record<string, unknown>) ?? {}).length;
    } else if (key.startsWith("osler_article_highlights_")) {
      articleHighlightsCount++;
    }
  }
  return {
    senderName: payload.senderName || "Unknown",
    timestamp: payload.timestamp,
    sizeBytes: file.size,
    progressCount,
    sessionsCount,
    flashcardsCount,
    notesCount,
    achievementsCount,
    articleHighlightsCount,
  };
}

/**
 * Create a file input element, trigger it, and return a promise
 * that resolves with the selected File.
 */
export function openFilePicker(accept?: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept ?? ".osler-backup,.txt,.json";
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
    };
    input.click();
  });
}
