"use client";

import * as React from "react";
import {
  BookOpen,
  BookOpenText,
  ClipboardList,
  FileDown,
  Flame,
  Layers,
  PenTool,
  PlayCircle,
  Stethoscope,
  WifiOff,
  type LucideIcon,
} from "lucide-react";

import { useI18n } from "@/components/osler/i18n-provider";
import { enabledEngines, isEngineEnabled } from "@/lib/osler/config";
import { getEngineMeta } from "@/lib/osler/content";
import type { EngineType } from "@/lib/osler/types";
import type { StringKey } from "@/lib/osler/i18n";

// Rendering concern only — labels/colors come from getEngineMeta, mirroring
// how learn.tsx pairs engine types with Lucide icons.
const ENGINE_ICONS: Record<EngineType, LucideIcon> = {
  quiz: ClipboardList,
  bank: BookOpen,
  written: PenTool,
  flashcard: Layers,
  osce: Stethoscope,
  library: BookOpenText,
  video: PlayCircle,
};

const EXTRAS = [
  { icon: Flame, key: "onboarding.tour.extra.progress" },
  { icon: WifiOff, key: "onboarding.tour.extra.offline" },
  { icon: FileDown, key: "onboarding.tour.extra.pdf" },
] as const;

export function TourStep() {
  const { t } = useI18n();
  // The quiz/bank/written engines all live in the same QBank studio and read
  // as duplicates side by side — show the quiz card only when it is the only
  // QBank-family engine enabled.
  const engines = React.useMemo(
    () =>
      enabledEngines().filter(
        (type) => type !== "quiz" || (!isEngineEnabled("bank") && !isEngineEnabled("written")),
      ),
    [],
  );

  return (
    <div>
      <h2 className="text-lg font-bold tracking-tight">{t("onboarding.tour.title")}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-5">{t("onboarding.tour.subtitle")}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {engines.map((type) => {
          const meta = getEngineMeta(type);
          const Icon = ENGINE_ICONS[type];
          return (
            <div key={type} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="size-7 rounded-md flex items-center justify-center shrink-0"
                  style={{
                    background: `color-mix(in oklch, ${meta.color} 15%, transparent)`,
                    color: meta.color,
                  }}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="text-sm font-semibold truncate">
                  {t(`onboarding.tour.${type}.name` as StringKey)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t(`onboarding.tour.${type}.desc` as StringKey)}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-border space-y-2">
        {EXTRAS.map(({ icon: Icon, key }) => (
          <div key={key} className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="size-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Icon className="size-3" />
            </span>
            <span>{t(key as StringKey)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
