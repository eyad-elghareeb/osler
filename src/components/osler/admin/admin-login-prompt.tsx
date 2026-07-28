"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/components/osler/i18n-provider";
import { loginCloudAccount, saveCloudSession } from "@/lib/osler/cloud";
import { haptic } from "@/lib/osler/native";
import type { AdminIdentity } from "@/components/osler/admin/admin-api";
import { adminApi, AdminApiError } from "@/components/osler/admin/admin-api";
import { cn } from "@/lib/utils";

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
        transition={{ duration: 0.25 }}
        className="w-full max-w-sm"
      >
        {/* Icon */}
        <div className="mb-6 flex justify-center">
          <div className="osler-empty__icon">
            <ShieldAlert className="size-6" />
          </div>
        </div>

        <h1 className="osler-empty__title mb-1 text-center">
          {t("admin.login.title")}
        </h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          {t("admin.login.subtitle")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t("admin.login.identifier")}
            </label>
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
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t("admin.login.password")}
            </label>
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
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
      </motion.div>
    </div>
  );
}
