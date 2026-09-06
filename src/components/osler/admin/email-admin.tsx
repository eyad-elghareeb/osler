"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Send, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { LoadingState, StatTile } from "@/components/osler/ui-primitives";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { emailApi, type EmailOverview } from "@/components/osler/admin/admin-api";

function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Admin → Email: provider status, relay health, delivery stats, and the
 *  recent delivery log (outgoing mail + provider response outcomes). */
export function EmailAdmin() {
  const { t } = useI18n();
  const [data, setData] = useState<EmailOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await emailApi.overview());
    } catch (e) {
      setError(String(e).replace(/^AdminApiError:\s*/, ""));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sendTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await emailApi.sendTest();
      haptic("success");
      setTestResult({ ok: true, msg: t("admin.email.testQueued", { status: res.providerStatus }) });
      await load();
    } catch (e) {
      haptic("error");
      setTestResult({ ok: false, msg: String(e).replace(/^AdminApiError:\s*/, "") });
    } finally {
      setTesting(false);
    }
  }, [load, t]);

  if (loading && !data) {
    return <LoadingState label={t("common.loading")} />;
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0" />
        {error ?? t("admin.email.loadFailed")}
      </div>
    );
  }

  const modeLabel =
    data.provider.mode === "binding"
      ? t("admin.email.modeBinding")
      : data.provider.mode === "relay"
        ? t("admin.email.modeRelay")
        : t("admin.email.modeResend");

  return (
    <div className="space-y-6">
      {/* Provider status */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Mail className="size-4 text-primary" />
            {t("admin.email.providerTitle")}
          </h3>
          {data.provider.ready ? (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <CheckCircle2 className="size-3.5" />
              {t("admin.email.configured")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="size-3.5" />
              {t("admin.email.notConfigured")}
            </span>
          )}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <div className="flex justify-between sm:block">
            <dt className="text-muted-foreground">{t("admin.email.mode")}</dt>
            <dd className="font-mono text-foreground">{modeLabel}</dd>
          </div>
          <div className="flex justify-between sm:block">
            <dt className="text-muted-foreground">{t("admin.email.relayHealth")}</dt>
            <dd className="flex items-center gap-1.5">
              {data.relayHealth ? (
                data.relayHealth.ok ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckCircle2 className="size-3.5" /> {t("admin.email.healthy")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <XCircle className="size-3.5" /> {t("admin.email.unreachable", { status: data.relayHealth.status })}
                  </span>
                )
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </dd>
          </div>
          {data.provider.relayUrl ? (
            <div className="flex justify-between sm:col-span-2 sm:block">
              <dt className="text-muted-foreground">{t("admin.email.relayUrl")}</dt>
              <dd className="font-mono text-foreground break-all">{data.provider.relayUrl}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-3 pt-3 border-t border-border">
          <Button onClick={sendTest} loading={testing} disabled={!data.provider.ready}>
            <Send className="size-3.5" />
            {testing ? t("admin.email.sending") : t("admin.email.sendTest")}
          </Button>
          {testResult ? (
            <span className={cn("ms-3 text-xs", testResult.ok ? "text-success" : "text-destructive")}>{testResult.msg}</span>
          ) : (
            <span className="ms-3 text-xs text-muted-foreground">{t("admin.email.sendTestHint")}</span>
          )}
        </div>
      </div>

      {/* Delivery stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t("admin.email.stat.total")} value={data.stats.total} icon={Mail} color="primary" />
        <StatTile label={t("admin.email.stat.today")} value={data.stats.today} icon={Send} color="info" />
        <StatTile label={t("admin.email.stat.failed")} value={data.stats.failed} icon={AlertTriangle} color={data.stats.failed > 0 ? "warning" : "success"} />
        <StatTile label={t("admin.email.stat.lastSent")} value={<span className="text-sm font-semibold text-foreground">{fmtTime(data.stats.lastSentAt)}</span>} icon={Clock} color="primary" />
      </div>

      {/* Delivery log */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">{t("admin.email.logTitle")}</h3>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            {t("common.refresh")}
          </Button>
        </div>
        {data.log.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{t("admin.email.logEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="osler-table w-full text-xs">
              <thead>
                <tr>
                  <th className="font-medium">{t("admin.email.col.when")}</th>
                  <th className="font-medium">{t("admin.email.col.to")}</th>
                  <th className="font-medium">{t("admin.email.col.subject")}</th>
                  <th className="font-medium">{t("admin.email.col.provider")}</th>
                  <th className="font-medium">{t("admin.email.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {data.log.map((entry, i) => (
                  <tr key={`${entry.createdAt}-${i}`} className="hover:bg-muted/30">
                    <td className="text-muted-foreground whitespace-nowrap">{fmtTime(entry.createdAt)}</td>
                    <td className="font-mono text-[11px] max-w-[220px] truncate">{entry.to}</td>
                    <td className="max-w-[240px] truncate">{entry.subject}</td>
                    <td className="font-mono text-[11px] text-muted-foreground">{entry.provider}</td>
                    <td>
                      {entry.status === "sent" ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CheckCircle2 className="size-3.5" /> {t("admin.email.status.sent")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive" title={entry.error ?? undefined}>
                          <XCircle className="size-3.5" /> {t("admin.email.status.failed")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">{t("admin.email.privacyNote")}</p>
      </div>
    </div>
  );
}
