"use client";

import * as React from "react";
import { Check, Palette } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import { useOslerTheme } from "@/components/osler/theme-provider";
type ThemeOption = { id: string; name: string; variant: "dark" | "light" };

interface ThemeFamily {
  id: string;
  name: string;
  variants: ThemeOption[];
}

export function ThemeSettingsSection() {
  const { t } = useI18n();
  const { theme, setThemeId, availableThemes } = useOslerTheme();

  const themeFamilies = React.useMemo<ThemeFamily[]>(() => {
    const families = new Map<string, ThemeFamily>();
    for (const option of availableThemes) {
      const id = option.id === "dark" || option.id === "light"
        ? "osler-default"
        : option.id.replace(/-(dark|light)$/i, "");
      const current = families.get(id);
      if (current) {
        current.variants.push(option);
      } else {
        families.set(id, {
          id,
          name: id === "osler-default" ? t("app.name") : option.name.replace(/\s+(dark|light)$/i, ""),
          variants: [option],
        });
      }
    }
    return Array.from(families.values()).map((family) => ({
      ...family,
      variants: [...family.variants].sort((a, b) => (a.variant === "dark" ? -1 : 1) - (b.variant === "dark" ? -1 : 1)),
    }));
  }, [availableThemes, t]);

  const builtinFamilies = themeFamilies.filter((family) => family.id === "osler-default");
  const customFamilies = themeFamilies.filter((family) => family.id !== "osler-default");
  const activeFamily = themeFamilies.find((family) => family.variants.some((option) => option.id === theme));
  const activeOption = activeFamily?.variants.find((option) => option.id === theme);
  const variantLabel = (variant: "dark" | "light") =>
    variant === "dark" ? t("settings.theme.darkVariant") : t("settings.theme.lightVariant");

  /**
   * Mini app-surface preview — a richer alternative to flat color dots.
   * Renders a scaled-down mock of an app surface: background → card →
   * primary accent bar → muted text line → secondary tint. Reads as
   * "this is what the theme looks like" instead of "these are its colors".
   *
   * The preview is scoped to the theme's CSS class (`.dark`, `.light`,
   * or `.theme-<id>`) so the CSS variables resolve to the theme's actual
   * values. A 1px border separates the preview from the button chrome.
   */
  const renderThemePreview = (themeScope: string) => (
    <div
      className={cn(
        "w-full h-12 rounded-md border border-border overflow-hidden flex flex-col gap-1 p-1.5",
        themeScope,
      )}
      style={{ backgroundColor: "var(--background)" }}
      aria-hidden
    >
      {/* Card surface row — represents a card on the background */}
      <div
        className="h-3 rounded-sm flex items-center px-1 gap-1"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        {/* Primary accent dot */}
        <span
          className="size-1.5 rounded-full shrink-0"
          style={{ backgroundColor: "var(--primary)" }}
        />
        {/* Muted text line */}
        <span
          className="h-0.5 rounded-full flex-1 max-w-[40%]"
          style={{ backgroundColor: "var(--muted-foreground)", opacity: 0.5 }}
        />
      </div>
      {/* Bottom row — primary bar + secondary tint */}
      <div className="flex items-center gap-1 h-3">
        <span
          className="h-2.5 rounded-sm flex-[3]"
          style={{ backgroundColor: "var(--primary)" }}
        />
        <span
          className="h-2.5 rounded-sm flex-1"
          style={{
            backgroundColor: "var(--primary)",
            opacity: 0.25,
          }}
        />
        <span
          className="h-2.5 rounded-sm flex-1"
          style={{ backgroundColor: "var(--accent)" }}
        />
      </div>
    </div>
  );

  const renderThemeFamily = (family: ThemeFamily) => (
    <div key={family.id} className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-sm font-semibold truncate">{family.name}</span>
        {activeFamily?.id === family.id && activeOption && (
          <span className="text-[11px] text-muted-foreground shrink-0">{variantLabel(activeOption.variant)}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={family.name}>
        {family.variants.map((option) => {
          const active = option.id === theme;
          const themeScope = option.id === "dark" || option.id === "light" ? option.id : `theme-${option.id}`;
          return (
            <Button
              key={option.id}
              type="button"
              variant={active ? "default" : "outline"}
              aria-label={`${t("settings.theme.selectTheme")}: ${family.name} (${variantLabel(option.variant)})`}
              aria-pressed={active}
              onClick={() => { haptic("light"); setThemeId(option.id); }}
              className={cn(
                "h-auto min-w-0 flex-col items-stretch gap-2 p-2.5 rounded-lg",
                !active && "bg-background",
              )}
            >
              {renderThemePreview(themeScope)}
              <span className="flex items-center justify-between gap-2 text-xs font-medium">
                <span>{variantLabel(option.variant)}</span>
                {active && <Check className="size-3.5 shrink-0" />}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
          <Palette className="size-4 text-primary" />
          {t("settings.theme.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-5">
          {t("settings.theme.currentTheme")}:{" "}
          <span className="font-medium text-foreground">
            {activeFamily && activeOption ? `${activeFamily.name} · ${variantLabel(activeOption.variant)}` : theme}
          </span>
        </p>

        {/* Built-in themes */}
        <div className="space-y-3">
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {t("settings.theme.builtinTitle")}
            </h3>
            <p className="text-[11px] text-muted-foreground mb-3">
              {t("settings.theme.builtinDesc")}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
              {builtinFamilies.map(renderThemeFamily)}
            </div>
          </div>

          {/* Custom themes */}
          {customFamilies.length > 0 && (
            <div className="pt-4 border-t border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t("settings.theme.customTitle")}
              </h3>
              <p className="text-[11px] text-muted-foreground mb-3">
                {t("settings.theme.customDesc")}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                {customFamilies.map(renderThemeFamily)}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ─── Language section ─────────────────────────────────────────────── */