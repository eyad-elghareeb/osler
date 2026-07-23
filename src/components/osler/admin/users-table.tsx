"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, ChevronLeft, ChevronRight, KeyRound } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { adminApi, type AdminUser } from "@/components/osler/admin/admin-api";
import { Label } from "@/components/ui/label";
import { LoadingState, EmptyState } from "@/components/osler/ui-primitives";
import { useToast } from "@/hooks/use-toast";

type Role = "student" | "content_admin" | "admin";

const ROLE_COLOR: Record<Role, string> = {
  admin: "bg-primary/15 text-primary border-primary/30",
  content_admin: "bg-warning/15 text-warning border-warning/30",
  student: "bg-muted text-muted-foreground border-border",
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

export function UsersTable() {
  const { t } = useI18n();
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
      .catch(() => toast({ title: "Failed to load users", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [page, debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function changeRole(user: AdminUser, role: Role) {
    haptic("light");
    try {
      const updated = await adminApi.updateUser(user.id, { role });
      setUsers((prev) => prev.map((u) => u.id === updated.id ? updated : u));
      toast({ title: t("admin.users.changeRole"), description: `${user.displayName} → ${t(`admin.users.roles.${role}` as any)}` });
    } catch {
      toast({ title: "Failed to update role", variant: "destructive" });
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
      toast({ title: "Failed to delete user", variant: "destructive" });
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
      toast({ title: "Failed to reset password", variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  const totalPages = Math.ceil(total / 25);

  return (
    <>
      {/* Search + count */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            id="admin-users-search"
            placeholder={t("admin.users.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {t("admin.users.total", { n: String(total) })}
        </span>
      </div>

      {loading ? (
        <LoadingState label={t("common.loading")} />
      ) : users.length === 0 ? (
        <EmptyState icon={Search} title={t("common.none")} />
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {[
                  t("admin.users.col.user"),
                  t("admin.users.col.role"),
                  t("admin.users.col.email"),
                  t("admin.users.col.joined"),
                  t("admin.users.col.actions"),
                ].map((col) => (
                  <th key={col} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user, i) => (
                <motion.tr
                  key={user.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{user.displayName}</div>
                    <div className="text-xs text-muted-foreground">@{user.username}</div>
                  </td>
                  <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{user.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">{t("admin.users.changeRole")}</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(["student", "content_admin", "admin"] as Role[]).map((r) => (
                            <DropdownMenuItem
                              key={r}
                              disabled={user.role === r}
                              onClick={() => changeRole(user, r)}
                            >
                              {t(`admin.users.roles.${r}` as any)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setNewPassword(""); setResetTarget(user); }}
                      >
                        <KeyRound className="size-3.5 me-1.5" />
                        {t("admin.users.resetPassword")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(user)}
                      >
                        {t("admin.users.deleteUser")}
                      </Button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="outline" size="iconSm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button variant="outline" size="iconSm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            <ChevronRight className="size-4" />
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
            <Label htmlFor="reset-password" className="text-sm font-medium">New password</Label>
            <Input
              id="reset-password"
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="min. 10 characters"
              className="mt-1.5"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setNewPassword(""); }}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={newPassword.length < 10 || resetting}
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
