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
