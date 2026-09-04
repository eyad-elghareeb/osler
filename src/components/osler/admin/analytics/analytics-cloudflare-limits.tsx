"use client";

import * as React from "react";
import {
  Cloud,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  Cpu,
  ShieldCheck,
  Layers,
  ArrowUpRight,
  Activity,
  Zap,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { CloudflareLimitsData, CloudflareLimitMetric } from "@/components/osler/admin/admin-api";
import { LoadingState } from "@/components/osler/ui-primitives";

interface AnalyticsCloudflareLimitsProps {
  data: CloudflareLimitsData | null;
  loading?: boolean;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0m";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getStatusColor(status: CloudflareLimitMetric["status"]): {
  text: string;
  badge: string;
  progress: string;
  icon: string;
} {
  switch (status) {
    case "exceeded":
      return {
        text: "text-destructive",
        badge: "bg-destructive/15 text-destructive border-destructive/30",
        progress: "bg-destructive",
        icon: "text-destructive",
      };
    case "critical":
      return {
        text: "text-destructive",
        badge: "bg-destructive/15 text-destructive border-destructive/30",
        progress: "bg-destructive",
        icon: "text-destructive",
      };
    case "warning":
      return {
        text: "text-warning",
        badge: "bg-warning/15 text-warning border-warning/30",
        progress: "bg-warning",
        icon: "text-warning",
      };
    case "healthy":
    default:
      return {
        text: "text-success",
        badge: "bg-success/15 text-success border-success/30",
        progress: "bg-success",
        icon: "text-success",
      };
  }
}

export function AnalyticsCloudflareLimitsPanel({ data, loading }: AnalyticsCloudflareLimitsProps) {
  const { t } = useI18n();

  if (loading && !data) {
    return <LoadingState label="Loading Cloudflare free tier analytics…" />;
  }

  if (!data) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t("admin.analytics.noData")}
      </div>
    );
  }

  const { metrics, caps, resetAt, d1Tables, safetyThrottles } = data;
  const isApproachingLimits =
    metrics.workerRequests.status !== "healthy" ||
    metrics.d1Writes.status !== "healthy" ||
    metrics.d1Reads.status !== "healthy" ||
    metrics.d1Storage.status !== "healthy" ||
    metrics.r2Storage.status !== "healthy";

  const msToReset = Math.max(0, resetAt - Date.now());

  return (
    <div className="space-y-6">
      {/* Top Banner: Status + UTC Countdown */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-muted/40 border border-border">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Cloud className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {t("admin.analytics.cf.freePlan")}
              </span>
              <Badge
                variant="outline"
                className={cn("text-xs font-medium border", getStatusColor(data.status).badge)}
              >
                {data.status === "healthy" && <CheckCircle2 className="size-3 mr-1" />}
                {data.status !== "healthy" && <AlertTriangle className="size-3 mr-1" />}
                {t(`admin.analytics.cf.status.${data.status}`)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("admin.analytics.cf.resetAtUtc")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background/80 px-3 py-1.5 rounded-lg border border-border">
          <Clock className="size-3.5 text-primary" />
          <span>{t("admin.analytics.cf.resetIn", { time: formatCountdown(msToReset) })}</span>
        </div>
      </div>

      {/* Warning Banner if approaching limits */}
      {isApproachingLimits && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-warning/10 border border-warning/30 text-foreground">
          <AlertTriangle className="size-5 text-warning shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <h3 className="font-semibold text-sm text-warning mb-0.5">
              {t("admin.analytics.cf.alertTitle")}
            </h3>
            <p className="text-muted-foreground">
              {t("admin.analytics.cf.alertDesc")}
            </p>
          </div>
        </div>
      )}

      {/* Main Quota Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* 1. Workers Daily Requests */}
        <QuotaCard
          title={t("admin.analytics.cf.workerReqs")}
          subtitle={t("admin.analytics.cf.workerReqsDesc")}
          current={metrics.workerRequests.current.toLocaleString()}
          limit={metrics.workerRequests.limit.toLocaleString()}
          unit="reqs"
          percentage={metrics.workerRequests.percentage}
          status={metrics.workerRequests.status}
          icon={Zap}
        />

        {/* 2. D1 Database Writes */}
        <QuotaCard
          title={t("admin.analytics.cf.d1Writes")}
          subtitle={t("admin.analytics.cf.d1WritesDesc")}
          current={metrics.d1Writes.current.toLocaleString()}
          limit={metrics.d1Writes.limit.toLocaleString()}
          unit="writes"
          percentage={metrics.d1Writes.percentage}
          status={metrics.d1Writes.status}
          icon={Database}
          extraInfo={
            <div className="mt-3 pt-2.5 border-t border-border/60 text-[11px] text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>{t("admin.analytics.cf.analyticsCap")}:</span>
                <span className="font-medium tabular-nums text-foreground">
                  {caps.analyticsWriteCap.current.toLocaleString()} / {caps.analyticsWriteCap.cap.toLocaleString()} ({caps.analyticsWriteCap.percentage}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t("admin.analytics.cf.qstatsCap")}:</span>
                <span className="font-medium tabular-nums text-foreground">
                  {caps.qstatsWriteCap.current.toLocaleString()} / {caps.qstatsWriteCap.cap.toLocaleString()} ({caps.qstatsWriteCap.percentage}%)
                </span>
              </div>
            </div>
          }
        />

        {/* 3. D1 Database Reads */}
        <QuotaCard
          title={t("admin.analytics.cf.d1Reads")}
          subtitle={t("admin.analytics.cf.d1ReadsDesc")}
          current={metrics.d1Reads.current.toLocaleString()}
          limit={metrics.d1Reads.limit.toLocaleString()}
          unit="reads"
          percentage={metrics.d1Reads.percentage}
          status={metrics.d1Reads.status}
          icon={Activity}
        />

        {/* 4. D1 Database Storage */}
        <QuotaCard
          title={t("admin.analytics.cf.d1Storage")}
          subtitle={t("admin.analytics.cf.d1StorageDesc")}
          current={formatBytes(metrics.d1Storage.current)}
          limit={formatBytes(metrics.d1Storage.limit)}
          unit=""
          percentage={metrics.d1Storage.percentage}
          status={metrics.d1Storage.status}
          icon={HardDrive}
          extraInfo={
            <div className="mt-3 pt-2.5 border-t border-border/60 flex justify-between text-[11px] text-muted-foreground">
              <span>{t("admin.analytics.cf.totalRows", { count: data.totalD1Rows.toLocaleString() })}</span>
              <span className="font-medium text-foreground">{formatBytes(data.totalD1EstimatedBytes)}</span>
            </div>
          }
        />

        {/* 5. R2 Object Storage */}
        <QuotaCard
          title={t("admin.analytics.cf.r2Storage")}
          subtitle={t("admin.analytics.cf.r2StorageDesc")}
          current={formatBytes(metrics.r2Storage.current)}
          limit={formatBytes(metrics.r2Storage.limit)}
          unit=""
          percentage={metrics.r2Storage.percentage}
          status={metrics.r2Storage.status}
          icon={Layers}
          extraInfo={
            <div className="mt-3 pt-2.5 border-t border-border/60 text-[11px] text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>{t("admin.analytics.cf.r2ClassA")}:</span>
                <span className="font-medium tabular-nums text-foreground">
                  {metrics.r2ClassAOps.current.toLocaleString()} / 1M ({metrics.r2ClassAOps.percentage}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t("admin.analytics.cf.r2ClassB")}:</span>
                <span className="font-medium tabular-nums text-foreground">
                  {metrics.r2ClassBOps.current.toLocaleString()} / 10M ({metrics.r2ClassBOps.percentage}%)
                </span>
              </div>
            </div>
          }
        />

        {/* 6. Worker Execution CPU & Subrequests */}
        <QuotaCard
          title={t("admin.analytics.cf.cpuLimit")}
          subtitle={t("admin.analytics.cf.cpuLimitDesc")}
          current={`${data.executionLatency.p50 ?? "—"} ms`}
          limit="10 ms CPU"
          unit=""
          percentage={metrics.workerCpuTime.percentage}
          status={metrics.workerCpuTime.status}
          icon={Cpu}
          extraInfo={
            <div className="mt-3 pt-2.5 border-t border-border/60 text-[11px] text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>p50 / p95 latency:</span>
                <span className="font-medium tabular-nums text-foreground">
                  {data.executionLatency.p50 ?? "—"}ms / {data.executionLatency.p95 ?? "—"}ms
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t("admin.analytics.cf.subrequests")}:</span>
                <span className="font-medium tabular-nums text-success">
                  ≤ 40 / 50 cap (bounded)
                </span>
              </div>
            </div>
          }
        />
      </div>

      {/* D1 Tables & Safety Throttles Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* D1 Storage & Row Breakdown */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Database className="size-4 text-primary" />
              {t("admin.analytics.cf.d1Breakdown")}
            </h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("admin.analytics.cf.totalSize", { size: formatBytes(data.totalD1EstimatedBytes) })}
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground sticky top-0 border-b border-border">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">{t("admin.analytics.cf.col.table")}</th>
                  <th className="py-2 px-3 text-right font-medium">{t("admin.analytics.cf.col.rows")}</th>
                  <th className="py-2 px-3 text-right font-medium">{t("admin.analytics.cf.col.size")}</th>
                  <th className="py-2 px-3 text-right font-medium">{t("admin.analytics.cf.col.retention")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d1Tables.map((tbl) => (
                  <tr key={tbl.table} className="hover:bg-muted/30">
                    <td className="py-1.5 px-3 font-mono text-[11px] text-foreground">{tbl.table}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">{tbl.rowCount.toLocaleString()}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">{formatBytes(tbl.estimatedBytes)}</td>
                    <td className="py-1.5 px-3 text-right text-[11px] text-muted-foreground">{tbl.retention}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Safety Defenses & Throttles */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <ShieldCheck className="size-4 text-success" />
              {t("admin.analytics.cf.safetyThrottles")}
            </h3>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground sticky top-0 border-b border-border">
                <tr>
                  <th className="py-2 px-3 text-left font-medium">{t("admin.analytics.cf.col.defense")}</th>
                  <th className="py-2 px-3 text-left font-medium">{t("admin.analytics.cf.col.threshold")}</th>
                  <th className="py-2 px-3 text-right font-medium">{t("admin.analytics.cf.col.protects")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {safetyThrottles.map((sec, idx) => (
                  <tr key={idx} className="hover:bg-muted/30">
                    <td className="py-2 px-3 font-medium text-foreground flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-success inline-block shrink-0" />
                      {sec.name}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-muted-foreground">{sec.threshold}</td>
                    <td className="py-2 px-3 text-right text-[11px] text-muted-foreground">{sec.protectedQuota}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

interface QuotaCardProps {
  title: string;
  subtitle: string;
  current: string;
  limit: string;
  unit: string;
  percentage: number;
  status: CloudflareLimitMetric["status"];
  icon: React.ElementType;
  extraInfo?: React.ReactNode;
}

function QuotaCard({
  title,
  subtitle,
  current,
  limit,
  percentage,
  status,
  icon: Icon,
  extraInfo,
}: QuotaCardProps) {
  const colors = getStatusColor(status);

  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon className={cn("size-4 shrink-0", colors.icon)} />
            <h4 className="text-sm font-semibold tracking-tight text-foreground truncate">{title}</h4>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{subtitle}</p>
        </div>
        <Badge
          variant="outline"
          className={cn("text-[11px] font-bold tabular-nums shrink-0", colors.badge)}
        >
          {percentage}%
        </Badge>
      </div>

      <div className="my-2.5">
        <div className="flex items-baseline justify-between text-xs mb-1.5">
          <span className="font-bold text-base tabular-nums text-foreground">{current}</span>
          <span className="text-muted-foreground tabular-nums text-xs">/ {limit}</span>
        </div>
        <Progress value={Math.min(100, percentage)} className="h-1.5" />
      </div>

      {extraInfo}
    </div>
  );
}
