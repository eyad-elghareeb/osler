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
  BookOpen,
  BrainCircuit,
  Monitor,
  ScrollText,
  KeyRound,
  Trash2,
  ChevronDown,
  MailCheck,
  Loader2,
  Activity,
  Layers,
  History,
  StickyNote,
  Highlighter,
  Bookmark,
  MonitorPlay,
  Trophy,
  Settings2,
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
import { SectionHeading, LoadingState, EmptyState, StatTile, AnimatedDisclosure } from "@/components/osler/ui-primitives";
import { useToast } from "@/hooks/use-toast";

interface UserDetailViewProps {
  userId: string;
}

/** Sync-kind metadata for the activity grid — one entry per SYNC_KIND the
 *  progress endpoint can report. Icons/colors are display-only. */
const KIND_META: Array<{
  kind: string;
  icon: LucideIcon;
  color: "primary" | "success" | "warning" | "destructive" | "info";
}> = [
  { kind: "qbank", icon: BookOpen, color: "primary" },
  { kind: "flashcards", icon: Layers, color: "info" },
  { kind: "sessions", icon: History, color: "success" },
  { kind: "notes", icon: StickyNote, color: "warning" },
  { kind: "articleHighlights", icon: Highlighter, color: "primary" },
  { kind: "bookmarks", icon: Bookmark, color: "info" },
  { kind: "videos", icon: MonitorPlay, color: "success" },
  { kind: "achievements", icon: Trophy, color: "warning" },
  { kind: "settings", icon: Settings2, color: "primary" },
];

export function UserDetailView({ userId }: UserDetailViewProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();

  const [user, setUser] = React.useState<AdminUserDetail | null>(null);
  // Heavy sections lazy-load on first expand — the mount fetch only pulls
  // the account record (content list rides along). Progress reads every
  // sync doc; sessions hits a second table. Neither runs until opened.
  const [progress, setProgress] = React.useState<UserProgressSummary | null>(null);
  const [progressLoading, setProgressLoading] = React.useState(false);
  const [progressOpen, setProgressOpen] = React.useState(false);
  const [sessions, setSessions] = React.useState<AdminSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);
  const [sessionsLoaded, setSessionsLoaded] = React.useState(false);
  const [sessionsOpen, setSessionsOpen] = React.useState(false);
  const [contentOpen, setContentOpen] = React.useState(false);
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
    // Reset lazy sections when switching users so a new account never
    // flashes the previous one's progress/sessions.
    setProgress(null);
    setProgressOpen(false);
    setSessions([]);
    setSessionsLoaded(false);
    setSessionsOpen(false);
    setContentOpen(false);
    adminApi.getUser(userId)
      .then(setUser)
      .catch(() => setError(t("admin.userDetail.loadFailed")))
      .finally(() => setLoading(false));
  }, [userId, t]);

  function handleProgressOpenChange(open: boolean) {
    haptic("selection");
    setProgressOpen(open);
    if (open && !progress && !progressLoading) {
      setProgressLoading(true);
      adminApi.getUserProgress(userId)
        .then(setProgress)
        .catch(() => setProgress(null))
        .finally(() => setProgressLoading(false));
    }
  }

  function handleSessionsOpenChange(open: boolean) {
    haptic("selection");
    setSessionsOpen(open);
    if (open && !sessionsLoaded && !sessionsLoading) {
      setSessionsLoading(true);
      adminApi.userSessions(userId)
        .then((r) => {
          setSessions(r.sessions);
          setSessionsLoaded(true);
        })
        .catch(() => setSessionsLoaded(false))
        .finally(() => setSessionsLoading(false));
    }
  }

  async function handleClearKey() {
    if (!user) return;
    haptic("warning");
    setClearing(true);
    try {
      await adminApi.clearUserGeminiKey(user.id);
      setUser((prev) => (prev ? { ...prev, hasGeminiKey: false, geminiModel: null, geminiMaxWait: null } : prev));
      toast({ title: t("admin.userDetail.gemini.cleared") });
      setClearKeyOpen(false);
    } catch {
      toast({ title: t("admin.userDetail.gemini.clearFailed"), variant: "destructive" });
    } finally {
      setClearing(false);
    }
  }

  // Activity overview derived from the per-kind progress summary. It sits
  // above the early returns (hooks rule) and tolerates a null user — the
  // section only renders once `user` exists. Every kind is optional (older
  // Workers only return qbank/flashcards): a missing kind counts as zero
  // records / never synced.
  const activity = React.useMemo(() => {
    const kinds = KIND_META.map((m) => {
      const stats = progress?.[m.kind];
      return { ...m, count: stats?.recordCount ?? 0, updatedAt: stats?.updatedAt ?? 0 };
    });
    const totalRecords = kinds.reduce((n, k) => n + k.count, 0);
    const mostActive = kinds.reduce<(typeof kinds)[number] | null>(
      (best, k) => (k.count > 0 && (!best || k.count > best.count) ? k : best),
      null,
    );
    const lastActiveAt = kinds.reduce((latest, k) => Math.max(latest, k.updatedAt), 0);
    const accountAgeDays = user
      ? Math.max(0, Math.floor((Date.now() - user.createdAt) / 86_400_000))
      : 0;
    return { kinds, totalRecords, mostActive, lastActiveAt, accountAgeDays };
  }, [progress, user]);

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

      {/* Gemini key — stored-key status plus the non-sensitive preferences
          (model + max wait) so admins can see how the user's AI calls run
          without ever seeing the key value itself. */}
      <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
        <SectionHeading icon={KeyRound}>{t("admin.userDetail.gemini.title")}</SectionHeading>
        {user.hasGeminiKey ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 min-w-0 flex-1">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("admin.userDetail.gemini.status")}</p>
                <Badge variant="outline" className="border-success/30 text-success text-xs">
                  {t("admin.userDetail.gemini.stored")}
                </Badge>
              </div>
              <div className="space-y-1 min-w-0">
                <p className="text-xs text-muted-foreground">{t("admin.userDetail.gemini.model")}</p>
                <p className="text-sm font-medium font-mono truncate">{user.geminiModel ?? t("admin.userDetail.gemini.notSet")}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("admin.userDetail.gemini.maxWait")}</p>
                <p className="text-sm font-medium tabular-nums">
                  {user.geminiMaxWait != null
                    ? t("admin.userDetail.gemini.maxWaitSec", { n: String(Math.round(user.geminiMaxWait / 1000)) })
                    : t("admin.userDetail.gemini.notSet")}
                </p>
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0"
              onClick={() => { haptic("light"); setClearKeyOpen(true); }}
            >
              {t("admin.userDetail.gemini.clearKey")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("admin.userDetail.gemini.noKey")}</p>
        )}
      </div>

      {/* Activity & progress — collapsed until opened; the progress fetch
          reads every sync doc so it only runs on first expand. Every kind
          is optional (older Workers only return qbank/flashcards), so
          missing kinds render as zero/never rather than crashing. */}
      <AnimatedDisclosure
        icon={Activity}
        label={t("admin.userDetail.progress.title")}
        open={progressOpen}
        onOpenChange={handleProgressOpenChange}
      >
        {progressLoading ? (
          <LoadingState label={t("admin.table.loading")} />
        ) : progress ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile
                compact
                label={t("admin.userDetail.activity.totalRecords")}
                value={activity.totalRecords}
                icon={Activity}
                color="primary"
              />
              <StatTile
                compact
                label={t("admin.userDetail.activity.mostActive")}
                value={activity.mostActive ? t(`admin.userDetail.activity.kind.${activity.mostActive.kind}` as any) : "—"}
                icon={activity.mostActive?.icon ?? Trophy}
                color={activity.mostActive?.color ?? "warning"}
                footer={
                  activity.mostActive ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t("admin.userDetail.progress.records", { n: String(activity.mostActive.count) })}
                    </span>
                  ) : undefined
                }
              />
              <StatTile
                compact
                label={t("admin.userDetail.activity.lastActive")}
                value={activity.lastActiveAt > 0 ? new Date(activity.lastActiveAt).toLocaleDateString() : t("admin.userDetail.progress.never")}
                icon={History}
                color="info"
              />
              <StatTile
                compact
                label={t("admin.userDetail.activity.accountAge")}
                value={t("admin.userDetail.activity.days", { n: String(activity.accountAgeDays) })}
                icon={Calendar}
                color="success"
                footer={
                  <span className="text-xs text-muted-foreground">
                    {t("admin.userDetail.activity.joinedOn", { date: new Date(user.createdAt).toLocaleDateString() })}
                  </span>
                }
              />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {activity.kinds.map((k) => (
                <StatTile
                  key={k.kind}
                  compact
                  label={t(`admin.userDetail.activity.kind.${k.kind}` as any)}
                  value={t("admin.userDetail.progress.records", { n: String(k.count) })}
                  icon={k.icon}
                  color={k.color}
                  footer={
                    <span className="text-xs text-muted-foreground">
                      {k.updatedAt > 0
                        ? `${t("admin.userDetail.progress.lastSync")} ${new Date(k.updatedAt).toLocaleDateString()}`
                        : t("admin.userDetail.progress.never")}
                    </span>
                  }
                />
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("admin.userDetail.progress.loadFailed")}</p>
        )}
      </AnimatedDisclosure>

      {/* Sessions — collapsed until opened; fetched lazily on first expand.
          The header count falls back to the detail record's active-session
          count until the list loads. */}
      <AnimatedDisclosure
        icon={Monitor}
        label={t("admin.userDetail.sessions.title", { count: String(sessionsLoaded ? sessions.length : user.activeSessionCount) })}
        open={sessionsOpen}
        onOpenChange={handleSessionsOpenChange}
      >
        {sessionsLoading ? (
          <LoadingState label={t("admin.table.loading")} />
        ) : sessions.length === 0 ? (
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
      </AnimatedDisclosure>

      {/* Content — already on the account record, but long lists stay
          collapsed until opened. */}
      {user.content.length > 0 && (
        <AnimatedDisclosure
          icon={ScrollText}
          label={t("admin.userDetail.content.title", { count: String(user.content.length) })}
          open={contentOpen}
          onOpenChange={(open) => {
            haptic("selection");
            setContentOpen(open);
          }}
        >
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
        </AnimatedDisclosure>
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
                  {user.role === r && <span className="ms-auto text-[11px] text-muted-foreground">✓</span>}
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
