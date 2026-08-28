"use client";

import { Check, ShieldCheck } from "lucide-react";

import { useI18n } from "@/components/osler/i18n-provider";

const POINTS = ["onboarding.consent.point.local", "onboarding.consent.point.noTracking"] as const;

export function ConsentStep() {
  const { t } = useI18n();

  return (
    <div>
      <div className="w-11 h-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center mb-4">
        <ShieldCheck className="size-5" />
      </div>
      <h2 className="text-lg font-bold tracking-tight">{t("onboarding.consent.title")}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">{t("onboarding.consent.subtitle")}</p>

      <p className="text-xs text-muted-foreground leading-relaxed">{t("consent.description")}</p>

      <div className="mt-4 space-y-2">
        {POINTS.map((key) => (
          <div key={key} className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="size-5 rounded-full bg-success-soft text-success flex items-center justify-center shrink-0">
              <Check className="size-3" />
            </span>
            <span>{t(key)}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg bg-muted/40 border border-border p-3 text-xs leading-relaxed">
        {t("consent.agreePrefix")}{" "}
        <a
          href="/docs/terms-of-service.md"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground font-medium"
        >
          {t("legal.tos")}
        </a>{" "}
        {t("consent.and")}{" "}
        <a
          href="/docs/privacy-policy.md"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground font-medium"
        >
          {t("legal.privacy")}
        </a>
        .
      </div>

      <p className="text-[11px] text-muted-foreground mt-3">{t("onboarding.consent.bannerNote")}</p>
    </div>
  );
}
