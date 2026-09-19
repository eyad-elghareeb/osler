"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, LifeBuoy, MessageCircleReply, Plus, RefreshCw, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeading, EmptyState, LoadingState } from "@/components/osler/ui-primitives";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  fileFollowUp,
  groupTicketsIntoThreads,
  listMyTickets,
  OPEN_SUPPORT_THREAD_EVENT,
  TICKET_CATEGORY_I18N,
  TICKET_STATUS_I18N,
  type SupportTicket,
  type TicketStatus,
  type TicketThread,
} from "@/lib/osler/support";
import { ReportTicketDialog } from "@/components/osler/report-ticket-dialog";

const STATUS_BADGE_CLASS: Record<TicketStatus, string> = {
  open: "bg-warning-soft text-warning border-warning/30",
  in_progress: "bg-info-soft text-info border-info/30",
  resolved: "bg-success-soft text-success border-success/30",
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export function SupportSettingsSection() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [tickets, setTickets] = React.useState<SupportTicket[] | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [activeThreadId, setActiveThreadId] = React.useState<string | null>(null);

  const queryThread = searchParams?.get("thread") || searchParams?.get("ticket");
  React.useEffect(() => {
    if (queryThread) {
      setActiveThreadId(queryThread);
    }
  }, [queryThread]);

  const refresh = React.useCallback(() => {
    listMyTickets().then(setTickets).catch(() => setTickets([]));
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // Notification deep-links (and admin "view report" shortcuts) arrive here —
  // the id sticks even when the receipts haven't loaded yet.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail?.threadId;
      if (typeof id === "string" && id) {
        haptic("light");
        setActiveThreadId(id);
      }
    };
    window.addEventListener(OPEN_SUPPORT_THREAD_EVENT, handler);
    return () => window.removeEventListener(OPEN_SUPPORT_THREAD_EVENT, handler);
  }, []);

  const threads = React.useMemo(
    () => (tickets ? groupTicketsIntoThreads(tickets) : null),
    [tickets],
  );

  const activeThread = threads?.find(
    (th) => th.id === activeThreadId || th.tickets.some((t) => t.id === activeThreadId)
  ) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          {activeThread ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                haptic("selection");
                setActiveThreadId(null);
              }}
              aria-label={t("support.chat.back")}
              title={t("support.chat.back")}
              className="shrink-0"
            >
              <ArrowLeft className="size-4 rtl-flip-x" />
            </Button>
          ) : (
            <div className="size-10 rounded-xl bg-primary-soft border border-primary/30 flex items-center justify-center shrink-0">
              <LifeBuoy className="size-5 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">
              {activeThread ? activeThread.subject : t("support.section.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {activeThread
                ? `${t(TICKET_CATEGORY_I18N[activeThread.category])} · ${formatDate(activeThread.tickets[0].createdAt)}`
                : t("support.section.desc")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {activeThread && (
            <Badge variant="outline" className={STATUS_BADGE_CLASS[activeThread.status]}>
              {t(TICKET_STATUS_I18N[activeThread.status])}
            </Badge>
          )}
          <Button variant="ghost" size="icon" onClick={() => { haptic("light"); refresh(); }} title={t("support.section.refresh")} aria-label={t("support.section.refresh")}>
            <RefreshCw className="size-4" />
          </Button>
          {!activeThread && (
            <Button size="sm" onClick={() => { haptic("light"); setDialogOpen(true); }}>
              <Plus className="size-4" />
              <span className="hidden sm:inline">{t("support.section.newReport")}</span>
            </Button>
          )}
        </div>
      </div>

      {threads === null ? (
        <LoadingState />
      ) : activeThread ? (
        <ThreadView key={activeThread.id} thread={activeThread} onSent={refresh} />
      ) : (
        <React.Fragment>
          <SectionHeading>{t("support.section.history")}</SectionHeading>
          {threads.length === 0 ? (
            <EmptyState
              icon={MessageCircleReply}
              title={t("support.section.emptyTitle")}
              description={t("support.section.emptyDesc")}
              actions={
                <Button variant="outline" onClick={() => { haptic("light"); setDialogOpen(true); }}>
                  {t("support.section.newReport")}
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {threads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  onOpen={() => {
                    haptic("selection");
                    setActiveThreadId(thread.id);
                  }}
                />
              ))}
            </div>
          )}
        </React.Fragment>
      )}

      <ReportTicketDialog open={dialogOpen} onOpenChange={setDialogOpen} source="settings" />
    </div>
  );
}

function ThreadRow({ thread, onOpen }: { thread: TicketThread; onOpen: () => void }) {
  const { t } = useI18n();
  const last = thread.tickets[thread.tickets.length - 1];
  const excerpt = last.reply ?? last.message;
  return (
    <button
      onClick={onOpen}
      className="group w-full flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-start transition-colors hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <span className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary-soft transition-colors">
        <MessageCircleReply className="size-4 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate">{thread.subject}</span>
          {thread.tickets.length > 1 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {t("support.chat.threadCount", { n: String(thread.tickets.length) })}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground truncate">
          {thread.hasReply ? `${t("support.replyLabel")}: ` : ""}{excerpt}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
          {formatDate(thread.latestAt)} · {t(TICKET_CATEGORY_I18N[thread.category])}
          {!last.synced && <span className="text-warning"> · {t("support.pendingSync")}</span>}
        </span>
      </span>
      <Badge variant="outline" className={cn("shrink-0", STATUS_BADGE_CLASS[thread.status])}>
        {t(TICKET_STATUS_I18N[thread.status])}
      </Badge>
    </button>
  );
}

/** Chat thread: user messages on the inline-end side, admin replies opposite. */
function ThreadView({ thread, onSent }: { thread: TicketThread; onSent: () => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread.id, thread.tickets.length]);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      const receipt = await fileFollowUp(thread, message);
      haptic(receipt.synced ? "success" : "warning");
      toast({
        title: t("support.successTitle"),
        description: t(receipt.synced ? "support.successDesc" : "support.pendingDesc"),
      });
      setDraft("");
      onSent();
    } catch {
      haptic("error");
      toast({ title: t("support.errorTitle"), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        {thread.tickets.map((ticket) => (
          <React.Fragment key={ticket.id}>
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap break-words">
                {ticket.message}
                <div className="mt-1 text-[11px] opacity-80 tabular-nums">
                  {formatTime(ticket.createdAt)}
                  {!ticket.synced && ` · ${t("support.pendingSync")}`}
                </div>
              </div>
            </div>
            {ticket.reply && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap break-words">
                  <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("support.chat.admin")}
                  </div>
                  {ticket.reply}
                </div>
              </div>
            )}
          </React.Fragment>
        ))}
        <div ref={bottomRef} />
      </Card>

      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
          placeholder={t("support.chat.messagePlaceholder")}
          rows={2}
          maxLength={5000}
          className="flex-1 resize-none"
          aria-label={t("support.chat.messagePlaceholder")}
        />
        <Button onClick={send} loading={sending} disabled={!draft.trim()} aria-label={t("support.chat.send")}>
          {!sending && <Send className="size-4" />}
          <span className="hidden sm:inline">{t("support.chat.send")}</span>
        </Button>
      </div>
    </div>
  );
}
