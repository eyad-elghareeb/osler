"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  LifeBuoy,
  Loader2,
  Save,
  Settings2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** One ticket card: context details + status/reply triage controls. */
function TicketCard({ ticket, onUpdated }: {
  ticket: AdminSupportTicket;
  onUpdated: (t: AdminSupportTicket) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [status, setStatus] = useState(ticket.status);
  const [reply, setReply] = useState(ticket.reply ?? "");
  const [saving, setSaving] = useState(false);
  const SourceIcon = SOURCE_ICON[ticket.source] ?? Settings2;

  // Re-sync local fields when the parent list refreshes.
  useEffect(() => {
    setStatus(ticket.status);
    setReply(ticket.reply ?? "");
  }, [ticket.status, ticket.reply]);

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

  const ctx = ticket.context;
  const ctxEntries: Array<[string, string | undefined]> = ctx
    ? [
        [t("support.contextPack"), ctx.packTitle],
        [t("support.contextQuestionId"), ctx.qid],
        [t("support.contextQuestion"), ctx.questionExcerpt],
        [t("support.contextAnswer"), ctx.selectedAnswer],
        [t("support.contextArticle"), ctx.articleTitle],
      ]
    : [];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="size-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <SourceIcon className="size-3.5 text-muted-foreground" />
            </span>
            <span className="text-sm font-semibold truncate">{ticket.subject}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{ticket.username || t("support.contextGuest")}</span>
            <span>·</span>
            <span>{formatDate(ticket.createdAt)}</span>
            <span>·</span>
            <Badge variant="outline" className="px-1.5 py-0 text-[11px]">{ticket.source}</Badge>
            <Badge variant="outline" className="px-1.5 py-0 text-[11px]">{t(TICKET_CATEGORY_I18N[ticket.category])}</Badge>
          </div>
        </div>
        <Select value={status} onValueChange={(v) => { haptic("selection"); setStatus(v as AdminSupportTicket["status"]); }}>
          <SelectTrigger size="sm" className={cn("w-36 shrink-0", STATUS_BADGE_CLASS[status])}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TICKET_STATUS_I18N) as AdminSupportTicket["status"][]).map((s) => (
              <SelectItem key={s} value={s}>{t(TICKET_STATUS_I18N[s])}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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

      <div className="grid gap-2">
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={t("admin.tickets.replyPlaceholder")}
          rows={2}
          maxLength={2000}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={!dirty || saving} loading={saving}>
            {!saving && <Save className="size-3.5" />}
            {t("admin.tickets.save")}
          </Button>
        </div>
      </div>
    </Card>
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
        <div className="space-y-3">
          {tickets.map((tk) => (
            <TicketCard key={tk.id} ticket={tk} onUpdated={(u) => setTickets((prev) => prev.map((x) => (x.id === u.id ? u : x)))} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="size-4" />
            {t("common.previous")}
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground px-1">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
            {t("common.next")}
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
