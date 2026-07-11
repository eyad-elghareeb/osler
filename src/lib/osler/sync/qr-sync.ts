/**
 * QRSync — QR generation + camera scanning for PeerJS link sharing.
 *
 * QR codes are NO LONGER used to transfer sync data. They now only encode
 * a small "peer link" string that lets one device open a PeerJS connection
 * to another device as an alternative to network discovery (e.g. across
 * VLANs, VPNs, or when MQTT discovery is blocked).
 *
 * Wire format for a peer link:
 *   osler-peer:<peerId>:<deviceName>
 *
 * Data transfer itself happens over the PeerJS data channel once the
 * connection is established — see NetworkTransport.sendExport().
 */

/* ── Type declarations for browser APIs ─────────────────────────────── */

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  detect(image: ImageBitmap | HTMLVideoElement | HTMLCanvasElement): Promise<Array<{ rawValue: string }>>;
}

/* ── Peer link format ───────────────────────────────────────────────── */

export const PEER_LINK_PREFIX = "osler-peer:";

export interface PeerLink {
  peerId: string;
  deviceName: string;
}

/**
 * Build the peer-link string encoded into the QR.
 * Format: osler-peer:<peerId>:<deviceName>
 */
export function buildPeerLink(peerId: string, deviceName: string): string {
  const safeName = (deviceName || "Device").replace(/:/g, " ");
  return `${PEER_LINK_PREFIX}${peerId}:${safeName}`;
}

/**
 * Parse a scanned string into a PeerLink. Returns null if not a peer link.
 */
export function parsePeerLink(text: string): PeerLink | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith(PEER_LINK_PREFIX)) return null;
  const body = trimmed.substring(PEER_LINK_PREFIX.length);
  const firstColon = body.indexOf(":");
  if (firstColon <= 0) return null;
  const peerId = body.substring(0, firstColon).trim();
  const deviceName = body.substring(firstColon + 1).trim() || "Device";
  if (!peerId) return null;
  return { peerId, deviceName };
}

/* ── QR Generation ──────────────────────────────────────────────────── */

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

/* ── QR Scanning ────────────────────────────────────────────────────── */

export type ScanCallback = (text: string) => void;
export type ScanErrorCallback = (error: string) => void;

/** Minimal shape of the html5-qrcode scanner we use. */
interface IHtml5Scanner {
  start(
    config: { facingMode: string },
    options: { fps: number; qrbox: { width: number; height: number } },
    onSuccess: (decoded: string, result: { decodedText?: string }) => void,
    onError: (err: unknown) => void,
  ): Promise<void>;
  stop(): Promise<void>;
  clear(): Promise<void> | void;
}

/** Camera scanner that uses the native BarcodeDetector API with
 *  getUserMedia for camera access. Works in Chromium-based browsers and
 *  recent Safari. Calls onScan once per detected code (deduped by text).
 */
export class CameraScanner {
  private stream: MediaStream | null = null;
  private detector: BarcodeDetector | null = null;
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private video: HTMLVideoElement | null = null;
  private onScan: ScanCallback;
  private onError: ScanErrorCallback;
  private active = false;
  private lastScanned = "";
  private lastScannedAt = 0;

  constructor(onScan: ScanCallback, onError: ScanErrorCallback) {
    this.onScan = onScan;
    this.onError = onError;
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
    this.lastScanned = "";
    this.lastScannedAt = 0;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: options?.facingMode ?? "environment",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      videoElement.srcObject = this.stream;
      await videoElement.play();

      // Try native BarcodeDetector (Chrome, Edge, recent Safari on iOS 16.4+)
      if (typeof BarcodeDetector !== "undefined") {
        try {
          this.detector = new BarcodeDetector({ formats: ["qr_code"] });
        } catch {
          this.detector = null;
        }
      }

      if (this.detector) {
        const fps = options?.fps ?? 12;
        this.scanInterval = setInterval(() => this.scanFrame(), 1000 / fps);
      } else {
        // Fallback: html5-qrcode (already in deps) which has its own scanner.
        // Defer to it lazily so we don't bloat the initial bundle.
        try {
          await this.startHtml5QrScanner(videoElement);
        } catch (e) {
          this.onError(`Scanner not available: ${(e as Error).message}`);
          await this.stop();
        }
      }
    } catch (e) {
      this.active = false;
      this.onError(`Camera error: ${(e as Error).message}`);
    }
  }

  private html5Scanner: { stop: () => Promise<void> } | null = null;

  private async startHtml5QrScanner(_videoElement: HTMLVideoElement): Promise<void> {
    const mod = await import("html5-qrcode");
    // html5-qrcode wants its own DOM element. We reuse the video element's
    // parent by creating a wrapper id and pointing the library at it.
    const wrapperId = "osler-qr-html5-wrapper";
    let wrapper = document.getElementById(wrapperId);
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.id = wrapperId;
      wrapper.style.position = "fixed";
      wrapper.style.inset = "0";
      wrapper.style.pointerEvents = "none";
      wrapper.style.opacity = "0";
      wrapper.style.zIndex = "-1";
      document.body.appendChild(wrapper);
    }
    // The Html5Qrcode constructor is the named export on the module.
    const Html5QrcodeCtor = (mod.Html5Qrcode ?? (mod as { default?: unknown }).default) as
      | (new (id: string) => IHtml5Scanner)
      | undefined;
    if (!Html5QrcodeCtor) {
      throw new Error("Html5Qrcode constructor not found in module");
    }
    const scanner = new Html5QrcodeCtor(wrapperId);
    await scanner.start(
      { facingMode: "environment" },
      { fps: 12, qrbox: { width: 240, height: 240 } },
      (decoded: string, decodedResult: { decodedText?: string }) => {
        const text = decodedResult?.decodedText ?? decoded;
        this.maybeDispatch(text);
      },
      () => {
        // per-frame failure — ignore
      },
    );
    this.html5Scanner = {
      stop: async () => {
        try {
          await scanner.stop();
          await scanner.clear();
        } catch {
          // ignore
        }
      },
    };
    // Hide the native video element since html5-qrcode renders its own.
    _videoElement.style.opacity = "0.001";
  }

  private maybeDispatch(text: string): void {
    if (!text) return;
    const now = Date.now();
    // Dedupe: same text within 2s is ignored.
    if (text === this.lastScanned && now - this.lastScannedAt < 2000) return;
    this.lastScanned = text;
    this.lastScannedAt = now;
    this.onScan(text);
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.html5Scanner) {
      try { await this.html5Scanner.stop(); } catch {}
      this.html5Scanner = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      if (this.video.style.opacity === "0.001") this.video.style.opacity = "1";
      this.video = null;
    }
    this.detector = null;
  }

  private async scanFrame(): Promise<void> {
    if (!this.active || !this.video || !this.detector) return;
    try {
      const barcodes = await this.detector.detect(this.video);
      for (const barcode of barcodes) {
        if (barcode.rawValue) {
          this.maybeDispatch(barcode.rawValue);
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
