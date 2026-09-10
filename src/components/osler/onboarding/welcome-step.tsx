"use client";

import * as React from "react";
import { Camera, Compass, Download, Languages, Palette, ShieldCheck, Sparkles, Target } from "lucide-react";
import { OslerMark } from "@/components/osler/osler-mark";

import { useI18n } from "@/components/osler/i18n-provider";

export function WelcomeStep() {
  const { t } = useI18n();

  const chips = [
    { icon: Languages, label: t("onboarding.welcome.chip.language") },
    { icon: Palette, label: t("onboarding.welcome.chip.theme") },
    { icon: Compass, label: t("onboarding.welcome.chip.tour") },
    { icon: Target, label: t("onboarding.welcome.chip.goal") },
    { icon: Sparkles, label: t("onboarding.welcome.chip.ai") },
    { icon: Download, label: t("onboarding.welcome.chip.install") },
    { icon: Camera, label: t("onboarding.welcome.chip.permissions") },
    { icon: ShieldCheck, label: t("onboarding.welcome.chip.consent") },
  ];

  return (
    <div className="text-center">
      <OslerMark className="w-14 h-14 rounded-2xl shadow-e2 mx-auto mb-4" />
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
