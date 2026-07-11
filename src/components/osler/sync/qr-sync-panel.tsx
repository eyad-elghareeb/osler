"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  QrCode,
  ScanLine,
  Check,
  AlertTriangle,
  Loader2,
  SwitchCamera,
  X,
  RefreshCw,
  Link2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QRSync, type NetworkTransport } from "@/lib/osler/sync";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";

/**
 * PeerLinkQrPanel — small, embeddable panel that:
 *  - renders a single QR encoding the local device's PeerJS link
 *    (osler-peer:<peerId>:<deviceName>)
 *  - exposes a compact "Scan" button that opens the camera and connects
 *    to a remote device whose QR is scanned.
 *
 * This panel is meant to live inline on the network sync page (no separate
 * tab). The QR is only used to *link* two PeerJS peers; the actual data
 * transfer happens over the PeerJS data channel after the connection is
 * established.
 */
export function PeerLinkQrPanel({
  transport,
  peerId,
  deviceName,
  onConnected,
}: {
  transport: NetworkTransport | null;
  peerId: string;
  deviceName: string;
  onConnected?: (peerId: string, label: string) => void;
}) {
  const { t } = useI18n();
  const [qrUrl, setQrUrl] = React.useState<string>("");
  const [scanning, setScanning] = React.useState(false);
  const [scanResult, setScanResult] = React.useState<{ success: boolean; message: string } | null>(null);
  const [facingMode, setFacingMode] = React.useState<"user" | "environment">("environment");

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const scannerRef = React.useRef<QRSync.CameraScanner | null>(null);

  // (Re)generate the QR whenever peerId or deviceName changes.
  React.useEffect(() => {
    let cancelled = false;
    if (!peerId) {
      setQrUrl("");
      return;
    }
    const link = QRSync.buildPeerLink(peerId, deviceName || "Osler Device");
    QRSync.generateQrDataUrl(link, { width: 240, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [peerId, deviceName]);

  // Cleanup scanner on unmount.
  React.useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  const handleStartScan = async () => {
    if (!videoRef.current || !transport) return;
    setScanning(true);
    setScanResult(null);

    const scanner = new QRSync.CameraScanner(
      (text) => {
        const link = QRSync.parsePeerLink(text);
        if (!link) {
          setScanResult({
            success: false,
            message: t("sync.qr.notPeerCode"),
          });
          return;
        }
        setScanResult({
          success: true,
          message: t("sync.qr.connectingTo", { name: link.deviceName }),
        });
        transport.connectTo(link.peerId, link.deviceName);
        onConnected?.(link.peerId, link.deviceName);
        // Stop the scanner after a successful scan — connection is now in
        // the hands of the NetworkTransport.
        scannerRef.current?.stop().catch(() => {});
        scannerRef.current = null;
        setScanning(false);
      },
      (error) => {
        setScanResult({ success: false, message: error });
      },
    );

    scannerRef.current = scanner;
    try {
      await scanner.start(videoRef.current, { facingMode });
    } catch (e) {
      setScanResult({
        success: false,
        message: t("sync.qr.cameraError", { error: (e as Error).message }),
      });
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
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    if (scanning && scannerRef.current && videoRef.current) {
      await scannerRef.current.stop();
      scannerRef.current = new QRSync.CameraScanner(
        (text) => {
          const link = QRSync.parsePeerLink(text);
          if (!link) {
            setScanResult({ success: false, message: t("sync.qr.notPeerCode") });
            return;
          }
          setScanResult({
            success: true,
            message: t("sync.qr.connectingTo", { name: link.deviceName }),
          });
          transport?.connectTo(link.peerId, link.deviceName);
          onConnected?.(link.peerId, link.deviceName);
          scannerRef.current?.stop().catch(() => {});
          scannerRef.current = null;
          setScanning(false);
        },
        (error) => setScanResult({ success: false, message: error }),
      );
      scannerRef.current.start(videoRef.current, { facingMode: next }).catch(() => {});
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-start gap-4">
        {/* QR — own peer link */}
        <div className="shrink-0">
          <div className="size-[140px] sm:size-[160px] rounded-xl bg-white p-2 shadow-sm flex items-center justify-center">
            {qrUrl ? (
              <img src={qrUrl} alt="My Peer QR" className="size-full" />
            ) : (
              <div className="size-full flex items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground text-center font-mono break-all px-1">
            {peerId || "—"}
          </div>
        </div>

        {/* Right side: explainer + scan button */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <QrCode className="size-4 text-primary" />
            <h4 className="text-sm font-semibold">{t("sync.qr.peerLinkTitle")}</h4>
          </div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            {t("sync.qr.peerLinkDesc")}
          </p>

          {/* Scan button — opens camera inline below */}
          <div className="flex items-center gap-2">
            {!scanning ? (
              <Button
                size="sm"
                variant="default"
                className="h-9 text-xs"
                onClick={handleStartScan}
                disabled={!transport || !peerId}
              >
                <ScanLine className="size-3.5 me-1.5" />
                {t("sync.qr.scanButton")}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" className="h-9 text-xs" onClick={handleStopScan}>
                  <X className="size-3.5 me-1.5" />
                  {t("sync.qr.stop")}
                </Button>
                <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={handleSwitchCamera}>
                  <SwitchCamera className="size-3.5 me-1.5" />
                  {t("sync.qr.switch")}
                </Button>
              </>
            )}
          </div>

          {/* Result inline */}
          <AnimatePresence>
            {scanResult && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className={cn(
                  "flex items-center gap-2 text-xs p-2 rounded-lg border mt-3",
                  scanResult.success
                    ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
                    : "bg-destructive/10 border-destructive/30 text-destructive",
                )}
              >
                {scanResult.success ? (
                  <Check className="size-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="size-3.5 shrink-0" />
                )}
                <span className="flex-1 min-w-0 truncate">{scanResult.message}</span>
                <button
                  onClick={() => setScanResult(null)}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  aria-label="Dismiss"
                >
                  <X className="size-3" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Camera viewport — shows inline when scanning */}
      <AnimatePresence>
        {scanning && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-border/60">
              <div className="relative mx-auto max-w-[280px] rounded-xl overflow-hidden border border-border bg-black">
                <video
                  ref={videoRef}
                  className="w-full aspect-[4/3] object-cover"
                  playsInline
                  muted
                />
                {/* Reticle overlay */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="size-40 border-2 border-white/70 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                </div>
                <div className="absolute top-2 start-2 flex items-center gap-1 text-[10px] text-white/90 bg-black/50 rounded px-2 py-1">
                  <Camera className="size-3" />
                  {t("sync.qr.scanningHint")}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Helper hint */}
      {!peerId && (
        <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Link2 className="size-3" />
          <span>{t("sync.qr.startTransportHint")}</span>
        </div>
      )}
    </Card>
  );
}
