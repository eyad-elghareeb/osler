"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, Settings2, X, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NetworkSyncPanel } from "./network-sync-panel";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";

export function SyncModal({
  open,
  onClose,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();

  const dismissProps = useSwipeBackDismiss({
    onDismiss: onClose,
    direction: "vertical",
    disabled: !open,
  });

  const handleClose = () => {
    haptic("light");
    onClose();
  };

  const handleOpenSettings = () => {
    haptic("selection");
    onOpenSettings();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <motion.div
            className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-border bg-background shadow-xl overflow-hidden"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            {...dismissProps}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
              <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Wifi className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold">{t("sync.title")}</h2>
                <p className="text-[11px] text-muted-foreground truncate">{t("sync.subtitle")}</p>
              </div>
              <button
                onClick={handleClose}
                className="size-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
                aria-label={t("common.cancel")}
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Body — quick network sync */}
            <div className="flex-1 overflow-y-auto medos-scroll p-4">
              <NetworkSyncPanel />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border shrink-0">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleOpenSettings}>
                <Settings2 className="size-3.5 me-1.5" />
                {t("settings.section.sync.open")}
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={handleClose}>
                <RefreshCw className="size-3.5 me-1.5 rtl-flip-x" />
                {t("common.cancel")}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
