"use client";

import * as React from "react";
import { CheckCircle2, Target } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

interface DailyGoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTarget: number;
}

export function DailyGoalDialog({ open, onOpenChange, currentTarget }: DailyGoalDialogProps) {
  const { t } = useI18n();
  const [target, setTarget] = React.useState<number>(currentTarget);
  const [isCustom, setIsCustom] = React.useState<boolean>(() => !GOAL_PRESETS.some((p) => p.value === currentTarget));
  const [customValue, setCustomValue] = React.useState<string>(() => String(currentTarget));

  React.useEffect(() => {
    if (open) {
      setTarget(currentTarget);
      const isPreset = GOAL_PRESETS.some((p) => p.value === currentTarget);
      setIsCustom(!isPreset);
      setCustomValue(String(currentTarget));
    }
  }, [open, currentTarget]);

  const handleSelectPreset = (value: number) => {
    setTarget(value);
    setIsCustom(false);
    setCustomValue(String(value));
    haptic("selection");
  };

  const handleSave = async () => {
    const finalTarget = isCustom ? parseInt(customValue, 10) || 50 : target;
    await dailyGoal.save({ target: Math.max(5, finalTarget) });
    haptic("success");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Target className="size-4" />
            </div>
            <DialogTitle>{t("dash.goal.dialogTitle")}</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            {t("dash.goal.dialogSubtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-2">
            {GOAL_PRESETS.map((preset) => {
              const active = !isCustom && target === preset.value;
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

          {/* Custom option */}
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <button
              type="button"
              onClick={() => {
                setIsCustom(true);
                haptic("selection");
              }}
              className={cn(
                "text-xs font-semibold hover:text-foreground transition-colors",
                isCustom ? "text-primary" : "text-muted-foreground"
              )}
            >
              {t("dash.goal.customTarget")}
            </button>

            {isCustom && (
              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="number"
                  min="5"
                  max="500"
                  value={customValue}
                  onChange={(e) => {
                    setCustomValue(e.target.value);
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val > 0) setTarget(val);
                  }}
                  className="w-28 h-9 px-3 text-sm bg-background border border-border rounded-lg outline-none focus:border-primary tabular-nums font-semibold"
                  aria-label={t("dash.goal.customTarget")}
                  autoFocus
                />
                <span className="text-xs text-muted-foreground">{t("dash.goal.questionsLabel", { n: "" }).trim()} / {t("dash.streak.today").toLowerCase()}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={handleSave}>
            {t("dash.goal.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
