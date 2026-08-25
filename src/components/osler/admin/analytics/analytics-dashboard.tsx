"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/osler/i18n-provider";
import { useToast } from "@/hooks/use-toast";
import {
  AdminApiError,
  analyticsApi,
  questionStatsApi,
  type AnalyticsApiPerformance,
  type AnalyticsContent,
  type AnalyticsErrors,
  type AnalyticsOverview,
  type AnalyticsRange,
  type AnalyticsTimeseries,
  type AnalyticsTopPages,
  type AnalyticsWebVitals,
} from "@/components/osler/admin/admin-api";
import { AnalyticsFilters } from "./analytics-filters";
import { AnalyticsOverviewTiles } from "./analytics-overview-tiles";
import { AnalyticsTimeseriesPanel } from "./analytics-timeseries-chart";
import { AnalyticsWebVitalsPanel } from "./analytics-web-vitals";
import { AnalyticsTopPagesPanel } from "./analytics-top-pages";
import { AnalyticsErrorsPanel } from "./analytics-errors";
import { AnalyticsApiPerformancePanel } from "./analytics-api-performance";
import { AnalyticsContentPanel } from "./analytics-content";
import { AnalyticsQuestionStatsPanel } from "./analytics-question-stats";
import type { QuestionStatsPack } from "@/components/osler/admin/admin-api";

interface AnalyticsState {
  overview: AnalyticsOverview | null;
  timeseries: AnalyticsTimeseries | null;
  webVitals: AnalyticsWebVitals | null;
  topPages: AnalyticsTopPages | null;
  errors: AnalyticsErrors | null;
  apiPerformance: AnalyticsApiPerformance | null;
  content: AnalyticsContent | null;
  qstatsPacks: QuestionStatsPack[] | null;
}

const EMPTY_STATE: AnalyticsState = {
  overview: null,
  timeseries: null,
  webVitals: null,
  topPages: null,
  errors: null,
  apiPerformance: null,
  content: null,
  qstatsPacks: null,
};

export function AnalyticsDashboard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [range, setRange] = useState<AnalyticsRange>("24h");
  const [data, setData] = useState<AnalyticsState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (r: AnalyticsRange, isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [overview, timeseries, webVitals, topPages, errors, apiPerformance, content, qstatsPacks] = await Promise.all([
        analyticsApi.overview(r),
        analyticsApi.timeseries(r),
        analyticsApi.webVitals(r),
        analyticsApi.topPages(r, 15),
        analyticsApi.errors(r, 15),
        analyticsApi.apiPerformance(r, 15),
        analyticsApi.content(15),
        questionStatsApi.packs(),
      ]);
      setData({ overview, timeseries, webVitals, topPages, errors, apiPerformance, content, qstatsPacks: qstatsPacks.packs });
    } catch (err) {
      // 503 = cloud backend not configured (typical in local dev preview).
      // Show a softer message in that case.
      const status = err instanceof AdminApiError ? err.status : 0;
      toast({
        title: t(status === 503 ? "admin.analytics.error.unavailableTitle" : "admin.analytics.error.title"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
      setData(EMPTY_STATE);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast, t]);

  useEffect(() => { void load(range); }, [load, range]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("admin.analytics.intro")}</p>
        <AnalyticsFilters
          range={range}
          onRangeChange={setRange}
          onRefresh={() => void load(range, true)}
          refreshing={refreshing}
        />
      </div>

      <AnalyticsOverviewTiles data={data.overview} />

      <AnalyticsTimeseriesPanel data={data.timeseries} loading={loading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsWebVitalsPanel data={data.webVitals} loading={loading} />
        <AnalyticsApiPerformancePanel data={data.apiPerformance} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsTopPagesPanel data={data.topPages} loading={loading} />
        <AnalyticsErrorsPanel data={data.errors} loading={loading} />
      </div>

      <AnalyticsContentPanel data={data.content} loading={loading} />

      <AnalyticsQuestionStatsPanel packs={data.qstatsPacks} loading={loading} />
    </div>
  );
}
