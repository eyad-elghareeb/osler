/**
 * Notification center — new-content alerts, ticket status updates, and admin
 * announcements.
 *
 * Local-first: notifications live in the `settings` IndexedDB store (which
 * also syncs across the user's own devices via the settings sync kind — ids
 * are deterministic per event so a last-writer-wins merge never duplicates).
 *
 * Sources (no worker changes required):
 * - New content: the content-version stamp (see content-version.ts) moves on
 *   every publish — the first observed move after seeding raises one alert.
 * - Ticket updates: `listMyTickets()` receipts are diffed against a snapshot;
 *   a status change or a fresh admin reply raises one alert per ticket.
 * - Announcements: admins publish `content-files/notifications/
 *   announcements.json` through the existing R2 upload endpoint; students
 *   fetch it through the existing public `/v1/content/` endpoint.
 */

import { getConfig } from "@/lib/osler/config";
import { currentContentVersion, onContentVersionChange } from "@/lib/osler/content-version";
import { settings } from "@/lib/osler/storage";
import { listMyTickets, type TicketStatus } from "@/lib/osler/support";

export type NotificationKind = "content" | "ticket" | "announcement";

export interface NotificationLink {
  /** Settings section to open (ticket alerts use "support"). */
  section?: string;
  /** Support thread to open after navigating (see support.ts). */
  threadId?: string;
}

export interface OslerNotification {
  /** Deterministic per event (content-<version>, ticket-<id>-<n>, ann-<id>). */
  id: string;
  kind: NotificationKind;
  /** Ticket id for ticket alerts (drives the thread deep-link). */
  ticketId?: string;
  /** Ticket status for ticket alerts ("open" | "in_progress" | "resolved"). */
  ticketStatus?: TicketStatus;
  /** Subject of the ticket. */
  ticketSubject?: string;
  /** Admin-authored announcement (displayed as-is, lang-picked at render). */
  title?: string;
  titleAr?: string;
  body?: string;
  bodyAr?: string;
  createdAt: number;
  readAt: number | null;
  link?: NotificationLink;
}

export interface Announcement {
  id: string;
  title: string;
  titleAr?: string;
  body: string;
  bodyAr?: string;
  createdAt: number;
}

const STORE_KEY = "osler-notifications-v1";
const META_KEY = "osler-notifications-meta-v1";
const MAX_ITEMS = 100;
export const ANNOUNCEMENTS_R2_KEY = "content-files/notifications/announcements.json";
export const NOTIFICATIONS_EVENT = "osler-notifications-changed";

interface NotificationsMeta {
  lastContentVersion: string | null;
  ticketSnap: Record<string, { status: string; reply: string | null }>;
  seenAnnouncementIds: string[];
}

async function readItems(): Promise<OslerNotification[]> {
  try {
    const raw = await settings.get(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeItems(items: OslerNotification[]): Promise<void> {
  await settings.set(STORE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  dispatch();
}

async function readMeta(): Promise<NotificationsMeta> {
  const fallback: NotificationsMeta = { lastContentVersion: null, ticketSnap: {}, seenAnnouncementIds: [] };
  try {
    const raw = await settings.get(META_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<NotificationsMeta>;
    return {
      lastContentVersion: parsed.lastContentVersion ?? null,
      ticketSnap: parsed.ticketSnap && typeof parsed.ticketSnap === "object" ? parsed.ticketSnap : {},
      seenAnnouncementIds: Array.isArray(parsed.seenAnnouncementIds) ? parsed.seenAnnouncementIds : [],
    };
  } catch {
    return fallback;
  }
}

async function writeMeta(meta: NotificationsMeta): Promise<void> {
  await settings.set(META_KEY, JSON.stringify(meta));
}

function dispatch(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_EVENT));
}

export function subscribeNotifications(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(NOTIFICATIONS_EVENT, handler);
  return () => window.removeEventListener(NOTIFICATIONS_EVENT, handler);
}

/** All notifications, newest first. Never throws. */
export async function listNotifications(): Promise<OslerNotification[]> {
  const items = await readItems();
  return [...items].sort((a, b) => b.createdAt - a.createdAt);
}

/** Insert unless the id already exists (idempotent — safe to re-run polls). */
export async function pushNotification(input: Omit<OslerNotification, "readAt">): Promise<boolean> {
  const items = await readItems();
  if (items.some((n) => n.id === input.id)) return false;
  await writeItems([{ ...input, readAt: null }, ...items]);
  return true;
}

export async function markNotificationRead(id: string): Promise<void> {
  const items = await readItems();
  const next = items.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: Date.now() } : n));
  await writeItems(next);
}

export async function markAllNotificationsRead(): Promise<void> {
  const items = await readItems();
  if (!items.some((n) => !n.readAt)) return;
  await writeItems(items.map((n) => (n.readAt ? n : { ...n, readAt: Date.now() })));
}

export async function dismissNotification(id: string): Promise<void> {
  const items = await readItems();
  await writeItems(items.filter((n) => n.id !== id));
}

/** Register a newly filed ticket locally so subsequent status changes (to in_progress / resolved)
 *  are recognized as diffs and immediately trigger notifications. */
export async function registerTicketForNotifications(
  ticketId: string,
  status: TicketStatus = "open",
  reply: string | null = null,
): Promise<void> {
  try {
    const meta = await readMeta();
    meta.ticketSnap[ticketId] = { status, reply };
    await writeMeta(meta);
  } catch {}
}

/** Resolve the cloud API base for the public announcements file. Null when
 *  the instance is bundled/local (announcements need a cloud backend). */
function resolvedApiUrl(): string | null {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLOUD_API_URL) {
    return process.env.NEXT_PUBLIC_CLOUD_API_URL.replace(/\/$/, "");
  }
  try {
    const cfg = getConfig().cloud as { enabled?: boolean; apiUrl?: string } | undefined;
    if (cfg?.enabled && cfg.apiUrl) return cfg.apiUrl.replace(/\/$/, "");
  } catch {}
  return null;
}

/** Fetch the admin-published announcements file. 404 / offline → []. */
export async function fetchAnnouncements(): Promise<Announcement[]> {
  const apiUrl = resolvedApiUrl();
  if (!apiUrl || typeof fetch === "undefined") return [];
  try {
    const rel = ANNOUNCEMENTS_R2_KEY.replace(/^content-files\//, "");
    const res = await fetch(`${apiUrl}/v1/content/${rel}`, { cache: "no-store" });
    if (!res.ok) return [];
    const doc = (await res.json()) as { announcements?: unknown };
    if (!Array.isArray(doc.announcements)) return [];
    return (doc.announcements as Announcement[]).filter(
      (a) => a && typeof a.id === "string" && typeof a.title === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Run every source check once: content-version move, ticket diff, new
 * announcements. First run seeds state silently (no flood for history).
 * Never throws — each source fails independently.
 */
export async function refreshNotifications(): Promise<OslerNotification[]> {
  const meta = await readMeta();
  let changed = false;

  // 1. New content — the version stamp moved since we last saw it.
  try {
    const version = currentContentVersion();
    if (version && meta.lastContentVersion && version !== meta.lastContentVersion) {
      if (await pushNotification({ id: `content-${version}`, kind: "content", createdAt: Date.now() })) changed = true;
    }
    if (version && version !== meta.lastContentVersion) {
      meta.lastContentVersion = version;
      changed = true;
    }
  } catch {}

  // 2. Ticket updates — status moved or an admin reply landed.
  try {
    const tickets = await listMyTickets();
    const isFirstRun = Object.keys(meta.ticketSnap).length === 0;
    for (const ticket of tickets) {
      const prev = meta.ticketSnap[ticket.id];
      if (!prev) {
        meta.ticketSnap[ticket.id] = { status: ticket.status, reply: ticket.reply ?? null };
        changed = true;
        // On very first run, avoid flooding historical notifications
        if (isFirstRun) continue;
        // If not first run, but a ticket wasn't in ticketSnap yet, only notify if it has updates beyond initial "open"
        if (ticket.status === "open" && !ticket.reply) continue;
      }

      const statusMoved = !prev || prev.status !== ticket.status;
      const freshReply = !prev ? Boolean(ticket.reply) : Boolean(ticket.reply && ticket.reply !== prev.reply);

      if (statusMoved || freshReply) {
        const threadId = (ticket.context as { threadId?: string } | undefined)?.threadId ?? ticket.id;

        let title: string | undefined;
        let titleAr: string | undefined;
        let body: string | undefined = ticket.reply || undefined;
        let bodyAr: string | undefined = ticket.reply || undefined;

        if (ticket.status === "resolved") {
          title = ticket.subject ? `Ticket resolved: ${ticket.subject}` : "Support ticket resolved";
          titleAr = ticket.subject ? `تم حل البلاغ: ${ticket.subject}` : "تم حل بلاغ الدعم";
          if (!body) {
            body = "Your support ticket has been marked as resolved.";
            bodyAr = "تم وضع علامة على بلاغك بأنه تم حله بنجاح.";
          }
        } else if (ticket.status === "in_progress") {
          title = ticket.subject ? `Ticket in progress: ${ticket.subject}` : "Support ticket in progress";
          titleAr = ticket.subject ? `البلاغ قيد المتابعة: ${ticket.subject}` : "بلاغ الدعم قيد المتابعة";
          if (!body) {
            body = "Your support ticket is currently being reviewed and worked on.";
            bodyAr = "يجري الآن مراجعة بلاغك والعمل عليه من قبل الفريق.";
          }
        } else if (freshReply) {
          title = ticket.subject ? `New reply: ${ticket.subject}` : "Reply on support ticket";
          titleAr = ticket.subject ? `رد جديد: ${ticket.subject}` : "رد على بلاغ الدعم";
          if (!body) {
            body = "An admin replied to your support ticket.";
            bodyAr = "أرسل أحد المشرفين رداً على بلاغك.";
          }
        } else {
          title = ticket.subject ? `Ticket updated: ${ticket.subject}` : "Support ticket updated";
          titleAr = ticket.subject ? `تحديث البلاغ: ${ticket.subject}` : "تحديث على بلاغ الدعم";
          if (!body) {
            body = "An admin updated your support ticket.";
            bodyAr = "قام أحد المشرفين بتحديث بلاغك.";
          }
        }

        const pushed = await pushNotification({
          id: `ticket-${ticket.id}-${ticket.status}-${(ticket.reply ?? "").length}`,
          kind: "ticket",
          ticketId: ticket.id,
          ticketStatus: ticket.status,
          ticketSubject: ticket.subject,
          title,
          titleAr,
          body,
          bodyAr,
          createdAt: Date.now(),
          link: { section: "support", threadId },
        });
        if (pushed) changed = true;
      }
      meta.ticketSnap[ticket.id] = { status: ticket.status, reply: ticket.reply ?? null };
      changed = true;
    }
  } catch {}

  // 3. Admin announcements — every unseen id raises one alert.
  try {
    const announcements = await fetchAnnouncements();
    const seen = new Set(meta.seenAnnouncementIds);
    for (const a of announcements) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      await pushNotification({
        id: `ann-${a.id}`,
        kind: "announcement",
        title: a.title,
        titleAr: a.titleAr,
        body: a.body,
        bodyAr: a.bodyAr,
        createdAt: typeof a.createdAt === "number" ? a.createdAt : Date.now(),
      });
    }
    meta.seenAnnouncementIds = [...seen].slice(-200);
    changed = true;
  } catch {}

  if (changed) {
    try {
      await writeMeta(meta);
    } catch {}
  }
  return listNotifications();
}

let syncStarted = false;

/** Start background tracking: seed once, then poll on focus/visibility and on
 *  a slow interval. Idempotent. */
export function startNotificationsSync(): void {
  if (syncStarted || typeof window === "undefined") return;
  syncStarted = true;
  void refreshNotifications();
  const check = () => {
    if (document.visibilityState === "visible") void refreshNotifications();
  };
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", check);
  window.setInterval(() => void refreshNotifications(), 5 * 60 * 1000);
  onContentVersionChange(() => {
    void refreshNotifications();
  });
}
