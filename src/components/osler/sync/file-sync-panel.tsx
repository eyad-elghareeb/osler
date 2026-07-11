"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Download, Upload, FileText, Check, AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSync, SyncProtocol } from "@/lib/osler/sync";
import { buildExportPayload, mergePayloadIntoStorage } from "@/lib/osler/sync/sync-helpers";
import { cn } from "@/lib/utils";

export function FileSyncPanel() {
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
      setFileResult({ success: true, message: "Backup downloaded successfully" });
    } catch (e) {
      setFileResult({ success: false, message: `Export failed: ${(e as Error).message}` });
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
        setFileResult({ success: false, message: importResult.error ?? "Unknown error" });
        setImporting(false);
        return;
      }
      if (importResult.payload) {
        await mergePayloadIntoStorage(importResult.payload);
        setFileResult({ success: true, message: `Restored from backup: ${importResult.payload.senderName}` });
      }
    } catch (e) {
      setFileResult({ success: false, message: `Import failed: ${(e as Error).message}` });
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
            <h3 className="text-sm font-semibold mb-1">Backup Progress</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Download all your progress data to a secure file. Use this file to restore your data on another device or after a reset.
            </p>
            <Button size="sm" variant="default" className="h-8 text-xs" onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <><Loader2 className="size-3 me-1.5 animate-spin" /> Exporting...</>
              ) : (
                <><Download className="size-3 me-1.5" /> Download Backup</>
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
            <h3 className="text-sm font-semibold mb-1">Restore Progress</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Select a backup file to restore your progress. Data will be merged with existing records.
            </p>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleImport} disabled={importing}>
              {importing ? (
                <><Loader2 className="size-3 me-1.5 animate-spin" /> Reading file...</>
              ) : (
                <><Upload className="size-3 me-1.5" /> Select Backup File</>
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
              ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
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


