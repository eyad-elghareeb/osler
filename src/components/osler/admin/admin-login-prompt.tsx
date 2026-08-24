"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/osler/i18n-provider";
import { loginCloudAccount, saveCloudSession } from "@/lib/osler/cloud";
import { haptic } from "@/lib/osler/native";
import type { AdminIdentity } from "@/components/osler/admin/admin-api";
import { adminApi, AdminApiError } from "@/components/osler/admin/admin-api";
import { OslerCard } from "@/components/osler/ui-primitives";
import { MOTION_TRANSITION } from "@/lib/osler/motion";

interface AdminLoginPromptProps {
  onSuccess: (identity: AdminIdentity) => void;
}

export function AdminLoginPrompt({ onSuccess }: AdminLoginPromptProps) {
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    haptic("light");
    setBusy(true);
    setError(null);
    try {
      const session = await loginCloudAccount({ identifier, password });
      saveCloudSession(session);
      // Validate role
      const identity = await adminApi.me();
      if (!identity.capabilities.manageContent) {
        throw new AdminApiError(403, t("admin.access.denied"));
      }
      haptic("success");
      onSuccess(identity);
    } catch (err) {
      haptic("error");
      const msg = err instanceof AdminApiError
        ? (err.status === 403 ? t("admin.access.deniedDesc") : err.message)
        : t("admin.login.error");
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={MOTION_TRANSITION.normal}
        className="w-full max-w-md"
      >
        <OslerCard padding="roomy">
          <div className="mb-6 flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
              <ShieldAlert className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight">{t("admin.login.title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("admin.login.subtitle")}</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="admin-identifier">{t("admin.login.identifier")}</Label>
              <Input
                id="admin-identifier"
                type="text"
                autoComplete="username"
                autoFocus
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={busy}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-password">{t("admin.login.password")}</Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
              />
            </div>

          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            id="admin-login-btn"
            type="submit"
            className="w-full"
            size="lg"
            disabled={busy || !identifier || !password}
          >
            {busy ? t("common.loading") : t("admin.login.submit")}
          </Button>
          </form>
        </OslerCard>
      </motion.div>
    </div>
  );
}
