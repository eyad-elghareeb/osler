"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Wifi, FileText, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileSyncPanel } from "./file-sync-panel";
import { NetworkSyncPanel } from "./network-sync-panel";
import { useI18n } from "@/components/osler/i18n-provider";

type SyncTab = "network" | "file";

export function SyncSettingsSection() {
  const { t } = useI18n();
  const TABS: Array<{
    id: SyncTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
  }> = [
    {
      id: "network",
      label: t("sync.tab.network"),
      icon: Wifi,
      description: t("sync.tab.networkDesc"),
    },
    {
      id: "file",
      label: t("sync.tab.file"),
      icon: FileText,
      description: t("sync.tab.fileDesc"),
    },
  ];
  const [tab, setTab] = React.useState<SyncTab>("network");

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

      {/* Sub-tabs — QR is no longer a separate tab. The Peer-link QR is
          embedded inline in the Network panel. */}
      <div className="flex items-center gap-1 border-b border-border/60 overflow-x-auto overflow-y-hidden medos-scroll">
        {TABS.map((tabDef) => {
          const I = tabDef.icon;
          const active = tab === tabDef.id;
          return (
            <button
              key={tabDef.id}
              onClick={() => setTab(tabDef.id)}
              className={cn(
                "relative h-10 px-3 sm:px-4 text-sm font-medium flex items-center gap-2 transition-colors shrink-0 whitespace-nowrap",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
              title={tabDef.description}
            >
              <I className="size-4" />
              {tabDef.label}
              {active && <div className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        {tab === "network" && <NetworkSyncPanel />}
        {tab === "file" && <FileSyncPanel />}
      </motion.div>
    </div>
  );
}
