"use client";

import * as React from "react";
import {
  Settings as SettingsIcon,
  Sun,
  Moon,
  Sparkles,
  Zap,
  Gauge,
  RotateCcw,
  Info,
  ShieldAlert,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import {
  useAdminSettings,
  type AdminLang,
  type AdminTheme,
  type AdminWorkingMode,
  type AdminLanding,
} from "@/components/osler/admin/admin-settings-context";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { OslerCard } from "@/components/osler/ui-primitives";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

export default function AdminSettingsPage() {
  return (
    <AdminRouteGuard>
      <AdminPageFrame
        title="Settings"
        subtitle="Personalize the admin panel and configure working preferences."
        inlineIcon={SettingsIcon}
      >
        <AdminSettingsContent />
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}

function AdminSettingsContent() {
  const { t } = useI18n();
  const { settings, update, reset } = useAdminSettings();
  const identity = useAdminIdentity();

  return (
    <div className="space-y-4 max-w-3xl">
      {/* ── Language ──────────────────────────────────────────────────── */}
      <SettingsCard
        icon={SettingsIcon}
        title={t("admin.settings.section.language")}
        desc={t("admin.settings.language.desc")}
      >
        <div className="grid grid-cols-2 gap-3 max-w-md">
          {([
            { id: "en", label: t("admin.settings.language.en"), native: "English", dir: "LTR", mark: "EN" },
            { id: "ar", label: t("admin.settings.language.ar"), native: "العربية", dir: "RTL", mark: "ع" },
          ] as const).map((opt) => {
            const active = settings.language === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => update("language", opt.id as AdminLang)}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border text-start transition-colors",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:bg-muted/60",
                )}
              >
                <div
                  className={cn(
                    "size-9 rounded-lg flex items-center justify-center text-sm font-bold",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {opt.mark}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div
                    className="text-[11px] text-muted-foreground truncate"
                    dir={opt.id === "ar" ? "rtl" : "ltr"}
                    lang={opt.id}
                  >
                    {opt.native} · {opt.dir}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground bg-muted/40 border border-border/60 rounded-md px-3 py-2">
          <strong>ℹ</strong> {t("admin.settings.language.rtlNote")}
        </p>
      </SettingsCard>

      {/* ── Theme ────────────────────────────────────────────────────── */}
      <SettingsCard
        icon={settings.theme === "dark" ? Moon : Sun}
        title={t("admin.settings.section.appearance")}
        desc={t("admin.settings.theme.desc")}
      >
        <div className="flex gap-2">
          {([
            { id: "dark", label: t("admin.settings.theme.dark"), Icon: Moon },
            { id: "light", label: t("admin.settings.theme.light"), Icon: Sun },
          ] as const).map((opt) => {
            const active = settings.theme === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => update("theme", opt.id as AdminTheme)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card hover:bg-muted/60 text-muted-foreground",
                )}
              >
                <opt.Icon className="size-4" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </SettingsCard>

      {/* ── Working mode ─────────────────────────────────────────────── */}
      <SettingsCard
        icon={Gauge}
        title={t("admin.settings.section.working")}
        desc={t("admin.settings.working.desc")}
      >
        <div className="grid grid-cols-2 gap-3 max-w-md">
          {([
            { id: "comfortable", label: t("admin.settings.working.comfortable"), Icon: Sparkles, hint: "Default spacing" },
            { id: "compact", label: t("admin.settings.working.compact"), Icon: Zap, hint: "Denser rows" },
          ] as const).map((opt) => {
            const active = settings.workingMode === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => update("workingMode", opt.id as AdminWorkingMode)}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-xl border text-start transition-colors",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:bg-muted/60",
                )}
              >
                <div
                  className={cn(
                    "size-9 rounded-lg flex items-center justify-center",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <opt.Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{opt.hint}</div>
                </div>
              </button>
            );
          })}
        </div>
      </SettingsCard>

      {/* ── Behavior ─────────────────────────────────────────────────── */}
      <SettingsCard
        icon={RotateCcw}
        title={t("admin.settings.section.behavior")}
      >
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
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                {t("admin.settings.behavior.pageSize")}
              </label>
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
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                {t("admin.settings.behavior.landing")}
              </label>
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

      {/* ── About ────────────────────────────────────────────────────── */}
      <SettingsCard
        icon={Info}
        title={t("admin.settings.about.title")}
      >
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Field label={t("admin.settings.about.version")} value="Osler Admin v0.2.1" />
          <Field label={t("admin.settings.about.role")} value={identity.user.role} />
          <Field label={t("admin.settings.about.storage")} value={t("admin.settings.about.storageLocal")} />
          <Field label="User" value={`@${identity.user.username}`} />
        </dl>
      </SettingsCard>

      {/* ── Danger zone ──────────────────────────────────────────────── */}
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
                  reset();
                  toast({ title: "Settings reset" });
                }}
              >
                {t("admin.settings.danger.reset")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingsCard>
    </div>
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
    <div className="border border-border/60 rounded-lg px-3 py-2 bg-muted/30">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium truncate">{value}</dd>
    </div>
  );
}
