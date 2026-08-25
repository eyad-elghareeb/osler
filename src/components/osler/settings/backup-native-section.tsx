"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Sparkles, Check, FileArchive, Fingerprint, Vibrate, SwitchCamera, Sun, Wifi, Info, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSyncPanel } from "@/components/osler/sync/file-sync-panel";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { isHapticsEnabled, setHapticsEnabled, haptic, isViewTransitionsSupported, isWakeLockSupported, checkBiometricAvailability, enrollBiometric, disableBiometric } from "@/lib/osler/native";
import { isAnimationsEnabled, setAnimationsEnabled } from "@/lib/osler/motion";
import { readCloudSession } from "@/lib/osler/cloud";
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

/* ─── Native features section (haptics / biometric / view transitions) ─ */

export function NativeSettingsSection() {
  const { t } = useI18n();
  const [hapticsOn, setHapticsOn] = React.useState(false);
  const [vtOn, setVtOn] = React.useState(false);
  const [animationsOn, setAnimationsOn] = React.useState(true);
  const [biometricSupported, setBiometricSupported] = React.useState(false);
  const [biometricPlatform, setBiometricPlatform] = React.useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = React.useState(false);
  const [biometricEnabled, setBiometricEnabled] = React.useState(false);
  const [biometricCloud, setBiometricCloud] = React.useState(false);
  const [biometricBusy, setBiometricBusy] = React.useState(false);
  const [biometricMsg, setBiometricMsg] = React.useState<string>("");

  // Hydrate initial state from the lib helpers.
  React.useEffect(() => {
    setHapticsOn(isHapticsEnabled());
    setVtOn(isViewTransitionsSupported());
    setAnimationsOn(isAnimationsEnabled());
    let cancelled = false;
    checkBiometricAvailability().then((a) => {
      if (cancelled) return;
      setBiometricSupported(a.supported);
      setBiometricPlatform(a.platformAuthenticator);
      setBiometricEnrolled(a.enrolled);
      setBiometricEnabled(a.enabled);
      setBiometricCloud(a.cloudBacked);
    });
    return () => { cancelled = true; };
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

  const handleEnrollBiometric = async () => {
    setBiometricBusy(true);
    setBiometricMsg("");
    // When signed into a cloud account, enrollment is server-backed: the
    // Worker mints the challenge and stores the credential against the
    // account so it can quick-unlock from the login screen.
    const cloudSession = readCloudSession();
    const username =
      cloudSession?.user.username ??
      ((typeof window !== "undefined" && window.localStorage.getItem("osler-session")) || "User");
    const result = await enrollBiometric(username, cloudSession);
    setBiometricBusy(false);
    if (result.ok) {
      haptic("success");
      const a = await checkBiometricAvailability();
      setBiometricEnrolled(a.enrolled);
      setBiometricEnabled(a.enabled);
      setBiometricCloud(a.cloudBacked);
    } else {
      setBiometricMsg(
        result.message && !cloudSession
          ? result.message
          : result.reason === "cancelled"
            ? t("native.biometric.cancelled")
            : t("native.biometric.cloudError"),
      );
      haptic("error");
    }
  };

  const handleDisableBiometric = async () => {
    setBiometricBusy(true);
    setBiometricMsg("");
    await disableBiometric();
    setBiometricEnrolled(false);
    setBiometricEnabled(false);
    setBiometricCloud(false);
    setBiometricBusy(false);
    haptic("warning");
  };

  return (
    <div className="space-y-6">
      {/* Section header */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1">
          <Fingerprint className="size-4 text-primary" />
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
              <p className="text-[10px] text-muted-foreground/70 mt-2">
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
              <p className="text-[10px] text-muted-foreground/70 mt-2">
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
              <p className="text-[10px] text-muted-foreground/70 mt-2">
                {t("animations.reduceHint")}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Biometric */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Fingerprint className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{t("native.biometric.title")}</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              {t("native.biometric.desc")}
            </p>

            {!biometricSupported || !biometricPlatform ? (
              <p className="text-[11px] text-muted-foreground/80">
                {t("native.biometric.unsupported")}
              </p>
            ) : biometricEnrolled ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-success">
                  <Check className="size-3.5" />
                  <span>{t("native.biometric.enrolled", { user: "user" })}</span>
                </div>
                {biometricCloud && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("native.biometric.cloudSynced")}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs text-destructive hover:text-destructive"
                  onClick={handleDisableBiometric}
                  disabled={biometricBusy}
                >
                  {biometricBusy ? t("native.biometric.disabling") : t("native.biometric.disable")}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={handleEnrollBiometric}
                disabled={biometricBusy}
              >
                {biometricBusy ? t("native.biometric.unlocking") : t("native.biometric.enroll")}
              </Button>
            )}

            {biometricMsg && (
              <p className="text-[11px] text-destructive mt-2">{biometricMsg}</p>
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