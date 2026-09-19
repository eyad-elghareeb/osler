"use client";

import * as React from "react";
import {
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  refreshNotifications,
  startNotificationsSync,
  subscribeNotifications,
  type OslerNotification,
} from "@/lib/osler/notifications";

/**
 * Reactive view of the notification center. Starts the background pollers on
 * first mount (idempotent) and re-reads the store on every change event.
 */
export function useNotifications() {
  const [items, setItems] = React.useState<OslerNotification[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let live = true;
    startNotificationsSync();
    listNotifications()
      .then((v) => {
        if (live) setItems(v);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoading(false);
      });
    const reload = () => {
      listNotifications()
        .then((v) => {
          if (live) setItems(v);
        })
        .catch(() => {});
    };
    const off = subscribeNotifications(reload);
    return () => {
      live = false;
      off();
    };
  }, []);

  const unread = React.useMemo(() => items.filter((n) => !n.readAt).length, [items]);

  const markRead = React.useCallback((id: string) => {
    void markNotificationRead(id);
  }, []);

  const markAllRead = React.useCallback(() => {
    void markAllNotificationsRead();
  }, []);

  const dismiss = React.useCallback((id: string) => {
    void dismissNotification(id);
  }, []);

  const refresh = React.useCallback(() => {
    void refreshNotifications();
  }, []);

  return { items, unread, loading, markRead, markAllRead, dismiss, refresh };
}
