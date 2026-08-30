"use client";

import * as React from "react";
import { CheckCircle2, Download, ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { usePlatform } from "@/hooks/use-platform";
import { haptic } from "@/lib/osler/native";
import type { StringKey } from "@/lib/osler/i18n";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallStep() {
  const { t, tList } = useI18n();
  const { isTauri, platform } = usePlatform();
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = React.useState(
    () =>
      isTauri ||
      (typeof window !== "undefined" &&
        (window.matchMedia("(display-mode: standalone)").matches ||
          // iOS Safari reports standalone via its own extension.
          (navigator as Navigator & { standalone?: boolean }).standalone === true)),
  );

  React.useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferred) return;
    haptic("light");
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setDeferred(null);
  };

  // PWA install requires a secure context (HTTPS or localhost) — over a plain
  // LAN IP the browser never offers install (same rule as pwa-install-button).
  const isSecure =
    typeof window === "undefined" ||
    window.isSecureContext ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  const stepsKey = (platform === "ios" ? "onboarding.install.iosSteps" : platform === "android" ? "onboarding.install.androidSteps" : "onboarding.install.desktopSteps") as StringKey;
  const steps = tList(stepsKey);

  return (
    <div>
      <h2 className="text-lg font-bold tracking-tight">{t("onboarding.install.title")}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-5">{t("onboarding.install.subtitle")}</p>

      {installed ? (
        <div className="rounded-lg border border-border bg-card p-4 flex items-start gap-3">
          <span className="size-9 rounded-lg bg-success-soft text-success flex items-center justify-center shrink-0">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <div className="text-sm font-semibold">{t("onboarding.install.installedTitle")}</div>
            <p className="text-xs text-muted-foreground mt-0.5">{t("onboarding.install.installedDesc")}</p>
          </div>
        </div>
      ) : (
        <>
          {deferred && (
            <Button size="lg" onClick={handleInstall} className="w-full gap-2 mb-4">
              <Download className="size-4" />
              {t("onboarding.install.cta")}
            </Button>
          )}

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3 text-xs font-semibold">
              <ListChecks className="size-4 text-primary" />
              {t("onboarding.install.manualTitle")}
            </div>
            <ol className="space-y-2.5">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs text-muted-foreground">
                  <span className="size-5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold flex items-center justify-center shrink-0 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {!isSecure && (
            <p className="text-[11px] text-warning mt-3">
              {t("pwa.notSecure", { url: typeof window !== "undefined" ? `http://${window.location.host}` : "" })}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-3">{t("onboarding.install.later")}</p>
        </>
      )}
    </div>
  );
}
