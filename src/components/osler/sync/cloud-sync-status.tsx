"use client";

import * as React from "react";
import { Cloud, RefreshCw, LogIn, CloudOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";
import { useOslerRouter } from "@/lib/osler/navigation";
import {
  readCloudSession,
  cloudEnabled,
  syncCloudNow,
  getSyncQuota,
} from "@/lib/osler/cloud";
import { haptic } from "@/lib/osler/native";

/**
 * CloudSyncStatusCard — the canonical "Cloud Sync Status" card shared by the
 * Account settings section and the Sync settings section.
 *
 * Signed-in: live status dot (synced / syncing / offline), last-synced time,
 * a "Sync Now" button, and the storage-quota bar.
 * Signed-out / disabled: a compact prompt to sign in from Account settings.
 */
export function CloudSyncStatusCard() {
  const { t } = useI18n();
  const { navigate } = useOslerRouter();
  const [session, setSession] = React.useState<{ token: string } | null>(() => readCloudSession());
  const [cloudActive, setCloudActive] = React.useState(false);
  const [syncState, setSyncState] = React.useState<"synced" | "syncing" | "offline">("synced");
  const [lastSyncedAt, setLastSyncedAt] = React.useState<number | null>(null);
  const [quota, setQuota] = React.useState<{ usedBytes: number; limitBytes: number } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void cloudEnabled().then((enabled) => {
      if (!cancelled) setCloudActive(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const onSyncStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.state) setSyncState(detail.state);
      if (detail?.syncedAt) setLastSyncedAt(detail.syncedAt);
    };
    const onSyncQuota = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.usedBytes === "number" && typeof detail.limitBytes === "number") {
        setQuota(detail);
      }
    };
    window.addEventListener("osler-cloud-sync-status", onSyncStatus);
    window.addEventListener("osler-cloud-sync-quota", onSyncQuota);
    const currentQuota = getSyncQuota();
    if (currentQuota) setQuota(currentQuota);
    return () => {
      window.removeEventListener("osler-cloud-sync-status", onSyncStatus);
      window.removeEventListener("osler-cloud-sync-quota", onSyncQuota);
    };
  }, []);

  const handleManualSync = () => {
    haptic("selection");
    syncCloudNow();
  };

  const handleSignIn = () => {
    haptic("selection");
    navigate("settings", { section: "account" });
  };

  if (!cloudActive) {
    return (
      <Card className="p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <CloudOff className="size-4 text-muted-foreground" />
          {t("settings.account.syncTitle")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("sync.cloud.unavailable")}</p>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card className="p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Cloud className="size-4 text-primary" />
          {t("settings.account.syncTitle")}
        </h3>
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <LogIn className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{t("sync.cloud.signInTitle")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("sync.cloud.signInDesc")}</p>
          </div>
        </div>
        <Button size="sm" variant="default" className="mt-3 gap-1.5" onClick={handleSignIn}>
          <LogIn className="size-3.5" />
          {t("sync.cloud.signIn")}
        </Button>
      </Card>
    );
  }

  const quotaPct = quota && quota.limitBytes > 0 ? Math.round((quota.usedBytes / quota.limitBytes) * 100) : 0;

  return (
    <Card className="p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
        <Cloud className="size-4 text-primary" />
        {t("settings.account.syncTitle")}
      </h3>
      <div className="flex items-center justify-between gap-3 p-3.5 rounded-lg border border-border bg-card">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "size-3 rounded-full shrink-0",
              syncState === "synced"
                ? "bg-success animate-pulse"
                : syncState === "syncing"
                  ? "bg-warning animate-spin"
                  : "bg-muted",
            )}
          />
          <div>
            <div className="text-sm font-semibold">
              {syncState === "synced"
                ? t("settings.account.syncSynced")
                : syncState === "syncing"
                  ? t("settings.account.syncSyncing")
                  : t("settings.account.syncOffline")}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {lastSyncedAt
                ? t("settings.account.lastSynced", { time: new Date(lastSyncedAt).toLocaleTimeString() })
                : t("login.footer")}
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleManualSync}
          disabled={syncState === "syncing"}
          className="gap-1.5 text-xs"
        >
          <RefreshCw className={cn("size-3.5", syncState === "syncing" && "animate-spin")} />
          {t("settings.account.syncNow")}
        </Button>
      </div>
      {quota && quota.limitBytes > 0 && (
        <div className="mt-3.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
            <span>{t("settings.account.quotaTitle")}</span>
            <span>
              {t("settings.account.quotaUsed", {
                used: formatQuotaMB(quota.usedBytes),
                limit: formatQuotaMB(quota.limitBytes),
              })}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full",
                quotaPct >= 90 ? "bg-destructive" : quotaPct >= 70 ? "bg-warning" : "bg-success",
              )}
              style={{ width: `${Math.min(100, quotaPct)}%` }}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function formatQuotaMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}`;
}
