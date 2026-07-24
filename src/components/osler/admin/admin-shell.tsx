"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Users, FileText, ClipboardList, ScrollText,
  LogOut, Moon, Sun, ShieldOff, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/components/osler/i18n-provider";
import { readCloudSession, clearCloudSession } from "@/lib/osler/cloud";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { AdminLoginPrompt } from "@/components/osler/admin/admin-login-prompt";
import { AdminProvider } from "@/components/osler/admin/admin-context";
import { adminApi, type AdminIdentity } from "@/components/osler/admin/admin-api";

interface AdminShellProps {
  children: React.ReactNode;
  /** CF-Access email injected server-side via headers(), null in local dev */
  cfEmail: string | null;
}

// ── Nav items ────────────────────────────────────────────────────────────────

function NavItem({ href, icon: Icon, label, badge }: { href: string; icon: React.ElementType; label: string; badge?: number }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      onClick={() => haptic("selection")}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 border border-primary/30 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <Badge variant="destructive" className="h-5 min-w-5 px-1 text-[10px]">
          {badge > 99 ? "99+" : badge}
        </Badge>
      )}
    </Link>
  );
}

// ── Main shell ───────────────────────────────────────────────────────────────

export function AdminShell({ children, cfEmail }: AdminShellProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [dark, setDark] = useState(true);

  // Try to restore session on mount
  useEffect(() => {
    const session = readCloudSession();
    if (!session) { setLoading(false); return; }
    adminApi.me()
      .then((id) => {
        if (id.capabilities.manageContent) setIdentity(id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Fetch pending count for admin badge
  useEffect(() => {
    if (!identity?.capabilities.approveContent) return;
    adminApi.pendingQueue()
      .then((r) => setPendingCount(r.items.length))
      .catch(() => {});
  }, [identity]);

  // Theme toggle
  useEffect(() => {
    const saved = localStorage.getItem("osler-admin-theme");
    const isDark = saved !== "light";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggleTheme = useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("osler-admin-theme", next ? "dark" : "light");
      return next;
    });
  }, []);

  const signOut = useCallback(() => {
    haptic("light");
    clearCloudSession();
    setIdentity(null);
  }, []);

  const isAdmin   = identity?.user.role === "admin";
  const isCAdmin  = identity?.user.role === "content_admin";
  const canAccess = isAdmin || isCAdmin;

  // ── Render: loading
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // ── Render: no Cloudflare Access in dev (cfEmail is null)
  if (cfEmail === null && process.env.NODE_ENV === "production") {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center">
        <div>
          <AlertTriangle className="mx-auto mb-3 size-12 text-warning" />
          <h1 className="mb-2 text-xl font-bold">{t("admin.access.protected")}</h1>
          <p className="max-w-md text-sm text-muted-foreground">{t("admin.access.protectedDesc")}</p>
        </div>
      </div>
    );
  }

  // ── Render: not logged in
  if (!identity) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <header className="flex h-12 shrink-0 items-center border-b border-border bg-card/60 px-4">
          <span className="text-sm font-bold text-primary">{t("admin.shell.brand")}</span>
          {cfEmail && <span className="ml-auto text-xs text-muted-foreground">{cfEmail}</span>}
        </header>
        <AdminLoginPrompt onSuccess={setIdentity} />
      </div>
    );
  }

  // ── Render: logged in but wrong role
  if (!canAccess) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center">
        <div>
          <ShieldOff className="mx-auto mb-3 size-12 text-destructive" />
          <h1 className="mb-2 text-xl font-bold">{t("admin.access.denied")}</h1>
          <p className="mb-4 text-sm text-muted-foreground">{t("admin.access.deniedDesc")}</p>
          <Button variant="outline" size="sm" onClick={signOut}>{t("admin.nav.signOut")}</Button>
        </div>
      </div>
    );
  }

  // ── Render: full shell
  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card/60 px-4 backdrop-blur-md">
        <span className="text-sm font-bold tracking-tight text-primary">{t("admin.shell.brand")}</span>
        <span className="text-xs text-muted-foreground hidden sm:block">{t("admin.shell.tagline")}</span>
        <div className="ml-auto flex items-center gap-2">
          {cfEmail && (
            <span className="hidden text-xs text-muted-foreground md:block">{cfEmail}</span>
          )}
          <span className="text-xs font-medium text-foreground">{identity.user.displayName}</span>
          <Button variant="ghost" size="iconSm" onClick={toggleTheme} aria-label="Toggle theme">
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button variant="ghost" size="iconSm" onClick={signOut} aria-label={t("admin.nav.signOut")}>
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 border-r border-border bg-card/40 p-3 flex flex-col gap-1 overflow-y-auto hidden md:flex">
          {isAdmin && (
            <NavItem href="/admin/dashboard" icon={LayoutDashboard} label={t("admin.nav.dashboard")} />
          )}
          {isAdmin && (
            <NavItem href="/admin/users" icon={Users} label={t("admin.nav.users")} />
          )}
          <NavItem href="/admin/content" icon={FileText} label={t("admin.nav.content")} />
          {isAdmin && (
            <NavItem href="/admin/review" icon={ClipboardList} label={t("admin.nav.review")} badge={pendingCount} />
          )}
          {isAdmin && (
            <NavItem href="/admin/audit" icon={ScrollText} label={t("admin.nav.audit")} />
          )}
          <div className="mt-auto pt-2 border-t border-border">
            <button
              onClick={signOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-destructive transition-colors"
            >
              <LogOut className="size-4" />
              {t("admin.nav.signOut")}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="h-full"
            >
              <AdminProvider identity={identity}>{children}</AdminProvider>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
