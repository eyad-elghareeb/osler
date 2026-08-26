"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  LifeBuoy,
  Loader2,
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
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { haptic } from "@/lib/osler/native";
import { adminApi, type AdminSupportTicket, type TicketStatusFilter } from "@/components/osler/admin/admin-api";
import { TICKET_CATEGORY_I18N, TICKET_STATUS_I18N } from "@/lib/osler/support";

const SOURCE_ICON = { qbank: ClipboardList, library: BookOpen, settings: Settings2 };
const STATUS_BADGE_CLASS: Record<AdminSupportTicket["status"], string> = {
  open: "bg-warning-soft text-warning border-warning/30",
  in_progress: "bg-info-soft text-info border-info/30",
  resolved: "bg-success-soft text-success border-success/30",
};
const PAGE_SIZE = 25;
const CHOICE_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"];

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
function TicketRow({ ticket, onOpen }: {
  ticket: AdminSupportTicket;
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
        <span className="block text-sm font-medium truncate">{ticket.subject}</span>
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

/** Full triage surface: message + context + attached question, with status,
 *  reply and delete controls. */
function TicketDetailDialog({ ticket, onClose, onUpdated, onDeleted }: {
  ticket: AdminSupportTicket;
  onClose: () => void;
  onUpdated: (t: AdminSupportTicket) => void;
  onDeleted: (id: string) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [status, setStatus] = useState(ticket.status);
  const [reply, setReply] = useState(ticket.reply ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
          <p className="text-sm whitespace-pre-wrap break-words">{ticket.message}</p>

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
            <TicketRow key={tk.id} ticket={tk} onOpen={(tk2) => setActiveTicketId(tk2.id)} />
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
