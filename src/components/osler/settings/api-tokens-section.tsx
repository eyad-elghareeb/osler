"use client";

import * as React from "react";
import { Bot, Copy, Check, KeyRound, Plus, Trash2, Loader2, ShieldCheck, Shield } from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { OslerCard, EmptyState } from "@/components/osler/ui-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useOslerSession } from "@/lib/osler/session-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiTokens, getMcpEndpoint, type AdminApiToken } from "@/components/osler/admin/admin-api";

const EXPIRY_OPTIONS = [
  { value: "0", labelKey: "admin.tokens.expiry.never" },
  { value: "30", labelKey: "admin.tokens.expiry.d30" },
  { value: "90", labelKey: "admin.tokens.expiry.d90" },
  { value: "365", labelKey: "admin.tokens.expiry.d365" },
];

/** Admin → Settings → "AI Agents" section: mint/revoke MCP API tokens. */
export function ApiTokensSection() {
  const { t, rtl } = useI18n();
  const [tokens, setTokens] = React.useState<AdminApiToken[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [endpoint, setEndpoint] = React.useState("");
  const [name, setName] = React.useState("");
  const [expiry, setExpiry] = React.useState("90");
  const [scope, setScope] = React.useState<"admin" | "content_admin">("content_admin");
  const [creating, setCreating] = React.useState(false);
  const [createdToken, setCreatedToken] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  const { cloudSession } = useOslerSession();
  const isAdminUser = cloudSession?.user?.role === "admin";

  const refresh = React.useCallback(async () => {
    try {
      setTokens((await apiTokens.list()).items);
    } catch (e: any) {
      toast({ title: t("admin.tokens.loadError"), description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void refresh();
    void getMcpEndpoint().then(setEndpoint).catch(() => {});
  }, []);

  const copy = async (value: string, tag: string) => {
    haptic("light");
    await navigator.clipboard.writeText(value).catch(() => {});
    setCopied(tag);
    setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500);
  };

  const create = async () => {
    if (!name.trim() || creating) return;
    haptic("medium");
    setCreating(true);
    try {
      const selectedScope = isAdminUser ? scope : "content_admin";
      const res = await apiTokens.create(name.trim(), Number(expiry) || null, selectedScope);
      setCreatedToken(res.token);
      setName("");
      haptic("success");
      await refresh();
    } catch (e: any) {
      haptic("error");
      toast({ title: t("admin.tokens.createError"), description: e?.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    haptic("warning");
    try {
      await apiTokens.revoke(id);
      toast({ title: t("admin.tokens.revoked") });
      await refresh();
    } catch (e: any) {
      toast({ title: t("admin.tokens.revokeError"), description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <OslerCard padding="roomy">
        <div className="flex items-start gap-3 mb-4">
          <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Bot className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t("admin.tokens.title")}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t("admin.tokens.desc")}</p>
          </div>
        </div>

        {/* Endpoint */}
        <div className="mb-4">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("admin.tokens.endpoint")}</Label>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-[var(--font-code)]">
              {endpoint || "…"}
            </code>
            <Button type="button" variant="outline" size="iconSm" onClick={() => endpoint && copy(endpoint, "endpoint")} aria-label={t("admin.tokens.copy")}>
              {copied === "endpoint" ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t("admin.tokens.connectHint")}</p>
        </div>

        {/* Create */}
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("admin.tokens.new")}</Label>
        <div className={cn("mt-1.5 grid gap-2", isAdminUser ? "grid-cols-1 sm:grid-cols-[1fr_150px_130px_auto]" : "grid-cols-1 sm:grid-cols-[1fr_140px_auto]")}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("admin.tokens.namePlaceholder")}
            maxLength={80}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          {isAdminUser && (
            <Select value={scope} onValueChange={(v) => { haptic("selection"); setScope(v as any); }}>
              <SelectTrigger><SelectValue placeholder={t("admin.tokens.scope.label")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{t("admin.tokens.scope.admin")}</SelectItem>
                <SelectItem value="content_admin">{t("admin.tokens.scope.contentAdmin")}</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select value={expiry} onValueChange={(v) => { haptic("selection"); setExpiry(v); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {EXPIRY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{t(o.labelKey as any)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={create} disabled={!name.trim() || creating}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t("admin.tokens.create")}
          </Button>
        </div>

        {/* One-time secret reveal */}
        {createdToken && (
          <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-3">
            <p className="text-xs font-medium text-warning mb-1.5">{t("admin.tokens.createdNotice")}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded-lg border border-border bg-background px-3 py-2 text-xs font-[var(--font-code)]" dir="ltr">
                {createdToken}
              </code>
              <Button type="button" variant="outline" size="iconSm" onClick={() => copy(createdToken, "token")} aria-label={t("admin.tokens.copy")}>
                {copied === "token" ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              </Button>
            </div>
          </div>
        )}
      </OslerCard>

      {/* Token list */}
      <OslerCard padding="default">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t("admin.tokens.list")}</h3>
        </div>
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : tokens.length === 0 ? (
          <EmptyState icon={Bot} title={t("admin.tokens.empty")} description={t("admin.tokens.emptyDesc")} />
        ) : (
          <ul className="divide-y divide-border">
            {tokens.map((tok) => {
              const expired = tok.expiresAt != null && tok.expiresAt < Date.now();
              const status = tok.revokedAt != null ? "revoked" : expired ? "expired" : "active";
              const isFullAdmin = tok.scope === "admin";
              return (
                <li key={tok.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{tok.name}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] shrink-0 font-medium",
                          isFullAdmin ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-muted/40 text-muted-foreground"
                        )}
                      >
                        {isFullAdmin ? <ShieldCheck className="size-3 me-1" /> : <Shield className="size-3 me-1" />}
                        {t(isFullAdmin ? "admin.tokens.scope.badgeAdmin" : "admin.tokens.scope.badgeContentAdmin")}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] shrink-0",
                          status === "active" && "border-success/30 text-success",
                          status === "revoked" && "border-destructive/30 text-destructive",
                          status === "expired" && "border-warning/30 text-warning",
                        )}
                      >
                        {t(`admin.tokens.status.${status}`)}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate" dir="ltr">
                      {tok.prefix}… · {t("admin.tokens.lastUsed")}: {tok.lastUsedAt ? fmtDate(tok.lastUsedAt) : t("admin.tokens.neverUsed")}
                      {tok.expiresAt ? ` · ${t("admin.tokens.expires")}: ${fmtDate(tok.expiresAt)}` : ""}
                    </div>
                  </div>
                  {status !== "revoked" && status !== "expired" && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="ghost" size="iconSm" className="text-destructive hover:text-destructive" aria-label={t("admin.tokens.revoke")}>
                          <Trash2 className={cn("size-3.5", rtl && "rtl-flip-x")} />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("admin.tokens.revokeTitle", { name: tok.name })}</AlertDialogTitle>
                          <AlertDialogDescription>{t("admin.tokens.revokeDesc")}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => revoke(tok.id)}>{t("admin.tokens.revoke")}</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </OslerCard>
    </div>
  );
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
