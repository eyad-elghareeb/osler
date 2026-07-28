"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  LayoutDashboard,
  Users,
  FileText,
  ClipboardList,
  ScrollText,
  LogOut,
  Moon,
  Sun,
  ShieldOff,
  AlertTriangle,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  PanelLeft,
  Home,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useI18n } from "@/components/osler/i18n-provider";
import { readCloudSession, clearCloudSession } from "@/lib/osler/cloud";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/osler/ui-primitives";
import { AdminLoginPrompt } from "@/components/osler/admin/admin-login-prompt";
import { AdminProvider } from "@/components/osler/admin/admin-context";
import {
  AdminSettingsProvider,
  useAdminSettings,
} from "@/components/osler/admin/admin-settings-context";
import { adminApi, type AdminIdentity } from "@/components/osler/admin/admin-api";

interface AdminShellProps {
  children: React.ReactNode;
  /** CF-Access email injected server-side via headers(), null in local dev */
  cfEmail: string | null;
}

// ── Nav item definition ────────────────────────────────────────────────────

interface NavItemDef {
  href: string;
  icon: React.ElementType;
  labelKey: string;
  superAdminOnly?: boolean;
  badge?: number;
}

// ── Main shell ─────────────────────────────────────────────────────────────

export function AdminShell({ children, cfEmail }: AdminShellProps) {
  // The shell wraps everything in the AdminSettingsProvider so that all
  // descendants (sidebar, header, pages) can read & update admin settings.
  return (
    <AdminSettingsProvider>
      <AdminShellInner cfEmail={cfEmail}>{children}</AdminShellInner>
    </AdminSettingsProvider>
  );
}

function AdminShellInner({ children, cfEmail }: AdminShellProps) {
  const { t, rtl } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const { settings, update, theme, toggleTheme } = useAdminSettings();

  const [identity, setIdentity] = React.useState<AdminIdentity | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  // Try to restore session on mount.
  // In dev mode (NODE_ENV !== production), if no cloud session and no cloud
  // backend is configured, we fall back to a mock admin identity so the
  // revamped admin UI can be previewed without a Cloudflare Workers backend.
  React.useEffect(() => {
    const session = readCloudSession();
    if (!session) {
      setLoading(false);
      return;
    }
    adminApi
      .me()
      .then((id) => {
        if (id.capabilities.manageContent) setIdentity(id);
      })
      .catch((err) => {
        // Dev preview fallback when the cloud API is completely unreachable
        // (network error, server not started, etc.) — not for auth failures.
        if (process.env.NODE_ENV !== "production" && err instanceof TypeError) {
          setIdentity({
            user: {
              id: "dev-admin",
              username: "admin",
              displayName: "Admin",
              role: "admin",
              email: "admin@local.test",
              createdAt: Date.now(),
            },
            capabilities: {
              manageUsers: true,
              manageContent: true,
              approveContent: true,
              publishDirect: true,
              viewStats: true,
              viewAudit: true,
              manageSessions: true,
            },
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Fetch pending count for admin badge.
  React.useEffect(() => {
    if (!identity?.capabilities.approveContent) return;
    adminApi
      .pendingQueue()
      .then((r) => setPendingCount(r.items.length))
      .catch(() => {});
  }, [identity]);

  const signOut = React.useCallback(() => {
    haptic("light");
    clearCloudSession();
    setIdentity(null);
  }, []);

  const toggleSidebar = React.useCallback(() => {
    update("sidebarCollapsed", !settings.sidebarCollapsed);
  }, [settings.sidebarCollapsed, update]);

  const isAdmin = identity?.user.role === "admin";
  const isCAdmin = identity?.user.role === "content_admin";
  const canAccess = isAdmin || isCAdmin;

  // ── Render: loading
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <LoadingState />
      </div>
    );
  }

  // ── Render: no Cloudflare Access in dev (cfEmail is null)
  if (cfEmail === null && process.env.NODE_ENV === "production") {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="osler-empty__icon">
            <AlertTriangle className="size-6" />
          </div>
          <h1 className="osler-empty__title">{t("admin.access.protected")}</h1>
          <p className="osler-empty__body">{t("admin.access.protectedDesc")}</p>
        </div>
      </div>
    );
  }

  // ── Render: not logged in
  if (!identity) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center border-b border-border bg-background/80 backdrop-blur-md px-4 safe-pt">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Activity className="size-4 text-primary" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">{t("app.name")}</div>
              <div className="text-xs text-muted-foreground">
                {t("admin.shell.brandAdmin")} · {t("admin.shell.tagline")}
              </div>
            </div>
          </div>
          {cfEmail && (
            <span className="ms-auto text-xs text-muted-foreground">{cfEmail}</span>
          )}
        </header>
        <AdminLoginPrompt onSuccess={setIdentity} />
      </div>
    );
  }

  // ── Render: logged in but wrong role
  if (!canAccess) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="osler-empty__icon">
            <ShieldOff className="size-6" />
          </div>
          <h1 className="osler-empty__title">{t("admin.access.denied")}</h1>
          <p className="osler-empty__body">{t("admin.access.deniedDesc")}</p>
          <Button variant="outline" size="sm" onClick={signOut}>
            {t("admin.nav.signOut")}
          </Button>
        </div>
      </div>
    );
  }

  // ── Nav items (depends on role)
  const workItems: NavItemDef[] = [
    ...(isAdmin
      ? [{ href: "/admin/dashboard", icon: LayoutDashboard, labelKey: "admin.nav.dashboard" }]
      : []),
    { href: "/admin/content", icon: FileText, labelKey: "admin.nav.content" },
    ...(isAdmin
      ? [
          {
            href: "/admin/review",
            icon: ClipboardList,
            labelKey: "admin.nav.review",
            badge: pendingCount,
          },
        ]
      : []),
  ];
  const systemItems: NavItemDef[] = [
    ...(isAdmin
      ? [{ href: "/admin/users", icon: Users, labelKey: "admin.nav.users" }]
      : []),
    ...(isAdmin
      ? [{ href: "/admin/audit", icon: ScrollText, labelKey: "admin.nav.audit" }]
      : []),
    { href: "/admin/settings", icon: SettingsIcon, labelKey: "admin.settings.title" },
  ];

  const sidebarCollapsed = settings.sidebarCollapsed;
  const reducedMotion = settings.reducedMotion;

  // ── Render: full shell
  return (
    <div
      className={cn(
        "h-screen md:h-screen h-[100dvh] flex flex-col bg-background overflow-hidden",
        rtl && "rtl",
      )}
    >
      {/* Top bar — mirrors main site AppShell header style */}
      <header className="z-40 shrink-0 h-14 border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 safe-pt">
        <div className="h-full px-3 sm:px-4 flex items-center gap-2 sm:gap-3">
          {/* Sidebar toggle — desktop: collapse/expand; mobile: open slide-in sheet */}
          <button
            onClick={() => {
              haptic("selection");
              if (window.innerWidth >= 768) {
                toggleSidebar();
              } else {
                setMobileNavOpen(true);
              }
            }}
            aria-label={t("admin.shell.menu")}
            className="osler-icon-btn shrink-0"
          >
            <PanelLeft className="size-4" />
          </button>

          {/* Logo — same recipe as main AppShell */}
          <Link
            href="/admin"
            className="flex items-center gap-2.5 me-1 sm:me-3 shrink-0"
          >
            <div className="size-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Activity className="size-4 text-primary" />
            </div>
            <div className="hidden sm:block leading-tight text-start">
              <div className="text-sm font-semibold">
                {t("app.name")} · {t("admin.shell.brandAdmin")}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("admin.shell.tagline")}
              </div>
            </div>
          </Link>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Cloud session indicator + cf email */}
          {cfEmail && (
            <span className="hidden lg:block text-xs text-muted-foreground truncate max-w-[12rem]">
              {cfEmail}
            </span>
          )}

          {/* Back to app */}
          <Link
            href="/"
            className="hidden sm:flex osler-icon-btn shrink-0"
            aria-label={t("admin.shell.backToApp")}
            title={t("admin.shell.backToApp")}
          >
            <Home className="size-4" />
          </Link>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            aria-label={t("admin.settings.theme.desc")}
            className="osler-icon-btn shrink-0"
          >
            {theme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </button>

          {/* User menu — same recipe as main AppShell */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 h-9 px-2 rounded-md hover:bg-muted/60 transition-colors shrink-0">
                <div className="size-7 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-xs font-semibold text-primary-foreground">
                  {identity.user.displayName.slice(0, 2).toUpperCase()}
                </div>
                <span className="hidden sm:block text-sm font-medium max-w-[8rem] truncate">
                  {identity.user.displayName}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{identity.user.displayName}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {identity.user.email || `@${identity.user.username}`} ·{" "}
                  {identity.user.role}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => router.push("/admin/settings")}
              >
                <SettingsIcon className="size-4 me-2" />
                {t("admin.settings.title")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:text-destructive"
                onClick={signOut}
              >
                <LogOut className="size-4 me-2" />
                {t("admin.nav.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "hidden md:flex shrink-0 flex-col border-e border-border bg-card/60 transition-[width] duration-200",
            sidebarCollapsed ? "w-[56px]" : "w-60",
          )}
        >
          <SidebarNav
            workItems={workItems}
            systemItems={systemItems}
            pathname={pathname}
            collapsed={sidebarCollapsed}
            onSignOut={signOut}
            signOutLabel={t("admin.nav.signOut")}
            sectionWorkLabel={t("admin.shell.navSection.work")}
            sectionSystemLabel={t("admin.shell.navSection.system")}
          />
        </aside>

        {/* Mobile nav sheet */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{t("admin.shell.brandAdmin")}</SheetTitle>
            </SheetHeader>
            <div className="flex h-full flex-col">
              <div className="h-14 shrink-0 border-b border-border flex items-center px-4">
                <div className="flex items-center gap-2.5">
                  <div className="size-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
                    <Activity className="size-4 text-primary" />
                  </div>
                  <div className="leading-tight">
                    <div className="text-sm font-semibold">
                      {t("admin.shell.brandAdmin")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("admin.shell.brandAdmin")}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <SidebarNav
                  workItems={workItems}
                  systemItems={systemItems}
                  pathname={pathname}
                  collapsed={false}
                  onSignOut={signOut}
                  signOutLabel={t("admin.nav.signOut")}
                  sectionWorkLabel={t("admin.shell.navSection.work")}
                  sectionSystemLabel={t("admin.shell.navSection.system")}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* Main content */}
        <main className="flex-1 min-h-0 overflow-y-auto medos-scroll-y">
          {reducedMotion ? (
            <div key={pathname} className="h-full">
              <AdminProvider identity={identity}>{children}</AdminProvider>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="h-full"
              >
                <AdminProvider identity={identity}>{children}</AdminProvider>
              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Sidebar nav ────────────────────────────────────────────────────────────

interface SidebarNavProps {
  workItems: NavItemDef[];
  systemItems: NavItemDef[];
  pathname: string;
  collapsed: boolean;
  onSignOut: () => void;
  signOutLabel: string;
  sectionWorkLabel: string;
  sectionSystemLabel: string;
  onNavigate?: () => void;
}

function SidebarNav({
  workItems,
  systemItems,
  pathname,
  collapsed,
  onSignOut,
  signOutLabel,
  sectionWorkLabel,
  sectionSystemLabel,
  onNavigate,
}: SidebarNavProps) {
  return (
    <div className="flex h-full flex-col gap-1 p-2 overflow-y-auto medos-scroll-y">
      <SidebarSectionLabel collapsed={collapsed}>{sectionWorkLabel}</SidebarSectionLabel>
      {workItems.map((item) => (
        <SidebarLink
          key={item.href}
          item={item}
          active={
            pathname === item.href || pathname.startsWith(item.href + "/")
          }
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ))}

      <div className="my-2 border-t border-border" />

      <SidebarSectionLabel collapsed={collapsed}>{sectionSystemLabel}</SidebarSectionLabel>
      {systemItems.map((item) => (
        <SidebarLink
          key={item.href}
          item={item}
          active={
            pathname === item.href || pathname.startsWith(item.href + "/")
          }
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ))}

      <div className="mt-auto pt-2 border-t border-border">
        <button
          onClick={() => {
            onNavigate?.();
            onSignOut();
          }}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-destructive transition-colors",
            collapsed && "justify-center px-0",
          )}
          title={signOutLabel}
        >
          <LogOut className="size-4 shrink-0" />
          {!collapsed && <span>{signOutLabel}</span>}
        </button>
      </div>
    </div>
  );
}

function SidebarSectionLabel({
  children,
  collapsed,
}: {
  children: React.ReactNode;
  collapsed: boolean;
}) {
  if (collapsed) {
    return <div className="mx-auto my-1 h-px w-6 bg-border/60" aria-hidden />;
  }
  return (
    <p className="px-3 pt-1 pb-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
      {children}
    </p>
  );
}

function SidebarLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItemDef;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const Icon = item.icon;
  const label = t(item.labelKey as any);
  return (
    <Link
      href={item.href}
      onClick={() => {
        haptic("selection");
        onNavigate?.();
      }}
      title={collapsed ? label : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-primary/10 border border-primary/30 text-primary"
          : "border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && item.badge != null && item.badge > 0 && (
        <Badge variant="destructive" className="h-5 min-w-5 px-1 text-xs">
          {item.badge > 99 ? "99+" : item.badge}
        </Badge>
      )}
      {collapsed && item.badge != null && item.badge > 0 && (
        <span className="absolute top-1 end-1 size-2 rounded-full bg-destructive" />
      )}
    </Link>
  );
}
