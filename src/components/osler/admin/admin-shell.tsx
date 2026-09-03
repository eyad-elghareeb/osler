"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  LayoutDashboard,
  Users,
  FileText,
  ClipboardList,
  LifeBuoy,
  ScrollText,
  LogOut,
  Moon,
  Sun,
  ShieldOff,
  Settings as SettingsIcon,
  SlidersHorizontal,
  ChevronDown,
  PanelLeft,
  Home,
  BarChart3,
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
import { haptic, pushWithViewTransition, isViewTransitionsSupported } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { LoadingState } from "@/components/osler/ui-primitives";
import { AdminLoginPrompt } from "@/components/osler/admin/admin-login-prompt";
import { AdminProvider } from "@/components/osler/admin/admin-context";
import { MOTION_TRANSITION, MOTION_SPRING } from "@/lib/osler/motion";
import {
  AdminSettingsProvider,
  useAdminSettings,
} from "@/components/osler/admin/admin-settings-context";
import { adminApi, type AdminIdentity } from "@/components/osler/admin/admin-api";

interface AdminShellProps {
  children: React.ReactNode;
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

export function AdminShell({ children }: AdminShellProps) {
  // The shell wraps everything in the AdminSettingsProvider so that all
  // descendants (sidebar, header, pages) can read & update admin settings.
  return (
    <AdminSettingsProvider>
      <AdminShellInner>{children}</AdminShellInner>
    </AdminSettingsProvider>
  );
}

function AdminShellInner({ children }: AdminShellProps) {
  const { t, rtl } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const { settings, update, theme, toggleTheme } = useAdminSettings();

  const [identity, setIdentity] = React.useState<AdminIdentity | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [openTicketCount, setOpenTicketCount] = React.useState(0);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  // When the browser can run View Transitions, the keyed page container
  // skips its framer fade (the VT crossfade handles it) — same contract as
  // the main AppShell.
  const [vtActive, setVtActive] = React.useState(false);
  React.useEffect(() => {
    setVtActive(isViewTransitionsSupported());
  }, []);

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
              updatedAt: Date.now(),
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
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // Fetch pending count for admin badge.
  React.useEffect(() => {
    if (!identity?.capabilities.approveContent) return;
    adminApi
      .pendingQueue()
      .then((r) => setPendingCount(r.items.length))
      .catch(() => {});
  }, [identity]);

  // Fetch open support-ticket count for the tickets nav badge.
  React.useEffect(() => {
    if (!identity?.user.role) return;
    adminApi
      .tickets(1, "open")
      .then((r) => setOpenTicketCount(r.openCount))
      .catch(() => {});
  }, [identity]);

  const signOut = React.useCallback(() => {
    haptic("light");
    clearCloudSession();
    setIdentity(null);
  }, []);

  const handleThemeToggle = React.useCallback(() => {
    haptic("selection");
    toggleTheme();
  }, [toggleTheme]);

  const toggleSidebar = React.useCallback(() => {
    update("sidebarCollapsed", !settings.sidebarCollapsed);
  }, [settings.sidebarCollapsed, update]);

  const isAdmin = identity?.user.role === "admin";
  const isCAdmin = identity?.user.role === "content_admin";
  const canAccess = isAdmin || isCAdmin;

  // The MCP OAuth consent page is a decision point, not admin work: it
  // renders bare — no sidebar, header, or badges — just the authorization
  // card (or the sign-in prompt when logged out). Providers stay mounted so
  // the page keeps its identity context and theme.
  const isAuthorizeRoute = (pathname ?? "").replace(/\/$/, "") === "/admin/mcp-authorize";

  // ── Render: loading
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <LoadingState />
      </div>
    );
  }

  // ── Render: not logged in
  if (!identity) {
    if (isAuthorizeRoute) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 safe-pt safe-pb">
          <div className="w-full max-w-md">
            <AdminLoginPrompt onSuccess={setIdentity} />
          </div>
        </div>
      );
    }
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

  // ── Render: OAuth consent goes bare (no nav chrome)
  if (canAccess && isAuthorizeRoute) {
    return (
      <AdminProvider identity={identity}>
        <div className="min-h-screen bg-background safe-pt safe-pb">{children}</div>
      </AdminProvider>
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
    { href: "/admin/tickets", icon: LifeBuoy, labelKey: "admin.nav.tickets", badge: openTicketCount },
  ];
  const systemItems: NavItemDef[] = [
    ...(isAdmin
      ? [{ href: "/admin/users", icon: Users, labelKey: "admin.nav.users" }]
      : []),
    ...(isAdmin
      ? [{ href: "/admin/analytics", icon: BarChart3, labelKey: "admin.nav.analytics" }]
      : []),
    ...(isAdmin
      ? [{ href: "/admin/audit", icon: ScrollText, labelKey: "admin.nav.audit" }]
      : []),
    ...(isAdmin
      ? [{ href: "/admin/config", icon: SlidersHorizontal, labelKey: "admin.nav.config" }]
      : []),
    { href: "/admin/settings", icon: SettingsIcon, labelKey: "admin.settings.title" },
  ];

  const sidebarCollapsed = settings.sidebarCollapsed;

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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              haptic("selection");
              if (window.innerWidth >= 768) {
                toggleSidebar();
              } else {
                setMobileNavOpen(true);
              }
            }}
            aria-label={t("admin.shell.menu")}
            className="shrink-0"
          >
            <PanelLeft className="size-4" />
          </Button>

          {/* Logo — premium recipe: primary-soft tint + subtle elevation */}
          <Link
            href="/admin"
            prefetch={false}
            className="flex items-center gap-2.5 me-1 sm:me-3 shrink-0"
          >
            <div className="size-8 rounded-lg bg-primary-soft border border-primary/30 flex items-center justify-center shadow-e1">
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

          {/* Back to app */}
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="hidden sm:flex shrink-0"
          >
            <Link
            href="/"
            aria-label={t("admin.shell.backToApp")}
            title={t("admin.shell.backToApp")}
            >
              <Home className="size-4" />
            </Link>
          </Button>

          {/* Theme toggle */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleThemeToggle}
            aria-label={t("admin.settings.theme.desc")}
            className="shrink-0"
          >
            {theme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </Button>

          {/* User menu — same recipe as main AppShell */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 shrink-0 px-2"
                aria-label={identity.user.displayName}
              >
                <div className="size-7 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-xs font-semibold text-primary-foreground">
                  {identity.user.displayName.slice(0, 2).toUpperCase()}
                </div>
                <span className="hidden sm:block text-sm font-medium max-w-[8rem] truncate">
                  {identity.user.displayName}
                </span>
                <ChevronDown className="hidden size-3.5 text-muted-foreground sm:block" />
              </Button>
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
                      {t("admin.shell.tagline")}
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

        {/* Main content — keyed by pathname so each admin page mounts fresh.
            Enter-only fade (no exit): AnimatePresence mode="wait" faded the
            outgoing page out completely before mounting the incoming one,
            which blanked the viewport between every sidebar navigation. The
            swap is instant; a short fade-in on the new page is the only
            animation. Sidebar links run through pushWithViewTransition, which
            crossfades old→new via the View Transitions API when supported. */}
        <main className="flex-1 min-h-0 overflow-y-auto osler-scroll-y">
          <motion.div
            key={pathname}
            initial={vtActive ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={MOTION_TRANSITION.quick}
            className="h-full"
          >
            <AdminProvider identity={identity}>{children}</AdminProvider>
          </motion.div>
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
    <div className="flex h-full flex-col gap-1 p-2 overflow-y-auto osler-scroll-y">
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
        <Button
          type="button"
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          onClick={() => {
            onNavigate?.();
            onSignOut();
          }}
          className={cn(
            "w-full justify-start text-muted-foreground hover:text-destructive",
            collapsed && "justify-center",
          )}
          title={signOutLabel}
        >
          <LogOut className="size-4 shrink-0" />
          {!collapsed && <span>{signOutLabel}</span>}
        </Button>
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
  const router = useRouter();
  const { settings } = useAdminSettings();
  const Icon = item.icon;
  const label = t(item.labelKey as any);
  return (
    <Link
      href={item.href}
      onClick={(e) => {
        // Let modified clicks / middle clicks / non-left clicks keep native
        // link behavior (new tab, etc.).
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        haptic("selection");
        onNavigate?.();
        // The admin reduced-motion setting forces near-zero CSS transitions
        // via .admin-reduced-motion, which can't reach ::view-transition
        // pseudo-elements — skip the snapshot roundtrip entirely there.
        if (settings.reducedMotion) {
          router.push(item.href);
          return;
        }
        pushWithViewTransition((p) => router.push(p), item.href);
      }}
      title={collapsed ? label : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {/* Active indicator — tinted background behind icon + label.
       * Uses `layoutId` so the tint slides between nav items as the user
       * navigates (Motion Primitives shared-layout pattern). */}
      {active && (
        <motion.span
          layoutId={collapsed ? "admin-nav-active-tint-collapsed" : "admin-nav-active-tint"}
          className="absolute inset-0 rounded-lg bg-primary/10 border border-primary/20"
          transition={MOTION_SPRING.snappy}
        />
      )}
      <Icon className="size-4 shrink-0 relative" />
      {!collapsed && <span className="flex-1 truncate relative">{label}</span>}
      {!collapsed && item.badge != null && item.badge > 0 && (
        <Badge variant="outline" className="relative h-5 min-w-5 border-border bg-muted/60 px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
          {item.badge > 99 ? "99+" : item.badge}
        </Badge>
      )}
      {collapsed && item.badge != null && item.badge > 0 && (
        <span className="absolute top-1 end-1 size-1.5 rounded-full bg-muted-foreground/50" />
      )}
    </Link>
  );
}
