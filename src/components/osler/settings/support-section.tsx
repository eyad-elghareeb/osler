"use client";

import * as React from "react";
import { LifeBuoy, MessageCircleReply, Plus, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionHeading, EmptyState } from "@/components/osler/ui-primitives";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import {
  listMyTickets,
  TICKET_CATEGORY_I18N,
  TICKET_STATUS_I18N,
  type SupportTicket,
  type TicketStatus,
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

export function SupportSettingsSection() {
  const { t } = useI18n();
  const [tickets, setTickets] = React.useState<SupportTicket[] | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const refresh = React.useCallback(() => {
    listMyTickets().then(setTickets).catch(() => setTickets([]));
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="size-10 rounded-xl bg-primary-soft border border-primary/30 flex items-center justify-center shrink-0">
            <LifeBuoy className="size-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t("support.section.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("support.section.desc")}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={() => { haptic("light"); refresh(); }} title={t("support.section.refresh")} aria-label={t("support.section.refresh")}>
            <RefreshCw className="size-4" />
          </Button>
          <Button size="sm" onClick={() => { haptic("light"); setDialogOpen(true); }}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("support.section.newReport")}</span>
          </Button>
        </div>
      </div>

      <SectionHeading>{t("support.section.history")}</SectionHeading>

      {tickets === null ? (
        <div className="py-16" />
      ) : tickets.length === 0 ? (
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
          {tickets.map((ticket) => (
            <Card key={ticket.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{ticket.subject}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDate(ticket.createdAt)}</span>
                    <span>·</span>
                    <span>{t(TICKET_CATEGORY_I18N[ticket.category])}</span>
                    {!ticket.synced && (
                      <React.Fragment>
                        <span>·</span>
                        <span className="text-warning">{t("support.pendingSync")}</span>
                      </React.Fragment>
                    )}
                  </div>
                </div>
                <Badge variant="outline" className={STATUS_BADGE_CLASS[ticket.status]}>
                  {t(TICKET_STATUS_I18N[ticket.status])}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap break-words">{ticket.message}</p>
              {ticket.reply && (
                <div className="mt-3 rounded-lg border border-primary/20 bg-primary-soft p-3">
                  <div className="text-xs font-semibold text-primary mb-1">{t("support.replyLabel")}</div>
                  <p className="text-sm whitespace-pre-wrap break-words">{ticket.reply}</p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <ReportTicketDialog open={dialogOpen} onOpenChange={setDialogOpen} source="settings" />
    </div>
  );
}
