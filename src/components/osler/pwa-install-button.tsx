"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Share, X, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";

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
      title="Install Osler"
      className="size-9 rounded-md hover:bg-muted/60 transition-colors flex items-center justify-center shrink-0"
    >
      {icon ?? <Download className="size-4" />}
    </button>
  );

  if (canPrompt) {
    return (
      <button
        onClick={handleInstall}
        aria-label="Install app"
        title="Install Osler"
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
      {iconBtn("Install app", () => setHint((s) => !s), <Download className="size-4" />)}
      <AnimatePresence>
        {hint && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 top-11 z-50 w-64 rounded-lg border border-border/60 bg-popover p-3 text-xs shadow-lg"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">Install Osler</span>
              <button
                onClick={() => setHint(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-3.5" />
              </button>
            </div>
            {showIos ? (
              <p className="text-muted-foreground leading-relaxed">
                Tap <Share className="size-3.5 inline-block align-text-bottom" /> then{" "}
                <span className="text-foreground">Add to Home Screen</span>.
              </p>
            ) : !isSecure ? (
              <p className="text-muted-foreground leading-relaxed">
                Install needs HTTPS. This address (
                <span className="text-foreground">http://{typeof window !== "undefined" ? window.location.host : ""}</span>
                ) isn&apos;t secure, so your browser blocks it. Serve Osler over
                HTTPS or open it on <span className="text-foreground">localhost</span>.
              </p>
            ) : (
              <p className="text-muted-foreground leading-relaxed">
                Open your browser menu{" "}
                <MoreVertical className="size-3.5 inline-block align-text-bottom" /> and
                choose <span className="text-foreground">Install app</span> /{" "}
                <span className="text-foreground">Add to Home Screen</span>.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
