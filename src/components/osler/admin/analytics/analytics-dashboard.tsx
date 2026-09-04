"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Cloud,
  BarChart2,
  Gauge,
  Globe,
  BookOpen,
  HelpCircle,
  ChevronDown,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
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
  type CloudflareLimitsData,
} from "@/components/osler/admin/admin-api";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AnalyticsFilters } from "./analytics-filters";
import { AnalyticsOverviewTiles } from "./analytics-overview-tiles";
import { AnalyticsTimeseriesPanel } from "./analytics-timeseries-chart";
import { AnalyticsWebVitalsPanel } from "./analytics-web-vitals";
import { AnalyticsTopPagesPanel } from "./analytics-top-pages";
import { AnalyticsErrorsPanel } from "./analytics-errors";
import { AnalyticsApiPerformancePanel } from "./analytics-api-performance";
import { AnalyticsContentPanel } from "./analytics-content";
import { AnalyticsQuestionStatsPanel } from "./analytics-question-stats";
import { AnalyticsCloudflareLimitsPanel } from "./analytics-cloudflare-limits";
import { AnalyticsCollapsibleSection } from "./analytics-collapsible-section";
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
  cfLimits: CloudflareLimitsData | null;
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
  cfLimits: null,
};

const SECTIONS = ["cloudflare", "volume", "performance", "trafficErrors", "content", "qstats"] as const;
type SectionId = (typeof SECTIONS)[number];

function StatusDot({ status }: { status: "healthy" | "warning" | "critical" | "exceeded" }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full shrink-0",
        status === "healthy" && "bg-success",
        status === "warning" && "bg-warning",
        (status === "critical" || status === "exceeded") && "bg-destructive animate-pulse"
      )}
    />
  );
}

export function AnalyticsDashboard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [range, setRange] = useState<AnalyticsRange>("24h");
  const [data, setData] = useState<AnalyticsState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openSections, setOpenSections] = useState<Set<SectionId>>(
    new Set(["cloudflare", "volume"] as SectionId[])
  );

  const allExpanded = openSections.size === SECTIONS.length;

  const toggleSection = useCallback((id: SectionId) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setOpenSections(allExpanded ? new Set() : new Set(SECTIONS));
  }, [allExpanded]);

  const load = useCallback(async (r: AnalyticsRange, isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [overview, timeseries, webVitals, topPages, errors, apiPerformance, content, qstatsPacks, cfLimits] =
        await Promise.all([
          analyticsApi.overview(r),
          analyticsApi.timeseries(r),
          analyticsApi.webVitals(r),
          analyticsApi.topPages(r, 15),
          analyticsApi.errors(r, 15),
          analyticsApi.apiPerformance(r, 15),
          analyticsApi.content(15),
          questionStatsApi.packs(),
          analyticsApi.cloudflareLimits().catch(() => null),
        ]);
      setData({
        overview,
        timeseries,
        webVitals,
        topPages,
        errors,
        apiPerformance,
        content,
        qstatsPacks: qstatsPacks.packs,
        cfLimits,
      });
    } catch (err) {
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

  const cfStatus = data.cfLimits?.status ?? "healthy";
  const cfBadge = data.cfLimits ? (
    <Badge
      variant="outline"
      className={cn(
        "text-[11px] font-medium border gap-1",
        cfStatus === "healthy" && "bg-success/15 text-success border-success/30",
        cfStatus === "warning" && "bg-warning/15 text-warning border-warning/30",
        (cfStatus === "critical" || cfStatus === "exceeded") && "bg-destructive/15 text-destructive border-destructive/30",
      )}
    >
      <StatusDot status={cfStatus} />
      {t(`admin.analytics.cf.status.${cfStatus}`)}
    </Badge>
  ) : null;

  const jsErrorCount = data.overview?.jsErrors ?? 0;
  const errorsBadge = jsErrorCount > 0 ? (
    <Badge variant="outline" className="text-[11px] font-medium border bg-destructive/15 text-destructive border-destructive/30">
      {jsErrorCount.toLocaleString()} errors
    </Badge>
  ) : null;

  return (
    <div className="space-y-3">
      {/* Intro + controls */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">{t("admin.analytics.intro")}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleAll}
            className="gap-1.5 text-xs text-muted-foreground"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", allExpanded && "rotate-180")} />
            {allExpanded ? t("admin.analytics.collapseAll") : t("admin.analytics.expandAll")}
          </Button>
          <AnalyticsFilters
            range={range}
            onRangeChange={setRange}
            onRefresh={() => void load(range, true)}
            refreshing={refreshing}
          />
        </div>
      </div>

      {/* ── Cloudflare Free Tier & Quotas ── */}
      <AnalyticsCollapsibleSection
        id="cloudflare"
        icon={Cloud}
        iconColor="var(--color-info)"
        title={t("admin.analytics.section.cloudflare")}
        description={t("admin.analytics.section.cloudflare.desc")}
        badge={cfBadge}
        open={openSections.has("cloudflare")}
        onToggle={() => toggleSection("cloudflare")}
      >
        <AnalyticsCloudflareLimitsPanel data={data.cfLimits} loading={loading} />
      </AnalyticsCollapsibleSection>

      {/* ── Telemetry Overview & Event Volume ── */}
      <AnalyticsCollapsibleSection
        id="volume"
        icon={BarChart2}
        iconColor="var(--color-primary)"
        title={t("admin.analytics.section.volume")}
        description={t("admin.analytics.section.volume.desc")}
        badge={
          data.overview ? (
            <Badge variant="outline" className="text-[11px] font-medium border bg-primary/10 text-primary border-primary/25">
              {data.overview.totalEvents.toLocaleString()} events
            </Badge>
          ) : null
        }
        open={openSections.has("volume")}
        onToggle={() => toggleSection("volume")}
      >
        <div className="space-y-4">
          <AnalyticsOverviewTiles data={data.overview} />
          <AnalyticsTimeseriesPanel data={data.timeseries} loading={loading} />
        </div>
      </AnalyticsCollapsibleSection>

      {/* ── Web Vitals & API Performance ── */}
      <AnalyticsCollapsibleSection
        id="performance"
        icon={Gauge}
        iconColor="var(--color-success)"
        title={t("admin.analytics.section.performance")}
        description={t("admin.analytics.section.performance.desc")}
        open={openSections.has("performance")}
        onToggle={() => toggleSection("performance")}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AnalyticsWebVitalsPanel data={data.webVitals} loading={loading} />
          <AnalyticsApiPerformancePanel data={data.apiPerformance} loading={loading} />
        </div>
      </AnalyticsCollapsibleSection>

      {/* ── Top Pages & Client Errors ── */}
      <AnalyticsCollapsibleSection
        id="trafficErrors"
        icon={Globe}
        iconColor="var(--color-warning)"
        title={t("admin.analytics.section.trafficErrors")}
        description={t("admin.analytics.section.trafficErrors.desc")}
        badge={errorsBadge}
        open={openSections.has("trafficErrors")}
        onToggle={() => toggleSection("trafficErrors")}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AnalyticsTopPagesPanel data={data.topPages} loading={loading} />
          <AnalyticsErrorsPanel data={data.errors} loading={loading} />
        </div>
      </AnalyticsCollapsibleSection>

      {/* ── Content Engagement ── */}
      <AnalyticsCollapsibleSection
        id="content"
        icon={BookOpen}
        iconColor="var(--color-chart-2)"
        title={t("admin.analytics.section.content")}
        description={t("admin.analytics.section.content.desc")}
        badge={
          data.content ? (
            <Badge variant="outline" className="text-[11px] font-medium border bg-muted text-muted-foreground border-border">
              {data.content.totalUsers} learners
            </Badge>
          ) : null
        }
        open={openSections.has("content")}
        onToggle={() => toggleSection("content")}
      >
        <AnalyticsContentPanel data={data.content} loading={loading} />
      </AnalyticsCollapsibleSection>

      {/* ── Question Choice Statistics ── */}
      <AnalyticsCollapsibleSection
        id="qstats"
        icon={HelpCircle}
        iconColor="var(--color-chart-3)"
        title={t("admin.analytics.section.qstats")}
        description={t("admin.analytics.section.qstats.desc")}
        badge={
          data.qstatsPacks ? (
            <Badge variant="outline" className="text-[11px] font-medium border bg-muted text-muted-foreground border-border">
              {data.qstatsPacks.length} packs
            </Badge>
          ) : null
        }
        open={openSections.has("qstats")}
        onToggle={() => toggleSection("qstats")}
      >
        <AnalyticsQuestionStatsPanel packs={data.qstatsPacks} loading={loading} />
      </AnalyticsCollapsibleSection>
    </div>
  );
}
