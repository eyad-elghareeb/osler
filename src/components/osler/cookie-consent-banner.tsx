"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, X } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { Button } from "@/components/ui/button";

// localStorage is the correct storage for a simple one-time boolean flag that
// doesn't belong to the domain-specific IndexedDB store (AGENTS.md §15 exception).
const CONSENT_KEY = "osler_cookie_consent";

export function CookieConsentBanner() {
  const { t } = useI18n();
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    // Poll instead of a one-shot timer: while the first-run onboarding wizard
    // is open (data-osler-onboarding on <html>) it owns the consent decision,
    // so the banner holds. If the user skips the wizard without agreeing, the
    // banner appears once it closes; if they agreed, consent is set and the
    // banner never shows.
    const startedAt = Date.now();
    const timer = setInterval(() => {
      try {
        if (localStorage.getItem(CONSENT_KEY)) {
          clearInterval(timer);
          return;
        }
      } catch {
        clearInterval(timer); // Private browsing / storage blocked — skip banner
        return;
      }
      if (document.documentElement.hasAttribute("data-osler-onboarding")) return;
      if (Date.now() - startedAt < 1200) return;
      setVisible(true);
      clearInterval(timer);
    }, 300);
    return () => clearInterval(timer);
  }, []);

  const accept = () => {
    haptic("success");
    setVisible(false);
    try { localStorage.setItem(CONSENT_KEY, "1"); } catch {}
  };

  const dismiss = () => {
    haptic("light");
    setVisible(false);
    try { localStorage.setItem(CONSENT_KEY, "1"); } catch {}
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ duration: 0.25 }}
          className="fixed bottom-4 inset-x-4 md:inset-x-auto md:end-6 md:max-w-md z-50 pointer-events-auto"
        >
          <div className="rounded-xl border border-border bg-card/95 backdrop-blur-md p-4 shadow-xl text-card-foreground">
            <div className="flex items-start gap-3">
              <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                <ShieldCheck className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  {t("consent.title")}
                </h4>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {t("consent.description")}
                </p>
                <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                  {t("consent.agreePrefix")}{" "}
                  <a
                    href="/docs/terms-of-service.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {t("legal.tosShort")}
                  </a>{" "}
                  {t("consent.and")}{" "}
                  <a
                    href="/docs/privacy-policy.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {t("legal.privacyShort")}
                  </a>
                  .
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <Button size="sm" onClick={accept} className="text-xs font-medium">
                    {t("consent.accept")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={dismiss} className="text-xs text-muted-foreground">
                    {t("consent.dismiss")}
                  </Button>
                </div>
              </div>
              <Button
                variant="ghost"
                size="iconSm"
                onClick={dismiss}
                className="text-muted-foreground hover:text-foreground shrink-0 -me-1 -mt-1"
                aria-label={t("consent.dismiss")}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
