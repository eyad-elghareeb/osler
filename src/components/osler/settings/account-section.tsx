"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trash2, AlertTriangle, Save, Download, User, Cloud, LogOut, KeyRound, Database, ShieldCheck, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CloudSyncStatusCard } from "@/components/osler/sync/cloud-sync-status";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import { readCloudSession, getCloudAccount, updateCloudAccount, changeCloudPassword, exportCloudAccount, deleteCloudAccount, logoutCloudAccount, cloudEnabled, CloudApiError, type CloudSession, type CloudAccount } from "@/lib/osler/cloud";
export function AccountSettingsSection() {
  const { t } = useI18n();
  const [session, setSession] = React.useState<CloudSession | null>(() => readCloudSession());
  const [account, setAccount] = React.useState<CloudAccount | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [cloudActive, setCloudActive] = React.useState(false);

  // Profile Form state
  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [profileSaving, setProfileSaving] = React.useState(false);
  const [profileMsg, setProfileMsg] = React.useState<{ text: string; error?: boolean } | null>(null);

  // Password Form state
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [passwordSaving, setPasswordSaving] = React.useState(false);
  const [passwordMsg, setPasswordMsg] = React.useState<{ text: string; error?: boolean } | null>(null);

  // Delete Account Modal state
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = React.useState("");
  const [deletePassword, setDeletePassword] = React.useState("");
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState("");

  // Export state
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void cloudEnabled().then((enabled) => {
      if (!cancelled) setCloudActive(enabled);
    });
    if (session) {
      getCloudAccount(session)
        .then((acc) => {
          if (cancelled) return;
          setAccount(acc);
          setDisplayName(acc.user.displayName);
          setEmail(acc.user.email || "");
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const updated = await updateCloudAccount(session, {
        displayName: displayName.trim(),
        email: email.trim() || null,
      });
      setAccount(updated);
      setProfileMsg({ text: t("settings.account.profileUpdated") });
      haptic("success");
    } catch (err) {
      setProfileMsg({ text: err instanceof CloudApiError ? err.message : t("login.cloud.error"), error: true });
      haptic("error");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setPasswordSaving(true);
    setPasswordMsg(null);
    try {
      const updatedSession = await changeCloudPassword(session, {
        currentPassword: account?.user.hasPassword ? currentPassword : undefined,
        password: newPassword,
      });
      setSession(updatedSession);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordMsg({ text: t("settings.account.passwordChanged") });
      haptic("success");
    } catch (err) {
      setPasswordMsg({ text: err instanceof CloudApiError ? err.message : t("login.cloud.error"), error: true });
      haptic("error");
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleExport = async () => {
    if (!session) return;
    setExporting(true);
    haptic("light");
    try {
      const data = await exportCloudAccount(session);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `osler-account-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      haptic("success");
    } catch {
      haptic("error");
    } finally {
      setExporting(false);
    }
  };

  const handleSignOut = async () => {
    haptic("warning");
    await logoutCloudAccount(session);
    window.location.reload();
  };

  const handleDelete = async () => {
    if (!session) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteCloudAccount(session, {
        password: account?.user.hasPassword ? deletePassword : undefined,
      });
      haptic("success");
      window.location.reload();
    } catch (err) {
      setDeleteError(err instanceof CloudApiError ? err.message : t("login.cloud.error"));
      haptic("error");
    } finally {
      setDeleteBusy(false);
    }
  };

  if (!cloudActive) {
    return (
      <Card className="p-5">
        <h2 className="text-base font-semibold flex items-center gap-2 mb-2">
          <User className="size-4 text-primary" />
          {t("settings.account.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.account.localGuestDesc")}
        </p>
        <div className="p-4 rounded-lg bg-muted/30 border border-border text-xs text-muted-foreground space-y-1">
          <div className="font-semibold text-foreground">{t("settings.account.localGuest")}</div>
          <p>{t("login.demoNote")}</p>
        </div>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin me-2" />
        <span>{t("common.loading")}</span>
      </Card>
    );
  }

  if (!session || !account) {
    return (
      <Card className="p-5">
        <h2 className="text-base font-semibold flex items-center gap-2 mb-2">
          <User className="size-4 text-primary" />
          {t("settings.account.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.account.localGuestDesc")}
        </p>
        <Button onClick={() => window.location.reload()} size="default" className="gap-2">
          <User className="size-4" />
          {t("login.signIn")}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Account Overview Header */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="size-14 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-xl font-bold text-primary-foreground shrink-0 shadow-sm">
            {account.user.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold truncate">{account.user.displayName}</h2>
              <span className={cn(
                "text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border",
                account.user.role === "admin"
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-muted text-muted-foreground border-border"
              )}>
                {account.user.role === "admin" ? t("settings.account.admin") : t("settings.account.student")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              @{account.user.username} {account.user.email ? `· ${account.user.email}` : ""}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut} className="gap-1.5 shrink-0 text-xs">
            <LogOut className="size-3.5" />
            {t("settings.account.signOut")}
          </Button>
        </div>
      </Card>

      {/* Cloud Sync Status */}
      <CloudSyncStatusCard />

      {/* Profile Details Form */}
      <Card className="p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {t("login.displayName")} & {t("login.email")}
        </h3>
        <form onSubmit={handleUpdateProfile} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("settings.account.displayName")}</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="mt-1 w-full h-9 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("settings.account.email")}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("login.emailPlaceholder")}
              className="mt-1 w-full h-9 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary"
            />
            <p className="text-[11px] text-muted-foreground mt-1">{t("login.emailOptional")}</p>
          </div>
          {profileMsg && (
            <p className={cn("text-xs", profileMsg.error ? "text-destructive" : "text-success")}>
              {profileMsg.text}
            </p>
          )}
          <Button type="submit" size="sm" disabled={profileSaving} className="gap-1.5">
            {profileSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {t("settings.account.updateProfile")}
          </Button>
        </form>
      </Card>

      {/* Password & Security */}
      <Card className="p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          {t("settings.account.security")}
        </h3>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-muted/40 border border-border flex items-center justify-between text-xs">
            <div>
              <div className="font-semibold text-foreground mb-0.5">{t("settings.account.providers")}</div>
              <div className="text-muted-foreground flex items-center gap-2">
                {account.providers.includes("google") && (
                  <span className="flex items-center gap-1 text-primary font-medium">
                    <ShieldCheck className="size-3 text-success" />
                    {t("settings.account.providerGoogle")}
                  </span>
                )}
                {account.user.hasPassword && (
                  <span className="flex items-center gap-1 text-foreground font-medium">
                    <ShieldCheck className="size-3 text-success" />
                    {t("settings.account.providerPassword")}
                  </span>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-3 pt-2">
            {account.user.hasPassword && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t("settings.account.currentPassword")}</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="mt-1 w-full h-9 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {account.user.hasPassword ? t("settings.account.newPassword") : t("settings.account.setPassword")}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
                placeholder={t("login.passwordSecurePlaceholder")}
                className="mt-1 w-full h-9 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary"
              />
            </div>
            {passwordMsg && (
              <p className={cn("text-xs", passwordMsg.error ? "text-destructive" : "text-success")}>
                {passwordMsg.text}
              </p>
            )}
            <Button type="submit" size="sm" variant="outline" disabled={passwordSaving} className="gap-1.5">
              {passwordSaving ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
              {account.user.hasPassword ? t("settings.account.changePassword") : t("settings.account.setPassword")}
            </Button>
          </form>
        </div>
      </Card>

      {/* Export & Danger Zone */}
      <Card className="p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Database className="size-4 text-primary" />
          {t("settings.section.backup")} & {t("settings.account.deleteAccount")}
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 p-3.5 rounded-lg border border-border">
            <div>
              <div className="text-sm font-semibold">{t("settings.account.exportData")}</div>
              <div className="text-xs text-muted-foreground">{t("settings.account.exportDesc")}</div>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="gap-1.5 shrink-0 text-xs">
              {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {t("settings.account.exportButton")}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 p-3.5 rounded-lg border border-destructive/30 bg-destructive/5">
            <div>
              <div className="text-sm font-semibold text-destructive">{t("settings.account.deleteAccount")}</div>
              <div className="text-xs text-muted-foreground">{t("settings.account.deleteDesc")}</div>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)} className="gap-1.5 shrink-0 text-xs">
              <Trash2 className="size-3.5" />
              {t("settings.account.deleteAccount")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Delete Account Dialog */}
      <AnimatePresence>
        {deleteOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-4 shadow-xl"
            >
              <div className="flex items-center gap-3 text-destructive">
                <AlertTriangle className="size-6 shrink-0" />
                <h3 className="text-lg font-bold">{t("settings.account.deleteConfirmTitle")}</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("settings.account.deleteConfirmPrompt")}
              </p>

              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("settings.account.typeDelete")}
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  className="mt-1 w-full h-9 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-destructive"
                />
              </div>

              {account.user.hasPassword && (
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {t("settings.account.currentPassword")}
                  </label>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    required
                    className="mt-1 w-full h-9 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-destructive"
                  />
                </div>
              )}

              {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" onClick={() => { setDeleteOpen(false); setDeleteConfirmText(""); setDeletePassword(""); setDeleteError(""); }}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteConfirmText !== "DELETE" || (account.user.hasPassword && !deletePassword) || deleteBusy}
                  onClick={handleDelete}
                  className="gap-1.5"
                >
                  {deleteBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  {t("settings.account.deleteConfirmButton")}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}