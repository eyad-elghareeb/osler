"use client";

import { Check, Cloud, HardDrive, Smartphone, WifiOff } from "lucide-react";

import { useI18n } from "@/components/osler/i18n-provider";

export function SyncStep() {
  const { t } = useI18n();

  const points: Array<{ icon: typeof Cloud; key: string }> = [
    { icon: HardDrive, key: "onboarding.sync.point.local" },
    { icon: Cloud, key: "onboarding.sync.point.cloud" },
    { icon: Smartphone, key: "onboarding.sync.point.p2p" },
  ];

  return (
    <div>
      <div className="w-11 h-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center mb-4">
        <Cloud className="size-5" />
      </div>
      <h2 className="text-lg font-bold tracking-tight">{t("onboarding.sync.title")}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">{t("onboarding.sync.subtitle")}</p>

      <div className="space-y-2.5">
        {points.map(({ icon: Icon, key }) => (
          <div key={key} className="flex items-start gap-2.5 text-xs text-muted-foreground">
            <span className="size-7 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0 mt-0.5">
              <Icon className="size-3.5" />
            </span>
            <span className="pt-1.5 leading-relaxed">{t(key as never)}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg bg-muted/40 border border-border p-3 flex items-start gap-2.5">
        <span className="size-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Check className="size-3.5" />
        </span>
        <div className="text-xs leading-relaxed">
          <span className="font-semibold text-foreground">{t("onboarding.sync.howTitle")} </span>
          <span className="text-muted-foreground">{t("onboarding.sync.howBody")}</span>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground">
        <WifiOff className="size-3 shrink-0 mt-0.5" />
        <span>{t("onboarding.sync.offlineNote")}</span>
      </div>
    </div>
  );
}
