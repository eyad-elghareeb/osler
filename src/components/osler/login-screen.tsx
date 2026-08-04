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
  Eye,
  EyeOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { getConfig } from "@/lib/osler/config";
import {
  CloudApiError,
  SESSION_EXPIRED_FLAG,
  cloudEnabled,
  cloudGoogleEnabled,
  cloudUsernameAvailable,
  confirmPasswordReset,
  loginCloudAccount,
  registerCloudAccount,
  requestPasswordReset,
  startGoogleLogin,
} from "@/lib/osler/cloud";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }) => string;
      remove: (widgetId: string) => void;
    };
  }
}

interface LoginScreenProps {
  onLogin: (username: string) => void;
  /** When set, show the corresponding error banner (e.g. Google OAuth failure). */
  cloudAuthError?: "google";
}

export function LoginScreen({ onLogin, cloudAuthError }: LoginScreenProps) {
  const { t, rtl } = useI18n();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [passwordConfirm, setPasswordConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = React.useState(false);
  const [biometricStatus, setBiometricStatus] = React.useState<

    "idle" | "enrolling" | "authenticating" | "error"
  >("idle");
  const [biometricMsg, setBiometricMsg] = React.useState<string>("");
  const [cloudMode, setCloudMode] = React.useState<"login" | "register" | "reset">("login");
  const [cloudActive, setCloudActive] = React.useState(false);
  const [cloudGoogleActive, setCloudGoogleActive] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [cloudBusy, setCloudBusy] = React.useState(false);
  const [cloudError, setCloudError] = React.useState("");
  const [resetSent, setResetSent] = React.useState(false);
  const [resetToken, setResetToken] = React.useState("");
  const [usernameStatus, setUsernameStatus] = React.useState<"idle" | "checking" | "available" | "taken">("idle");
  const [turnstileToken, setTurnstileToken] = React.useState("");
  const turnstileRef = React.useRef<HTMLDivElement>(null);

  const { availability, refresh: refreshBiometric } = useBiometricAvailability();

  React.useEffect(() => {
    let cancelled = false;
    void cloudEnabled().then((enabled) => {
      if (cancelled) return;
      setCloudActive(enabled);
      if (enabled) {
        void cloudGoogleEnabled().then((gEnabled) => {
          if (!cancelled) setCloudGoogleActive(gEnabled);
        }).catch(() => {});
      }
    });
    const params = new URLSearchParams(window.location.search);
    const token = params.get("reset");
    if (token) {
      setResetToken(token);
      setCloudMode("reset");
    }
    // Surface the Google OAuth error from either the prop (passed by the
    // login page, which read it from searchParams) or a stray URL param.
    if (cloudAuthError === "google" || params.get("cloudAuthError") === "google") {
      setCloudError(t("login.googleError"));
    }
    // If a stored cloud session died (revoked / expired beyond the refresh
    // grace), tell the user why they're back on the login screen instead of
    // silently dropping them to a local-only account.
    try {
      if (sessionStorage.getItem(SESSION_EXPIRED_FLAG)) {
        sessionStorage.removeItem(SESSION_EXPIRED_FLAG);
        setCloudError(t("login.sessionExpired"));
      }
    } catch {
      // ignore
    }
    return () => { cancelled = true; };
  }, [t, cloudAuthError]);

  React.useEffect(() => {
    const sitekey = cloudActive ? getConfig().cloud.turnstileSiteKey : undefined;
    const container = turnstileRef.current;
    if (!sitekey || !container) return;
    let widgetId = "";
    const render = () => {
      if (!window.turnstile || !container.isConnected) return;
      container.replaceChildren();
      widgetId = window.turnstile.render(container, {
        sitekey,
        callback: setTurnstileToken,
        "expired-callback": () => setTurnstileToken(""),
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[src^="https://challenges.cloudflare.com/turnstile/"]');
    if (existing) {
      existing.addEventListener("load", render, { once: true });
      render();
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render, { once: true });
      document.head.appendChild(script);
    }
    return () => {
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [cloudActive]);

  // Pre-fill the username field if a biometric credential is already enrolled.
  React.useEffect(() => {
    if (availability?.enrolled) {
      const stored = getBiometricUsername();
      if (stored) setUsername(stored);
    }
  }, [availability?.enrolled]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cloudActive) {
      setCloudBusy(true);
      setCloudError("");
      try {
        if (cloudMode === "register") {
          if (password !== passwordConfirm) {
            setCloudError(t("login.passwordMismatch"));
            haptic("error");
            return;
          }
          const session = await registerCloudAccount({
            username: username.trim(),
            email: email.trim() || undefined,
            displayName: displayName.trim() || username.trim(),
            password,
            turnstileToken: turnstileToken || undefined,
          });
          haptic("success");
          onLogin(session.user.displayName);
          return;
        }
        if (cloudMode === "reset") {
          if (resetToken) {
            await confirmPasswordReset(resetToken, password);
            setResetToken("");
            setCloudMode("login");
            setCloudError("");
            haptic("success");
          } else {
            await requestPasswordReset(email, turnstileToken || undefined);
            setResetSent(true);
            haptic("success");
          }
          return;
        }
        const session = await loginCloudAccount({ identifier: username.trim(), password, turnstileToken: turnstileToken || undefined });
        haptic("success");
        onLogin(session.user.displayName);
        return;
      } catch (error) {
        setCloudError(error instanceof CloudApiError ? error.message : t("login.cloud.error"));
        haptic("error");
      } finally {
        setCloudBusy(false);
      }
      return;
    }
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

  const canEnroll = !cloudActive && !!availability?.supported && !!availability?.platformAuthenticator;
  const canQuickUnlock = !!availability?.enrolled && !!availability?.enabled;
  const biometricSupported = !cloudActive && (canEnroll || canQuickUnlock);

  const checkUsername = async () => {
    if (!cloudActive || cloudMode !== "register" || !username.trim()) return;
    setUsernameStatus("checking");
    try {
      setUsernameStatus(await cloudUsernameAvailable(username.trim()) ? "available" : "taken");
    } catch {
      setUsernameStatus("idle");
    }
  };

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
            className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground mx-auto mb-4 shadow-md"
          >
            <Activity className="size-8" />
          </motion.div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{t("login.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
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
            <Button
              type="button"
              size="lg"
              onClick={handleQuickUnlock}
              disabled={biometricStatus === "authenticating" || biometricStatus === "enrolling"}
              className="w-full h-10 rounded-md gap-2.5"
            >
              {biometricStatus === "authenticating" ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("native.biometric.unlocking")}
                </>
              ) : (
                <>
                  <Fingerprint className="size-4" />
                  {t("native.biometric.quickUnlock")}
                </>
              )}
            </Button>
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
          {cloudMode === "register" && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("login.displayName")}
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("login.displayNamePlaceholder")}
                className="mt-1.5 w-full h-10 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary transition-colors"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {cloudActive ? t("login.identifier") : t("login.username")}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setUsernameStatus("idle"); }}
              onBlur={checkUsername}
              placeholder={cloudActive ? t("login.identifierPlaceholder") : t("login.usernamePlaceholder")}
              autoFocus
              className="mt-1.5 w-full h-10 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary transition-colors"
            />
            {cloudActive && cloudMode === "register" && usernameStatus !== "idle" && (
              <p className={cn("text-xs mt-1", usernameStatus === "available" ? "text-success" : usernameStatus === "taken" ? "text-destructive" : "text-muted-foreground")}>
                {usernameStatus === "checking" ? t("login.usernameChecking") : usernameStatus === "available" ? t("login.usernameAvailable") : t("login.usernameTaken")}
              </p>
            )}
          </div>

          {cloudActive && (cloudMode === "register" || cloudMode === "reset") && !resetToken && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("login.email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("login.emailPlaceholder")}
                required={cloudMode === "reset"}
                className="mt-1.5 w-full h-10 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary transition-colors"
              />
              {cloudMode === "register" && (
                <p className="text-xs text-muted-foreground mt-1">
                  {email.trim() ? t("login.emailOptional") : t("login.noEmailWarning")}
                </p>
              )}
            </div>
          )}

          {cloudMode !== "reset" || !!resetToken ? (
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("login.password")}
              </label>
              <div className="relative mt-1.5">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={cloudActive ? t("login.passwordSecurePlaceholder") : t("login.passwordPlaceholder")}
                  minLength={cloudActive ? 8 : undefined}
                  required={cloudActive}
                  className="w-full h-10 ps-3 pe-10 bg-background border border-border rounded-md text-sm outline-none focus:border-primary transition-colors"
                />
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setShowPassword((v) => !v);
                  }}
                  className="absolute inset-y-0 end-0 pe-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {!cloudActive && <p className="text-[10px] text-muted-foreground mt-1">{t("login.demoNote")}</p>}
            </div>
          ) : null}

          {cloudActive && cloudMode === "register" && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("login.confirmPassword")}
              </label>
              <div className="relative mt-1.5">
                <input
                  type={showPasswordConfirm ? "text" : "password"}
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  placeholder={t("login.passwordSecurePlaceholder")}
                  minLength={8}
                  required
                  className="w-full h-10 ps-3 pe-10 bg-background border border-border rounded-md text-sm outline-none focus:border-primary transition-colors"
                />
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setShowPasswordConfirm((v) => !v);
                  }}
                  className="absolute inset-y-0 end-0 pe-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPasswordConfirm ? "Hide password" : "Show password"}
                >
                  {showPasswordConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
          )}


          {cloudError && <p className="text-xs text-destructive">{cloudError}</p>}
          {resetSent && <p className="text-xs text-success">{t("login.resetSent")}</p>}
          {cloudActive && getConfig().cloud.turnstileSiteKey && <div ref={turnstileRef} className="flex justify-center" />}

          <Button type="submit" size="lg" disabled={cloudBusy} className="w-full gap-2">
            {cloudBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            {cloudMode === "register" ? t("login.createAccount") : cloudMode === "reset" ? (resetToken ? t("login.resetPassword") : t("login.sendReset")) : t("login.signIn")}
            {!cloudBusy && <ArrowRight className={cn("size-4", rtl && "rtl-flip-x")} />}
          </Button>

          {cloudActive && cloudGoogleActive && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                haptic("selection");
                startGoogleLogin();
              }}
              className="w-full gap-2 text-[13px] font-medium"
            >
              <svg className="size-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              {t("login.google")}
            </Button>
          )}

          {cloudActive && (
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs">
              <Button type="button" variant="link" size="sm" onClick={() => { setCloudMode(cloudMode === "register" ? "login" : "register"); setCloudError(""); }}>
                {cloudMode === "register" ? t("login.haveAccount") : t("login.createAccount")}
              </Button>
              {cloudMode !== "reset" && <Button type="button" variant="link" size="sm" onClick={() => { setCloudMode("reset"); setCloudError(""); }}>
                {t("login.forgotPassword")}
              </Button>}
              {cloudMode === "reset" && <Button type="button" variant="link" size="sm" onClick={() => { setCloudMode("login"); setResetToken(""); }}>
                {t("login.backToSignIn")}
              </Button>}
            </div>
          )}

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
                    <ShieldCheck className="size-3.5 text-success shrink-0" />
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
                  <motion.div
                    key="enroll"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      onClick={handleEnrollBiometric}
                      disabled={biometricStatus === "enrolling" || !username.trim()}
                      className="w-full gap-2 text-xs"
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
                    </Button>
                  </motion.div>
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

          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              haptic("light");
              onLogin("Guest");
            }}
            className="w-full text-xs text-muted-foreground hover:text-foreground"
          >
            {t("login.guest")}
          </Button>
        </form>

        <p className="text-center text-[10px] text-muted-foreground mt-6">
          {t("login.footer")}
        </p>
      </motion.div>
    </div>
  );
}
