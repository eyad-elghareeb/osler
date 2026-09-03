"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Eye,
  EyeOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "./i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { MOTION_SPRING, MOTION_TRANSITION } from "@/lib/osler/motion";
import { getConfig } from "@/lib/osler/config";
import {
  CloudApiError,
  SESSION_EXPIRED_FLAG,
  cloudEnabled,
  cloudGoogleEnabled,
  cloudUsernameAvailable,
  confirmEmailVerify,
  confirmPasswordReset,
  loginCloudAccount,
  registerCloudAccount,
  requestEmailVerify,
  requestPasswordReset,
  startGoogleLogin,
  verifyGuestTurnstile,
} from "@/lib/osler/cloud";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback": () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
        },
      ) => string;
      remove: (widgetId: string) => void;
      /** Re-issue the challenge in-place and produce a fresh single-use token. */
      reset: (widgetId: string) => void;
    };
  }
}

interface LoginScreenProps {
  onLogin: (username: string) => void;
  /** When set, show the corresponding error banner (e.g. Google OAuth failure). */
  cloudAuthError?: "google" | "email_claimed";
}

export function LoginScreen({ onLogin, cloudAuthError }: LoginScreenProps) {
  const { t, rtl } = useI18n();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [passwordConfirm, setPasswordConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = React.useState(false);
  const [cloudMode, setCloudMode] = React.useState<"login" | "register" | "reset" | "verify">("login");
  const [cloudActive, setCloudActive] = React.useState(false);
  const [cloudGoogleActive, setCloudGoogleActive] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [cloudBusy, setCloudBusy] = React.useState(false);
  const [cloudError, setCloudError] = React.useState("");
  const [resetSent, setResetSent] = React.useState(false);
  const [resetToken, setResetToken] = React.useState("");
  const [verifyState, setVerifyState] = React.useState<"idle" | "verifying" | "success" | "error">("idle");
  const [verifySent, setVerifySent] = React.useState(false);
  const [usernameStatus, setUsernameStatus] = React.useState<"idle" | "checking" | "available" | "taken">("idle");
  const [turnstileToken, setTurnstileToken] = React.useState("");
  const turnstileRef = React.useRef<HTMLDivElement>(null);
  const turnstileWidgetId = React.useRef("");

  // Guest dialog — display-name picker with its own Turnstile gate.
  const [guestDialogOpen, setGuestDialogOpen] = React.useState(false);
  const [guestName, setGuestName] = React.useState("");
  const [guestTurnstileToken, setGuestTurnstileToken] = React.useState("");
  const guestTurnstileRef = React.useRef<HTMLDivElement>(null);
  const guestTurnstileWidgetId = React.useRef("");
  const [guestVerifying, setGuestVerifying] = React.useState(false);
  const [guestError, setGuestError] = React.useState("");

  // Turnstile tokens are single-use: once a submit fires (success OR failure)
  // the presented token is spent. Reset the widget so the next attempt carries
  // a fresh token instead of re-sending a dead one and bouncing off the
  // server's fail-closed check.
  const resetTurnstile = React.useCallback(() => {
    setTurnstileToken("");
    const widgetId = turnstileWidgetId.current;
    if (!widgetId || !window.turnstile) return;
    try {
      window.turnstile.reset(widgetId);
    } catch {
      window.turnstile.remove(widgetId);
      turnstileWidgetId.current = "";
    }
  }, []);

  // Guests have no account to submit the main form, so their Turnstile
  // challenge lives in the guest dialog. Mirror the main widget's render logic
  // but scoped to the dialog's container (rendered only while it's open).
  const guestTurnstileEnabled = cloudActive && !!getConfig().cloud.turnstileSiteKey;
  const emailEnabled = getConfig().email?.enabled !== false;

  React.useEffect(() => {
    const sitekey = getConfig().cloud.turnstileSiteKey;
    const container = guestTurnstileRef.current;
    if (!guestDialogOpen || !guestTurnstileEnabled || !sitekey || !container) return;

    const render = () => {
      if (!window.turnstile || !container.isConnected) return;
      container.replaceChildren();
      guestTurnstileWidgetId.current = window.turnstile.render(container, {
        sitekey,
        callback: (token) => {
          setGuestTurnstileToken(token);
          setGuestError("");
        },
        "expired-callback": () => setGuestTurnstileToken(""),
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
      const widgetId = guestTurnstileWidgetId.current;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      guestTurnstileWidgetId.current = "";
      setGuestTurnstileToken("");
    };
  }, [guestDialogOpen, guestTurnstileEnabled]);

  const resetGuestTurnstile = React.useCallback(() => {
    setGuestTurnstileToken("");
    const widgetId = guestTurnstileWidgetId.current;
    if (!widgetId || !window.turnstile) return;
    try {
      window.turnstile.reset(widgetId);
    } catch {
      window.turnstile.remove(widgetId);
      guestTurnstileWidgetId.current = "";
    }
  }, []);

  const handleGuestContinue = async () => {
    const name = guestName.trim();
    if (!name || guestVerifying) return;
    if (guestTurnstileEnabled) {
      if (!guestTurnstileToken) return;
      setGuestVerifying(true);
      setGuestError("");
      try {
        const ok = await verifyGuestTurnstile(guestTurnstileToken);
        if (!ok) {
          setGuestError(t("login.guestTurnstileFailed"));
          resetGuestTurnstile();
          haptic("error");
          return;
        }
      } catch {
        setGuestError(t("login.guestVerifyError"));
        resetGuestTurnstile();
        haptic("error");
        return;
      } finally {
        setGuestVerifying(false);
      }
    }
    haptic("success");
    setGuestDialogOpen(false);
    setGuestName("");
    onLogin(name);
  };

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
    // A password-reset or email-verify link carries a bearer token: either
    // surfaced at the top level (/?reset=TOKEN, /?verify=TOKEN, or their
    // /login?… forms once RouteGuard has normalized them) or, defensively,
    // still buried inside `next` from an old guest redirect. Recover from both.
    let reset = params.get("reset");
    if (!reset) {
      const nextRaw = params.get("next");
      if (nextRaw) reset = new URLSearchParams(nextRaw.replace(/^\//, "")).get("reset");
    }
    if (reset) {
      setResetToken(reset);
      setCloudMode("reset");
      params.delete("reset");
    }
    let verify = params.get("verify");
    if (!verify) {
      const nextRaw = params.get("next");
      if (nextRaw) verify = new URLSearchParams(nextRaw.replace(/^\//, "")).get("verify");
    }
    if (verify) {
      params.delete("verify");
      setVerifyState("verifying");
      void confirmEmailVerify(verify)
        .then((res) => setVerifyState(res.verified ? "success" : "error"))
        .catch(() => setVerifyState("error"));
    }
    // Reset and verify tokens are bearer credentials — drop them from the URL
    // so they can't linger in browser history, bookmarks, or be leaked as a
    // Referer.
    if (reset || verify) {
      const cleanQuery = params.toString();
      history.replaceState(null, "", `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${window.location.hash}`);
    }
    // Surface the Google OAuth error from either the prop (passed by the
    // login page, which read it from searchParams) or a stray URL param.
    if (cloudAuthError === "google" || params.get("cloudAuthError") === "google") {
      setCloudError(t("login.googleError"));
    }
    if (cloudAuthError === "email_claimed" || params.get("cloudAuthError") === "email_claimed") {
      setCloudError(t("login.googleEmailClaimed"));
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
      turnstileWidgetId.current = widgetId;
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
            await confirmPasswordReset(resetToken, password, turnstileToken || undefined);
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
        if (cloudMode === "verify") {
          await requestEmailVerify(email, turnstileToken || undefined);
          setVerifySent(true);
          haptic("success");
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
        // The Turnstile token for this attempt was consumed by the request
        // (success or failure) — re-issue so a retry never sends a dead token.
        resetTurnstile();
      }
      return;
    }
    const name = username.trim() || "Guest";
    haptic("success");
    onLogin(name);
  };

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
    <div className="min-h-dvh flex items-center justify-center p-4 bg-background safe-py relative overflow-hidden">
      {/* Ambient primary glow — one focal element per viewport per the
       * design-library-roadmap. Sits behind the card, never competes with
       * the form's text contrast. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 35%, color-mix(in oklch, var(--primary) 14%, transparent), transparent 70%)",
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MOTION_TRANSITION.slow}
        className="w-full max-w-md relative"
      >
        {/* Brand header — Motion Primitives staggered entrance */}
        <motion.div
          className="text-center mb-8"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
          }}
        >
          <motion.div
            variants={{
              hidden: { scale: 0.9, opacity: 0, y: 6 },
              visible: {
                scale: 1,
                opacity: 1,
                y: 0,
                transition: MOTION_SPRING.pop,
              },
            }}
            className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground mx-auto mb-4 shadow-e2 relative overflow-hidden"
          >
            {/* Subtle inner highlight — reads as a polished glass tile */}
            <span
              aria-hidden
              className="absolute inset-0 opacity-40"
              style={{
                background:
                  "linear-gradient(160deg, color-mix(in oklch, var(--primary-foreground) 25%, transparent), transparent 55%)",
              }}
            />
            <Activity className="size-8 relative" />
          </motion.div>
          <motion.h1
            variants={{
              hidden: { opacity: 0, y: 6 },
              visible: { opacity: 1, y: 0, transition: MOTION_TRANSITION.normal },
            }}
            className="osler-display text-2xl md:text-3xl font-bold"
          >
            {t("login.title")}
          </motion.h1>
          <motion.p
            variants={{
              hidden: { opacity: 0, y: 6 },
              visible: { opacity: 1, y: 0, transition: MOTION_TRANSITION.normal },
            }}
            className="text-sm text-muted-foreground mt-1 max-w-md mx-auto"
          >
            {t("login.subtitle")}
          </motion.p>
        </motion.div>

        <form
          onSubmit={submit}
          className="bg-card border border-border rounded-xl p-6 space-y-4 shadow-e1"
        >
          {cloudMode === "register" && (
            <div>
              <label htmlFor="display-name" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("login.displayName")}
              </label>
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("login.displayNamePlaceholder")}
                autoComplete="name"
                className="w-full h-10 px-3 bg-background border border-border-strong rounded-md text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          )}

          <div>
            <label htmlFor="username" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {cloudActive ? t("login.identifier") : t("login.username")}
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setUsernameStatus("idle"); }}
              onBlur={checkUsername}
              placeholder={cloudActive ? t("login.identifierPlaceholder") : t("login.usernamePlaceholder")}
              autoComplete="username"
              autoFocus
              className="w-full h-10 px-3 bg-background border border-border-strong rounded-md text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            {cloudActive && cloudMode === "register" && usernameStatus !== "idle" && (
              <p className={cn("text-xs mt-1", usernameStatus === "available" ? "text-success" : usernameStatus === "taken" ? "text-destructive" : "text-muted-foreground")}>
                {usernameStatus === "checking" ? t("login.usernameChecking") : usernameStatus === "available" ? t("login.usernameAvailable") : t("login.usernameTaken")}
              </p>
            )}
          </div>

          {cloudActive && (cloudMode === "register" || cloudMode === "reset" || cloudMode === "verify") && !resetToken && (
            <div>
              <label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("login.email")}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("login.emailPlaceholder")}
                autoComplete="email"
                required={cloudMode === "reset" || cloudMode === "verify"}
                className="w-full h-10 px-3 bg-background border border-border-strong rounded-md text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              {cloudMode === "register" && (
                <p className="text-xs text-muted-foreground mt-1">
                  {email.trim() ? t("login.emailOptional") : t("login.noEmailWarning")}
                </p>
              )}
            </div>
          )}

          {cloudMode !== "verify" && (cloudMode !== "reset" || !!resetToken) ? (
            <div>
              <label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("login.password")}
              </label>
              <div className="relative mt-1.5">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={cloudActive ? t("login.passwordSecurePlaceholder") : t("login.passwordPlaceholder")}
                  autoComplete={cloudMode === "login" ? "current-password" : "new-password"}
                  minLength={cloudActive ? 8 : undefined}
                  required={cloudActive}
                  className="w-full h-10 ps-3 pe-10 bg-background border border-border-strong rounded-md text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setShowPassword((v) => !v);
                  }}
                  className="absolute inset-y-0 end-0 pe-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {!cloudActive && <p className="text-[11px] text-muted-foreground mt-1">{t("login.demoNote")}</p>}
            </div>
          ) : null}

          {cloudActive && cloudMode === "register" && (
            <div>
              <label htmlFor="password-confirm" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("login.confirmPassword")}
              </label>
              <div className="relative mt-1.5">
                <input
                  id="password-confirm"
                  type={showPasswordConfirm ? "text" : "password"}
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  placeholder={t("login.passwordSecurePlaceholder")}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="w-full h-10 ps-3 pe-10 bg-background border border-border-strong rounded-md text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setShowPasswordConfirm((v) => !v);
                  }}
                  className="absolute inset-y-0 end-0 pe-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPasswordConfirm ? t("login.hidePassword") : t("login.showPassword")}
                >
                  {showPasswordConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
          )}


          {cloudError && <p className="text-xs text-destructive">{cloudError}</p>}
          {resetSent && <p className="text-xs text-success">{t("login.resetSent")}</p>}
          {verifySent && <p className="text-xs text-success">{t("login.verifySent")}</p>}
          {verifyState !== "idle" && (
            <div className={cn("flex items-start gap-1.5 text-xs", verifyState === "success" ? "text-success" : "text-destructive")}>
              {verifyState === "verifying" ? (
                <Loader2 className="size-3.5 animate-spin shrink-0 mt-0.5" />
              ) : verifyState === "success" ? (
                <ShieldCheck className="size-3.5 shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="size-3.5 shrink-0 mt-0.5" />
              )}
              <span>
                {verifyState === "verifying" ? t("login.verifyChecking") : verifyState === "success" ? t("login.verifyConfirmed") : t("login.verifyFailed")}
              </span>
            </div>
          )}
          {cloudActive && getConfig().cloud.turnstileSiteKey && <div ref={turnstileRef} className="flex justify-center" />}

          <Button type="submit" size="lg" disabled={cloudBusy} className="w-full gap-2">
            {cloudBusy ? <Loader2 className="size-4 animate-spin" /> : null}
            {cloudMode === "register" ? t("login.createAccount") : cloudMode === "reset" ? (resetToken ? t("login.resetPassword") : t("login.sendReset")) : cloudMode === "verify" ? t("login.sendVerify") : t("login.signIn")}
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
              {cloudMode === "login" && emailEnabled && (
                <>
                  <Button type="button" variant="link" size="sm" onClick={() => { setCloudMode("reset"); setCloudError(""); setVerifyState("idle"); setVerifySent(false); }}>
                    {t("login.forgotPassword")}
                  </Button>
                  <Button type="button" variant="link" size="sm" onClick={() => { setCloudMode("verify"); setCloudError(""); setVerifyState("idle"); setVerifySent(false); }}>
                    {t("login.resendVerification")}
                  </Button>
                </>
              )}
              {(cloudMode === "reset" || cloudMode === "verify") && <Button type="button" variant="link" size="sm" onClick={() => { setCloudMode("login"); setResetToken(""); setVerifyState("idle"); }}>
                {t("login.backToSignIn")}
              </Button>}
            </div>
          )}

          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              haptic("selection");
              setGuestError("");
              setGuestDialogOpen(true);
            }}
            className="w-full text-xs text-muted-foreground hover:text-foreground"
          >
            {t("login.guest")}
          </Button>
        </form>

        {/* Guest display-name dialog */}
        <Dialog open={guestDialogOpen} onOpenChange={setGuestDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("login.guestDialogTitle")}</DialogTitle>
              <DialogDescription>{t("login.guestDialogDescription")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="guest-name"
                  className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {t("login.displayName")}
                </label>
                <input
                  id="guest-name"
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder={t("login.displayNamePlaceholder")}
                  autoComplete="nickname"
                  autoFocus
                  maxLength={48}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleGuestContinue();
                    }
                  }}
                  className="mt-1.5 w-full h-10 px-3 bg-background border border-border-strong rounded-md text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              {guestTurnstileEnabled && (
                <div ref={guestTurnstileRef} className="flex justify-center" />
              )}
              {guestError && <p className="text-xs text-destructive">{guestError}</p>}
            </div>
            <DialogFooter>
              <Button
                type="button"
                size="lg"
                onClick={handleGuestContinue}
                disabled={guestVerifying || !guestName.trim() || (guestTurnstileEnabled && !guestTurnstileToken)}
                className="w-full gap-2"
              >
                {guestVerifying && <Loader2 className="size-4 animate-spin" />}
                {t("login.guestContinue")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <p className="text-center text-[11px] text-muted-foreground mt-6">
          {t("login.footer")}
        </p>
      </motion.div>
    </div>
  );
}
