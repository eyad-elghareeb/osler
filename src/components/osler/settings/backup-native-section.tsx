"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Sparkles, FileArchive, Vibrate, SwitchCamera, Sun, Wifi, Info, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSyncPanel } from "@/components/osler/sync/file-sync-panel";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { isHapticsEnabled, setHapticsEnabled, haptic, isViewTransitionsSupported, isWakeLockSupported } from "@/lib/osler/native";
import { isAnimationsEnabled, setAnimationsEnabled } from "@/lib/osler/motion";
export function BackupSettingsSection() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <FileArchive className="size-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold">{t("settings.section.backup")}</h2>
          <p className="text-xs text-muted-foreground">{t("sync.tab.fileDesc")}</p>
        </div>
      </div>
      <FileSyncPanel />
    </div>
  );
}

/* ─── Native features section (haptics / view transitions) ─ */

export function NativeSettingsSection() {
  const { t } = useI18n();
  const [hapticsOn, setHapticsOn] = React.useState(false);
  const [vtOn, setVtOn] = React.useState(false);
  const [animationsOn, setAnimationsOn] = React.useState(true);

  // Hydrate initial state from the lib helpers.
  React.useEffect(() => {
    setHapticsOn(isHapticsEnabled());
    setVtOn(isViewTransitionsSupported());
    setAnimationsOn(isAnimationsEnabled());
  }, []);

  const toggleHaptics = () => {
    const next = !hapticsOn;
    setHapticsOn(next);
    setHapticsEnabled(next);
    // Fire a test vibration so the user can feel the effect immediately.
    if (next) haptic("success");
  };

  const toggleAnimations = () => {
    const next = !animationsOn;
    setAnimationsOn(next);
    setAnimationsEnabled(next);
    haptic(next ? "success" : "light");
  };

  const testHaptics = () => {
    if (!hapticsOn) return;
    haptic("success");
  };

  return (
    <div className="space-y-6">
      {/* Section header */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <Vibrate className="size-4 text-primary" />
          <h2 className="text-base font-semibold">{t("native.sectionTitle")}</h2>
        </div>
        <p className="text-xs text-muted-foreground">{t("native.sectionDesc")}</p>
      </Card>

      {/* Haptics */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Vibrate className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{t("native.haptics.title")}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              {t("native.haptics.desc")}
            </p>
            <div className="flex items-center gap-2">
              <ToggleSwitch checked={hapticsOn} onChange={toggleHaptics} label={t("native.haptics.enable")} />
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={testHaptics}
                disabled={!hapticsOn}
              >
                {t("native.haptics.test")}
              </Button>
            </div>
            {!hapticsOn && (
              <p className="text-[11px] text-muted-foreground/70 mt-2">
                {t("native.haptics.unsupported")}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* View Transitions */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <SwitchCamera className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{t("native.viewTransitions.title")}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              {t("native.viewTransitions.desc")}
            </p>
            <ToggleSwitch
              checked={vtOn}
              onChange={() => {
                // View Transitions are auto-detected — we just show the
                // current state. There's no user toggle because the API
                // is either supported or not.
                haptic("light");
              }}
              label={t("native.viewTransitions.enable")}
              disabled
            />
            {!vtOn && (
              <p className="text-[11px] text-muted-foreground/70 mt-2">
                {t("native.viewTransitions.desc")}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* UI Animations — user-controlled master switch for framer-motion +
          CSS transitions across the whole app. See @/lib/osler/motion.ts. */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Sparkles className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{t("animations.title")}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              {t("animations.desc")}
            </p>
            <ToggleSwitch
              checked={animationsOn}
              onChange={toggleAnimations}
              label={t("animations.enable")}
            />
            {!animationsOn && (
              <p className="text-[11px] text-muted-foreground/70 mt-2">
                {t("animations.reduceHint")}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Wake Lock info (read-only) */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Sun className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{t("native.wakeLock.title")}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              {t("native.wakeLock.desc")}
            </p>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "size-2 rounded-full",
                  isWakeLockSupported() ? "bg-success" : "bg-muted-foreground",
                )}
              />
              <span className="text-muted-foreground">
                {isWakeLockSupported()
                  ? t("native.wakeLock.acquired")
                  : t("native.wakeLock.unsupported")}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Network Info (read-only) */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Wifi className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{t("native.network.title")}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              {t("native.network.unavailable")}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

/**
 * Minimal accessible toggle switch — we don't pull in the shadcn Switch
 * here to avoid adding a new import cycle; this is a self-contained
 * visual equivalent with proper aria semantics.
 */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 transform rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/* ─── Danger Zone section ───────────────────────────────────────────── */