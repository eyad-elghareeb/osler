"use client";

import * as React from "react";
import {
  Save,
  Plus,
  Trash2,
  Settings,
  Globe,
  Puzzle,
  Palette,
  SlidersHorizontal,
  Code2,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { adminApi } from "@/components/osler/admin/admin-api";
import { LoadingState, SectionHeading } from "@/components/osler/ui-primitives";
import { useToast } from "@/hooks/use-toast";
import { ENGINE_META } from "@/lib/osler/content";

interface ConfigData {
  site: { name: string; shortName: string; tagline: string; githubRepo: string; organisation: string; supportEmail: string };
  engines: Record<string, { enabled: boolean; label?: string; singular?: string; color?: string; icon?: string }>;
  themes: { default: string; custom: Array<{ id: string; name: string; variant: "dark" | "light"; primary?: string; background?: string; foreground?: string; accent?: string; border?: string; destructive?: string }> };
  defaults: {
    view: string;
    language: { ui: string; content: string };
    quiz: { count: number; secPerQuestion: number; tutor: boolean; shuffle: boolean };
    ai: { model: string; enabled: boolean; temperature: number };
    sync: { method: string; room: string };
  };
  [key: string]: unknown;
}

const TABS = ["site", "engines", "themes", "defaults", "raw"] as const;
type TabId = (typeof TABS)[number];

const ENGINE_IDS = ["quiz", "bank", "written", "flashcard", "osce", "library", "video"] as const;

function defaultConfig(): ConfigData {
  return {
    site: { name: "Osler", shortName: "Osler", tagline: "Your medical companion", githubRepo: "", organisation: "", supportEmail: "" },
    engines: Object.fromEntries(ENGINE_IDS.map((id) => [id, { enabled: true }])),
    themes: { default: "light", custom: [] },
    defaults: {
      view: "dashboard",
      language: { ui: "en", content: "all" },
      quiz: { count: 10, secPerQuestion: 90, tutor: false, shuffle: true },
      ai: { model: "gemini-2.5-flash", enabled: true, temperature: 0.7 },
      sync: { method: "webrtc", room: "" },
    },
  } as ConfigData;
}

export function AdminConfigEditor() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [config, setConfig] = React.useState<ConfigData>(defaultConfig());
  const [raw, setRaw] = React.useState("");
  const [rawError, setRawError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<TabId>("site");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setLoading(true);
    adminApi
      .getConfig()
      .then((data) => {
        const merged = { ...defaultConfig(), ...data };
        setConfig(merged);
        setRaw(JSON.stringify(merged, null, 2));
      })
      .catch(() => {
        toast({ title: t("admin.config.loadFailed"), variant: "destructive" });
      })
      .finally(() => setLoading(false));
  }, [t, toast]);

  function updateConfig(path: string, value: unknown) {
    setConfig((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let obj: Record<string, unknown> = next;
      for (let i = 0; i < keys.length - 1; i++) {
        if (typeof obj[keys[i]] !== "object" || obj[keys[i]] === null) obj[keys[i]] = {};
        obj = obj[keys[i]] as Record<string, unknown>;
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  }

  function updateEngine(id: string, field: string, value: unknown) {
    setConfig((prev) => {
      const next = structuredClone(prev);
      if (!next.engines[id]) next.engines[id] = { enabled: true };
      (next.engines[id] as Record<string, unknown>)[field] = value;
      return next;
    });
  }

  async function handleSave() {
    haptic("light");
    let payload: Record<string, unknown>;
    if (tab === "raw") {
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
        setRawError(null);
      } catch {
        setRawError(t("admin.config.raw.invalidJson"));
        toast({ title: t("admin.config.saveFailed"), variant: "destructive" });
        return;
      }
    } else {
      payload = config as unknown as Record<string, unknown>;
    }
    setSaving(true);
    try {
      await adminApi.updateConfig(payload);
      haptic("success");
      toast({ title: t("admin.config.saved") });
    } catch {
      haptic("error");
      toast({ title: t("admin.config.saveFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // ── Tabs ──
  const tabItems: { id: TabId; icon: React.ElementType; labelKey: string }[] = [
    { id: "site", icon: Globe, labelKey: "admin.config.tab.site" },
    { id: "engines", icon: Puzzle, labelKey: "admin.config.tab.engines" },
    { id: "themes", icon: Palette, labelKey: "admin.config.tab.themes" },
    { id: "defaults", icon: SlidersHorizontal, labelKey: "admin.config.tab.defaults" },
    { id: "raw", icon: Code2, labelKey: "admin.config.tab.raw" },
  ];

  if (loading) return <LoadingState label={t("admin.table.loading")} />;

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        {tabItems.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              key={item.id}
              onClick={() => { haptic("selection"); setTab(item.id); }}
              role="tab"
              aria-selected={tab === item.id}
              className={cn(
                "font-medium",
                tab === item.id
                  ? "bg-primary/10 border border-primary/30 text-primary"
                  : "text-muted-foreground hover:text-foreground border border-transparent",
              )}
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{t(item.labelKey as any)}</span>
            </Button>
          );
        })}
        <div className="ms-auto">
          <Button onClick={handleSave} disabled={saving} size="sm">
            <Save className="size-4 me-1.5" />
            {saving ? t("common.loading") : t("admin.config.save")}
          </Button>
        </div>
      </div>

      {/* Tab panels */}
      {tab === "site" && <SitePanel config={config} update={updateConfig} t={t} />}
      {tab === "engines" && <EnginesPanel config={config} update={updateEngine} t={t} />}
      {tab === "themes" && <ThemesPanel config={config} update={updateConfig} t={t} />}
      {tab === "defaults" && <DefaultsPanel config={config} update={updateConfig} t={t} />}
      {tab === "raw" && (
        <RawPanel
          raw={raw}
          setRaw={setRaw}
          rawError={rawError}
          setRawError={setRawError}
          config={config}
          t={t}
        />
      )}
    </div>
  );
}

// ── Site Identity ──────────────────────────────────────────────────────────

function SitePanel({ config, update, t }: { config: ConfigData; update: (path: string, v: unknown) => void; t: (key: any) => string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-5">
      <SectionHeading icon={Globe}>{t("admin.config.tab.site")}</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <FormField label={t("admin.config.site.name")} hint="" value={config.site.name} onChange={(v) => update("site.name", v)} />
        <FormField label={t("admin.config.site.shortName")} hint={t("admin.config.site.shortNameHint")} value={config.site.shortName} onChange={(v) => update("site.shortName", v)} />
        <FormField label={t("admin.config.site.tagline")} hint="" value={config.site.tagline} onChange={(v) => update("site.tagline", v)} />
        <FormField label={t("admin.config.site.organisation")} hint="" value={config.site.organisation} onChange={(v) => update("site.organisation", v)} />
        <FormField label={t("admin.config.site.githubRepo")} hint={t("admin.config.site.githubRepoHint")} value={config.site.githubRepo} onChange={(v) => update("site.githubRepo", v)} />
        <FormField label={t("admin.config.site.supportEmail")} hint="" type="email" value={config.site.supportEmail} onChange={(v) => update("site.supportEmail", v)} />
      </div>
    </div>
  );
}

// ── Engine Plugins ────────────────────────────────────────────────────────

function EnginesPanel({ config, update, t }: { config: ConfigData; update: (id: string, f: string, v: unknown) => void; t: (key: any) => string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("admin.config.engines.desc")}</p>
      {ENGINE_IDS.map((id) => {
        const engine = config.engines[id] ?? { enabled: true };
        const meta = ENGINE_META[id as keyof typeof ENGINE_META];
        return (
          <div key={id} className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="flex size-9 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-sm font-semibold text-primary"
                  style={meta?.color ? {
                    backgroundColor: `color-mix(in oklch, ${meta.color} 12%, transparent)`,
                    borderColor: `color-mix(in oklch, ${meta.color} 30%, transparent)`,
                    color: meta.color,
                  } : undefined}
                >
                  {meta?.label ?? id}
                </div>
                <div>
                  <p className="text-sm font-medium capitalize">{id}</p>
                  <p className="text-xs text-muted-foreground">{meta?.label ?? id}</p>
                </div>
              </div>
              <Switch
                checked={engine.enabled}
                onCheckedChange={(v) => update(id, "enabled", v)}
              />
            </div>
            {!engine.enabled && (
              <p className="text-xs text-warning">{t("admin.config.engines.disabled")}</p>
            )}
            {engine.enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <FormField label={t("admin.config.engines.overrideLabel")} hint="" value={engine.label ?? ""} onChange={(v) => update(id, "label", v || undefined)} />
                <FormField label={t("admin.config.engines.overrideSingular")} hint="" value={engine.singular ?? ""} onChange={(v) => update(id, "singular", v || undefined)} />
                <FormField label={t("admin.config.engines.overrideColor")} hint="" value={engine.color ?? ""} onChange={(v) => update(id, "color", v || undefined)} />
                <FormField label={t("admin.config.engines.overrideIcon")} hint="" value={engine.icon ?? ""} onChange={(v) => update(id, "icon", v || undefined)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Themes ─────────────────────────────────────────────────────────────────

function ThemesPanel({ config, update, t }: { config: ConfigData; update: (path: string, v: unknown) => void; t: (key: any) => string }) {
  function addCustom() {
    const id = `custom-${Date.now()}`;
    const newTheme = { id, name: "New Theme", variant: "light" as const, primary: "", background: "", foreground: "", accent: "", border: "", destructive: "" };
    haptic("light");
    update("themes.custom", [...config.themes.custom, newTheme]);
  }

  function removeCustom(index: number) {
    haptic("light");
    const next = config.themes.custom.filter((_, i) => i !== index);
    update("themes.custom", next);
  }

  function updateCustom(index: number, field: string, value: unknown) {
    const next = config.themes.custom.map((t, i) => (i === index ? { ...t, [field]: value } : t));
    update("themes.custom", next);
  }

  return (
    <div className="space-y-5">
      {/* Default theme */}
      <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
        <SectionHeading icon={Palette}>{t("admin.config.themes.default")}</SectionHeading>
        <DefaultSelect
          label=""
          value={config.themes.default}
          onChange={(v) => update("themes.default", v)}
          options={["light", "dark", ...config.themes.custom.map((c) => c.id)]}
          getLabel={(v) => {
            if (v === "light") return "Light";
            if (v === "dark") return "Dark";
            return config.themes.custom.find((c) => c.id === v)?.name ?? v;
          }}
        />
      </div>

      {/* Custom themes */}
      <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading icon={Palette}>{t("admin.config.themes.custom")}</SectionHeading>
          <Button variant="outline" size="sm" onClick={addCustom}>
            <Plus className="size-3.5 me-1.5" />
            {t("admin.config.themes.add")}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{t("admin.config.themes.customDesc")}</p>
        {config.themes.custom.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">{t("admin.config.themes.noCustom")}</p>
        ) : (
          <div className="space-y-4">
            {config.themes.custom.map((theme, i) => (
              <div key={theme.id} className="relative space-y-3 rounded-xl border border-border p-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="iconSm"
                  onClick={() => removeCustom(i)}
                  className="absolute end-3 top-3 text-muted-foreground hover:text-destructive"
                  aria-label={t("common.remove")}
                >
                  <Trash2 className="size-4" />
                </Button>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <FormField label={t("admin.config.themes.field.name")} hint="" value={theme.name} onChange={(v) => updateCustom(i, "name", v)} />
                  <DefaultSelect
                    label={t("admin.config.themes.field.variant")}
                    value={theme.variant}
                    onChange={(v) => updateCustom(i, "variant", v)}
                    options={["dark", "light"]}
                  />
                  <FormField label={t("admin.config.themes.field.primary")} hint="" value={theme.primary ?? ""} onChange={(v) => updateCustom(i, "primary", v || undefined)} />
                  <FormField label={t("admin.config.themes.field.background")} hint="" value={theme.background ?? ""} onChange={(v) => updateCustom(i, "background", v || undefined)} />
                  <FormField label={t("admin.config.themes.field.foreground")} hint="" value={theme.foreground ?? ""} onChange={(v) => updateCustom(i, "foreground", v || undefined)} />
                  <FormField label={t("admin.config.themes.field.accent")} hint="" value={theme.accent ?? ""} onChange={(v) => updateCustom(i, "accent", v || undefined)} />
                  <FormField label={t("admin.config.themes.field.border")} hint="" value={theme.border ?? ""} onChange={(v) => updateCustom(i, "border", v || undefined)} />
                  <FormField label={t("admin.config.themes.field.destructive")} hint="" value={theme.destructive ?? ""} onChange={(v) => updateCustom(i, "destructive", v || undefined)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Defaults ───────────────────────────────────────────────────────────────

function DefaultsPanel({ config, update, t }: { config: ConfigData; update: (path: string, v: unknown) => void; t: (key: any) => string }) {
  const VIEWS = ["dashboard", "learn", "qbank", "flashcards", "osce", "videos", "library", "profile", "settings"];
  const LANGUAGES = ["en", "ar"];
  const CONTENT_FILTERS = ["all", "en", "ar"];

  return (
    <div className="space-y-5">
      {/* View + Language */}
      <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
        <SectionHeading>{t("admin.config.defaults.view")}</SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DefaultSelect label={t("admin.config.defaults.view")} value={config.defaults.view} onChange={(v) => update("defaults.view", v)} options={VIEWS} />
          <DefaultSelect label={t("admin.config.defaults.uiLang")} value={config.defaults.language.ui} onChange={(v) => update("defaults.language.ui", v)} options={LANGUAGES} />
          <DefaultSelect label={t("admin.config.defaults.contentFilter")} value={config.defaults.language.content} onChange={(v) => update("defaults.language.content", v)} options={CONTENT_FILTERS} />
        </div>
      </div>

      {/* Quiz defaults */}
      <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
        <SectionHeading>{t("admin.config.defaults.quiz")}</SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <FormField label={t("admin.config.defaults.quizCount")} type="number" value={String(config.defaults.quiz.count)} onChange={(v) => update("defaults.quiz.count", Number(v))} />
          <FormField label={t("admin.config.defaults.quizSecPerQ")} type="number" value={String(config.defaults.quiz.secPerQuestion)} onChange={(v) => update("defaults.quiz.secPerQuestion", Number(v))} />
          <ToggleField label={t("admin.config.defaults.quizTutor")} checked={config.defaults.quiz.tutor} onChange={(v) => update("defaults.quiz.tutor", v)} />
          <ToggleField label={t("admin.config.defaults.quizShuffle")} checked={config.defaults.quiz.shuffle} onChange={(v) => update("defaults.quiz.shuffle", v)} />
        </div>
      </div>

      {/* AI defaults */}
      <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
        <SectionHeading>{t("admin.config.defaults.ai")}</SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label={t("admin.config.defaults.aiModel")} value={config.defaults.ai.model} onChange={(v) => update("defaults.ai.model", v)} />
          <FormField label={t("admin.config.defaults.aiTemp")} type="number" value={String(config.defaults.ai.temperature)} onChange={(v) => update("defaults.ai.temperature", Number(v))} />
          <ToggleField label={t("admin.config.defaults.aiEnabled")} checked={config.defaults.ai.enabled} onChange={(v) => update("defaults.ai.enabled", v)} />
        </div>
      </div>

      {/* Sync defaults */}
      <div className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
        <SectionHeading>{t("admin.config.defaults.sync")}</SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DefaultSelect label={t("admin.config.defaults.syncMethod")} value={config.defaults.sync.method} onChange={(v) => update("defaults.sync.method", v)} options={["webrtc", "qr", "file", "disabled"]} />
          <FormField label={t("admin.config.defaults.syncRoom")} value={config.defaults.sync.room} onChange={(v) => update("defaults.sync.room", v)} />
        </div>
      </div>
    </div>
  );
}

// ── Raw JSON ───────────────────────────────────────────────────────────────

function RawPanel({
  raw, setRaw, rawError, setRawError, config, t,
}: {
  raw: string; setRaw: (v: string) => void; rawError: string | null; setRawError: (v: string | null) => void; config: ConfigData; t: (key: any) => string;
}) {
  function handleChange(v: string) {
    setRaw(v);
    try { JSON.parse(v); setRawError(null); } catch { setRawError(t("admin.config.raw.invalidJson")); }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("admin.config.raw.desc")}</p>
      <textarea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        className={cn(
          "w-full h-[60vh] font-mono text-sm p-4 rounded-xl border bg-card resize-none focus:outline-none focus:ring-2 focus:ring-ring",
          rawError ? "border-destructive/50 focus:ring-destructive" : "border-border",
        )}
        spellCheck={false}
      />
      {rawError && (
        <p className="text-xs text-destructive flex items-center gap-1.5">
          <X className="size-3" />
          {rawError}
        </p>
      )}
      {!rawError && raw && (
        <p className="text-xs text-success flex items-center gap-1.5">
          <Check className="size-3" />
          Valid JSON
        </p>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function FormField({
  label, hint, value, onChange, type = "text",
}: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function DefaultSelect({
  label, value, onChange, options, getLabel,
}: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; getLabel?: (v: string) => string;
}) {
  return (
    <div className="space-y-1.5">
      {label && <Label className="text-xs font-medium text-muted-foreground">{label}</Label>}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>{getLabel ? getLabel(o) : o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ToggleField({
  label, checked, onChange,
}: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
