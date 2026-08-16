"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  ClipboardList,
  FileText,
  ScrollText,
  Settings as SettingsIcon,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { SectionHeading } from "@/components/osler/ui-primitives";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";

/**
 * AdminQuickActions — shortcut cards to the admin sections an admin
 * touches most. Same visual recipe as the main app's dashboard QuickAction
 * (soft icon chip + title + subtitle + nudging arrow), built on Links so
 * they're real navigation, not buttons.
 */

interface QuickActionDef {
  href: string;
  icon: LucideIcon;
  titleKey: string;
  descKey: string;
}

const ACTIONS: QuickActionDef[] = [
  { href: "/admin/content",   icon: FileText,       titleKey: "admin.nav.content",   descKey: "admin.dashboard.shortcut.content" },
  { href: "/admin/review",    icon: ClipboardList,  titleKey: "admin.nav.review",    descKey: "admin.dashboard.shortcut.review" },
  { href: "/admin/users",     icon: Users,          titleKey: "admin.nav.users",     descKey: "admin.dashboard.shortcut.users" },
  { href: "/admin/analytics", icon: BarChart3,      titleKey: "admin.nav.analytics", descKey: "admin.dashboard.shortcut.analytics" },
  { href: "/admin/audit",     icon: ScrollText,     titleKey: "admin.nav.audit",     descKey: "admin.dashboard.shortcut.audit" },
  { href: "/admin/settings",  icon: SettingsIcon,   titleKey: "admin.settings.title", descKey: "admin.dashboard.shortcut.settings" },
];

export function AdminQuickActions() {
  const { t, rtl } = useI18n();

  return (
    <section>
      <SectionHeading>{t("admin.dashboard.quickActions")}</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {ACTIONS.map((a, i) => {
          const Icon = a.icon;
          return (
            <motion.div
              key={a.href}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.04 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.99 }}
            >
              <Link
                href={a.href}
                onClick={() => haptic("selection")}
                className="text-start osler-card--default group flex items-center gap-3 hover:border-primary/40 hover:shadow-e2 transition-all"
              >
                <div className="w-10 h-10 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105">
                  <Icon className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{t(a.titleKey as any)}</div>
                  <div className="text-xs text-muted-foreground truncate">{t(a.descKey as any)}</div>
                </div>
                <ArrowRight
                  className={cn(
                    "size-4 text-muted-foreground shrink-0 transition-transform duration-200 group-hover:translate-x-0.5",
                    rtl && "rtl-flip-x",
                  )}
                />
              </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
