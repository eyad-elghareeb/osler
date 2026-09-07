"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Upload, Check, AlertTriangle, Loader2, FileArchive, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSync, SyncProtocol, type BackupPreview } from "@/lib/osler/sync";
import { buildExportPayload, mergePayloadIntoStorage } from "@/lib/osler/sync/sync-helpers";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";

export function FileSyncPanel() {
  const { t } = useI18n();
  const [importing, setImporting] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [fileResult, setFileResult] = React.useState<{ success: boolean; message: string } | null>(null);
  const [pendingImport, setPendingImport] = React.useState<{ file: File; preview: BackupPreview } | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setFileResult(null);
    try {
      const payload = await buildExportPayload();
      const wire = SyncProtocol.encode(payload);
      FileSync.downloadBackup(wire);
      haptic("success");
      setFileResult({ success: true, message: t("sync.file.success") });
    } catch (e) {
      haptic("error");
      setFileResult({ success: false, message: t("sync.file.exportFailed", { error: (e as Error).message }) });
    } finally {
      setExporting(false);
    }
  };

  const handlePickFile = async () => {
    setFileResult(null);
    try {
      const result = await FileSync.openFilePicker();
      if (!result) return;
      const preview = await FileSync.previewBackupFile(result);
      setPendingImport({ file: result, preview });
    } catch (e) {
      haptic("error");
      setFileResult({ success: false, message: t("sync.file.importFailed", { error: (e as Error).message }) });
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImport) return;
    setImporting(true);
    setPendingImport(null);
    try {
      const importResult = await FileSync.readBackupFile(pendingImport.file);
      if (!importResult.success || !importResult.payload) {
        haptic("error");
        setFileResult({ success: false, message: importResult.error ?? t("sync.file.unknownError") });
        return;
      }
      await mergePayloadIntoStorage(importResult.payload);
      haptic("success");
      setFileResult({ success: true, message: t("sync.file.imported", { name: importResult.payload.senderName }) });
    } catch (e) {
      haptic("error");
      setFileResult({ success: false, message: t("sync.file.importFailed", { error: (e as Error).message }) });
    } finally {
      setImporting(false);
    }
  };

  const handleCancelImport = () => {
    setPendingImport(null);
  };

  return (
    <div className="space-y-4">
      {/* Export */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Download className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold mb-1">{t("sync.file.exportTitle")}</h3>
            <p className="text-xs text-muted-foreground mb-3">
              {t("sync.file.exportDesc")}
            </p>
            <Button size="sm" variant="default" className="h-8 text-xs" onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <><Loader2 className="size-3 me-1.5 animate-spin" /> {t("sync.file.exporting")}</>
              ) : (
                <><Download className="size-3 me-1.5" /> {t("sync.file.exportButton")}</>
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* Import */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Upload className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold mb-1">{t("sync.file.importTitle")}</h3>
            <p className="text-xs text-muted-foreground mb-3">
              {t("sync.file.importDesc")}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={handlePickFile}
              disabled={importing || !!pendingImport}
            >
              <Upload className="size-3 me-1.5" /> {t("sync.file.importButton")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Import preview — mirror the P2P accept/decline gate so a malicious
          or accidentally-chosen file can't silently clobber local data. */}
      <AnimatePresence>
        {pendingImport && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <Card className="p-5 border-warning/40 bg-warning/5">
              <div className="flex items-start gap-4">
                <div className="size-10 rounded-lg flex items-center justify-center shrink-0 bg-warning/15 text-warning">
                  <FileArchive className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold mb-1">{t("sync.file.previewTitle")}</h3>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t("sync.file.previewFrom", {
                      name: pendingImport.preview.senderName,
                      date: new Date(pendingImport.preview.timestamp).toLocaleString(),
                    })}
                  </p>
                  <dl className="text-xs space-y-1 mb-3">
                    <PreviewRow label={t("sync.file.previewSize")} value={formatBytes(pendingImport.preview.sizeBytes)} />
                    <PreviewRow
                      label={t("sync.file.previewProgress")}
                      value={t("sync.file.previewN", { n: pendingImport.preview.progressCount })}
                    />
                    <PreviewRow
                      label={t("sync.file.previewSessions")}
                      value={t("sync.file.previewN", { n: pendingImport.preview.sessionsCount })}
                    />
                    <PreviewRow
                      label={t("sync.file.previewFlashcards")}
                      value={t("sync.file.previewN", { n: pendingImport.preview.flashcardsCount })}
                    />
                    <PreviewRow
                      label={t("sync.file.previewNotes")}
                      value={t("sync.file.previewN", { n: pendingImport.preview.notesCount })}
                    />
                    <PreviewRow
                      label={t("sync.file.previewAchievements")}
                      value={t("sync.file.previewN", { n: pendingImport.preview.achievementsCount })}
                    />
                    <PreviewRow
                      label={t("sync.file.previewHighlights")}
                      value={t("sync.file.previewN", { n: pendingImport.preview.articleHighlightsCount })}
                    />
                  </dl>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-8 text-xs"
                      onClick={() => {
                        haptic("success");
                        handleConfirmImport();
                      }}
                      disabled={importing}
                    >
                      <Check className="size-3 me-1.5" /> {t("sync.file.confirmImport")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => {
                        haptic("light");
                        handleCancelImport();
                      }}
                      disabled={importing}
                    >
                      <X className="size-3 me-1.5" /> {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result toast */}
      {fileResult && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "flex items-center gap-2 text-xs p-3 rounded-lg border",
            fileResult.success
              ? "bg-success-soft border-success/30 text-success"
              : "bg-destructive/10 border-destructive/30 text-destructive",
          )}
        >
          {fileResult.success ? <Check className="size-3.5 shrink-0" /> : <AlertTriangle className="size-3.5 shrink-0" />}
          <span>{fileResult.message}</span>
          <button onClick={() => setFileResult(null)} className="ms-auto text-muted-foreground hover:text-foreground" aria-label={t("common.cancel")}>
            <X className="size-3" />
          </button>
        </motion.div>
      )}
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
