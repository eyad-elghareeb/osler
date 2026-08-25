"use client";

import * as React from "react";
import { BarChart3, Layers } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { ChartCard, MetricBar } from "@/components/osler/ui-primitives";
import { ChartEmpty, ChartLoading } from "@/components/osler/analytics-primitives";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AdminApiError, questionStatsApi, type AdminQuestionStatsDetail, type QuestionStatsPack } from "@/components/osler/admin/admin-api";

interface AnalyticsQuestionStatsPanelProps {
  packs: QuestionStatsPack[] | null;
  loading: boolean;
}

const CHOICE_LETTERS = "ABCDEFGHIJKL";

/**
 * Admin view of the per-question choice counters (question_choice_stats).
 * Unlike the student-facing review percentages, this panel shows RAW
 * aggregates with no minimum-sample gate — admins may inspect small
 * cohorts. Pick a pack, see every question's answer distribution.
 */
export function AnalyticsQuestionStatsPanel({ packs, loading }: AnalyticsQuestionStatsPanelProps) {
  const { t } = useI18n();
  const [selected, setSelected] = React.useState<string>("");
  const [detail, setDetail] = React.useState<AdminQuestionStatsDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const uid = selected || (packs && packs.length > 0 ? packs[0].uid : "");

  React.useEffect(() => {
    if (!uid) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setError(null);
    questionStatsApi.detail(uid)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof AdminApiError ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [uid]);

  const questions = detail
    ? Object.entries(detail.stats).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <ChartCard
      title={
        <span className="flex items-center gap-2">
          <BarChart3 className="size-4 text-primary" />
          {t("admin.analytics.qstats.title")}
        </span>
      }
      subtitle={t("admin.analytics.qstats.desc")}
      actions={
        packs && packs.length > 0 ? (
          <Select value={uid} onValueChange={setSelected}>
            <SelectTrigger className="h-8 w-[220px] text-xs" aria-label={t("admin.analytics.qstats.select")}>
              <SelectValue placeholder={t("admin.analytics.qstats.select")} />
            </SelectTrigger>
            <SelectContent>
              {packs.map((p) => (
                <SelectItem key={p.uid} value={p.uid} className="text-xs">
                  {p.uid} ({t("admin.analytics.qstats.responses", { n: p.responses })})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : undefined
      }
    >
      {loading ? (
        <ChartLoading />
      ) : !packs || packs.length === 0 ? (
        <ChartEmpty
          icon={Layers}
          title={t("admin.analytics.noData")}
          description={t("admin.analytics.qstats.desc")}
        />
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !detail || detailLoading ? (
        <ChartLoading />
      ) : questions.length === 0 ? (
        <ChartEmpty
          icon={BarChart3}
          title={t("admin.analytics.noData")}
          description={t("admin.analytics.qstats.desc")}
        />
      ) : (
        <ul className="space-y-4">
          {questions.map(([qid, s]) => {
            const modalIdx = s.c.indexOf(Math.max(...s.c));
            return (
              <li key={qid} className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <code className="font-mono truncate text-foreground">{qid}</code>
                  <span className="shrink-0 text-muted-foreground">
                    {t("admin.analytics.qstats.respondents", { n: s.t })}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {s.c.map((count, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className={`size-5 shrink-0 rounded-full border flex items-center justify-center text-[11px] font-semibold ${
                        idx === modalIdx
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground"
                      }`}>
                        {CHOICE_LETTERS[idx] ?? idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <MetricBar value={count} max={s.t} color="primary" label={`${qid}-${idx}`} />
                      </div>
                      <span className="shrink-0 w-14 text-end font-mono text-xs tabular-nums text-muted-foreground">
                        {Math.round((count / s.t) * 100)}% · {count}
                      </span>
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}
