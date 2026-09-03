"use client";

import * as React from "react";
import { Flame, Target, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { dailyGoal } from "@/lib/osler/storage";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";

const GOAL_PRESETS = [
  { value: 25, labelKey: "dash.goal.presetCasual" as const },
  { value: 50, labelKey: "dash.goal.presetStandard" as const },
  { value: 100, labelKey: "dash.goal.presetIntensive" as const },
  { value: 150, labelKey: "dash.goal.presetMastery" as const },
];

export function GoalStep() {
  const { t } = useI18n();
  const [selectedTarget, setSelectedTarget] = React.useState<number>(() => dailyGoal.getSync().target);
  const [isCustom, setIsCustom] = React.useState<boolean>(() => !GOAL_PRESETS.some((p) => p.value === dailyGoal.getSync().target));
  const [customValue, setCustomValue] = React.useState<string>(() => String(dailyGoal.getSync().target));

  const handleSelectPreset = (value: number) => {
    setSelectedTarget(value);
    setIsCustom(false);
    setCustomValue(String(value));
    void dailyGoal.save({ target: value });
    haptic("selection");
  };

  const handleCustomChange = (val: string) => {
    setCustomValue(val);
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) {
      setSelectedTarget(num);
      void dailyGoal.save({ target: num });
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3 shadow-e1">
          <Target className="size-6" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">{t("onboarding.goal.title")}</h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">{t("onboarding.goal.subtitle")}</p>
      </div>

      {/* Concept explainer cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-3.5 flex items-start gap-3 text-start">
          <div className="size-9 rounded-lg bg-warning/15 text-warning flex items-center justify-center shrink-0">
            <Flame className="size-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-foreground">{t("onboarding.goal.streakCardTitle")}</h3>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              {t("onboarding.goal.streakCardDesc")}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3.5 flex items-start gap-3 text-start">
          <div className="size-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-foreground">{t("onboarding.goal.ringsCardTitle")}</h3>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              {t("onboarding.goal.ringsCardDesc")}
            </p>
          </div>
        </div>
      </div>

      {/* Target Selector */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("onboarding.goal.selectTarget")}
          </label>
          <span className="text-xs font-bold text-primary tabular-nums">
            {selectedTarget} {t("onboarding.goal.perDay")}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {GOAL_PRESETS.map((preset) => {
            const active = !isCustom && selectedTarget === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => handleSelectPreset(preset.value)}
                className={cn(
                  "p-3 rounded-xl border text-start transition-all flex flex-col justify-between h-20",
                  active
                    ? "border-primary bg-primary/10 text-primary shadow-sm"
                    : "border-border bg-card hover:border-border/80 text-foreground"
                )}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-lg font-bold tabular-nums">{preset.value}</span>
                  {active && <CheckCircle2 className="size-3.5 text-primary shrink-0" />}
                </div>
                <span className="text-[11px] font-medium text-muted-foreground leading-tight">
                  {t(preset.labelKey)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Custom Input */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => {
              setIsCustom(true);
              haptic("selection");
            }}
            className={cn(
              "text-xs font-medium underline underline-offset-4 hover:text-foreground transition-colors",
              isCustom ? "text-primary font-semibold" : "text-muted-foreground"
            )}
          >
            {t("onboarding.goal.targetCustom")}
          </button>

          {isCustom && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min="5"
                max="500"
                value={customValue}
                onChange={(e) => handleCustomChange(e.target.value)}
                className="w-28 h-9 px-3 text-sm bg-background border border-border rounded-lg outline-none focus:border-primary tabular-nums font-semibold"
                aria-label={t("onboarding.goal.targetCustom")}
              />
              <span className="text-xs text-muted-foreground">{t("onboarding.goal.perDay")}</span>
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground italic text-center pt-1">
          {t("onboarding.goal.changeLater")}
        </p>
      </div>
    </div>
  );
}
