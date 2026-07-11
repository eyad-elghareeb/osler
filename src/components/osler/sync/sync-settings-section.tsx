"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Wifi, QrCode, FileText, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileSyncPanel } from "./file-sync-panel";
import { NetworkSyncPanel } from "./network-sync-panel";
import { QrSyncPanel } from "./qr-sync-panel";

type SyncTab = "network" | "qr" | "file";

const TABS: Array<{ id: SyncTab; label: string; icon: React.ComponentType<{ className?: string }>; description: string }> = [
  { id: "network", label: "Network", icon: Wifi, description: "Sync over local network via WebRTC" },
  { id: "qr", label: "QR Code", icon: QrCode, description: "Scan QR codes to transfer data" },
  { id: "file", label: "File", icon: FileText, description: "Export/import via backup files" },
];

export function SyncSettingsSection() {
  const [tab, setTab] = React.useState<SyncTab>("network");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Smartphone className="size-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold">Progress Sync</h2>
          <p className="text-xs text-muted-foreground">
            Export, import, and sync your progress across devices.
          </p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-border/60 overflow-x-auto overflow-y-hidden medos-scroll">
        {TABS.map((t) => {
          const I = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative h-10 px-3 sm:px-4 text-sm font-medium flex items-center gap-2 transition-colors shrink-0 whitespace-nowrap",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
              title={t.description}
            >
              <I className="size-4" />
              {t.label}
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
        {tab === "qr" && <QrSyncPanel />}
        {tab === "file" && <FileSyncPanel />}
      </motion.div>
    </div>
  );
}
