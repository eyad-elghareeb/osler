"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Share, X, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { settings } from "@/lib/osler/storage";
import { useI18n } from "@/components/osler/i18n-provider";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIos() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iosDevice =
    /iP(hone|ad|od)/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iosDevice && !("MSStream" in window);
}

export function PwaInstallButton({ className }: { className?: string }) {
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = React.useState(false);
  const [hint, setHint] = React.useState(false);

  React.useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const { t } = useI18n();
  const [dismissed, setDismissed] = React.useState(false);
  const [checkingDismiss, setCheckingDismiss] = React.useState(true);

  React.useEffect(() => {
    settings.getBool("dismiss-pwa-hint").then((val) => {
      setDismissed(val);
      setCheckingDismiss(false);
    });
  }, []);

  if (installed) return null;
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(display-mode: standalone)").matches
  ) {
    return null;
  }

  // PWA install requires a secure context (HTTPS or localhost). Over a plain
  // LAN IP the browser will never offer install — tell the user clearly.
  const isSecure =
    typeof window === "undefined" ||
    window.isSecureContext ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  const canPrompt = Boolean(deferred);
  const showIos = isIos() && !canPrompt;

  const handleInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setDeferred(null);
  };

  const iconBtn = (label: string, onClick?: () => void, icon?: React.ReactNode) => (
    <button
      onClick={onClick}
      aria-label={label}
      title={t("pwa.installOsler")}
      className="size-9 rounded-md hover:bg-muted/60 transition-colors flex items-center justify-center shrink-0"
    >
      {icon ?? <Download className="size-4" />}
    </button>
  );

  if (dismissed && !checkingDismiss) return null;

  if (canPrompt) {
    return (
      <button
        onClick={handleInstall}
        aria-label={t("pwa.installApp")}
        title={t("pwa.installOsler")}
        className={cn(
          "size-9 rounded-md hover:bg-muted/60 transition-colors flex items-center justify-center shrink-0",
          className
        )}
      >
        <Download className="size-4" />
      </button>
    );
  }

  // No native prompt captured (Android without active SW, or iOS). Show a
  // discoverable button that guides the user to install from the browser.
  return (
    <div className={cn("relative shrink-0", className)}>
      {iconBtn(t("pwa.installApp"), () => setHint((s) => !s), <Download className="size-4" />)}
      <AnimatePresence>
        {hint && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 top-11 z-50 w-64 rounded-lg border border-border bg-popover p-3 text-xs shadow-lg"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">{t("pwa.installOsler")}</span>
              <button
                onClick={() => setHint(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={t("common.close")}
              >
                <X className="size-3.5" />
              </button>
            </div>
            {showIos ? (
              <p className="text-muted-foreground leading-relaxed">
                {t("pwa.iosHint").replace("{icon}", "")}
                <Share className="size-3.5 inline-block align-text-bottom mx-0.5" />
                <span className="text-foreground">{t("pwa.addToHomeScreen")}</span>.
              </p>
            ) : !isSecure ? (
              <p className="text-muted-foreground leading-relaxed">
                {t("pwa.notSecure", {
                  url: typeof window !== "undefined" ? `http://${window.location.host}` : "",
                })}
              </p>
            ) : (
              <p className="text-muted-foreground leading-relaxed">
                {t("pwa.browserHint").replace("{icon}", "")}
                <MoreVertical className="size-3.5 inline-block align-text-bottom mx-0.5" />
                 <span className="text-foreground">{t("pwa.installApp")}</span> /{" "}
                 <span className="text-foreground">{t("pwa.addToHomeScreen")}</span>.
              </p>
            )}
            <label className="mt-3 flex items-center gap-1.5 cursor-pointer border-t border-border pt-2">
              <input
                type="checkbox"
                className="size-3.5 accent-foreground"
                checked={dismissed}
                onChange={(e) => {
                  const next = e.target.checked;
                  setDismissed(next);
                  setHint(false);
                  if (next) settings.set("dismiss-pwa-hint", "true");
                  else settings.set("dismiss-pwa-hint", "false");
                }}
              />
              <span className="text-muted-foreground">{t("pwa.dontShowAgain")}</span>
            </label>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
