"use client";

import { Check } from "lucide-react";

import { useI18n } from "@/components/osler/i18n-provider";
import { useOslerTheme } from "@/components/osler/theme-provider";
import { ThemePreview, groupThemeFamilies, type ThemeFamily } from "@/components/osler/settings/theme-section";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";

export function ThemeStep() {
  const { t } = useI18n();
  const { theme, setThemeId, availableThemes } = useOslerTheme();
  const families = groupThemeFamilies(availableThemes, t("app.name"));
  const variantLabel = (variant: "dark" | "light") =>
    variant === "dark" ? t("settings.theme.darkVariant") : t("settings.theme.lightVariant");

  const renderFamily = (family: ThemeFamily) => (
    <div key={family.id} className="rounded-lg border border-border bg-background p-2.5">
      <div className="text-sm font-semibold truncate mb-2">{family.name}</div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={family.name}>
        {family.variants.map((option) => {
          const active = option.id === theme;
          const themeScope = option.id === "dark" || option.id === "light" ? option.id : `theme-${option.id}`;
          return (
            <button
              key={option.id}
              type="button"
              aria-label={`${t("settings.theme.selectTheme")}: ${family.name} (${variantLabel(option.variant)})`}
              aria-pressed={active}
              onClick={() => {
                haptic("light");
                setThemeId(option.id);
              }}
              className={cn(
                "rounded-lg border p-1.5 text-start flex flex-col gap-1.5 transition-all",
                active
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border hover:border-primary/40",
              )}
            >
              <ThemePreview themeScope={themeScope} className="border-0" />
              <span className="flex items-center justify-between gap-1 text-[11px] font-medium px-0.5">
                <span>{variantLabel(option.variant)}</span>
                {active && <Check className="size-3 shrink-0 text-primary" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div>
      <h2 className="text-lg font-bold tracking-tight">{t("onboarding.theme.title")}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-5">{t("onboarding.theme.subtitle")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {families.map(renderFamily)}
      </div>
    </div>
  );
}
