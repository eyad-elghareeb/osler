/**
 * QRSync — QR code generation and camera scanning for data transfer.
 *
 * Uses `qrcode` npm package for generation.
 * Uses native `BarcodeDetector` API when available, with a canvas-based
 * fallback that you can swap for a heavier library like jsQR.
 *
 * Pure logic — no UI. Returns data strings and canvas refs for rendering.
 */

import * as SyncProtocol from "./sync-protocol";

/* ── Type declarations for browser APIs ─────────────────────────────── */

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  detect(image: ImageBitmap | HTMLVideoElement | HTMLCanvasElement): Promise<Array<{ rawValue: string }>>;
}

/* ── QR Generation ──────────────────────────────────────────────────── */

export interface QrChunkData {
  text: string;
  index: number;
  total: number;
}

/**
 * Split sync wire data into QR chunks (each fits one QR code).
 * Returns one or more text strings to encode as QR codes.
 */
export function getQrChunks(wireData: string): QrChunkData[] {
  const chunks = SyncProtocol.frameForQR(wireData);
  return chunks.map((text, i) => ({
    text,
    index: i,
    total: chunks.length,
  }));
}

/**
 * Generate a QR code as a data URL (canvas.toDataURL).
 * Uses the `qrcode` package.
 */
export async function generateQrDataUrl(
  text: string,
  options?: { width?: number; margin?: number },
): Promise<string> {
  const QRCode = await import("qrcode");
  return QRCode.toDataURL(text, {
    width: options?.width ?? 256,
    margin: options?.margin ?? 1,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/**
 * Generate a QR code as an SVG string.
 */
export async function generateQrSvg(
  text: string,
  options?: { width?: number; margin?: number },
): Promise<string> {
  const QRCode = await import("qrcode");
  return QRCode.toString(text, {
    type: "svg",
    width: options?.width ?? 256,
    margin: options?.margin ?? 1,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/* ── QR Scanning ────────────────────────────────────────────────────── */

export interface ScanResult {
  fullData: string;
  chunksReceived: number;
  totalChunks: number;
}

export type ScanCallback = (result: ScanResult) => void;
export type ScanErrorCallback = (error: string) => void;

/**
 * Multi-part QR scanner state.
 * Tracks partial chunks from a multi-QR transfer and reassembles them.
 */
export class QrScanner {
  private chunks: Record<string, Record<string, string>> = {};
  private transferHashes: Record<string, string> = {};
  private onResult: ScanCallback;
  private onError: ScanErrorCallback;

  constructor(onResult: ScanCallback, onError: ScanErrorCallback) {
    this.onResult = onResult;
    this.onError = onError;
  }

  /**
   * Process a decoded QR text. Handles both single and multi-part codes.
   */
  processScan(text: string): void {
    const parsed = SyncProtocol.parseQRChunk(text);
    if (!parsed) {
      this.onError("Invalid QR code format");
      return;
    }

    if (parsed.total === 1) {
      // Single QR — done
      this.onResult({ fullData: parsed.data, chunksReceived: 1, totalChunks: 1 });
      return;
    }

    // Multi-part: key by transfer hash
    const firstData = parsed.seq === 1 ? parsed.data.substring(0, 20) : "";
    const transferKey = String(parsed.total) + "_" + (this.transferHashes._current || firstData);
    if (parsed.seq === 1 && firstData) {
      this.transferHashes._current = firstData;
    }
    if (!this.chunks[transferKey]) {
      this.chunks[transferKey] = {};
    }
    this.chunks[transferKey][String(parsed.seq)] = parsed.data;

    const currentCount = Object.keys(this.chunks[transferKey]).length;

    if (currentCount >= parsed.total) {
      // All chunks received — reassemble
      let full = "";
      for (let i = 1; i <= parsed.total; i++) {
        full += this.chunks[transferKey][String(i)] || "";
      }
      delete this.chunks[transferKey];
      delete this.transferHashes._current;
      this.onResult({ fullData: full, chunksReceived: currentCount, totalChunks: parsed.total });
    }
  }

  reset(): void {
    this.chunks = {};
    this.transferHashes = {};
  }
}

/* ── Native camera scanner helper ───────────────────────────────────── */

/**
 * Camera scanner that uses the native BarcodeDetector API with
 * getUserMedia for camera access. Works in Chromium-based browsers.
 */
export class CameraScanner {
  private stream: MediaStream | null = null;
  private detector: BarcodeDetector | null = null;
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private video: HTMLVideoElement | null = null;
  private onScan: ScanCallback;
  private onError: ScanErrorCallback;
  private qrScanner: QrScanner;
  private active = false;

  constructor(onScan: ScanCallback, onError: ScanErrorCallback) {
    this.onScan = onScan;
    this.onError = onError;
    this.qrScanner = new QrScanner(onScan, onError);
  }

  get isActive(): boolean {
    return this.active;
  }

  async start(
    videoElement: HTMLVideoElement,
    options?: { facingMode?: "user" | "environment"; fps?: number },
  ): Promise<void> {
    if (this.active) await this.stop();

    this.active = true;
    this.video = videoElement;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: options?.facingMode ?? "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      videoElement.srcObject = this.stream;
      await videoElement.play();

      // Try native BarcodeDetector
      if (typeof BarcodeDetector !== "undefined") {
        this.detector = new BarcodeDetector({ formats: ["qr_code"] });
        const fps = options?.fps ?? 15;
        this.scanInterval = setInterval(() => this.scanFrame(), 1000 / fps);
      } else {
        this.onError("BarcodeDetector not available in this browser");
        await this.stop();
      }
    } catch (e) {
      this.active = false;
      this.onError(`Camera error: ${(e as Error).message}`);
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.detector = null;
    this.qrScanner.reset();
  }

  private async scanFrame(): Promise<void> {
    if (!this.active || !this.video || !this.detector) return;
    try {
      const barcodes = await this.detector.detect(this.video);
      for (const barcode of barcodes) {
        if (barcode.rawValue) {
          this.qrScanner.processScan(barcode.rawValue);
        }
      }
    } catch {
      // Scanning frame failed — continue
    }
  }
}

/* ── Utilities ──────────────────────────────────────────────────────── */

export async function getCameras(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  } catch {
    return [];
  }
}
