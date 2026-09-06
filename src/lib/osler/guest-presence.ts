/**
 * Guest presence reporting — lets the admin panel count local-only guests
 * by name (see cloudflare/worker/migrations/0005_guest_presence.sql).
 *
 * Guests never create an account, so the users table can't see them. This
 * module reports {aid, displayName} through the pre-auth
 * POST /v1/guest/presence endpoint, throttled to ~once/day per device.
 * Signed-in users are skipped (they're already counted in users).
 * Best-effort by contract: cloud disabled, offline, or rate-limited ⇒
 * silently dropped. Never throws into the session flow.
 */

import { cloudEnabled, readCloudSession, reportGuestPresence } from "@/lib/osler/cloud";
import { getContributorId } from "@/lib/osler/question-stats";

const LAST_REPORT_KEY = "osler-guest-presence-reported-at";
const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Report this device's guest name for admin statistics (throttled, best-effort). */
export async function maybeReportGuestPresence(displayName: string): Promise<void> {
  const name = displayName.trim().slice(0, 40);
  if (!name || typeof window === "undefined") return;
  try {
    if (!(await cloudEnabled())) return;
    if (readCloudSession()?.token) return;
    const last = Number(window.localStorage.getItem(LAST_REPORT_KEY) || 0);
    if (Date.now() - last < REPORT_INTERVAL_MS) return;
    await reportGuestPresence(getContributorId(), name);
    window.localStorage.setItem(LAST_REPORT_KEY, String(Date.now()));
  } catch {
    // Dropped — best-effort by contract.
  }
}
