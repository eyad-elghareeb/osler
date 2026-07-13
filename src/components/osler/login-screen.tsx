"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Fingerprint,
  Loader2,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { useI18n } from "./i18n-provider";
import { useBiometricAvailability } from "@/hooks/use-native";
import {
  enrollBiometric,
  authenticateWithBiometric,
  getBiometricUsername,
  disableBiometric,
  haptic,
} from "@/lib/osler/native";
import { cn } from "@/lib/utils";

interface LoginScreenProps {
  onLogin: (username: string) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const { t, rtl } = useI18n();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [biometricStatus, setBiometricStatus] = React.useState<
    "idle" | "enrolling" | "authenticating" | "error"
  >("idle");
  const [biometricMsg, setBiometricMsg] = React.useState<string>("");

  const { availability, refresh: refreshBiometric } = useBiometricAvailability();

  // Pre-fill the username field if a biometric credential is already enrolled.
  React.useEffect(() => {
    if (availability?.enrolled) {
      const stored = getBiometricUsername();
      if (stored) setUsername(stored);
    }
  }, [availability?.enrolled]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = username.trim() || "Guest";
    haptic("success");
    onLogin(name);
  };

  // ── Biometric enrollment (first-time setup) ─────────────────────────
  const handleEnrollBiometric = async () => {
    if (!availability?.platformAuthenticator) return;
    const name = username.trim();
    if (!name) {
      setBiometricStatus("error");
      setBiometricMsg(t("login.username"));
      haptic("error");
      return;
    }
    setBiometricStatus("enrolling");
    setBiometricMsg("");
    const result = await enrollBiometric(name);
    if (result.ok) {
      haptic("success");
      refreshBiometric();
      // Immediately try to authenticate so the user is signed in.
      const auth = await authenticateWithBiometric();
      if (auth.ok) {
        haptic("success");
        onLogin(auth.username);
        return;
      }
      // If for some reason auth fails right after enrollment, fall back to manual.
      setBiometricStatus("idle");
    } else {
      setBiometricStatus("error");
      setBiometricMsg(
        result.message ||
          (result.reason === "cancelled"
            ? t("native.biometric.cancelled")
            : t("native.biometric.unsupported")),
      );
      haptic("error");
    }
  };

  // ── Biometric authentication (quick unlock for returning user) ──────
  const handleQuickUnlock = async () => {
    if (!availability?.enrolled) return;
    setBiometricStatus("authenticating");
    setBiometricMsg("");
    haptic("light");
    const result = await authenticateWithBiometric();
    if (result.ok) {
      haptic("success");
      onLogin(result.username);
    } else {
      setBiometricStatus("error");
      setBiometricMsg(
        result.message ||
          (result.reason === "cancelled"
            ? t("native.biometric.cancelled")
            : t("native.biometric.unsupported")),
      );
      haptic("error");
    }
  };

  const canEnroll = !!availability?.supported && !!availability?.platformAuthenticator;
  const canQuickUnlock = !!availability?.enrolled && !!availability?.enabled;
  const biometricSupported = canEnroll || canQuickUnlock;

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-background safe-py">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
            className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground mx-auto mb-4 shadow-lg"
          >
            <Activity className="size-8" />
          </motion.div>
          <h1 className="text-2xl font-bold tracking-tight">{t("login.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("login.subtitle")}
          </p>
        </div>

        {/* Biometric quick-unlock — shown above the form when a credential
            is already enrolled on this device. Looks like a native "Sign
            In with Face ID" button. */}
        {canQuickUnlock && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mb-3"
          >
            <button
              type="button"
              onClick={handleQuickUnlock}
              disabled={biometricStatus === "authenticating" || biometricStatus === "enrolling"}
              className={cn(
                "w-full h-12 rounded-xl bg-primary text-primary-foreground text-sm font-semibold",
                "flex items-center justify-center gap-2.5 shadow-md transition-all",
                "hover:bg-primary/90 active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100",
              )}
            >
              {biometricStatus === "authenticating" ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  {t("native.biometric.unlocking")}
                </>
              ) : (
                <>
                  <Fingerprint className="size-5" />
                  {t("native.biometric.quickUnlock")}
                </>
              )}
            </button>
            <div className="flex items-center justify-center gap-1.5 my-3 text-[10px] text-muted-foreground">
              <span className="h-px bg-border flex-1 max-w-[60px]" />
              {t("common.or")}
              <span className="h-px bg-border flex-1 max-w-[60px]" />
            </div>
          </motion.div>
        )}

        <form
          onSubmit={submit}
          className="bg-card border border-border rounded-xl p-6 space-y-4"
        >
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("login.username")}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("login.usernamePlaceholder")}
              autoFocus
              className="mt-1.5 w-full h-10 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("login.password")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("login.passwordPlaceholder")}
              className="mt-1.5 w-full h-10 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary transition-colors"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {t("login.demoNote")}
            </p>
          </div>

          <button
            type="submit"
            className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            {t("login.signIn")}
            <ArrowRight className={cn("size-4", rtl && "rtl-flip-x")} />
          </button>

          {/* Biometric enrollment row — only render if the device supports it.
              If a credential is already enrolled, this becomes a "disable"
              button so the user can revoke it from the login screen. */}
          {biometricSupported && (
            <div className="pt-2 border-t border-border/60">
              <AnimatePresence mode="wait">
                {availability?.enrolled ? (
                  <motion.div
                    key="enrolled"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <ShieldCheck className="size-3.5 text-green-500 shrink-0" />
                    <span className="flex-1">
                      {t("native.biometric.enrolled", {
                        user: getBiometricUsername() ?? username,
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        disableBiometric();
                        refreshBiometric();
                        haptic("warning");
                      }}
                      className="text-[10px] text-destructive hover:underline"
                    >
                      {t("native.biometric.disable")}
                    </button>
                  </motion.div>
                ) : (
                  <motion.button
                    key="enroll"
                    type="button"
                    onClick={handleEnrollBiometric}
                    disabled={biometricStatus === "enrolling" || !username.trim()}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full flex items-center justify-center gap-2 h-9 rounded-md border border-border bg-background hover:bg-muted/40 transition-colors text-xs font-medium disabled:opacity-50"
                  >
                    {biometricStatus === "enrolling" ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        {t("native.biometric.unlocking")}
                      </>
                    ) : (
                      <>
                        <Fingerprint className="size-3.5" />
                        {t("native.biometric.enroll")}
                      </>
                    )}
                  </motion.button>
                )}
              </AnimatePresence>

              {/* Inline error message */}
              <AnimatePresence>
                {biometricStatus === "error" && biometricMsg && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive"
                  >
                    <ShieldAlert className="size-3 shrink-0 mt-0.5" />
                    <span>{biometricMsg}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {!availability?.platformAuthenticator && availability?.supported && (
                <p className="mt-2 text-[10px] text-muted-foreground/80 leading-relaxed">
                  {t("native.biometric.unsupported")}
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              haptic("light");
              onLogin("Guest");
            }}
            className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("login.guest")}
          </button>
        </form>

        <p className="text-center text-[10px] text-muted-foreground mt-6">
          {t("login.footer")}
        </p>
      </motion.div>
    </div>
  );
}
