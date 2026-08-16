"use client";

import type { ReactNode } from "react";
import {
  BookOpenCheck, Flag, Gauge, Layers, Target, Timer, Users, Zap,
} from "lucide-react";
import {
  Cell, Pie, PieChart, ResponsiveContainer, Tooltip,
} from "recharts";
import { useI18n } from "@/components/osler/i18n-provider";
import { ChartCard, MetricBar, StatTile } from "@/components/osler/ui-primitives";
import {
  ChartContainer, ChartEmpty, ChartTooltip, chartSeries,
} from "@/components/osler/analytics-primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { ENGINE_META } from "@/lib/osler/content";
import { cn } from "@/lib/utils";
import type { AnalyticsContent } from "@/components/osler/admin/admin-api";

interface AnalyticsContentPanelProps {
  data: AnalyticsContent | null;
  loading: boolean;
}

type BarColor = "primary" | "success" | "warning" | "destructive" | "info";

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

/** Resolve a pack/engine id to a display label + oklch accent, falling back
 *  to the semantic chart palette for ids that aren't a known engine plugin. */
function engineInfo(engine: string, index: number): { label: string; color: string } {
  const meta = (ENGINE_META as Record<string, { label: string; color: string } | undefined>)[engine];
  return meta ?? { label: engine, color: chartSeries(index) };
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function MiniCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function BarListRow({ label, value, max, color, unit }: {
  label: string; value: number; max: number; color: BarColor; unit: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground truncate">{label}</span>
        <span className="shrink-0 font-mono tabular-nums">
          {value.toLocaleString()} <span className="text-muted-foreground">{unit}</span>
        </span>
      </div>
      <MetricBar value={value} max={max} color={color} label={label} />
    </div>
  );
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

  const RECENCY_ROWS: Array<{ key: string; label: string; color: BarColor }> = [
    { key: "24h", label: t("admin.analytics.content.recency.24h"), color: "success" },
    { key: "7d", label: t("admin.analytics.content.recency.7d"), color: "info" },
    { key: "30d", label: t("admin.analytics.content.recency.30d"), color: "warning" },
    { key: "older", label: t("admin.analytics.content.recency.older"), color: "destructive" },
  ];
  const TIER_ROWS: Array<{ key: string; label: string }> = [
    { key: "1", label: t("admin.analytics.content.tier.1") },
    { key: "2to5", label: t("admin.analytics.content.tier.2to5") },
    { key: "6to10", label: t("admin.analytics.content.tier.6to10") },
    { key: "11plus", label: t("admin.analytics.content.tier.11plus") },
  ];
  const BAND_ROWS: Array<{ key: string; label: string; color: BarColor }> = [
    { key: "good", label: t("admin.analytics.content.band.good"), color: "success" },
    { key: "warn", label: t("admin.analytics.content.band.warn"), color: "warning" },
    { key: "bad", label: t("admin.analytics.content.band.bad"), color: "destructive" },
  ];

  const recencyValue = (key: string) =>
    data?.recencyBuckets.find((b) => b.bucket === key)?.packs ?? 0;
  const tierValue = (key: string) =>
    data?.userTiers.find((u) => u.tier === key)?.users ?? 0;
  const bandValue = (key: string) =>
    data?.accuracyBands.find((b) => b.bucket === key)?.packs ?? 0;

  const maxRecency = Math.max(1, ...data?.recencyBuckets.map((b) => b.packs) ?? [1]);
  const maxTier = Math.max(1, ...data?.userTiers.map((u) => u.users) ?? [1]);
  const maxBand = Math.max(1, ...data?.accuracyBands.map((b) => b.packs) ?? [1]);

  const enginePie = (data?.byEngine ?? []).map((e, i) => ({
    ...e,
    name: engineInfo(e.engine, i).label,
  }));

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
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border p-3.5 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-12" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border p-4 space-y-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-24 w-full" />
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
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
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
            <StatTile
              compact
              label={t("admin.analytics.content.kpi.avgAccuracy")}
              value={data.avgAccuracy != null ? `${data.avgAccuracy}%` : "—"}
              icon={Gauge}
              color={data.avgAccuracy != null && data.avgAccuracy < 50 ? "destructive" : "success"}
            />
            <StatTile
              compact
              label={t("admin.analytics.content.kpi.firstTry")}
              value={data.firstTryRate != null ? `${data.firstTryRate}%` : "—"}
              icon={Zap}
              color="info"
            />
            <StatTile
              compact
              label={t("admin.analytics.content.kpi.avgTime")}
              value={fmtDuration(data.avgTimeMs)}
              icon={Timer}
              color="warning"
            />
          </div>

          {/* Insight cards: engine mix / freshness / adoption / accuracy bands */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
            <MiniCard title={t("admin.analytics.content.engineMix")}>
              <div className="relative">
                <ChartContainer height={170}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip
                        content={
                          <ChartTooltip
                            hideLabel
                            valueFormatter={(v) => `${Number(v).toLocaleString()}×`}
                          />
                        }
                      />
                      <Pie
                        data={enginePie}
                        dataKey="attempts"
                        nameKey="name"
                        innerRadius="60%"
                        outerRadius="86%"
                        paddingAngle={2}
                        stroke="var(--card)"
                        strokeWidth={2}
                        isAnimationActive={false}
                      >
                        {enginePie.map((e, i) => (
                          <Cell key={e.engine} fill={engineInfo(e.engine, i).color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-lg font-bold tabular-nums leading-tight">
                    {data.totalAttempts.toLocaleString()}
                  </span>
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {t("admin.analytics.content.kpi.attempts")}
                  </span>
                </div>
              </div>
              {enginePie.map((e, i) => {
                const info = engineInfo(e.engine, i);
                return (
                  <div key={e.engine} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ backgroundColor: info.color }}
                      />
                      <span className="truncate">{info.label}</span>
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground shrink-0">
                      {e.attempts.toLocaleString()}×{e.accuracy != null ? ` · ${e.accuracy}%` : ""}
                    </span>
                  </div>
                );
              })}
            </MiniCard>

            <MiniCard title={t("admin.analytics.content.freshness")}>
              {RECENCY_ROWS.map((r) => (
                <BarListRow
                  key={r.key}
                  label={r.label}
                  value={recencyValue(r.key)}
                  max={maxRecency}
                  color={r.color}
                  unit={t("admin.analytics.content.packsUnit")}
                />
              ))}
            </MiniCard>

            <MiniCard title={t("admin.analytics.content.adoption")}>
              {TIER_ROWS.map((r) => (
                <BarListRow
                  key={r.key}
                  label={r.label}
                  value={tierValue(r.key)}
                  max={maxTier}
                  color="primary"
                  unit={t("admin.analytics.content.usersUnit")}
                />
              ))}
            </MiniCard>

            <MiniCard title={t("admin.analytics.content.accuracyBands")}>
              {BAND_ROWS.map((r) => (
                <BarListRow
                  key={r.key}
                  label={r.label}
                  value={bandValue(r.key)}
                  max={maxBand}
                  color={r.color}
                  unit={t("admin.analytics.content.packsUnit")}
                />
              ))}
              <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t("admin.analytics.content.col.questions")}: {data.totalQuestions.toLocaleString()}
                </span>
                <span className="flex items-center gap-1">
                  <Flag className="size-3 text-warning" />
                  {data.flaggedQuestions.toLocaleString()}
                </span>
              </div>
            </MiniCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {/* Top content */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("admin.analytics.content.topContent")}
              </div>
              <ul className="divide-y divide-border">
                {data.packs.map((p, i) => {
                  const info = engineInfo(p.engine, i);
                  return (
                    <li key={p.uid} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs text-muted-foreground font-mono w-6 shrink-0 text-end">{i + 1}.</span>
                          <span
                            className="size-2 rounded-full shrink-0"
                            style={{ backgroundColor: info.color }}
                            title={info.label}
                          />
                          <code className="font-mono text-xs truncate">{p.uid}</code>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="hidden sm:inline text-[11px] text-muted-foreground">{info.label}</span>
                          <span className="font-mono font-medium tabular-nums">{p.attempts.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="mt-2 ms-8 space-y-1.5">
                        <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${Math.max(4, (p.attempts / maxPackAttempts) * 100)}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{t("admin.analytics.content.col.users")}: {p.users.toLocaleString()}</span>
                          <span>{t("admin.analytics.content.col.questions")}: {p.questions.toLocaleString()}</span>
                          <span>{t("admin.analytics.content.col.accuracy")}: {p.accuracy != null ? `${p.accuracy}%` : "—"}</span>
                          {p.firstTryRate != null && (
                            <span>{t("admin.analytics.content.col.firstTry")}: {p.firstTryRate}%</span>
                          )}
                          {p.avgTimeMs != null && (
                            <span>{t("admin.analytics.content.col.avgTime")}: {fmtDuration(p.avgTimeMs)}</span>
                          )}
                          {p.flagged > 0 && (
                            <span className="text-warning">
                              {t("admin.analytics.content.col.flagged")}: {p.flagged.toLocaleString()}
                            </span>
                          )}
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
                  );
                })}
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
