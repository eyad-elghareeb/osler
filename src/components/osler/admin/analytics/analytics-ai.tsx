"use client";

import { Sparkles, Users } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { ChartCard, MetricBar } from "@/components/osler/ui-primitives";
import { ChartEmpty, ChartLoading } from "@/components/osler/analytics-primitives";
import type { AnalyticsAi } from "@/components/osler/admin/admin-api";

interface AnalyticsAiPanelProps {
  data: AnalyticsAi | null;
  loading: boolean;
}

export function AnalyticsAiPanel({ data, loading }: AnalyticsAiPanelProps) {
  const { t } = useI18n();

  const maxModelUsers = data?.models.reduce((m, r) => Math.max(m, r.users), 0) ?? 0;

  return (
    <ChartCard
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          {t("admin.analytics.ai.title")}
        </span>
      }
      subtitle={t("admin.analytics.ai.desc")}
    >
      {loading ? (
        <ChartLoading />
      ) : !data || data.keys.totalUsers === 0 ? (
        <ChartEmpty
          icon={Sparkles}
          title={t("admin.analytics.ai.noUsers")}
          description={t("admin.analytics.ai.desc")}
        />
      ) : (
        <div className="space-y-5">
          {/* Key adoption hero */}
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums">
                {data.keys.pct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%
              </span>
              <span className="text-xs text-muted-foreground">
                {t("admin.analytics.ai.keysShare", {
                  with: data.keys.usersWithKey.toLocaleString(),
                  total: data.keys.totalUsers.toLocaleString(),
                })}
              </span>
            </div>
            <MetricBar
              value={data.keys.pct}
              color="primary"
              label={t("admin.analytics.ai.title")}
              className="mt-2"
            />
          </div>

          {/* Usage mini-stats */}
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                { value: data.usage.proxyCalls, label: t("admin.analytics.ai.proxyCalls") },
                { value: data.usage.aiSessions, label: t("admin.analytics.ai.aiSessions") },
                {
                  value: `${data.usage.aiSessionPct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`,
                  label: t("admin.analytics.ai.aiSessionShare"),
                },
              ] as const
            ).map((s) => (
              <div key={s.label} className="rounded-xl border border-border p-3">
                <div className="text-xl font-bold tabular-nums">
                  {typeof s.value === "number" ? s.value.toLocaleString() : s.value}
                </div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mt-0.5">
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Model mix */}
          {data.models.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                {t("admin.analytics.ai.models")}
              </h4>
              <ul className="space-y-2.5">
                {data.models.map((m) => (
                  <li key={m.model ?? "__default"} className="flex items-center gap-3">
                    <code className="text-xs font-mono truncate flex-1">
                      {m.model ?? t("admin.analytics.ai.defaultModel")}
                    </code>
                    <MetricBar
                      value={m.users}
                      max={Math.max(1, maxModelUsers)}
                      color="info"
                      className="w-24 shrink-0"
                    />
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-16 text-end">
                      {t("admin.analytics.ai.users", { n: m.users.toLocaleString() })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
            <Users className="size-3.5 shrink-0 mt-0.5" />
            {t("admin.analytics.ai.privacyNote")}
          </p>
        </div>
      )}
    </ChartCard>
  );
}
