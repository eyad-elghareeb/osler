"use client";

import { RefreshCw } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import type { AnalyticsRange } from "@/components/osler/admin/admin-api";

interface AnalyticsFiltersProps {
  range: AnalyticsRange;
  onRangeChange: (r: AnalyticsRange) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export function AnalyticsFilters({
  range,
  onRangeChange,
  onRefresh,
  refreshing,
}: AnalyticsFiltersProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <Select value={range} onValueChange={(v) => onRangeChange(v as AnalyticsRange)}>
        <SelectTrigger id="analytics-range" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="24h">{t("admin.analytics.range.24h")}</SelectItem>
          <SelectItem value="7d">{t("admin.analytics.range.7d")}</SelectItem>
          <SelectItem value="30d">{t("admin.analytics.range.30d")}</SelectItem>
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
        className="gap-2"
      >
        <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
        {t("admin.analytics.refresh")}
      </Button>
    </div>
  );
}
