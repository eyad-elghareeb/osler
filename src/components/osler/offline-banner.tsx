"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CloudOff, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { useNetworkInfo } from "@/hooks/use-native";
import { haptic } from "@/lib/osler/native";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import { useOslerRouter } from "@/lib/osler/navigation";
import { cn } from "@/lib/utils";

type BannerMode = "hidden" | "offline" | "reconnected";

/**
 * Persistent slim banner while offline (with how many packs are downloaded),
 * plus a transient "Back online" confirmation on reconnect. The pack count
 * comes from the service worker's downloaded-pack registry via
 * GET_CONTENT_CACHE_STATS (`packCount`).
 */
export function OfflineBanner() {
  const { t } = useI18n();
  const { online } = useNetworkInfo();
  const { navigate } = useOslerRouter();
  const [mode, setMode] = React.useState<BannerMode>("hidden");
  const [packCount, setPackCount] = React.useState<number | null>(null);
  // Starts true so a page that BOOTS offline (installed PWA, airplane mode)
  // flips into the offline banner on the first effect run.
  const wasOnline = React.useRef(true);
  const dismissTimer = React.useRef<number | null>(null);

  const swController =
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    navigator.serviceWorker.controller
      ? navigator.serviceWorker.controller
      : null;

  // Collect the SW's stats replies — we only care about the registry count.
  React.useEffect(() => {
    if (!swController) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; packCount?: number };
      if (d?.type === "CONTENT_CACHE_STATS" && typeof d.packCount === "number") {
        setPackCount(d.packCount);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [swController]);

  const requestStats = React.useCallback(() => {
    swController?.postMessage({ type: "GET_CONTENT_CACHE_STATS" });
  }, [swController]);

  React.useEffect(() => {
    if (wasOnline.current === online) return;
    wasOnline.current = online;
    if (!online) {
      if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current);
      setMode("offline");
      haptic("warning");
    } else {
      setMode("reconnected");
      haptic("success");
      dismissTimer.current = window.setTimeout(() => setMode("hidden"), 2500);
    }
  }, [online]);

  // Refresh the pack count when offline — twice, in case the SW finished
  // registering packs between the first ask and now.
  React.useEffect(() => {
    if (online || !swController) return;
    requestStats();
    const timer = window.setTimeout(requestStats, 2500);
    return () => window.clearTimeout(timer);
  }, [online, swController, requestStats]);

  React.useEffect(
    () => () => {
      if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current);
    },
    []
  );

  const detail =
    packCount === null
      ? null
      : packCount === 0
        ? t("offline.banner.noPacks")
        : packCount === 1
          ? t("offline.banner.onePack")
          : t("offline.banner.packs", { n: packCount });

  return (
    <AnimatePresence initial={false}>
      {mode !== "hidden" && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={MOTION_TRANSITION.base}
          className="shrink-0 overflow-hidden"
        >
          <div
            role="status"
            className={cn(
              "flex items-center gap-2 border-b px-4 py-2 text-xs",
              mode === "offline"
                ? "border-warning/30 bg-warning-soft"
                : "border-success/30 bg-success-soft"
            )}
          >
            {mode === "offline" ? (
              <CloudOff className="size-4 shrink-0 text-warning" />
            ) : (
              <Wifi className="size-4 shrink-0 text-success" />
            )}
            <p className="min-w-0 flex-1 text-foreground">
              <span className="font-semibold">
                {mode === "offline" ? t("offline.banner.title") : t("offline.banner.back")}
              </span>
              {mode === "offline" && detail && (
                <span className="text-muted-foreground"> · {detail}</span>
              )}
            </p>
            {mode === "offline" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  haptic("light");
                  navigate("settings", { section: "downloads" });
                }}
              >
                {t("offline.banner.manage")}
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
