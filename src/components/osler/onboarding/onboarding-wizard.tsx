"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import { WelcomeStep } from "./welcome-step";
import { TourStep } from "./tour-step";
import { LanguageStep } from "./language-step";
import { ThemeStep } from "./theme-step";
import { AiStep } from "./ai-step";
import { InstallStep } from "./install-step";
import { ConsentStep } from "./consent-step";

// localStorage (not the IndexedDB store) is deliberate: like the cookie-consent
// flag, this is a device-level one-time boolean that the login page must read
// synchronously on first paint so it never flashes the wrong surface. It must
// NOT be account-scoped — logging out and back in must not retrigger onboarding.
const ONBOARDING_KEY = "osler-onboarding-complete";

export function isOnboardingComplete(): boolean {
  try {
    return !!localStorage.getItem(ONBOARDING_KEY);
  } catch {
    // Storage blocked (private mode) — never trap the user in the wizard.
    return true;
  }
}

function markOnboardingComplete(withConsent: boolean) {
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
    if (withConsent) localStorage.setItem("osler_cookie_consent", "1");
  } catch {
    // ignore — private mode
  }
}

const STEPS = [WelcomeStep, TourStep, LanguageStep, ThemeStep, AiStep, InstallStep, ConsentStep];

export function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const { t, rtl } = useI18n();
  const [index, setIndex] = React.useState(0);
  const [dir, setDir] = React.useState(1);
  const total = STEPS.length;
  const isLast = index === total - 1;
  const Step = STEPS[index];

  // While the wizard owns the consent decision, tell the cookie banner to
  // hold off — users agree inside the wizard instead of on a banner.
  React.useEffect(() => {
    document.documentElement.setAttribute("data-osler-onboarding", "");
    return () => document.documentElement.removeAttribute("data-osler-onboarding");
  }, []);

  const go = React.useCallback(
    (next: number) => {
      if (next === index) return;
      setDir(next > index ? 1 : -1);
      setIndex(next);
      haptic("selection");
    },
    [index],
  );

  const finish = React.useCallback(
    (withConsent: boolean) => {
      markOnboardingComplete(withConsent);
      haptic("success");
      onComplete();
    },
    [onComplete],
  );

  // Directional slide tuned for a form wizard (24px, not the 80px card
  // carousel) — composed from the shared motion tokens only.
  const slide = React.useMemo(() => {
    const x = dir * (rtl ? -24 : 24);
    return {
      initial: { opacity: 0, x },
      animate: { opacity: 1, x: 0, transition: MOTION_TRANSITION.normal },
      exit: { opacity: 0, x: -x, transition: MOTION_TRANSITION.quick },
    };
  }, [dir, rtl]);

  return (
    <div className="h-dvh relative overflow-hidden bg-background">
      {/* Ambient primary glow — mirrors the login screen's focal element */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 35%, color-mix(in oklch, var(--primary) 14%, transparent), transparent 70%)",
        }}
      />
      {/* min-h-full inside a scrollable h-full frame: centers when short,
          scrolls instead of clipping when a step is taller than the viewport */}
      <div className="h-full overflow-y-auto relative">
        <div className="min-h-full flex items-center justify-center p-4 safe-py">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={MOTION_TRANSITION.slow}
            className="w-full max-w-lg relative"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2.5">
                <div className="size-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-e1 relative overflow-hidden">
                  <span
                    aria-hidden
                    className="absolute inset-0 opacity-40"
                    style={{
                      background:
                        "linear-gradient(160deg, color-mix(in oklch, var(--primary-foreground) 25%, transparent), transparent 55%)",
                    }}
                  />
                  <Activity className="size-4 relative" />
                </div>
                <span className="text-sm font-semibold">{t("app.name")}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => finish(false)}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                {t("onboarding.skip")}
              </Button>
            </div>

            <div
              className="flex items-center gap-3 mb-4"
              role="group"
              aria-label={t("onboarding.progress", { current: index + 1, total })}
            >
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                {t("onboarding.progress", { current: index + 1, total })}
              </span>
              <div className="flex-1 flex items-center gap-1.5 justify-end">
                {STEPS.map((_, i) => (
                  <motion.span
                    key={i}
                    className={cn("h-1.5 rounded-full", i <= index ? "bg-primary" : "bg-muted")}
                    initial={false}
                    animate={{ width: i === index ? 24 : 12 }}
                    transition={MOTION_TRANSITION.quick}
                  />
                ))}
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-6 shadow-e1">
              <AnimatePresence mode="wait">
                <motion.div key={index} {...slide}>
                  <Step />
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex items-center gap-2 mt-4">
              {index > 0 && (
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => go(index - 1)}
                  className="gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className={cn("size-4", rtl && "rtl-flip-x")} />
                  {t("onboarding.back")}
                </Button>
              )}
              <Button size="lg" onClick={() => (isLast ? finish(true) : go(index + 1))} className="flex-1 gap-2">
                {isLast ? t("onboarding.consent.agree") : t("onboarding.continue")}
                {!isLast && <ArrowRight className={cn("size-4", rtl && "rtl-flip-x")} />}
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
