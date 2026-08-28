"use client";

import * as React from "react";
import { Activity, Compass, Download, Languages, Palette, ShieldCheck, Sparkles } from "lucide-react";

import { useI18n } from "@/components/osler/i18n-provider";

export function WelcomeStep() {
  const { t } = useI18n();

  const chips = [
    { icon: Languages, label: t("onboarding.welcome.chip.language") },
    { icon: Palette, label: t("onboarding.welcome.chip.theme") },
    { icon: Compass, label: t("onboarding.welcome.chip.tour") },
    { icon: Sparkles, label: t("onboarding.welcome.chip.ai") },
    { icon: Download, label: t("onboarding.welcome.chip.install") },
    { icon: ShieldCheck, label: t("onboarding.welcome.chip.consent") },
  ];

  return (
    <div className="text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground mx-auto mb-4 shadow-e2 relative overflow-hidden">
        <span
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{
            background:
              "linear-gradient(160deg, color-mix(in oklch, var(--primary-foreground) 25%, transparent), transparent 55%)",
          }}
        />
        <Activity className="size-7 relative" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">
        {t("onboarding.welcome.title", { name: t("app.name") })}
      </h1>
      <p className="text-sm text-muted-foreground mt-2">{t("onboarding.welcome.subtitle")}</p>

      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-6 mb-2.5">
        {t("onboarding.welcome.includes")}
      </p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {chips.map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground"
          >
            <Icon className="size-3.5 text-primary" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
