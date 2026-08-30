"use client";

/**
 * SessionsSettingsSection — active sign-ins ("devices") for the account.
 *
 * Lists every active cloud session with a human-readable device label
 * derived from the sign-in User-Agent, lets the user revoke any device
 * individually, and offers a one-click "sign out all other devices".
 */

import * as React from "react";
import { Monitor, Smartphone, Loader2, LogOut, ShieldCheck, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import {
  readCloudSession,
  cloudEnabled,
  listCloudSessions,
  revokeCloudSession,
  revokeOtherCloudSessions,
  CloudApiError,
  type CloudSessionInfo,
} from "@/lib/osler/cloud";

/** Browser/OS label parsed from the raw sign-in User-Agent (best effort). */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  let browser = "Browser";
  if (/Edg\//.test(userAgent)) browser = "Edge";
  else if (/OPR\//.test(userAgent)) browser = "Opera";
  else if (/Chrome\//.test(userAgent)) browser = "Chrome";
  else if (/Firefox\//.test(userAgent)) browser = "Firefox";
  else if (/Safari\//.test(userAgent)) browser = "Safari";

  let os = "";
  if (/Windows/.test(userAgent)) os = "Windows";
  else if (/Android/.test(userAgent)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(userAgent)) os = "iOS";
  else if (/Mac OS X|Macintosh/.test(userAgent)) os = "macOS";
  else if (/Linux/.test(userAgent)) os = "Linux";

  return os ? `${browser} · ${os}` : browser;
}

/** Mobile-ish device heuristic for the icon. */
function isMobileDevice(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return /Mobi|Android|iPhone|iPad|iPod/.test(userAgent);
}

/** Compact relative formatter for the "last active" hint. */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "<1m";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  return new Date(ts).toLocaleDateString();
}

export function SessionsSettingsSection() {
  const { t } = useI18n();
  const [session, setSession] = React.useState(() => readCloudSession());
  const [cloudActive, setCloudActive] = React.useState<boolean | null>(null);
  const [sessions, setSessions] = React.useState<CloudSessionInfo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [signingOutOthers, setSigningOutOthers] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const current = readCloudSession();
    setSession(current);
    if (!current) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setSessions(await listCloudSessions(current));
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void cloudEnabled().then((enabled) => setCloudActive(enabled));
    void refresh();
  }, [refresh]);

  const handleRevoke = async (info: CloudSessionInfo) => {
    if (!session) return;
    haptic("warning");
    setBusyId(info.id);
    try {
      await revokeCloudSession(session, info.id);
      await refresh();
    } catch (err) {
      console.error("[osler/sessions] revoke failed:", err);
    } finally {
      setBusyId(null);
    }
  };

  const handleRevokeOthers = async () => {
    if (!session) return;
    haptic("warning");
    setSigningOutOthers(true);
    try {
      await revokeOtherCloudSessions(session);
      await refresh();
    } catch (err) {
      console.error("[osler/sessions] revoke-others failed:", err);
    } finally {
      setSigningOutOthers(false);
    }
  };

  if (cloudActive === false) {
    return (
      <Card className="p-5">
        <h2 className="text-base font-semibold flex items-center gap-2 mb-2">
          <ShieldCheck className="size-4 text-primary" />
          {t("settings.section.sessions")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("settings.account.localGuestDesc")}</p>
      </Card>
    );
  }

  const othersCount = sessions.filter((s) => !s.current).length;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            {t("settings.sessions.title")}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("settings.sessions.desc")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            haptic("selection");
            void refresh();
          }}
          disabled={loading}
          aria-label={t("common.refresh")}
          className="shrink-0 size-8"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {loading ? (
        <div className="py-8 flex items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin me-2" />
          <span className="text-xs">{t("common.loading")}</span>
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          {t("settings.sessions.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {sessions.map((info) => {
            const Icon = isMobileDevice(info.userAgent) ? Smartphone : Monitor;
            const busy = busyId === info.id;
            return (
              <div
                key={info.id}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                  info.current ? "border-primary/40 bg-primary/5" : "border-border",
                )}
              >
                <span className="size-9 rounded-md bg-muted/60 text-muted-foreground flex items-center justify-center shrink-0">
                  <Icon className="size-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {describeDevice(info.userAgent)}
                    </span>
                    {info.current && (
                      <span className="text-[11px] uppercase font-semibold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary shrink-0">
                        {t("settings.sessions.current")}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {t("settings.sessions.lastActive", { when: formatRelative(info.lastSeenAt) })}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRevoke(info)}
                  disabled={busy || info.current}
                  title={info.current ? t("settings.sessions.currentHint") : t("settings.sessions.revoke")}
                  className="gap-1.5 shrink-0 text-xs"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
                  <span className="hidden sm:inline">{t("settings.sessions.revoke")}</span>
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {othersCount > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRevokeOthers()}
            disabled={signingOutOthers || loading}
            className="w-full gap-2 text-xs"
          >
            {signingOutOthers ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <LogOut className="size-3.5" />
            )}
            {t("settings.sessions.signOutOthers", { n: othersCount })}
          </Button>
        </div>
      )}
    </Card>
  );
}
