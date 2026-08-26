/**
 * Support tickets — user-reported problems (Settings / QBank / Library).
 *
 * Types live here (not in types.ts) because tickets are user data, not
 * content. Every filed report is kept as a local receipt in IndexedDB so the
 * Settings → Support history works offline; delivery to the Worker happens
 * through `cloud.ts` and is marked on the receipt. Signed-in reporters get
 * their account attached server-side; guests stay anonymous but still show
 * up in the admin queue.
 */

import { fetchMySupportTickets, submitSupportTicket } from "@/lib/osler/cloud";
import { settings } from "@/lib/osler/storage";
import type { StringKey } from "@/lib/osler/i18n";

export type TicketStatus = "open" | "in_progress" | "resolved";
export type TicketSource = "settings" | "qbank" | "library";
export type TicketCategory = "bug" | "content" | "feature" | "other";

/** Full question payload attached to QBank reports — mirrors the AI
 *  assistant's questionContext (stem + choices + correct) plus the fields
 *  admins need to fix content: the explanation and the reporter's choice. */
export interface TicketQuestionContext {
  stem: string;
  choices?: string[];
  correct?: number;
  explanation?: string;
  /** Index of the reporter's chosen choice at report time. */
  selected?: number;
}

export interface TicketContext {
  packUid?: string;
  packTitle?: string;
  qid?: string;
  questionExcerpt?: string;
  /** The reporter's chosen answer text at report time. */
  selectedAnswer?: string;
  articleTitle?: string;
  articleFile?: string;
  question?: TicketQuestionContext;
}

export interface SupportTicket {
  id: string;
  source: TicketSource;
  category: TicketCategory;
  subject: string;
  message: string;
  context?: TicketContext;
  createdAt: number;
  status: TicketStatus;
  reply?: string | null;
  /** True once the Worker accepted the ticket. */
  synced: boolean;
}

const RECEIPTS_KEY = "support-ticket-receipts";
const MAX_RECEIPTS = 200;

export const TICKET_CATEGORIES: TicketCategory[] = ["bug", "content", "feature", "other"];

export const TICKET_STATUS_I18N: Record<TicketStatus, StringKey> = {
  open: "support.status.open",
  in_progress: "support.status.inProgress",
  resolved: "support.status.resolved",
};

export const TICKET_CATEGORY_I18N: Record<TicketCategory, StringKey> = {
  bug: "support.category.bug",
  content: "support.category.content",
  feature: "support.category.feature",
  other: "support.category.other",
};

async function readReceipts(): Promise<SupportTicket[]> {
  try {
    const raw = await settings.get(RECEIPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeReceipts(tickets: SupportTicket[]): Promise<void> {
  await settings.set(RECEIPTS_KEY, JSON.stringify(tickets.slice(0, MAX_RECEIPTS)));
}

/** All locally-known tickets (newest first), merged with any server-side
 *  status/reply updates for signed-in users. Never throws. */
export async function listMyTickets(): Promise<SupportTicket[]> {
  const local = await readReceipts();
  try {
    const remote = await fetchMySupportTickets();
    if (Array.isArray(remote)) {
      const byId = new Map(local.map((t) => [t.id, t]));
      for (const r of remote) {
        const rec = byId.get((r as SupportTicket).id);
        if (!rec) continue;
        rec.status = (r as SupportTicket).status ?? rec.status;
        rec.reply = (r as SupportTicket).reply ?? rec.reply;
        rec.synced = true;
      }
      await writeReceipts(local);
    }
  } catch {
    // Offline / cloud disabled — local receipts are still shown.
  }
  return [...local].sort((a, b) => b.createdAt - a.createdAt);
}

/** File a new report: persist a local receipt immediately, then attempt
 *  delivery. Returns the receipt (check `synced` for delivery state). */
export async function fileTicket(input: {
  source: TicketSource;
  category: TicketCategory;
  subject: string;
  message: string;
  context?: TicketContext;
}): Promise<SupportTicket> {
  const ticket: SupportTicket = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    status: "open",
    synced: false,
    ...input,
  };
  const receipts = await readReceipts();
  await writeReceipts([ticket, ...receipts]);
  try {
    await submitSupportTicket({
      ...ticket,
      context: ticket.context as Record<string, unknown> | undefined,
    });
    ticket.synced = true;
    await writeReceipts((await readReceipts()).map((t) => (t.id === ticket.id ? ticket : t)));
  } catch {
    // Kept as an unsynced receipt; the next filing retries nothing, but the
    // user sees the pending state instead of silently losing the report.
  }
  return ticket;
}
