"use client";

import { BookOpenCheck, Layers, Target, Users } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { ChartCard, StatTile } from "@/components/osler/ui-primitives";
import { ChartEmpty, ChartLoading } from "@/components/osler/analytics-primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AnalyticsContent } from "@/components/osler/admin/admin-api";

interface AnalyticsContentPanelProps {
  data: AnalyticsContent | null;
  loading: boolean;
}

const ACCURACY_COLORS: Record<string, string> = {
  good: "bg-success-soft text-success border-success/30",
  warn: "bg-warning-soft text-warning border-warning/30",
  bad:  "bg-destructive-soft text-destructive border-destructive/30",
  "n/a":"bg-muted text-muted-foreground border-border",
};

function ratingAcc(accuracy: number | null): "good" | "warn" | "bad" | "n/a" {
  if (accuracy == null) return "n/a";
  if (accuracy >= 80) return "good";
  if (accuracy >= 50) return "warn";
  return "bad";
}

export function AnalyticsContentPanel({ data, loading }: AnalyticsContentPanelProps) {
  const { t } = useI18n();

  const fmtWhen = (ts: number | null): string => {
    if (!ts) return "—";
    const diff = Date.now() - ts;
    if (diff < 60_000) return t("admin.analytics.justNow");
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return t("admin.analytics.minutesAgo", { n: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("admin.analytics.hoursAgo", { n: hours });
    return t("admin.analytics.daysAgo", { n: Math.floor(hours / 24) });
  };

  const maxPackAttempts = Math.max(1, data?.packs?.[0]?.attempts ?? 1);
  const maxUserAttempts = Math.max(1, data?.topUsers?.[0]?.attempts ?? 1);

  return (
    <ChartCard
      title={
        <span className="flex items-center gap-2">
          <BookOpenCheck className="size-4 text-primary" />
          {t("admin.analytics.content.title")}
        </span>
      }
      subtitle={t("admin.analytics.content.desc")}
    >
      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border p-3.5 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-12" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border overflow-hidden">
                <div className="border-b border-border bg-muted/40 px-4 py-2.5">
                  <Skeleton className="h-4 w-32" />
                </div>
                {Array.from({ length: 5 }).map((__, j) => (
                  <div key={j} className="flex items-center justify-between gap-3 border-b border-border last:border-0 px-4 py-3">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : !data || data.packs.length === 0 ? (
        <ChartEmpty
          icon={BookOpenCheck}
          title={t("admin.analytics.content.noPacks")}
          description={t("admin.analytics.content.desc")}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatTile
              compact
              label={t("admin.analytics.content.kpi.packs")}
              value={data.totalPacks.toLocaleString()}
              icon={Layers}
              color="primary"
            />
            <StatTile
              compact
              label={t("admin.analytics.content.kpi.users")}
              value={data.totalUsers.toLocaleString()}
              icon={Users}
              color="info"
            />
            <StatTile
              compact
              label={t("admin.analytics.content.kpi.attempts")}
              value={data.totalAttempts.toLocaleString()}
              icon={Target}
              color="success"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {/* Top content */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("admin.analytics.content.topContent")}
              </div>
              <ul className="divide-y divide-border">
                {data.packs.map((p, i) => (
                  <li key={p.uid} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-muted-foreground font-mono w-6 shrink-0 text-end">{i + 1}.</span>
                        <code className="font-mono text-xs truncate">{p.uid}</code>
                      </div>
                      <span className="font-mono font-medium tabular-nums shrink-0">{p.attempts.toLocaleString()}</span>
                    </div>
                    <div className="mt-2 ms-8 space-y-1.5">
                      <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${Math.max(4, (p.attempts / maxPackAttempts) * 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{t("admin.analytics.content.col.users")}: {p.users.toLocaleString()}</span>
                        <span>{t("admin.analytics.content.col.accuracy")}: {p.accuracy != null ? `${p.accuracy}%` : "—"}</span>
                        <span className="ms-auto">{t("admin.analytics.content.col.lastSolved")}: {fmtWhen(p.lastSolvedAt)}</span>
                      </div>
                      {p.topUsers.length > 0 && (
                        <div className="rounded-md border border-border bg-card px-3 py-2 space-y-1">
                          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                            {t("admin.analytics.content.topUsersInPack")}
                          </div>
                          {p.topUsers.map((u) => (
                            <div key={u.username} className="flex items-center justify-between gap-3 text-xs">
                              <span className="truncate">{u.username}</span>
                              <span className="font-mono tabular-nums shrink-0">
                                {u.attempts.toLocaleString()}× {u.accuracy != null ? `· ${u.accuracy}%` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Top learners */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("admin.analytics.content.topUsers")}
              </div>
              <ul className="divide-y divide-border">
                {data.topUsers.map((u, i) => {
                  const r = ratingAcc(u.accuracy);
                  return (
                    <li key={u.username} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs text-muted-foreground font-mono w-6 shrink-0 text-end">{i + 1}.</span>
                          <span className="text-sm font-medium truncate">{u.username}</span>
                        </div>
                        <span className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium font-mono tabular-nums shrink-0",
                          ACCURACY_COLORS[r],
                        )}>
                          {u.accuracy != null ? `${u.accuracy}%` : "—"}
                        </span>
                      </div>
                      <div className="mt-2 ms-8 space-y-1.5">
                        <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", r === "good" ? "bg-success/70" : r === "warn" ? "bg-warning/70" : "bg-destructive/70")}
                            style={{ width: `${Math.max(4, (u.attempts / maxUserAttempts) * 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{t("admin.analytics.content.col.packs")}: {u.packs.toLocaleString()}</span>
                          <span className="ms-auto">{t("admin.analytics.content.col.attempts")}: {u.attempts.toLocaleString()}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </ChartCard>
  );
}
