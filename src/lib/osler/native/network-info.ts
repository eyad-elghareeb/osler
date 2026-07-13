/**
 * Osler Network Info — wrapper around the Network Information API.
 *
 * Docs: https://whatpwacando.today/network-info/
 * Spec: https://wicg.github.io/netinfo/
 *
 * Design notes:
 *  - The Network Information API exposes `navigator.connection` (and
 *    `navigator.mozConnection` on older Firefox). It gives us:
 *      type           'wifi' | 'cellular' | 'ethernet' | 'bluetooth' | 'none' | 'unknown'
 *      effectiveType  'slow-2g' | '2g' | '3g' | '4g'
 *      downlink       Mbps (number, rounded to 25 Kbps)
 *      rtt            round-trip time in ms (averaged)
 *      saveData       boolean — user has Data Saver enabled
 *  - The API is evented: `change` fires whenever any of the above changes.
 *    We expose a React hook (`useNetworkInfo`) that subscribes and
 *    re-renders on changes.
 *  - The sync panel uses this to show the *actual* network situation
 *    (e.g. "Wi-Fi · 4g · 8.2 Mbps · 50 ms RTT") alongside the room ID,
 *    so the user can immediately see whether peer-to-peer sync is likely
 *    to succeed (e.g. on slow-2g, suggest file export instead).
 *  - iOS Safari does not implement this API. We expose a clean "unknown"
 *    fallback rather than throwing.
 */

export type NetworkType = "bluetooth" | "cellular" | "ethernet" | "none" | "wifi" | "wimax" | "other" | "unknown";
export type EffectiveType = "slow-2g" | "2g" | "3g" | "4g" | "unknown";

export interface NetworkInfo {
  available: boolean;
  /** Top-level connection type. iOS Safari always reports `unknown`. */
  type: NetworkType;
  /** Effective connection type (derived from RTT/downlink heuristics). */
  effectiveType: EffectiveType;
  /** Theoretical max downlink speed in Mbps (rounded to nearest 25 Kbps). */
  downlink: number;
  /** Round-trip time in ms (averaged over recent requests). */
  rtt: number;
  /** User has Data Saver / Low Data Mode enabled. */
  saveData: boolean;
  /** Online (navigator.onLine). */
  online: boolean;
}

const UNKNOWN: NetworkInfo = {
  available: false,
  type: "unknown",
  effectiveType: "unknown",
  downlink: 0,
  rtt: 0,
  saveData: false,
  online: true,
};

interface NetworkInformationLike extends EventTarget {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  addEventListener(type: "change", listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: "change", listener: EventListenerOrEventListenerObject): void;
}

function getConnection(): NetworkInformationLike | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as any;
  return (nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null) as NetworkInformationLike | null;
}

export function readNetworkInfo(): NetworkInfo {
  if (typeof navigator === "undefined") return { ...UNKNOWN };
  const conn = getConnection();
  const online = typeof navigator.onLine === "boolean" ? navigator.onLine : true;
  if (!conn) {
    return { ...UNKNOWN, online };
  }
  const rawType = (conn as any).type as string | undefined;
  let type: NetworkType = "unknown";
  if (rawType === "bluetooth" || rawType === "cellular" || rawType === "ethernet" ||
      rawType === "none" || rawType === "wifi" || rawType === "wimax" || rawType === "other") {
    type = rawType as NetworkType;
  }
  const rawEff = (conn as any).effectiveType as string | undefined;
  let effectiveType: EffectiveType = "unknown";
  if (rawEff === "slow-2g" || rawEff === "2g" || rawEff === "3g" || rawEff === "4g") {
    effectiveType = rawEff;
  }
  return {
    available: true,
    type,
    effectiveType,
    downlink: typeof conn.downlink === "number" ? conn.downlink : 0,
    rtt: typeof conn.rtt === "number" ? conn.rtt : 0,
    saveData: !!conn.saveData,
    online,
  };
}

/* ── React hook ───────────────────────────────────────────────────── */
// Re-exported via a separate hook file so callers can `import { useNetworkInfo }`
// without pulling React types into the lib.

/* ── Formatting helpers ───────────────────────────────────────────── */

/** Human label for `NetworkType`. */
export function networkTypeLabel(t: NetworkType): string {
  switch (t) {
    case "wifi": return "Wi-Fi";
    case "cellular": return "Cellular";
    case "ethernet": return "Ethernet";
    case "bluetooth": return "Bluetooth";
    case "wimax": return "WiMAX";
    case "none": return "Offline";
    case "other": return "Other";
    default: return "Unknown";
  }
}

/** Human label for `EffectiveType` (e.g. "4g"). */
export function effectiveTypeLabel(t: EffectiveType): string {
  switch (t) {
    case "slow-2g": return "Slow 2G";
    case "2g": return "2G";
    case "3g": return "3G";
    case "4g": return "4G";
    default: return "Unknown";
  }
}

/** Format the downlink in Mbps with one decimal place. */
export function formatDownlink(mbps: number): string {
  if (!mbps || mbps <= 0) return "—";
  if (mbps < 1) return `${(mbps * 1000).toFixed(0)} Kbps`;
  return `${mbps.toFixed(1)} Mbps`;
}

/** Format RTT in ms. */
export function formatRtt(ms: number): string {
  if (!ms || ms <= 0) return "—";
  return `${Math.round(ms)} ms`;
}

/**
 * Quality band — a single 1–4 number derived from effectiveType, useful
 * for picking an icon or a color without enumerating all the strings.
 *   4 = 4g, 3 = 3g, 2 = 2g, 1 = slow-2g, 0 = unknown/offline.
 */
export function networkQualityBand(info: NetworkInfo): number {
  if (!info.online || info.type === "none") return 0;
  switch (info.effectiveType) {
    case "4g": return 4;
    case "3g": return 3;
    case "2g": return 2;
    case "slow-2g": return 1;
    default: return info.type === "wifi" || info.type === "ethernet" ? 4 : 0;
  }
}

/** Whether sync over the network is likely to work well. */
export function isNetworkGoodForSync(info: NetworkInfo): boolean {
  if (!info.online) return false;
  const band = networkQualityBand(info);
  return band >= 2;
}

/**
 * Subscribe to network changes. Returns an unsubscribe function.
 * Caller is responsible for re-reading `readNetworkInfo()` inside the
 * callback (so this stays framework-agnostic).
 */
export function subscribeNetworkInfo(cb: () => void): () => void {
  if (typeof navigator === "undefined") return () => {};
  const conn = getConnection();
  const handlers: Array<() => void> = [];
  const onChange = () => cb();
  const onOnline = () => cb();
  const onOffline = () => cb();

  if (conn) {
    conn.addEventListener("change", onChange);
    handlers.push(() => conn.removeEventListener("change", onChange));
  }
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  handlers.push(() => window.removeEventListener("online", onOnline));
  handlers.push(() => window.removeEventListener("offline", onOffline));

  return () => handlers.forEach((h) => h());
}
