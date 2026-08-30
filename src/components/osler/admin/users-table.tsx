"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, ChevronLeft, ChevronRight, KeyRound, Eye, MoreVertical, ShieldCheck, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import { adminApi, type AdminUser } from "@/components/osler/admin/admin-api";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/osler/ui-primitives";
import { useToast } from "@/hooks/use-toast";

type Role = "student" | "content_admin" | "admin";

const ROLE_COLOR: Record<Role, string> = {
  admin: "bg-primary/15 text-primary border-primary/30",
  content_admin: "bg-warning/15 text-warning border-warning/30",
  student: "bg-muted text-muted-foreground border-border",
};

const ROLE_AVATAR_RING: Record<Role, string> = {
  admin: "border-primary/40",
  content_admin: "border-warning/40",
  student: "border-border",
};

function RoleBadge({ role }: { role: string }) {
  const { t } = useI18n();
  const label = t(`admin.users.roles.${role}` as any) ?? role;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", ROLE_COLOR[role as Role] ?? ROLE_COLOR.student)}>
      {label}
    </span>
  );
}

function AvatarInitials({ name, role }: { name: string; role: string }) {
  return (
    <div
      className={cn(
        "size-9 rounded-full border bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0",
        ROLE_AVATAR_RING[role as Role] ?? ROLE_AVATAR_RING.student,
      )}
      aria-hidden
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function UsersTable() {
  const { t, rtl } = useI18n();
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(() => {
    setLoading(true);
    adminApi.users(page, debouncedQ)
      .then((r) => { setUsers(r.users); setTotal(r.total); })
      .catch(() => toast({ title: t("admin.toast.failedLoadUsers"), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [page, debouncedQ]);

  useEffect(() => { load(); }, [load]);

  async function changeRole(user: AdminUser, role: Role) {
    haptic("light");
    try {
      const updated = await adminApi.updateUser(user.id, { role });
      setUsers((prev) => prev.map((u) => u.id === updated.id ? updated : u));
      toast({ title: t("admin.users.changeRole"), description: `${user.displayName} → ${t(`admin.users.roles.${role}` as any)}` });
    } catch {
      toast({ title: t("admin.toast.failedUpdateRole"), variant: "destructive" });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    haptic("warning");
    try {
      await adminApi.deleteUser(deleteTarget.id);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setTotal((n) => n - 1);
      toast({ title: t("admin.users.deleteUser") });
    } catch {
      toast({ title: t("admin.toast.failedDeleteUser"), variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  }

  async function confirmReset() {
    if (!resetTarget) return;
    haptic("light");
    setResetting(true);
    try {
      await adminApi.resetUserPassword(resetTarget.id, newPassword);
      toast({ title: t("admin.users.resetSuccess") });
      setResetTarget(null);
      setNewPassword("");
    } catch {
      toast({ title: t("admin.toast.failedResetPassword"), variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  const totalPages = Math.ceil(total / 25);
  const pageFrom = total === 0 ? 0 : (page - 1) * 25 + 1;
  const pageTo = Math.min(page * 25, total);

  return (
    <>
      {/* Search + count */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-0 w-full sm:w-auto sm:max-w-xs">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            id="admin-users-search"
            placeholder={t("admin.users.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="ps-9"
            aria-label={t("admin.users.search")}
          />
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("admin.users.total", { n: String(total) })}
        </span>
      </div>

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
              <Skeleton className="size-9 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="size-7 rounded-md" />
            </div>
          ))}
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t("admin.users.empty.title")}
          description={t("admin.users.empty.desc")}
        />
      ) : (
        <div className="space-y-2">
          {users.map((user, i) => {
            const detailHref = `/admin/users?id=${encodeURIComponent(user.id)}`;
            return (
              <motion.div
                key={user.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...MOTION_TRANSITION.quick, delay: Math.min(i * 0.03, 0.3) }}
                className="group rounded-xl border border-border bg-card hover:border-primary/40 hover:shadow-e2 transition-all"
              >
                <div className="flex items-center gap-3 p-3">
                  {/* Main hit target — opens the detail view */}
                  <Link
                    href={detailHref}
                    className="flex items-center gap-3 min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl"
                  >
                    <AvatarInitials name={user.displayName} role={user.role} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                        {user.displayName}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        @{user.username}
                        {user.email && <span className="hidden sm:inline"> · {user.email}</span>}
                        <span className="sm:hidden"> · </span>
                        <span className="sm:hidden">{new Date(user.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <RoleBadge role={user.role} />
                  </Link>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={t("admin.users.moreActions")}
                        title={t("admin.users.moreActions")}
                      >
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem asChild>
                        <Link href={detailHref}>
                          <Eye className="me-2 size-3.5" />
                          {t("admin.users.view")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>{t("admin.users.changeRole")}</DropdownMenuLabel>
                      {(["student", "content_admin", "admin"] as Role[]).map((r) => (
                        <DropdownMenuItem
                          key={r}
                          disabled={user.role === r}
                          onClick={() => changeRole(user, r)}
                        >
                          <ShieldCheck className="me-2 size-3.5" />
                          {t(`admin.users.roles.${r}` as any)}
                          {user.role === r && <span className="ms-auto text-[11px] text-muted-foreground">✓</span>}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => { setNewPassword(""); setResetTarget(user); }}>
                        <KeyRound className="me-2 size-3.5" />
                        {t("admin.users.resetPassword")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg]:!text-destructive"
                        onClick={() => setDeleteTarget(user)}
                      >
                        <Trash2 className="me-2 size-3.5" />
                        {t("admin.users.deleteUser")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="outline" size="iconSm" onClick={() => { haptic("selection"); setPage((p) => Math.max(1, p - 1)); }} disabled={page === 1} aria-label={t("common.previous")}>
            <ChevronLeft className={cn("size-4", rtl && "rtl-flip-x")} />
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            <span className="hidden sm:inline">
              {t("admin.users.showing", { from: String(pageFrom), to: String(pageTo), n: String(total) })}
            </span>
            <span className="sm:hidden">{page} / {totalPages}</span>
          </span>
          <Button variant="outline" size="iconSm" onClick={() => { haptic("selection"); setPage((p) => Math.min(totalPages, p + 1)); }} disabled={page === totalPages} aria-label={t("common.next")}>
            <ChevronRight className={cn("size-4", rtl && "rtl-flip-x")} />
          </Button>
        </div>
      )}

      {/* Reset password dialog */}
      <AlertDialog open={!!resetTarget} onOpenChange={(o) => { if (!o) { setResetTarget(null); setNewPassword(""); }}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.users.resetPassword")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.users.resetSubtitle", { name: resetTarget?.displayName ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-3">
            <Label htmlFor="reset-password" className="text-sm font-medium">{t("admin.users.newPassword")}</Label>
            <Input
              id="reset-password"
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("admin.users.passwordPlaceholder")}
              className="mt-1.5"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setNewPassword(""); }}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={newPassword.length < 8 || resetting}
              onClick={confirmReset}
            >
              {resetting ? t("common.loading") : t("admin.users.resetPassword")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.users.deleteUser")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.users.deleteConfirm", { name: deleteTarget?.displayName ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-white hover:bg-destructive/90">
              {t("admin.users.deleteUser")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
