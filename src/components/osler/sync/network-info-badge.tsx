"use client";

/**
 * NetworkInfoBadge — shows the live Network Information API state inside
 * the sync panel, replacing the bare "Room ID" line with a richer view
 * that includes connection type, effective type (2g/3g/4g), downlink
 * speed, RTT, and Data Saver flag.
 *
 * Docs: https://whatpwacando.today/network-info/
 */

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wifi,
  WifiOff,
  Signal,
  SignalLow,
  SignalMedium,
  SignalHigh,
  Gauge,
  Timer,
  Save,
  AlertTriangle,
} from "lucide-react";
import { useNetworkInfo } from "@/hooks/use-native";
import {
  networkTypeLabel,
  effectiveTypeLabel,
  formatDownlink,
  formatRtt,
  networkQualityBand,
  isNetworkGoodForSync,
} from "@/lib/osler/native";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";

function SignalIcon({ band }: { band: number }) {
  if (band >= 4) return <SignalHigh className="size-3.5" />;
  if (band === 3) return <SignalMedium className="size-3.5" />;
  if (band === 2) return <SignalLow className="size-3.5" />;
  return <Signal className="size-3.5" />;
}

export function NetworkInfoBadge() {
  const info = useNetworkInfo();
  const { t } = useI18n();

  // Browser doesn't implement Network Information API (e.g. iOS Safari).
  if (!info.available) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        {t("native.network.unavailable")}
      </div>
    );
  }

  const band = networkQualityBand(info);
  const goodForSync = isNetworkGoodForSync(info);

  return (
    <motion.div
      layout
      className={cn(
        "rounded-lg border px-3 py-2.5 space-y-2",
        info.online
          ? goodForSync
            ? "border-green-500/30 bg-green-500/5"
            : "border-amber-500/30 bg-amber-500/5"
          : "border-destructive/30 bg-destructive/5",
      )}
    >
      {/* Top row: type + effective type */}
      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          {info.online ? (
            <Wifi className={cn("size-3.5", goodForSync ? "text-green-500" : "text-amber-500")} />
          ) : (
            <WifiOff className="size-3.5 text-destructive" />
          )}
          {info.online
            ? networkTypeLabel(info.type)
            : t("native.network.offline")}
        </span>

        {info.online && info.effectiveType !== "unknown" && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <SignalIcon band={band} />
            {effectiveTypeLabel(info.effectiveType)}
          </span>
        )}

        {info.saveData && (
          <span className="ms-auto flex items-center gap-1 text-amber-500 text-[10px] font-medium">
            <Save className="size-3" />
            {t("native.network.saveData")}
          </span>
        )}
      </div>

      {/* Detail row: downlink + RTT */}
      {info.online && (info.downlink > 0 || info.rtt > 0) && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground tabular-nums">
          {info.downlink > 0 && (
            <span className="flex items-center gap-1">
              <Gauge className="size-3" />
              {t("native.network.downlink")}: {formatDownlink(info.downlink)}
            </span>
          )}
          {info.rtt > 0 && (
            <span className="flex items-center gap-1">
              <Timer className="size-3" />
              {t("native.network.rtt")}: {formatRtt(info.rtt)}
            </span>
          )}
        </div>
      )}

      {/* Sync-readiness hint */}
      <AnimatePresence>
        {!info.online ? (
          <motion.div
            key="offline"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-1.5 text-[10px] text-destructive"
          >
            <AlertTriangle className="size-3 shrink-0 mt-0.5" />
            <span>{t("native.network.syncOffline")}</span>
          </motion.div>
        ) : !goodForSync ? (
          <motion.div
            key="poor"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-1.5 text-[10px] text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle className="size-3 shrink-0 mt-0.5" />
            <span>{t("native.network.syncPoor")}</span>
          </motion.div>
        ) : info.saveData ? (
          <motion.div
            key="saveData"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-1.5 text-[10px] text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle className="size-3 shrink-0 mt-0.5" />
            <span>{t("native.network.saveDataOn")}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
