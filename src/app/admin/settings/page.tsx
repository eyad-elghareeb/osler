"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings as SettingsIcon,
  Palette,
  Languages,
  Sparkles,
  RotateCcw,
  Info,
  ShieldAlert,
  ArrowLeft,
  ChevronRight,
  Bot,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import {
  useAdminSettings,
  type AdminLanding,
} from "@/components/osler/admin/admin-settings-context";
import { haptic } from "@/lib/osler/native";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import { OslerCard, PageHeader } from "@/components/osler/ui-primitives";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { LanguageSettingsSection } from "@/components/osler/settings/language-section";
import { ThemeSettingsSection } from "@/components/osler/settings/theme-section";
import { AiSettingsSection } from "@/components/osler/settings/ai-section";
import { ApiTokensSection } from "@/components/osler/settings/api-tokens-section";
import { NavigationStack } from "@/components/osler/navigation-stack";
import { useIsMobile } from "@/hooks/use-mobile";
import type { LucideIcon } from "lucide-react";

interface AdminSectionDef {
  id: string;
  labelKey: string;
  icon: LucideIcon;
}

const SECTIONS: AdminSectionDef[] = [
  { id: "appearance", labelKey: "admin.settings.section.appearance", icon: Palette },
  { id: "language", labelKey: "admin.settings.section.language", icon: Languages },
  { id: "ai", labelKey: "admin.settings.section.ai", icon: Sparkles },
  { id: "apiTokens", labelKey: "admin.settings.section.apiTokens", icon: Bot },
  { id: "behavior", labelKey: "admin.settings.section.behavior", icon: RotateCcw },
  { id: "about", labelKey: "admin.settings.section.about", icon: Info },
  { id: "danger", labelKey: "admin.settings.section.danger", icon: ShieldAlert },
];

function renderSection(id: string) {
  switch (id) {
    case "appearance":
      return <ThemeSettingsSection />;
    case "language":
      return <LanguageSettingsSection />;
    case "ai":
      return <AiSettingsSection />;
    case "apiTokens":
      return <ApiTokensSection />;
    case "behavior":
      return <BehaviorSettingsSection />;
    case "about":
      return <AboutSettingsSection />;
    case "danger":
      return <DangerZoneSection />;
    default:
      return null;
  }
}

export default function AdminSettingsPage() {
  const { t, rtl } = useI18n();
  const isMobile = useIsMobile();

  const [section, setSection] = React.useState<string>("appearance");
  const [mobileHome, setMobileHome] = React.useState<boolean>(true);

  const pickSection = (id: string) => {
    haptic("selection");
    setSection(id);
    setMobileHome(false);
  };
  const goHome = () => {
    haptic("selection");
    setMobileHome(true);
  };

  const activeMeta = SECTIONS.find((s) => s.id === section);

  return (
    <AdminRouteGuard>
      <div className="osler-page osler-has-scroll">
        <div className="osler-page__inner--wide">
          <PageHeader
            inline
            inlineIcon={SettingsIcon}
            title={t("admin.settings.title")}
            subtitle={t("admin.settings.subtitle")}
          />

          {isMobile ? (
            // ── Mobile: iOS-style section list + pushed sub-pages ─────
            <div className="h-full min-h-[60vh]">
              <NavigationStack
                className="h-full"
                homeClassName="osler-page osler-has-scroll"
                subpageClassName="osler-page osler-has-scroll"
                rtl={rtl}
                home={
                  <div className="px-1 py-1">
                    <div className="overflow-hidden rounded-xl border border-border bg-card">
                      {SECTIONS.map((s, idx) => {
                        const I = s.icon;
                        return (
                          <Button
                            type="button"
                            variant="ghost"
                            size="default"
                            key={s.id}
                            onClick={() => pickSection(s.id)}
                            className={cn(
                              "h-auto w-full justify-start rounded-none px-4 py-3 text-start",
                              idx > 0 && "border-t border-border",
                            )}
                          >
                            <span className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                              <I className="size-4" />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-medium truncate">{t(s.labelKey as any)}</span>
                            </span>
                            <ChevronRight className={cn("size-4 text-muted-foreground shrink-0", rtl && "rtl-flip-x")} />
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                }
                subpage={
                  mobileHome ? null : (
                    <div className="px-4 py-4">
                      <div className="flex items-center gap-2 mb-4">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={goHome}
                          className="-ms-1 ps-1 text-muted-foreground hover:text-foreground"
                          aria-label={t("settings.backToList")}
                        >
                          <ArrowLeft className={cn("size-4", rtl && "rtl-flip-x")} />
                          <span>{t("admin.settings.backToList")}</span>
                        </Button>
                      </div>
                      <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2 mb-4">
                        {renderIcon(activeMeta)}
                        {activeMeta ? t(activeMeta.labelKey as any) : t("admin.settings.title")}
                      </h1>
                      {renderSection(section)}
                    </div>
                  )
                }
                onBack={goHome}
              />
            </div>
          ) : (
            // ── Desktop: sidebar + content pane ───────────────────────
            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr] gap-6">
              <aside className="md:sticky md:top-0 md:self-start">
                <div className="osler-section-heading">{t("admin.settings.sidebarTitle")}</div>
                <nav className="space-y-0.5">
                  {SECTIONS.map((s) => {
                    const I = s.icon;
                    const active = section === s.id;
                    return (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        key={s.id}
                        onClick={() => pickSection(s.id)}
                        className={cn(
                          "relative h-9 w-full justify-start text-start font-medium",
                          active
                            ? "border border-primary/30 bg-primary/10 text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                        )}
                      >
                        <I className="size-4 shrink-0" />
                        <span className="truncate">{t(s.labelKey as any)}</span>
                      </Button>
                    );
                  })}
                </nav>
              </aside>

              <div className="min-w-0">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={section}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={MOTION_TRANSITION.quick}
                  >
                    {renderSection(section)}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminRouteGuard>
  );
}

function renderIcon(meta?: AdminSectionDef) {
  if (!meta) return null;
  const I = meta.icon;
  return <I className="size-5 text-primary" />;
}

/* ── Admin-specific sections ───────────────────────────────────────────── */

function BehaviorSettingsSection() {
  const { t } = useI18n();
  const { settings, update } = useAdminSettings();

  return (
    <SettingsCard icon={RotateCcw} title={t("admin.settings.section.behavior")}>
      <div className="space-y-3">
        <ToggleRow
          label={t("admin.settings.behavior.reducedMotion")}
          desc={t("admin.settings.behavior.reducedMotionDesc")}
          checked={settings.reducedMotion}
          onChange={(v) => update("reducedMotion", v)}
        />
        <ToggleRow
          label={t("admin.settings.behavior.autoSave")}
          desc={t("admin.settings.behavior.autoSaveDesc")}
          checked={settings.autoSaveDrafts}
          onChange={(v) => update("autoSaveDrafts", v)}
        />
        <ToggleRow
          label={t("admin.settings.behavior.advanced")}
          desc={t("admin.settings.behavior.advancedDesc")}
          checked={settings.showAdvancedFields}
          onChange={(v) => update("showAdvancedFields", v)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("admin.settings.behavior.pageSize")}
            </Label>
            <Select
              value={String(settings.pageSize)}
              onValueChange={(v) => update("pageSize", Number(v))}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("admin.settings.behavior.landing")}
            </Label>
            <Select
              value={settings.defaultLanding}
              onValueChange={(v) => update("defaultLanding", v as AdminLanding)}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dashboard">{t("admin.nav.dashboard")}</SelectItem>
                <SelectItem value="content">{t("admin.nav.content")}</SelectItem>
                <SelectItem value="review">{t("admin.nav.review")}</SelectItem>
                <SelectItem value="audit">{t("admin.nav.audit")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}

function AboutSettingsSection() {
  const { t } = useI18n();
  const identity = useAdminIdentity();

  return (
    <SettingsCard icon={Info} title={t("admin.settings.about.title")}>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <Field label={t("admin.settings.about.version")} value="Osler Admin v0.2.1" />
        <Field label={t("admin.settings.about.role")} value={identity.user.role} />
        <Field label={t("admin.settings.about.storage")} value={t("admin.settings.about.storageLocal")} />
        <Field label={t("admin.settings.about.user")} value={`@${identity.user.username}`} />
      </dl>
    </SettingsCard>
  );
}

function DangerZoneSection() {
  const { t } = useI18n();
  const { reset } = useAdminSettings();
  return (
    <SettingsCard
      icon={ShieldAlert}
      title={t("admin.settings.section.danger")}
      desc={t("admin.settings.danger.resetDesc")}
      tone="destructive"
    >
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10">
            <RotateCcw className="size-3.5 me-1.5" />
            {t("admin.settings.danger.reset")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.settings.danger.reset")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.settings.danger.resetConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                haptic("warning");
                reset();
                toast({ title: t("admin.settings.danger.reset") });
              }}
            >
              {t("admin.settings.danger.reset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function SettingsCard({
  icon: Icon,
  title,
  desc,
  tone = "default",
  children,
}: {
  icon: React.ElementType;
  title: string;
  desc?: string;
  tone?: "default" | "destructive";
  children: React.ReactNode;
}) {
  return (
    <OslerCard padding="roomy" className={cn(tone === "destructive" && "border-destructive/30")}>
      <div className="flex items-start gap-3 mb-4">
        <div
          className={cn(
            "size-9 rounded-lg flex items-center justify-center shrink-0",
            tone === "destructive"
              ? "bg-destructive/10 text-destructive"
              : "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
        </div>
      </div>
      {children}
    </OslerCard>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg px-3 py-2 bg-muted/30">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium truncate">{value}</dd>
    </div>
  );
}
