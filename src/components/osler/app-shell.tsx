"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  LayoutDashboard,
  BookOpen,
  ListChecks,
  Layers,
  Sun,
  Moon,
  LogOut,
  User as UserIcon,
  ChevronDown,
  Search,
  Settings as SettingsIcon,
  Stethoscope,
  PlayCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useOslerTheme } from "./theme-provider";
import { useI18n } from "./i18n-provider";
import { MobileTabBar } from "./mobile-tab-bar";
import { PwaInstallButton } from "./pwa-install-button";
import { LightboxProvider } from "./lightbox-provider";
import { searchArticles as searchArticlesAsync } from "@/lib/osler/articles";
import type { ArticleMeta } from "@/lib/osler/articles";
import { cn } from "@/lib/utils";

export type OslerView =
  | "dashboard"
  | "library"
  | "qbank"
  | "flashcards"
  | "osce"
  | "videos"
  | "profile"
  | "settings";

interface AppShellProps {
  view: OslerView;
  onViewChange: (v: OslerView) => void;
  username: string;
  onLogout: () => void;
  onArticleOpen?: (id: string) => void;
  children: React.ReactNode;
}

export function AppShell({
  view,
  onViewChange,
  username,
  onLogout,
  onArticleOpen,
  children,
}: AppShellProps) {
  const { theme, toggleTheme } = useOslerTheme();
  const { t, rtl } = useI18n();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<ArticleMeta[]>([]);

  // Search debounce
  React.useEffect(() => {
    const t = setTimeout(async () => {
      if (!query) {
        setSearchResults([]);
        return;
      }
      const results = await searchArticlesAsync(query);
      setSearchResults(results);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // Keyboard: Ctrl/Cmd+K opens search
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleOpenArticle = (id: string) => {
    setSearchOpen(false);
    setQuery("");
    onArticleOpen?.(id);
    if (view !== "library") onViewChange("library");
  };

  const searchPlaceholder = t("common.searchPlaceholder");

  const isDashboard = view === "dashboard";
  const isLibrary = view === "library";
  const isQbank = view === "qbank";

  // Search panel content (used by both desktop popover and mobile sheet)
  const searchPanel = (
    <>
      <div className="p-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground min-w-0"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground shrink-0">
            ESC
          </kbd>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto medos-scroll p-2">
        {searchResults.length > 0 ? (
          <div className="space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
              Articles
            </div>
            {searchResults.map((r) => (
              <button
                key={r.file}
                onClick={() => handleOpenArticle(r.file)}
                className="w-full text-start px-2 py-2 rounded-md hover:bg-muted/60 transition-colors flex items-center gap-3"
              >
                <BookOpen className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.title}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.specialty} · {r.readTimeMin} min read
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : query ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("common.none")} — "{query}"
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="h-screen md:h-screen h-[100dvh] flex flex-col bg-background overflow-hidden">
      <header className="z-40 shrink-0 h-14 border-b border-border/60 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 safe-pt">
        <div className="h-full px-3 sm:px-4 flex items-center gap-2 sm:gap-3">
          {/* Logo */}
          <button
            onClick={() => onViewChange("dashboard")}
            className="flex items-center gap-2.5 me-1 sm:me-3 shrink-0"
          >
            <div className="size-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Activity className="size-4 text-primary" />
            </div>
            <div className="hidden sm:block leading-tight text-start">
              <div className="text-sm font-semibold">{t("app.name")}</div>
              <div className="text-[10px] text-muted-foreground">
                {t("app.tagline")}
              </div>
            </div>
          </button>

          {/* Desktop nav items — hidden on mobile (replaced by bottom tab bar) */}
          <nav className="hidden md:flex items-center gap-1 ms-1">
            <NavButton
              active={isDashboard}
              onClick={() => onViewChange("dashboard")}
              icon={LayoutDashboard}
              label={t("nav.dashboard")}
              layoutId="nav-active"
            />

            <NavButton
              active={isQbank}
              onClick={() => onViewChange("qbank")}
              icon={ListChecks}
              label={t("nav.qbank")}
              layoutId="nav-active"
            />

            <NavButton
              active={isLibrary}
              onClick={() => onViewChange("library")}
              icon={BookOpen}
              label={t("nav.library")}
              layoutId="nav-active"
            />

            <NavButton
              active={view === "flashcards"}
              onClick={() => onViewChange("flashcards")}
              icon={Layers}
              label={t("nav.flashcards")}
              layoutId="nav-active"
            />

            <NavButton
              active={view === "osce"}
              onClick={() => onViewChange("osce")}
              icon={Stethoscope}
              label={t("nav.osce")}
              layoutId="nav-active"
            />

            <NavButton
              active={view === "videos"}
              onClick={() => onViewChange("videos")}
              icon={PlayCircle}
              label={t("nav.videos")}
              layoutId="nav-active"
            />
          </nav>

          {/* Search trigger — desktop (top-center pill) */}
          <div className="flex-1 flex justify-center px-2">
            <Popover open={searchOpen} onOpenChange={setSearchOpen}>
              <PopoverTrigger asChild>
                <button className="hidden lg:flex items-center gap-2 h-9 px-3 w-full max-w-md rounded-md border border-border/60 bg-muted/40 hover:bg-muted/60 transition-colors text-sm text-muted-foreground">
                  <Search className="size-3.5" />
                  <span className="flex-1 text-start truncate">
                    {searchPlaceholder}
                  </span>
                  <kbd className="hidden lg:inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-border/60 bg-background/60 font-mono">
                    Ctrl+K
                  </kbd>
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[min(640px,calc(100vw-2rem))] p-0"
                align="center"
                sideOffset={8}
              >
                {searchPanel}
              </PopoverContent>
            </Popover>

            <button
              onClick={() => setSearchOpen(true)}
              className="lg:hidden flex items-center gap-2 h-9 px-3 rounded-md border border-border/60 bg-muted/40 hover:bg-muted/60 transition-colors text-sm text-muted-foreground flex-1 max-w-md"
            >
              <Search className="size-3.5" />
              <span className="flex-1 text-start truncate">{t("common.search")}…</span>
            </button>
          </div>

          {/* PWA install */}
          <PwaInstallButton />

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title={theme === "dark" ? t("theme.toggleToLight") : t("theme.toggleToDark")}
            className="size-9 rounded-md hover:bg-muted/60 transition-colors flex items-center justify-center shrink-0"
          >
            {theme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </button>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 h-9 px-2 rounded-md hover:bg-muted/60 transition-colors shrink-0">
                <div className="size-7 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-xs font-semibold text-primary-foreground">
                  {username.slice(0, 2).toUpperCase()}
                </div>
                <ChevronDown className="size-3.5 text-muted-foreground hidden sm:block" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{username}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {t("nav.localSession")}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => onViewChange("profile")}
              >
                <UserIcon className="size-4 me-2" />
                {t("nav.profile")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => onViewChange("settings")}
              >
                <SettingsIcon className="size-4 me-2" />
                {t("nav.settings")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:text-destructive"
                onClick={onLogout}
              >
                <LogOut className="size-4 me-2" />
                {t("nav.signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Main content — scrolls independently so scrollbar doesn't touch the topbar.
          `medos-tabbar-pad` adds a bottom spacer on mobile so content never
          scrolls under the fixed bottom tab bar (the spacer is hidden on md+). */}
      <main className="flex-1 min-h-0 overflow-y-auto medos-scroll-y medos-tabbar-pad">
        <LightboxProvider>
          <AnimatePresence mode="sync" initial={false}>
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </LightboxProvider>
      </main>

      {/* Mobile tab bar */}
      <MobileTabBar view={view} onViewChange={onViewChange} />
    </div>
  );
}

function NavButton({
  active,
  onClick,
  icon: Icon,
  label,
  layoutId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  layoutId: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative h-9 px-3 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
        active
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      )}
    >
      <Icon className="size-4" />
      <span className="hidden md:inline">{label}</span>
      {active && (
        <motion.div
          layoutId={layoutId}
          className="absolute inset-0 rounded-md bg-primary/10 border border-primary/30 -z-10"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
    </button>
  );
}
