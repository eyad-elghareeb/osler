"use client";

import { BarChart3, Layers, ListChecks, MessagesSquare } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { ChartCard, MetricBar, StatTile } from "@/components/osler/ui-primitives";
import { ChartEmpty, ChartLoading } from "@/components/osler/analytics-primitives";
import type { QuestionStatsPack } from "@/components/osler/admin/admin-api";

interface AnalyticsQuestionStatsPanelProps {
  packs: QuestionStatsPack[] | null;
  loading: boolean;
}

/**
 * Admin view of MCQ answer-data volume (question_choice_stats).
 * Shows HOW MUCH data has been collected — packs tracked, questions with
 * answers, total responses — instead of per-question choice breakdowns.
 */
export function AnalyticsQuestionStatsPanel({ packs, loading }: AnalyticsQuestionStatsPanelProps) {
  const { t } = useI18n();

  const totalPacks = packs?.length ?? 0;
  const totalQuestions = packs?.reduce((n, p) => n + p.questions, 0) ?? 0;
  const totalResponses = packs?.reduce((n, p) => n + p.responses, 0) ?? 0;
  const maxResponses = Math.max(1, ...(packs?.map((p) => p.responses) ?? [1]));
  const ranked = [...(packs ?? [])].sort((a, b) => b.responses - a.responses);

  return (
    <ChartCard
      title={
        <span className="flex items-center gap-2">
          <BarChart3 className="size-4 text-primary" />
          {t("admin.analytics.qstats.title")}
        </span>
      }
      subtitle={t("admin.analytics.qstats.desc")}
    >
      {loading ? (
        <ChartLoading />
      ) : !packs || packs.length === 0 ? (
        <ChartEmpty
          icon={Layers}
          title={t("admin.analytics.noData")}
          description={t("admin.analytics.qstats.desc")}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatTile
              compact
              label={t("admin.analytics.qstats.kpi.packs")}
              value={totalPacks.toLocaleString()}
              icon={Layers}
              color="primary"
            />
            <StatTile
              compact
              label={t("admin.analytics.qstats.kpi.questions")}
              value={totalQuestions.toLocaleString()}
              icon={ListChecks}
              color="info"
            />
            <StatTile
              compact
              label={t("admin.analytics.qstats.kpi.responses")}
              value={totalResponses.toLocaleString()}
              icon={MessagesSquare}
              color="success"
            />
          </div>

          <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {ranked.map((p) => {
              const avgPerQ = p.questions > 0 ? p.responses / p.questions : 0;
              return (
                <li key={p.uid} className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <code className="font-mono text-xs truncate min-w-0">{p.uid}</code>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {p.responses.toLocaleString()} {t("admin.analytics.qstats.col.responses")}
                    </span>
                  </div>
                  <MetricBar value={p.responses} max={maxResponses} color="primary" label={p.uid} />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{t("admin.analytics.qstats.col.questions")}: {p.questions.toLocaleString()}</span>
                    <span className="ms-auto">
                      {t("admin.analytics.qstats.col.avgPerQ")}: {avgPerQ >= 10 ? Math.round(avgPerQ).toLocaleString() : avgPerQ.toFixed(1)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}
