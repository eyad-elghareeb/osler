"use client";

import * as React from "react";
import { Bell, CheckCheck, LifeBuoy, Megaphone, Sparkles, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { useOslerRouter } from "@/lib/osler/navigation";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/osler/ui-primitives";
import { useNotifications } from "@/hooks/use-notifications";
import type { OslerNotification } from "@/lib/osler/notifications";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const KIND_ICON = {
  content: Sparkles,
  ticket: LifeBuoy,
  announcement: Megaphone,
} as const;

/**
 * Notification center dialog — opened from the profile-photo menu. Ticket
 * rows deep-link into Settings → Support and ask it to open the thread
 * (support-section listens for `osler-open-support-thread`).
 */
export function NotificationsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, lang } = useI18n();
  const { navigate } = useOslerRouter();
  const { items, markRead, markAllRead, dismiss } = useNotifications();

  const unread = items.filter((n) => !n.readAt).length;

  const openTicket = (n: OslerNotification) => {
    haptic("light");
    markRead(n.id);
    onOpenChange(false);
    navigate("settings", { section: "support" });
    const threadId = n.link?.threadId ?? n.ticketId;
    if (threadId) {
      // The support section mounts async (code-split chunk) — retry a few
      // times so the deep-link lands even on a cold chunk load.
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        window.dispatchEvent(new CustomEvent("osler-open-support-thread", { detail: { threadId } }));
        if (attempts >= 10) window.clearInterval(timer);
      }, 300);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85dvh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2 text-start">
          <div className="flex items-center gap-2">
            <span className="size-8 rounded-lg bg-primary-soft border border-primary/20 flex items-center justify-center shrink-0">
              <Bell className="size-4 text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle>{t("notif.title")}</DialogTitle>
              <DialogDescription className="sr-only">{t("notif.desc")}</DialogDescription>
            </div>
            {unread > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  haptic("success");
                  markAllRead();
                }}
                className="shrink-0"
              >
                <CheckCheck className="size-4" />
                {t("notif.markAllRead")}
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-4">
          {items.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={t("notif.empty")}
              description={t("notif.emptyDesc")}
            />
          ) : (
            <ul className="space-y-2">
              {items.map((n) => (
                <NotificationRow
                  key={n.id}
                  item={n}
                  lang={lang}
                  onOpen={() => {
                    if (n.kind === "ticket") openTicket(n);
                    else {
                      haptic("light");
                      markRead(n.id);
                    }
                  }}
                  onDismiss={() => {
                    haptic("light");
                    dismiss(n.id);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NotificationRow({
  item,
  lang,
  onOpen,
  onDismiss,
}: {
  item: OslerNotification;
  lang: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const Icon = KIND_ICON[item.kind];
  const title =
    item.kind === "content"
      ? t("notif.contentTitle")
      : item.kind === "ticket"
        ? t("notif.ticketTitle")
        : lang === "ar" && item.titleAr
          ? item.titleAr
          : (item.title ?? "");
  const body =
    item.kind === "content"
      ? t("notif.contentBody")
      : item.kind === "ticket"
        ? t("notif.ticketBody")
        : lang === "ar" && item.bodyAr
          ? item.bodyAr
          : (item.body ?? "");

  return (
    <li
      className={cn(
        "group relative flex items-start gap-3 rounded-xl border p-3 text-start transition-colors",
        !item.readAt
          ? "border-primary/30 bg-primary/[0.04] hover:bg-primary/[0.07]"
          : "border-border bg-card hover:border-primary/40",
      )}
    >
      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-3 text-start rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={title}
      >
        <span className="size-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Icon className="size-4 text-muted-foreground" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">{title}</span>
            {!item.readAt && <span className="size-2 rounded-full bg-primary shrink-0" aria-hidden />}
          </span>
          {body ? (
            <span className="mt-0.5 block text-sm text-muted-foreground whitespace-pre-wrap break-words">
              {body}
            </span>
          ) : null}
          <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
            {formatDate(item.createdAt)}
          </span>
        </span>
      </button>
      <Button
        variant="ghost"
        size="iconSm"
        onClick={onDismiss}
        aria-label={t("notif.dismiss")}
        title={t("notif.dismiss")}
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <X className="size-3.5" />
      </Button>
    </li>
  );
}
