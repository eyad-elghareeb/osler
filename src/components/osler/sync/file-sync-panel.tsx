"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Download, Upload, FileText, Check, AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSync, SyncProtocol } from "@/lib/osler/sync";
import { buildExportPayload, mergePayloadIntoStorage } from "@/lib/osler/sync/sync-helpers";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";

export function FileSyncPanel() {
  const { t } = useI18n();
  const [importing, setImporting] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [fileResult, setFileResult] = React.useState<{ success: boolean; message: string } | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setFileResult(null);
    try {
      const payload = await buildExportPayload();
      const wire = SyncProtocol.encode(payload);
      FileSync.downloadBackup(wire);
      setFileResult({ success: true, message: t("sync.file.success") });
    } catch (e) {
      setFileResult({ success: false, message: t("sync.file.exportFailed", { error: (e as Error).message }) });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setFileResult(null);
    try {
      const result = await FileSync.openFilePicker();
      if (!result) {
        setImporting(false);
        return;
      }
      const importResult = await FileSync.readBackupFile(result);
      if (!importResult.success) {
        setFileResult({ success: false, message: importResult.error ?? t("sync.file.unknownError") });
        setImporting(false);
        return;
      }
      if (importResult.payload) {
        await mergePayloadIntoStorage(importResult.payload);
        setFileResult({ success: true, message: t("sync.file.imported", { name: importResult.payload.senderName }) });
      }
    } catch (e) {
      setFileResult({ success: false, message: t("sync.file.importFailed", { error: (e as Error).message }) });
    } finally {
      setImporting(false);
    }
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
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleImport} disabled={importing}>
              {importing ? (
                <><Loader2 className="size-3 me-1.5 animate-spin" /> {t("sync.file.reading")}</>
              ) : (
                <><Upload className="size-3 me-1.5" /> {t("sync.file.importButton")}</>
              )}
            </Button>
          </div>
        </div>
      </Card>

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
          <button onClick={() => setFileResult(null)} className="ms-auto text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </motion.div>
      )}
    </div>
  );
}


