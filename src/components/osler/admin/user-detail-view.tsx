"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  User,
  ArrowLeft,
  Shield,
  Calendar,
  AtSign,
  Mail,
  ShieldCheck,
  EyeOff,
  Hash,
  BookOpen,
  BrainCircuit,
  Monitor,
  ScrollText,
  KeyRound,
  Trash2,
  ChevronDown,
  MailCheck,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import {
  adminApi,
  type AdminUserDetail,
  type UserProgressSummary,
  type AdminSession,
} from "@/components/osler/admin/admin-api";
import { SectionHeading, LoadingState, EmptyState, StatTile } from "@/components/osler/ui-primitives";
import { useToast } from "@/hooks/use-toast";

interface UserDetailViewProps {
  userId: string;
}

export function UserDetailView({ userId }: UserDetailViewProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();

  const [user, setUser] = React.useState<AdminUserDetail | null>(null);
  const [progress, setProgress] = React.useState<UserProgressSummary | null>(null);
  const [sessions, setSessions] = React.useState<AdminSession[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [clearKeyOpen, setClearKeyOpen] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [newPassword, setNewPassword] = React.useState("");
  const [resetting, setResetting] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);

  async function toggleEmailVerification() {
    if (!user || !user.email) return;
    haptic("light");
    setVerifying(true);
    const next = !user.emailVerified;
    try {
      await adminApi.setUserEmailVerified(user.id, next);
      setUser((prev) => (prev ? { ...prev, emailVerified: next } : prev));
      toast({ title: next ? t("admin.userDetail.field.emailVerifiedToast") : t("admin.userDetail.field.emailUnverifiedToast") });
    } catch {
      toast({ title: t("admin.userDetail.field.emailVerifyFailed"), variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  }

  async function changeRole(role: string) {
    if (!user || role === user.role) return;
    haptic("light");
    try {
      const updated = await adminApi.updateUser(user.id, { role });
      setUser((prev) => (prev ? { ...prev, role: updated.role } : prev));
      toast({ title: t("admin.users.changeRole"), description: `${updated.displayName} → ${t(`admin.users.roles.${role}` as any)}` });
    } catch {
      toast({ title: t("admin.toast.failedUpdateRole"), variant: "destructive" });
    }
  }

  async function confirmReset() {
    if (!user) return;
    haptic("light");
    setResetting(true);
    try {
      await adminApi.resetUserPassword(user.id, newPassword);
      toast({ title: t("admin.users.resetSuccess") });
      setResetOpen(false);
      setNewPassword("");
    } catch {
      toast({ title: t("admin.toast.failedResetPassword"), variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  async function confirmDelete() {
    if (!user) return;
    haptic("warning");
    setDeleting(true);
    try {
      await adminApi.deleteUser(user.id);
      toast({ title: t("admin.users.deleteUser") });
      router.push("/admin/users");
    } catch {
      toast({ title: t("admin.toast.failedDeleteUser"), variant: "destructive" });
      setDeleting(false);
    }
  }

  React.useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      adminApi.getUser(userId),
      adminApi.getUserProgress(userId).catch(() => null),
      adminApi.userSessions(userId).then((r) => r.sessions).catch(() => []),
    ])
      .then(([u, p, s]) => {
        setUser(u);
        setProgress(p);
        setSessions(s);
      })
      .catch(() => setError(t("admin.userDetail.loadFailed")))
      .finally(() => setLoading(false));
  }, [userId]);

  async function handleClearKey() {
    if (!user) return;
    haptic("warning");
    setClearing(true);
    try {
      await adminApi.clearUserGeminiKey(user.id);
      setUser((prev) => (prev ? { ...prev, hasGeminiKey: false } : prev));
      toast({ title: t("admin.userDetail.gemini.cleared") });
      setClearKeyOpen(false);
    } catch {
      toast({ title: t("admin.userDetail.gemini.clearFailed"), variant: "destructive" });
    } finally {
      setClearing(false);
    }
  }

  if (loading) return <LoadingState label={t("admin.table.loading")} />;
  if (!user && error) {
    return (
      <EmptyState
        icon={User}
        title={t("admin.userDetail.loadFailed")}
        description={error}
        actions={
          <Button variant="outline" onClick={() => router.push("/admin/users")}>
            {t("admin.userDetail.actions.viewInList")}
          </Button>
        }
      />
    );
  }

  if (!user) {
    return (
      <EmptyState
        icon={User}
        title={t("admin.userDetail.notFound")}
        actions={
          <Button variant="outline" onClick={() => router.push("/admin/users")}>
            {t("admin.userDetail.actions.viewInList")}
          </Button>
        }
      />
    );
  }

  const roles: Record<string, string> = {
    student: "bg-muted text-muted-foreground border-border",
    content_admin: "bg-warning/15 text-warning border-warning/30",
    admin: "bg-primary/15 text-primary border-primary/30",
  };

  return (
    <div className="space-y-6">
      {/* Back button + title */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => { haptic("light"); router.push("/admin/users"); }}
          aria-label={t("admin.userDetail.actions.viewInList")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h2 className="text-lg font-semibold">{user.displayName}</h2>
          <p className="text-sm text-muted-foreground">@{user.username}</p>
        </div>
        <Badge className={cn("ms-auto", roles[user.role] ?? roles.student)}>
          {t(`admin.users.roles.${user.role}` as any)}
        </Badge>
      </div>

      {/* Profile card */}
      <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-5">
        <SectionHeading icon={User}>{t("admin.userDetail.tabs.profile")}</SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-4">
            <Field icon={User} label={t("admin.userDetail.field.username")} value={`@${user.username}`} />
            <Field icon={Mail} label={t("admin.userDetail.field.email")} value={user.email ?? "—"} />
            <Field icon={Calendar} label={t("admin.userDetail.field.joined")} value={new Date(user.createdAt).toLocaleDateString()} />
          </div>
          <div className="space-y-4">
            <Field icon={AtSign} label={t("admin.userDetail.field.displayName")} value={user.displayName} />
            <Field icon={Shield} label={t("admin.userDetail.field.role")} value={t(`admin.users.roles.${user.role}` as any)} />
            <Field icon={Calendar} label={t("admin.userDetail.field.updated")} value={new Date(user.updatedAt).toLocaleDateString()} />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 pt-2 border-t border-border">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4 text-success" />
            <span className="text-muted-foreground">{t("admin.userDetail.field.hasPassword")}:</span>
            <span className="font-medium">
              {user.hasPassword
                ? t("admin.userDetail.field.hasPasswordYes")
                : t("admin.userDetail.field.hasPasswordNo")}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <MailCheck className={cn("size-4", user.emailVerified ? "text-success" : "text-muted-foreground")} />
            <span className="text-muted-foreground">{t("admin.userDetail.field.emailVerified")}:</span>
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                user.emailVerified
                  ? "border-success/30 text-success"
                  : "border-warning/30 text-warning",
              )}
            >
              {user.emailVerified ? t("admin.userDetail.field.emailVerifiedYes") : t("admin.userDetail.field.emailVerifiedNo")}
            </Badge>
            {user.email && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={verifying}
                onClick={() => {
                  haptic("light");
                  void toggleEmailVerification();
                }}
              >
                {verifying ? (
                  <Loader2 className="size-3 me-1.5 animate-spin" />
                ) : null}
                {user.emailVerified ? t("admin.userDetail.field.unverifyEmail") : t("admin.userDetail.field.verifyEmail")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <BrainCircuit className="size-4 text-info" />
            <span className="text-muted-foreground">{t("admin.userDetail.field.hasGeminiKey")}:</span>
            <span className="font-medium">
              {user.hasGeminiKey
                ? t("admin.userDetail.field.hasGeminiKeyYes")
                : t("admin.userDetail.field.hasGeminiKeyNo")}
            </span>
          </div>
        </div>
      </div>

      {/* Gemini key action */}
      {user.hasGeminiKey && (
        <div className="rounded-xl border border-border bg-card p-5 md:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <SectionHeading icon={EyeOff}>{t("admin.userDetail.gemini.clearKey")}</SectionHeading>
              <p className="text-sm text-muted-foreground mt-1">{t("admin.userDetail.gemini.noKey")}</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { haptic("light"); setClearKeyOpen(true); }}
            >
              {t("admin.userDetail.gemini.clearKey")}
            </Button>
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
        <SectionHeading icon={Hash}>{t("admin.userDetail.progress.title")}</SectionHeading>
        {progress ? (
          <div className="grid grid-cols-2 gap-4">
            <StatTile
              compact
              label={t("admin.userDetail.progress.qbank")}
              value={t("admin.userDetail.progress.records", { n: String(progress.qbank.recordCount) })}
              icon={BookOpen}
              color="primary"
            />
            <StatTile
              compact
              label={t("admin.userDetail.progress.flashcards")}
              value={t("admin.userDetail.progress.records", { n: String(progress.flashcards.recordCount) })}
              icon={BrainCircuit}
              color="info"
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("admin.userDetail.progress.loadFailed")}</p>
        )}
      </div>

      {/* Sessions */}
      <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
        <SectionHeading icon={Monitor}>
          {t("admin.userDetail.sessions.title", { count: String(sessions.length) })}
        </SectionHeading>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("admin.userDetail.sessions.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("admin.userDetail.sessions.col.id")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                    {t("admin.userDetail.sessions.col.created")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                    {t("admin.userDetail.sessions.col.expires")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.slice(0, 10).map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground truncate max-w-[8rem]">
                      {s.id?.slice(0, 16) ?? "—"}…
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                      {new Date(s.expires_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Content — if user has authored content */}
      {user.content.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
          <SectionHeading icon={ScrollText}>
            {t("admin.userDetail.content.title", { count: String(user.content.length) })}
          </SectionHeading>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("admin.userDetail.content.col.title")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                    {t("admin.userDetail.content.col.type")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                    {t("admin.userDetail.content.col.status")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">
                    {t("admin.userDetail.content.col.updated")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {user.content.slice(0, 20).map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2.5 font-medium">{item.title ?? "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">{item.contentType}</td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                      {new Date(item.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
        <SectionHeading icon={ScrollText}>{t("admin.userDetail.actions")}</SectionHeading>
        <div className="flex flex-wrap gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ShieldCheck className="size-3.5 me-1.5" />
                {t("admin.users.changeRole")}
                <ChevronDown className="size-3.5 ms-1 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>{t("admin.users.col.role")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(["student", "content_admin", "admin"] as const).map((r) => (
                <DropdownMenuItem
                  key={r}
                  disabled={user.role === r}
                  onClick={() => changeRole(r)}
                >
                  {t(`admin.users.roles.${r}` as any)}
                  {user.role === r && <span className="ms-auto text-[10px] text-muted-foreground">✓</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={() => { setNewPassword(""); setResetOpen(true); }}>
            <KeyRound className="size-3.5 me-1.5" />
            {t("admin.users.resetPassword")}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="size-3.5 me-1.5" />
            {t("admin.users.deleteUser")}
          </Button>
        </div>
      </div>

      {/* Clear key dialog */}
      <AlertDialog open={clearKeyOpen} onOpenChange={(o) => !o && setClearKeyOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.userDetail.gemini.clearKey")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.userDetail.gemini.clearConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearKey}
              disabled={clearing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {clearing ? t("common.loading") : t("admin.userDetail.gemini.clearKey")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset password dialog */}
      <AlertDialog open={resetOpen} onOpenChange={(o) => { if (!o) { setResetOpen(false); setNewPassword(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.users.resetPassword")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.users.resetSubtitle", { name: user.displayName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-3">
            <Label htmlFor="detail-reset-password" className="text-sm font-medium">
              {t("admin.users.newPassword")}
            </Label>
            <Input
              id="detail-reset-password"
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("admin.users.passwordPlaceholder")}
              className="mt-1.5"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setNewPassword("")}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={newPassword.length < 8 || resetting} onClick={confirmReset}>
              {resetting ? t("common.loading") : t("admin.users.resetPassword")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={(o) => !o && setDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.users.deleteUser")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.users.deleteConfirm", { name: user.displayName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? t("common.loading") : t("admin.users.deleteUser")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium truncate">{value}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    published: "bg-success/15 text-success border-success/30",
    draft: "bg-muted text-muted-foreground border-border",
    pending: "bg-warning/15 text-warning border-warning/30",
    rejected: "bg-destructive/15 text-destructive border-destructive/30",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        colorMap[status] ?? colorMap.draft,
      )}
    >
      {status}
    </span>
  );
}
