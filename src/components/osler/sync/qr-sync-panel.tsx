"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Camera, QrCode, Smartphone, Check, AlertTriangle, Loader2, SwitchCamera, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SyncProtocol, QRSync } from "@/lib/osler/sync";
import { storage } from "@/lib/osler/storage";
import { cn } from "@/lib/utils";

export function QrSyncPanel() {
  const [tab, setTab] = React.useState<"export" | "scan">("export");
  const [qrChunks, setQrChunks] = React.useState<QRSync.QrChunkData[]>([]);
  const [qrPage, setQrPage] = React.useState(0);
  const [qrDataUrls, setQrDataUrls] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [scanning, setScanning] = React.useState(false);
  const [scanResult, setScanResult] = React.useState<{ success: boolean; message: string } | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const scannerRef = React.useRef<QRSync.CameraScanner | null>(null);

  // Generate QR codes on mount and when tab switches to export
  React.useEffect(() => {
    if (tab === "export") {
      generateQrCodes();
    }
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [tab]);

  const generateQrCodes = async () => {
    setLoading(true);
    try {
      const payload = await buildExportPayload();
      const wire = SyncProtocol.encode(payload);
      const chunks = QRSync.getQrChunks(wire);
      setQrChunks(chunks);

      const urls = await Promise.all(
        chunks.map((chunk) => QRSync.generateQrDataUrl(chunk.text)),
      );
      setQrDataUrls(urls);
      setQrPage(0);
    } catch (e) {
      setScanResult({ success: false, message: `QR generation failed: ${(e as Error).message}` });
    } finally {
      setLoading(false);
    }
  };

  const handleStartScan = async () => {
    if (!videoRef.current) return;
    setScanning(true);
    setScanResult(null);

    const scanner = new QRSync.CameraScanner(
      async (result) => {
        try {
          const payload = SyncProtocol.decode(result.fullData);
          await mergePayloadIntoStorage(payload);
          setScanResult({ success: true, message: "Sync complete! Data merged." });
          scanner.stop().catch(() => {});
          setScanning(false);
        } catch (e) {
          setScanResult({ success: false, message: `Import failed: ${(e as Error).message}` });
        }
      },
      (error) => {
        setScanResult({ success: false, message: error });
      },
    );

    scannerRef.current = scanner;
    try {
      await scanner.start(videoRef.current);
    } catch (e) {
      setScanResult({ success: false, message: `Camera error: ${(e as Error).message}` });
      setScanning(false);
    }
  };

  const handleStopScan = async () => {
    if (scannerRef.current) {
      await scannerRef.current.stop();
      scannerRef.current = null;
    }
    setScanning(false);
  };

  const handleSwitchCamera = async () => {
    if (scannerRef.current && videoRef.current) {
      const currentFacing = scannerRef.current["active"] ? "environment" : "user";
      const nextFacing = currentFacing === "environment" ? "user" : "environment";
      await scannerRef.current.stop();
      scannerRef.current = new QRSync.CameraScanner(
        (result) => {
          try {
            const payload = SyncProtocol.decode(result.fullData);
            mergePayloadIntoStorage(payload);
            setScanResult({ success: true, message: "Sync complete! Data merged." });
            scannerRef.current?.stop().catch(() => {});
            setScanning(false);
          } catch (e) {
            setScanResult({ success: false, message: `Import failed: ${(e as Error).message}` });
          }
        },
        (error) => setScanResult({ success: false, message: error }),
      );
      scannerRef.current.start(videoRef.current, { facingMode: nextFacing as "user" | "environment" }).catch(() => {});
    }
  };

  return (
    <div className="space-y-4">
      {/* Tab toggle */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={tab === "export" ? "default" : "outline"}
          className="h-8 text-xs"
          onClick={() => setTab("export")}
        >
          <QrCode className="size-3 me-1.5" /> Show My Code
        </Button>
        <Button
          size="sm"
          variant={tab === "scan" ? "default" : "outline"}
          className="h-8 text-xs"
          onClick={() => setTab("scan")}
        >
          <Camera className="size-3 me-1.5" /> Scan Code
        </Button>
      </div>

      {tab === "export" && (
        <Card className="p-5">
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-4">
              Scan this QR code from another device to sync your progress.
              {qrChunks.length > 1 && " This is a multi-part code — scan all parts."}
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-8 animate-spin text-primary" />
              </div>
            ) : qrDataUrls.length > 0 ? (
              <>
                <div className="inline-block p-3 bg-white rounded-xl mb-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrls[qrPage] || "/placeholder.svg"}
                    alt={`QR code ${qrPage + 1} of ${qrDataUrls.length}`}
                    className="size-48 mx-auto"
                  />
                </div>

                {qrChunks.length > 1 && (
                  <div className="flex items-center justify-center gap-3 mb-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => setQrPage((p) => Math.max(0, p - 1))}
                      disabled={qrPage === 0}
                    >
                      <ChevronLeft className="size-3" />
                    </Button>
                    <span className="text-xs font-medium text-muted-foreground">
                      {qrPage + 1} / {qrChunks.length}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => setQrPage((p) => Math.min(qrChunks.length - 1, p + 1))}
                      disabled={qrPage >= qrChunks.length - 1}
                    >
                      <ChevronRight className="size-3" />
                    </Button>
                  </div>
                )}

                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={generateQrCodes}>
                  <RefreshCwIcon className="size-3 me-1.5" /> Regenerate
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-8">No data to share.</p>
            )}
          </div>
        </Card>
      )}

      {tab === "scan" && (
        <Card className="p-5">
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-4">
              Point your camera at the QR code on the other device.
            </p>

            {/* Camera viewport */}
            <div className="relative mx-auto max-w-xs rounded-xl overflow-hidden border border-border bg-black/5 mb-4">
              <video
                ref={videoRef}
                className="w-full aspect-[4/3] object-cover"
                playsInline
                muted
              />
              {!scanning && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
                  <Camera className="size-8 text-muted-foreground/50" />
                </div>
              )}
            </div>

            <div className="flex justify-center gap-2">
              {!scanning ? (
                <Button size="sm" variant="default" className="h-8 text-xs" onClick={handleStartScan}>
                  <Camera className="size-3 me-1.5" /> Start Scanning
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleStopScan}>
                    <Loader2 className="size-3 me-1.5 animate-spin" /> Stop
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={handleSwitchCamera}>
                    <SwitchCamera className="size-3 me-1.5" /> Switch
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Result */}
          {scanResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex items-center gap-2 text-xs p-3 rounded-lg border mt-4",
                scanResult.success
                  ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
                  : "bg-destructive/10 border-destructive/30 text-destructive",
              )}
            >
              {scanResult.success ? <Check className="size-3.5 shrink-0" /> : <AlertTriangle className="size-3.5 shrink-0" />}
              <span>{scanResult.message}</span>
              <button onClick={() => setScanResult(null)} className="ms-auto text-muted-foreground hover:text-foreground">
                ✕
              </button>
            </motion.div>
          )}
        </Card>
      )}
    </div>
  );
}

function RefreshCwIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 12a9 9 0 1 1-9-9" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

/* ── Data helpers ───────────────────────────────────────────────────── */

async function buildExportPayload(): Promise<SyncProtocol.SyncPayload> {
  const allProgress = storage.allProgress();
  const data: Record<string, unknown> = {};
  for (const p of allProgress) {
    data[`osler_progress_${p.uid}`] = p;
  }
  return {
    timestamp: Date.now(),
    senderName: typeof window !== "undefined" ? localStorage.getItem("osler_sync_device_name") ?? "Osler User" : "Osler User",
    data,
  };
}

async function mergePayloadIntoStorage(payload: SyncProtocol.SyncPayload): Promise<void> {
  for (const [key, value] of Object.entries(payload.data)) {
    if (key.startsWith("osler_progress_")) {
      const entry = value as { uid: string; attempted: number; correct: number };
      const stats = storage.packProgress(entry.uid);
      if (entry.attempted > stats.attempted) {
        const diff = entry.attempted - stats.attempted;
        for (let i = 0; i < diff; i++) {
          storage.recordAnswer(entry.uid, `qr-sync-${i}-${Date.now()}`, "quiz", undefined, false, false);
        }
      }
    }
  }
}
