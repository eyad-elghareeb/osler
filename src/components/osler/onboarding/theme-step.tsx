"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { useI18n } from "@/components/osler/i18n-provider";
import { useOslerTheme } from "@/components/osler/theme-provider";
import { ThemePreview, groupThemeFamilies, type ThemeFamily } from "@/components/osler/settings/theme-section";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const VISIBLE_FAMILIES = 3;

export function ThemeStep() {
  const { t } = useI18n();
  const { theme, setThemeId, availableThemes } = useOslerTheme();
  const families = groupThemeFamilies(availableThemes, t("app.name"));
  const variantLabel = (variant: "dark" | "light") =>
    variant === "dark" ? t("settings.theme.darkVariant") : t("settings.theme.lightVariant");

  // Show 3 pairs by default; gate the rest behind View more. If the active
  // theme sits outside the first 3 (e.g. user had midnight selected), keep it
  // visible so the selection never appears hidden.
  const activeIdx = families.findIndex((f) => f.variants.some((v) => v.id === theme));
  const needsGate = families.length > VISIBLE_FAMILIES;
  const [expanded, setExpanded] = React.useState(() => (activeIdx >= VISIBLE_FAMILIES ? true : false));

  const visibleFamilies = React.useMemo(() => {
    if (expanded || !needsGate) return families;
    const head = families.slice(0, VISIBLE_FAMILIES);
    if (activeIdx >= VISIBLE_FAMILIES) {
      const activeFamily = families[activeIdx];
      if (activeFamily && !head.find((f) => f.id === activeFamily.id)) return [...head, activeFamily];
    }
    return head;
  }, [families, expanded, needsGate, activeIdx]);

  const hiddenCount = families.length - visibleFamilies.length;

  const renderFamily = (family: ThemeFamily) => (
    <div key={family.id} className="rounded-lg border border-border bg-card p-2.5">
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
        {visibleFamilies.map(renderFamily)}
      </div>
      {needsGate && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            haptic("selection");
            setExpanded((v) => !v);
          }}
          className="w-full mt-3 gap-1.5 text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
        >
          {expanded ? t("onboarding.theme.viewLess") : t("onboarding.theme.viewMore", { n: hiddenCount })}
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </Button>
      )}
    </div>
  );
}
