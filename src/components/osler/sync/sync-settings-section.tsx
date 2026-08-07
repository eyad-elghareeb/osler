"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Smartphone } from "lucide-react";
import { NetworkSyncPanel } from "./network-sync-panel";
import { CloudSyncStatusCard } from "./cloud-sync-status";
import { useI18n } from "@/components/osler/i18n-provider";

export function SyncSettingsSection() {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Smartphone className="size-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold">{t("sync.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("sync.subtitle")}</p>
        </div>
      </div>

      {/* Cloud account sync — same card as the Account section, so users can
          check their cloud status / quota without leaving the sync hub. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        <CloudSyncStatusCard />
      </motion.div>

      {/* The Network panel is the sole P2P sync surface here. The Peer-link QR
          is embedded inline in the Network panel. File backup/restore has its
          own top-level settings tab. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        <NetworkSyncPanel />
      </motion.div>
    </div>
  );
}
