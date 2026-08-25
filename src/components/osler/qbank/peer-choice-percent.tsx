"use client";

import { useI18n } from "@/components/osler/i18n-provider";
import type { QuestionChoiceStats } from "@/lib/osler/question-stats";

/**
 * UWorld-style "% of test-takers chose this" label for one choice row.
 * Renders nothing when there's no peer data (offline, cloud disabled, or
 * below the worker's minimum-sample threshold) or when the aggregate went
 * stale — i.e. the pack's choices were edited after the counter accrued
 * (recorded options_count no longer matches), which would make percentages
 * point at the wrong options.
 */
export function PeerChoicePercent({
  stat,
  idx,
  optionsCount,
}: {
  stat?: QuestionChoiceStats;
  idx: number;
  optionsCount: number;
}) {
  const { t } = useI18n();
  if (!stat || !stat.t || stat.c.length === 0) return null;
  if (stat.oc > 0 && stat.oc !== optionsCount) return null;
  const count = idx < stat.c.length ? stat.c[idx] : 0;
  const pct = Math.round((count / stat.t) * 100);
  return (
    <div
      className="shrink-0 self-center ps-1 text-xs font-medium tabular-nums text-muted-foreground"
      aria-label={t("qbank.stats.chosenBy", { n: pct })}
    >
      {pct}%
    </div>
  );
}
