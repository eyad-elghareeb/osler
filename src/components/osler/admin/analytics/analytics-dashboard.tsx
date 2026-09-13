"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { AnalyticsVisitorsPanel } from "./analytics-visitors";
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

/** Sections whose data never changes with the range filter — fetched once,
 *  on first expand, instead of on every range switch. */
const STATIC_SECTIONS: ReadonlySet<SectionId> = new Set(["cloudflare", "content", "qstats"]);

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
  const [refreshing, setRefreshing] = useState(false);
  const [openSections, setOpenSections] = useState<Set<SectionId>>(
    new Set(["cloudflare", "volume"] as SectionId[])
  );
  // Sections with a request in flight (drives per-panel skeletons).
  const [pending, setPending] = useState<Set<SectionId>>(new Set());
  // Sections that failed — their panels render data/empty states, not spinners.
  const [failed, setFailed] = useState<Set<SectionId>>(new Set());

  // Freshness markers (refs — logic-only, no re-render needed). Static
  // sections load once ever; range sections reload when the range moves on.
  // In-flight is keyed by what each request is fetching so a range switch
  // mid-flight still fires the new range instead of hiding behind the old one.
  const loadedStatic = useRef<Set<SectionId>>(new Set());
  const loadedRange = useRef<Partial<Record<SectionId, AnalyticsRange>>>({});
  const inFlight = useRef<Map<SectionId, AnalyticsRange | "static">>(new Map());
  const rangeRef = useRef(range);
  rangeRef.current = range;

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

  const failSection = useCallback((err: unknown, id: SectionId) => {
    const status = err instanceof AdminApiError ? err.status : 0;
    toast({
      title: t(status === 503 ? "admin.analytics.error.unavailableTitle" : "admin.analytics.error.title"),
      description: err instanceof Error ? err.message : undefined,
      variant: "destructive",
    });
    setFailed((prev) => new Set(prev).add(id));
  }, [toast, t]);

  /**
   * Fetch data for the given sections only — skipped when already fresh
   * (static sections load once; range sections reload only when the range
   * changed) or already in flight. Collapsed sections never fetch, and
   * expanding one loads just its own data.
   */
  const loadSections = useCallback(async (ids: SectionId[], r: AnalyticsRange) => {
    const targets = ids.filter((id) => {
      const want = STATIC_SECTIONS.has(id) ? ("static" as const) : r;
      if (inFlight.current.get(id) === want) return false;
      if (STATIC_SECTIONS.has(id)) return !loadedStatic.current.has(id);
      return loadedRange.current[id] !== r;
    });
    if (targets.length === 0) return;
    for (const id of targets) {
      inFlight.current.set(id, STATIC_SECTIONS.has(id) ? "static" : r);
    }
    setPending((prev) => new Set([...prev, ...targets]));
    setFailed((prev) => {
      const next = new Set(prev);
      targets.forEach((id) => next.delete(id));
      return next;
    });
    await Promise.all(targets.map(async (id) => {
      try {
        switch (id) {
          case "cloudflare": {
            const cfLimits = await analyticsApi.cloudflareLimits().catch(() => null);
            if (rangeRef.current !== r) return;
            setData((d) => ({ ...d, cfLimits }));
            break;
          }
          case "volume": {
            const [overview, timeseries] = await Promise.all([
              analyticsApi.overview(r),
              analyticsApi.timeseries(r),
            ]);
            if (rangeRef.current !== r) return;
            setData((d) => ({ ...d, overview, timeseries }));
            break;
          }
          case "performance": {
            const [webVitals, apiPerformance] = await Promise.all([
              analyticsApi.webVitals(r),
              analyticsApi.apiPerformance(r, 15),
            ]);
            if (rangeRef.current !== r) return;
            setData((d) => ({ ...d, webVitals, apiPerformance }));
            break;
          }
          case "trafficErrors": {
            const [topPages, errors] = await Promise.all([
              analyticsApi.topPages(r, 15),
              analyticsApi.errors(r, 15),
            ]);
            if (rangeRef.current !== r) return;
            setData((d) => ({ ...d, topPages, errors }));
            break;
          }
          case "content": {
            const content = await analyticsApi.content(15);
            setData((d) => ({ ...d, content }));
            break;
          }
          case "qstats": {
            const packs = await questionStatsApi.packs();
            setData((d) => ({ ...d, qstatsPacks: packs.packs }));
            break;
          }
        }
        if (STATIC_SECTIONS.has(id)) loadedStatic.current.add(id);
        else loadedRange.current[id] = r;
      } catch (err) {
        failSection(err, id);
      } finally {
        inFlight.current.delete(id);
      }
    }));
    setPending((prev) => {
      const next = new Set(prev);
      targets.forEach((id) => next.delete(id));
      return next;
    });
  }, [failSection]);

  // Load whatever the open sections still need — on mount, on expand, and
  // on range change (where only stale range sections refetch).
  useEffect(() => { void loadSections([...openSections], range); }, [loadSections, openSections, range]);

  const refreshOpen = useCallback(async () => {
    setRefreshing(true);
    try {
      for (const id of openSections) {
        if (STATIC_SECTIONS.has(id)) loadedStatic.current.delete(id);
        else delete loadedRange.current[id];
      }
      await loadSections([...openSections], rangeRef.current);
    } finally {
      setRefreshing(false);
    }
  }, [loadSections, openSections]);

  /** A panel spins while its section fetches or while fresh data is missing
   *  (and hasn't failed) — never because an unrelated section is loading. */
  const sectionLoading = (id: SectionId, hasData: boolean) =>
    pending.has(id) || (!hasData && !failed.has(id));

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
            onRefresh={() => void refreshOpen()}
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
        <AnalyticsCloudflareLimitsPanel
          data={data.cfLimits}
          loading={sectionLoading("cloudflare", data.cfLimits != null)}
        />
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
          <AnalyticsTimeseriesPanel
            data={data.timeseries}
            loading={sectionLoading("volume", data.overview != null && data.timeseries != null)}
          />
          {/* Visitor curve rides on the already-fetched timeseries — zero
              extra requests. Freshness follows the section (open / range /
              manual refresh); the dashboard ticker covers live polling. */}
          <AnalyticsVisitorsPanel
            timeseries={data.timeseries}
            loading={sectionLoading("volume", data.timeseries != null)}
          />
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
          <AnalyticsWebVitalsPanel
            data={data.webVitals}
            loading={sectionLoading("performance", data.webVitals != null)}
          />
          <AnalyticsApiPerformancePanel
            data={data.apiPerformance}
            loading={sectionLoading("performance", data.apiPerformance != null)}
          />
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
          <AnalyticsTopPagesPanel
            data={data.topPages}
            loading={sectionLoading("trafficErrors", data.topPages != null)}
          />
          <AnalyticsErrorsPanel
            data={data.errors}
            loading={sectionLoading("trafficErrors", data.errors != null)}
          />
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
        <AnalyticsContentPanel
          data={data.content}
          loading={sectionLoading("content", data.content != null)}
        />
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
        <AnalyticsQuestionStatsPanel
          packs={data.qstatsPacks}
          loading={sectionLoading("qstats", data.qstatsPacks != null)}
        />
      </AnalyticsCollapsibleSection>
    </div>
  );
}
