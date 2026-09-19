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
  /** Follow-up messages carry the root ticket's id here so the whole
   *  back-and-forth groups into one chat thread (no worker changes — each
   *  message is still its own ticket row server-side). */
  threadId?: string;
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

/** Client-side mirrors of the Worker caps (see TICKET_BODY_MAX_BYTES and the
 *  field slices in handleSupportTicketCreate). Enforced here so oversized
 *  input never leaves the device — and never bloats the IndexedDB receipts —
 *  even when the dialog's maxLength attributes are bypassed. */
export const TICKET_SUBJECT_MAX = 200;
export const TICKET_MESSAGE_MAX = 5000;
const TICKET_CONTEXT_MAX = 16_000;

/** Shrink an over-budget context while keeping the identifiers admins need
 *  (pack/article ids and titles). The full question payload is the only
 *  field that can realistically blow the budget, so it goes first. */
function trimTicketContext(context: TicketContext | undefined): TicketContext | undefined {
  if (!context) return undefined;
  if (JSON.stringify(context).length <= TICKET_CONTEXT_MAX) return context;
  const { question, questionExcerpt, selectedAnswer, ...identifiers } = context;
  if (JSON.stringify(identifiers).length <= TICKET_CONTEXT_MAX) return identifiers;
  const trimmed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(identifiers)) {
    trimmed[key] = typeof value === "string" ? value.slice(0, 500) : value;
  }
  return trimmed as TicketContext;
}

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

/** Deep-link event fired by the notification center (detail: { threadId })
 *  so Settings → Support opens the right chat thread. The section mounts
 *  async (code-split), so senders retry delivery a few times. */
export const OPEN_SUPPORT_THREAD_EVENT = "osler-open-support-thread";

export function openSupportThread(threadId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SUPPORT_THREAD_EVENT, { detail: { threadId } }));
}

/** Root thread id for a ticket — follow-ups point at the first report. */
export function ticketThreadId(ticket: Pick<SupportTicket, "id" | "context">): string {
  return ticket.context?.threadId ?? ticket.id;
}

export interface TicketThread {
  id: string;
  subject: string;
  category: TicketCategory;
  source: TicketSource;
  /** Status of the latest message in the thread. */
  status: TicketStatus;
  /** Every message oldest-first (root report + follow-ups). */
  tickets: SupportTicket[];
  latestAt: number;
  hasReply: boolean;
}

/** Group receipts into chat threads (newest activity first). */
export function groupTicketsIntoThreads(tickets: SupportTicket[]): TicketThread[] {
  const byId = new Map<string, SupportTicket[]>();
  for (const t of tickets) {
    const key = ticketThreadId(t);
    const list = byId.get(key) ?? [];
    list.push(t);
    byId.set(key, list);
  }
  const threads: TicketThread[] = [];
  for (const [id, list] of byId) {
    const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
    const root = sorted[0];
    const latest = sorted[sorted.length - 1];
    threads.push({
      id,
      subject: root.subject.replace(/^Re:\s*/i, ""),
      category: root.category,
      source: root.source,
      status: latest.status,
      tickets: sorted,
      latestAt: Math.max(...sorted.map((t) => t.createdAt)),
      hasReply: sorted.some((t) => !!t.reply),
    });
  }
  return threads.sort((a, b) => b.latestAt - a.latestAt);
}

/** Send a chat follow-up inside a thread: files a linked ticket carrying the
 *  root context (pack/article pointers stay attached for the admins). */
export async function fileFollowUp(thread: TicketThread, message: string): Promise<SupportTicket> {
  const root = thread.tickets[0];
  return fileTicket({
    source: root.source,
    category: root.category,
    subject: `Re: ${thread.subject}`.slice(0, TICKET_SUBJECT_MAX),
    message,
    context: { ...root.context, threadId: thread.id },
  });
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
    subject: input.subject.trim().slice(0, TICKET_SUBJECT_MAX),
    message: input.message.trim().slice(0, TICKET_MESSAGE_MAX),
    context: trimTicketContext(input.context),
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
