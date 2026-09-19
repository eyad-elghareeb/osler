"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  LifeBuoy,
  Loader2,
  Pencil,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/osler/i18n-provider";
import type { StringKey } from "@/lib/osler/i18n";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { haptic } from "@/lib/osler/native";
import { adminApi, type AdminSupportTicket, type TicketStatusFilter } from "@/components/osler/admin/admin-api";
import { TICKET_CATEGORY_I18N, TICKET_STATUS_I18N } from "@/lib/osler/support";
import { loadNodeByUid } from "@/lib/osler/content";

const SOURCE_ICON = { qbank: ClipboardList, library: BookOpen, settings: Settings2 };
const STATUS_BADGE_CLASS: Record<AdminSupportTicket["status"], string> = {
  open: "bg-warning-soft text-warning border-warning/30",
  in_progress: "bg-info-soft text-info border-info/30",
  resolved: "bg-success-soft text-success border-success/30",
};
const PAGE_SIZE = 25;
const CHOICE_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const ROLE_I18N: Record<string, StringKey> = {
  student: "admin.users.roles.student",
  content_admin: "admin.users.roles.content_admin",
  admin: "admin.users.roles.admin",
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The full question a QBank report attached (same payload the AI assistant
 *  sees): stem, choices with correct/user marks, and the explanation. */
function ReportedQuestion({ question }: {
  question: NonNullable<AdminSupportTicket["context"]>["question"];
}) {
  const { t } = useI18n();
  if (!question?.stem) return null;
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 grid gap-2">
      <div className="text-xs font-semibold text-muted-foreground">{t("admin.tickets.question")}</div>
      <p className="text-sm whitespace-pre-wrap break-words">{question.stem}</p>
      {!!question.choices?.length && (
        <ul className="grid gap-1">
          {question.choices.map((choice, i) => {
            const isCorrect = question.correct === i;
            const isSelected = question.selected === i;
            return (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-1.5 rounded-md px-2 py-1 text-sm",
                  isCorrect && "bg-success-soft text-success",
                  isSelected && !isCorrect && "bg-warning-soft text-warning",
                  !isCorrect && !isSelected && "text-muted-foreground",
                )}
              >
                <span className="font-mono text-xs mt-0.5 shrink-0">{CHOICE_KEYS[i] ?? i}.</span>
                <span className="min-w-0 break-words">{choice}</span>
                {isCorrect && <span className="ms-auto shrink-0 text-[11px] font-medium">{t("admin.tickets.correct")}</span>}
                {isSelected && <span className="ms-auto shrink-0 text-[11px] font-medium">{t("support.contextAnswer")}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {question.explanation && (
        <div className="border-t border-border pt-2">
          <div className="text-xs font-semibold text-muted-foreground mb-0.5">{t("admin.tickets.explanation")}</div>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{question.explanation}</p>
        </div>
      )}
    </div>
  );
}

/** Compact list row — opens the triage modal on click. */
function TicketRow({ ticket, threadCount, onOpen }: {
  ticket: AdminSupportTicket;
  /** Same-page messages sharing this ticket's thread (root + follow-ups). */
  threadCount: number;
  onOpen: (ticket: AdminSupportTicket) => void;
}) {
  const { t } = useI18n();
  const SourceIcon = SOURCE_ICON[ticket.source] ?? Settings2;
  return (
    <button
      onClick={() => { haptic("light"); onOpen(ticket); }}
      aria-label={t("admin.tickets.open")}
      title={ticket.subject}
      className="group w-full flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-start transition-colors hover:border-primary/40 hover:bg-primary/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <span className="size-7 rounded-md bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary-soft transition-colors">
        <SourceIcon className="size-3.5 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{ticket.subject}</span>
          {threadCount > 1 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {t("support.chat.threadCount", { n: String(threadCount) })}
            </span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground truncate">
          {ticket.username || t("support.contextGuest")} · {formatDate(ticket.createdAt)} · {ticket.source} · {t(TICKET_CATEGORY_I18N[ticket.category])}
        </span>
      </span>
      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE_CLASS[ticket.status])}>
        {t(TICKET_STATUS_I18N[ticket.status])}
      </span>
      {ticket.reply ? <CircleCheck className="size-3.5 shrink-0 text-success" /> : null}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl-flip-x" />
    </button>
  );
}

/** Full triage surface: message + thread conversation + context + attached
 *  question, with status, reply and delete controls. */
function TicketDetailDialog({ ticket, thread, onClose, onUpdated, onDeleted }: {
  ticket: AdminSupportTicket;
  /** Same-page tickets sharing this ticket's thread (root + follow-ups). */
  thread: AdminSupportTicket[];
  onClose: () => void;
  onUpdated: (t: AdminSupportTicket) => void;
  onDeleted: (id: string) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [status, setStatus] = useState(ticket.status);
  const [reply, setReply] = useState(ticket.reply ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const SourceIcon = SOURCE_ICON[ticket.source] ?? Settings2;

  // Re-sync local fields whenever another ticket is opened or the list refreshes.
  useEffect(() => {
    setStatus(ticket.status);
    setReply(ticket.reply ?? "");
  }, [ticket]);

  const dirty = status !== ticket.status || reply !== (ticket.reply ?? "");

  const save = async () => {
    setSaving(true);
    try {
      const r = await adminApi.updateTicket(ticket.id, { status, reply: reply.trim() || null });
      haptic("success");
      toast({ title: t("admin.tickets.updatedToast") });
      if (r.ticket) onUpdated(r.ticket);
    } catch {
      haptic("error");
      toast({ title: t("admin.tickets.updateFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteTicket = async () => {
    setDeleting(true);
    try {
      await adminApi.deleteTicket(ticket.id);
      haptic("success");
      toast({ title: t("admin.tickets.deletedToast") });
      onDeleted(ticket.id);
    } catch {
      haptic("error");
      toast({ title: t("admin.tickets.deleteFailed"), variant: "destructive" });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const ctx = ticket.context;
  // Full question (stem/choices/explanation) renders below via
  // ReportedQuestion — only pack/article pointers remain as summary lines.
  const ctxEntries: Array<[string, string | undefined]> = ctx
    ? [
        [t("support.contextPack"), ctx.packTitle],
        [t("support.contextQuestionId"), ctx.qid],
        [t("support.contextArticle"), ctx.articleTitle],
      ]
    : [];

  // Shortcut: jump straight into the editor for the reported file, focused
  // on the reported question. Resolves packUid → manifest path → R2 key →
  // managed object (or raw file), then deep-links with `?focus=<qid>`.
  const openInEditor = async () => {
    if (!ctx || resolving) return;
    haptic("selection");
    // Library tickets carry the article file directly — no manifest lookup.
    if (ctx.articleFile && !ctx.packUid) {
      setResolving(true);
      try {
        const key = ctx.articleFile.startsWith("content-files/")
          ? ctx.articleFile
          : `content-files/library/${ctx.articleFile.replace(/^\/+/, "")}`;
        try {
          const lookup = await adminApi.lookupByR2Key(key);
          if (lookup.found && lookup.object) {
            router.push(`/admin/content?id=${encodeURIComponent(lookup.object.id)}`);
            return;
          }
        } catch {
          // Fall through to the raw editor.
        }
        router.push(`/admin/content/raw?key=${encodeURIComponent(key)}`);
      } catch {
        haptic("error");
        toast({ title: t("admin.tickets.editResolveFailed"), variant: "destructive" });
      } finally {
        setResolving(false);
      }
      return;
    }
    if (!ctx.packUid) return;
    setResolving(true);
    try {
      const focusSuffix = ctx.qid ? `&focus=${encodeURIComponent(ctx.qid)}` : "";
      const openKey = async (key: string) => {
        try {
          const lookup = await adminApi.lookupByR2Key(key);
          if (lookup.found && lookup.object) {
            router.push(`/admin/content?id=${encodeURIComponent(lookup.object.id)}${focusSuffix}`);
            return;
          }
        } catch {
          // Fall through to the raw editor.
        }
        router.push(`/admin/content/raw?key=${encodeURIComponent(key)}${focusSuffix}`);
      };
      // 1. Manifest node gives the pack folder + data filenames.
      const node = await loadNodeByUid(ctx.packUid).catch(() => null);
      if (node) {
        let candidates = (node.files ?? []).map((f) => `content-files/qbank/${node.path}${f}`);
        if (candidates.length === 0) {
          // No filenames on the node — discover files under the pack prefix.
          try {
            const listing = await adminApi.listR2Keys(`qbank/${node.path}`);
            candidates = (listing.items ?? []).map((it) => it.key).filter((k) => k.endsWith(".json"));
          } catch {
            candidates = [];
          }
        }
        if (candidates.length === 1) {
          await openKey(candidates[0]);
          return;
        }
        if (candidates.length > 1 && ctx.qid) {
          // Pick the file that actually contains the reported question.
          for (const key of candidates) {
            try {
              const r = await adminApi.getR2Content(key);
              if (r.body.includes(`"${ctx.qid}"`)) {
                await openKey(key);
                return;
              }
            } catch {
              continue;
            }
          }
        }
        if (candidates.length > 0) {
          await openKey(candidates[0]);
          return;
        }
      }
      // 2. Fallback: search managed objects by pack title.
      if (ctx.packTitle) {
        try {
          const r = await adminApi.listContent("all", ctx.packTitle, 1, 5);
          const match = (r.items ?? [])[0];
          if (match) {
            router.push(`/admin/content?id=${encodeURIComponent(match.id)}${focusSuffix}`);
            return;
          }
        } catch {
          // Fall through to the failure toast.
        }
      }
      haptic("error");
      toast({ title: t("admin.tickets.editResolveFailed"), variant: "destructive" });
    } finally {
      setResolving(false);
    }
  };

  const canEdit = !!ctx?.packUid || !!ctx?.articleFile;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pe-6">
            <span className="size-7 rounded-md bg-primary-soft border border-primary/20 flex items-center justify-center shrink-0">
              <SourceIcon className="size-3.5 text-primary" />
            </span>
            <span className="min-w-0 break-words">{ticket.subject}</span>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{ticket.username || t("support.contextGuest")}</span>
            <span>·</span>
            <span>{formatDate(ticket.createdAt)}</span>
            <span>·</span>
            <Badge variant="outline" className="px-1.5 py-0 text-[11px]">{ticket.source}</Badge>
            <Badge variant="outline" className="px-1.5 py-0 text-[11px]">{t(TICKET_CATEGORY_I18N[ticket.category])}</Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {ticket.userInfo ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <span className="size-9 rounded-full bg-primary-soft border border-primary/20 flex items-center justify-center shrink-0 text-sm font-semibold text-primary">
                {(ticket.userInfo.displayName || ticket.userInfo.username || "?").charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1 grid gap-0.5">
                <span className="text-sm font-medium truncate">
                  {ticket.userInfo.displayName || ticket.userInfo.username || t("support.contextGuest")}
                  {ticket.userInfo.username && ticket.userInfo.displayName ? (
                    <span className="text-xs text-muted-foreground font-normal"> @{ticket.userInfo.username}</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {[
                    ticket.userInfo.email,
                    ticket.userInfo.role ? t(ROLE_I18N[ticket.userInfo.role] ?? "admin.users.roles.student") : null,
                    ticket.userInfo.createdAt ? `${t("admin.users.col.joined")} ${new Date(ticket.userInfo.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}` : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </div>
            </div>
          ) : null}

          <p className="text-sm whitespace-pre-wrap break-words">{ticket.message}</p>

          {/* Back-and-forth: other messages in this thread (follow-ups file
              as linked tickets, so the whole conversation reads here). */}
          {thread.filter((m) => m.id !== ticket.id).length > 0 && (
            <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3">
              <div className="text-xs font-semibold text-muted-foreground">{t("support.chat.conversation")}</div>
              {thread
                .filter((m) => m.id !== ticket.id)
                .sort((a, b) => a.createdAt - b.createdAt)
                .map((m) => (
                  <div key={m.id} className="grid gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {m.username || t("support.contextGuest")} · {formatDate(m.createdAt)}
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words">{m.message}</p>
                    {m.reply && (
                      <div className="rounded-md border border-primary/20 bg-primary-soft p-2">
                        <div className="text-[11px] font-semibold text-primary mb-0.5">{t("support.replyLabel")}</div>
                        <p className="text-sm whitespace-pre-wrap break-words">{m.reply}</p>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}

          {ctxEntries.some(([, v]) => v) && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 grid gap-1">
              {ctxEntries.filter(([, v]) => v).map(([label, v]) => (
                <div key={label} className="text-xs text-muted-foreground truncate">
                  <span className="font-medium text-foreground">{label}:</span> {v}
                </div>
              ))}
            </div>
          )}

          <ReportedQuestion question={ctx?.question} />

          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={openInEditor}
              disabled={resolving}
              loading={resolving}
              className="w-full"
            >
              {!resolving && <Pencil className="size-3.5" />}
              {ctx?.packUid ? t("admin.tickets.editQuestion") : t("admin.tickets.openArticle")}
            </Button>
          )}

          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t("admin.tickets.replyPlaceholder")}
            rows={3}
            maxLength={2000}
          />
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            <Select value={status} onValueChange={(v) => { haptic("selection"); setStatus(v as AdminSupportTicket["status"]); }}>
              <SelectTrigger size="sm" className={cn("w-36", STATUS_BADGE_CLASS[status])}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TICKET_STATUS_I18N) as AdminSupportTicket["status"][]).map((s) => (
                  <SelectItem key={s} value={s}>{t(TICKET_STATUS_I18N[s])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ticket.status === "resolved" && (
              <Button
                variant="ghost" size="iconSm"
                onClick={() => { haptic("light"); setConfirmDelete(true); }}
                className="text-muted-foreground hover:text-destructive"
                title={t("admin.tickets.delete")}
                aria-label={t("admin.tickets.delete")}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
          <Button size="sm" onClick={save} disabled={!dirty || saving} loading={saving}>
            {!saving && <Save className="size-3.5" />}
            {t("admin.tickets.save")}
          </Button>
        </DialogFooter>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("admin.tickets.deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("admin.tickets.deleteDesc")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); deleteTicket(); }}
                disabled={deleting}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {t("admin.tickets.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

export function SupportTicketsTable() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [tickets, setTickets] = useState<AdminSupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<TicketStatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.tickets(page, filter)
      .then((r) => {
        setTickets(r.items ?? []);
        setTotal(r.total);
        setOpenCount(r.openCount);
      })
      .catch(() => toast({ title: t("admin.tickets.loadFailed"), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeTicket = tickets.find((tk) => tk.id === activeTicketId) ?? null;
  // Same-page thread grouping (follow-ups carry context.threadId; roots are
  // their own thread). Cross-page mates aren't visible here by design — the
  // dialog labels what it shows as the loaded conversation.
  const threadKeyOf = (tk: AdminSupportTicket) => tk.context?.threadId ?? tk.id;
  const threadCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const tk of tickets) m.set(threadKeyOf(tk), (m.get(threadKeyOf(tk)) ?? 0) + 1);
    return m;
  }, [tickets]);
  const activeThread = useMemo(
    () => (activeTicket ? tickets.filter((tk) => threadKeyOf(tk) === threadKeyOf(activeTicket)) : []),
    [tickets, activeTicket],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filter} onValueChange={(v) => { setFilter(v as TicketStatusFilter); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            {(Object.keys(TICKET_STATUS_I18N) as AdminSupportTicket["status"][]).map((s) => (
              <SelectItem key={s} value={s}>{t(TICKET_STATUS_I18N[s])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground whitespace-nowrap">
          <CircleCheck className="size-3.5" />
          {t("admin.tickets.total", { n: String(total), open: String(openCount) })}
        </span>
      </div>

      {loading ? (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <div className="osler-empty__icon"><LifeBuoy className="size-6" /></div>
          <p className="text-sm text-muted-foreground">{t("admin.tickets.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map((tk) => (
            <TicketRow key={tk.id} ticket={tk} threadCount={threadCounts.get(threadKeyOf(tk)) ?? 1} onOpen={(tk2) => setActiveTicketId(tk2.id)} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="size-4 rtl-flip-x" />
            {t("common.previous")}
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground px-1">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
            {t("common.next")}
            <ChevronRight className="size-4 rtl-flip-x" />
          </Button>
        </div>
      )}

      {activeTicket && (
        <TicketDetailDialog
          key={activeTicket.id}
          ticket={activeTicket}
          thread={activeThread}
          onClose={() => setActiveTicketId(null)}
          onUpdated={(u) => setTickets((prev) => prev.map((x) => (x.id === u.id ? u : x)))}
          onDeleted={(id) => {
            setTickets((prev) => prev.filter((x) => x.id !== id));
            setTotal((n) => Math.max(0, n - 1));
            setActiveTicketId(null);
          }}
        />
      )}
    </div>
  );
}
