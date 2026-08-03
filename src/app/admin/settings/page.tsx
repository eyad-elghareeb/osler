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
  Cloud,
  Key,
  Loader2,
} from "lucide-react";
import { useI18n } from "@/components/osler/i18n-provider";
import { AdminPageFrame } from "@/components/osler/admin/admin-page-frame";
import { AdminRouteGuard } from "@/components/osler/admin/admin-route-guard";
import {
  useAdminSettings,
  type AdminWorkingMode,
  type AdminLanding,
} from "@/components/osler/admin/admin-settings-context";
import { haptic } from "@/lib/osler/native";
import { useAdminIdentity } from "@/components/osler/admin/admin-context";
import { useOslerTheme } from "@/components/osler/theme-provider";
import { OslerCard } from "@/components/osler/ui-primitives";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { geminiApi } from "@/components/osler/admin/admin-api";
import { cloudEnabled } from "@/lib/osler/cloud";

export default function AdminSettingsPage() {
  const { t } = useI18n();
  return (
    <AdminRouteGuard>
      <AdminPageFrame
        title={t("admin.settings.title")}
        subtitle={t("admin.settings.subtitle")}
        inlineIcon={SettingsIcon}
      >
        <AdminSettingsContent />
      </AdminPageFrame>
    </AdminRouteGuard>
  );
}

function AdminSettingsContent() {
  const { t } = useI18n();
  const { settings, update, reset, language, theme, setLanguage } = useAdminSettings();
  const { setTheme } = useOslerTheme();
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
            const active = language === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setLanguage(opt.id)}
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
        <p className="mt-3 text-xs text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2">
          <strong>ℹ</strong> {t("admin.settings.language.rtlNote")}
        </p>
      </SettingsCard>

      {/* ── Theme ────────────────────────────────────────────────────── */}
      <SettingsCard
        icon={theme === "dark" ? Moon : Sun}
        title={t("admin.settings.section.appearance")}
        desc={t("admin.settings.theme.desc")}
      >
        <div className="flex gap-2">
          {([
            { id: "dark", label: t("admin.settings.theme.dark"), Icon: Moon },
            { id: "light", label: t("admin.settings.theme.light"), Icon: Sun },
          ] as const).map((opt) => {
            const active = theme === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setTheme(opt.id)}
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
            { id: "comfortable", label: t("admin.settings.working.comfortable"), Icon: Sparkles, hint: t("admin.settings.working.comfortableHint") },
            { id: "compact", label: t("admin.settings.working.compact"), Icon: Zap, hint: t("admin.settings.working.compactHint") },
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

      {/* ── About ────────────────────────────────────────────────────── */}
      <SettingsCard
        icon={Info}
        title={t("admin.settings.about.title")}
      >
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Field label={t("admin.settings.about.version")} value="Osler Admin v0.2.1" />
          <Field label={t("admin.settings.about.role")} value={identity.user.role} />
          <Field label={t("admin.settings.about.storage")} value={t("admin.settings.about.storageLocal")} />
          <Field label={t("admin.settings.about.user")} value={`@${identity.user.username}`} />
        </dl>
      </SettingsCard>

      {/* ── AI / Gemini key (account-scoped) ─────────────────────────── */}
      <GeminiKeySection />

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
    <div className="border border-border rounded-lg px-3 py-2 bg-muted/30">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium truncate">{value}</dd>
    </div>
  );
}

/**
 * Per-account Gemini API key section. The key is stored in the cloud DB so
 * admins and content_admins only have to enter it once on any device.
 */
function GeminiKeySection() {
  const { t } = useI18n();
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [hasKey, setHasKey] = React.useState(false);
  const [draftKey, setDraftKey] = React.useState("");
  const [draftModel, setDraftModel] = React.useState("gemini-2.5-flash");
  const [cloudOn, setCloudOn] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const on = await cloudEnabled();
        setCloudOn(on);
        if (!on) { setLoading(false); return; }
        const info = await geminiApi.get();
        setHasKey(info.hasKey);
        if (info.model) setDraftModel(info.model);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    haptic("light");
    setSaving(true);
    try {
      const res = await geminiApi.save(draftKey.trim() || null, draftModel, null);
      setHasKey(res.hasKey);
      setDraftKey("");
      toast({ title: t("admin.settings.gemini.keySaved2"), description: t("admin.settings.gemini.keySavedDesc") });
    } catch (err) {
      toast({ title: t("admin.settings.gemini.saveFailed", { error: String(err) }), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const [clearOpen, setClearOpen] = React.useState(false);

  async function handleClear() {
    haptic("warning");
    setSaving(true);
    try {
      await geminiApi.clear();
      setHasKey(false);
      setDraftKey("");
      toast({ title: t("admin.settings.gemini.keyRemoved") });
      setClearOpen(false);
    } catch (err) {
      toast({ title: t("admin.settings.gemini.clearFailed", { error: String(err) }), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    haptic("light");
    setTesting(true);
    try {
      await geminiApi.test();
      toast({ title: t("admin.settings.gemini.keyValid") });
    } catch (err) {
      toast({ title: t("admin.settings.gemini.testFailed", { error: String(err) }), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <SettingsCard
      icon={Key}
      title={t("admin.settings.gemini.title")}
      desc={t("admin.settings.gemini.desc")}
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t("common.loading")}
        </div>
      ) : !cloudOn ? (
        <div className="text-sm text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-2">
          {t("admin.settings.gemini.cloudDisabled")}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs">
            {hasKey ? (
              <span className="inline-flex items-center gap-1 text-success">
                <Cloud className="size-3.5" /> {t("admin.settings.gemini.keySaved")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Cloud className="size-3.5" /> {t("admin.settings.gemini.noKey")}
              </span>
            )}
          </div>

          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {hasKey ? t("admin.settings.gemini.replaceKey") : t("admin.settings.gemini.apiKey")}
            </Label>
            <Input
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="AIza…"
              className="font-mono text-xs"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("admin.settings.gemini.getKeyHint")}
            </p>
          </div>

          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("admin.settings.gemini.defaultModel")}
            </Label>
            <Select value={draftModel} onValueChange={setDraftModel}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                <SelectItem value="gemini-2.0-flash">Gemini 2.0 Flash</SelectItem>
                <SelectItem value="gemini-1.5-flash">Gemini 1.5 Flash (legacy)</SelectItem>
                <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro (legacy)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button size="sm" onClick={handleSave} disabled={saving || (!draftKey.trim() && !hasKey)}>
              {saving ? <Loader2 className="size-3.5 me-1.5 animate-spin" /> : <Key className="size-3.5 me-1.5" />}
              {hasKey && !draftKey.trim() ? t("admin.settings.gemini.saveModel") : t("admin.settings.gemini.saveKey")}
            </Button>
            {hasKey && (
              <>
                <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
                  {testing ? <Loader2 className="size-3.5 me-1.5 animate-spin" /> : <Sparkles className="size-3.5 me-1.5" />}
                  {t("admin.settings.gemini.testKey")}
                </Button>
                <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" disabled={saving} className="text-destructive hover:text-destructive">
                      {t("admin.settings.gemini.removeKey")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("admin.settings.gemini.removeKey")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("admin.settings.gemini.confirmRemove")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                      <AlertDialogAction onClick={handleClear} disabled={saving}>
                        {t("admin.settings.gemini.removeKey")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>
      )}
    </SettingsCard>
  );
}
