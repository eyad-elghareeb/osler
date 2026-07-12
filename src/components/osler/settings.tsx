"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  AlertTriangle,
  Check,
  Keyboard,
  Save,
  Undo2,
  RotateCcw,
  CornerDownLeft,
  Globe,
  Languages,
  Download,
  HardDrive,
  Smartphone,
  FileArchive,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { storage } from "@/lib/osler/storage";
import { SyncSettingsSection } from "./sync/sync-settings-section";
import { FileSyncPanel } from "./sync/file-sync-panel";
import {
  SHORTCUT_ACTIONS,
  loadBindings,
  saveBindings,
  resetBindings,
  defaultBindings,
  findConflicts,
  describeBinding,
  type ShortcutScope,
} from "@/lib/osler/shortcuts";
import { useI18n } from "./i18n-provider";
import { LANGUAGES, UI_LANGS, type UiLang, type ContentLangFilter } from "@/lib/osler/i18n";
import { cn } from "@/lib/utils";

/* ─── Models & storage keys (shared with ai-assistant.tsx) ──────────── */

const MODELS = [
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite (default, fast & modern)"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash (latest, strongest Flash)"],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview (most capable, premium)"],
  ["gemma-4-26b-a4b-it", "Gemma 4 26B IT (open model, strong & free)"],
  ["gemma-4-31b-it", "Gemma 4 31B IT (larger open model)"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash (older fallback)"],
] as const;

const STORAGE_KEYS = {
  apiKey: "osler_gemini_api_key",
  model: "osler_gemini_model",
  maxWait: "osler_gemini_max_wait",
} as const;

const OSCE_VOICE_MODELS = [
  ["gemini-3.1-flash-live-preview", "Gemini 3.1 Flash Live (recommended)"],
  ["gemini-live-2.5-flash-native-audio", "Gemini Live 2.5 Flash — native audio"],
  ["gemini-live-2.5-flash-preview-native-audio-09-2025", "Gemini 2.5 Flash Live — native audio preview"],
] as const;

const OSCE_STORAGE_KEYS = {
  liveModel: "osler_osce_live_model",
  voiceOn: "osler_osce_voice_on",
  ttsVoice: "osler_osce_tts_voice",
  ttsRate: "osler_osce_tts_rate",
} as const;

/* ─── Section tabs ──────────────────────────────────────────────────── */

type SettingsSection = "language" | "ai" | "shortcuts" | "downloads" | "sync" | "backup" | "danger";

export function Settings({
  initialSection = "language",
}: {
  initialSection?: SettingsSection;
}) {
  const { t } = useI18n();
  const [section, setSection] = React.useState<SettingsSection>(initialSection);

  const SECTIONS: { id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "language", label: t("settings.section.language"), icon: Languages },
    { id: "ai", label: t("settings.section.ai"), icon: Sparkles },
    { id: "shortcuts", label: t("settings.section.shortcuts"), icon: Keyboard },
    { id: "downloads", label: "Downloads", icon: Download },
    { id: "sync", label: "Sync", icon: Smartphone },
    { id: "backup", label: t("settings.section.backup"), icon: FileArchive },
    { id: "danger", label: t("settings.section.danger"), icon: AlertTriangle },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="flex items-center gap-3 mb-6">
          <SettingsIcon className="size-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">{t("settings.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
          </div>
        </div>

        {/* Section tabs — horizontal scroll only (overflow-y is locked so the
            bar never becomes vertically scrollable even when labels wrap on
            narrow viewports). */}
        <div className="flex items-center gap-1 mb-6 border-b border-border/60 overflow-x-auto overflow-y-hidden medos-scroll">
          {SECTIONS.map((s) => {
            const I = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`relative h-10 px-3 sm:px-4 text-sm font-medium flex items-center gap-2 transition-colors shrink-0 whitespace-nowrap ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <I className="size-4" />
                {s.label}
                {active && (
                  <div className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
                )}
              </button>
            );
          })}
        </div>

        {section === "language" && <LanguageSettingsSection />}
        {section === "ai" && <AiSettingsSection />}
        {section === "shortcuts" && <ShortcutsSettingsSection />}
        {section === "downloads" && <DownloadsSettingsSection />}
        {section === "sync" && <SyncSettingsSection />}
        {section === "backup" && <BackupSettingsSection />}
        {section === "danger" && <DangerZoneSection />}
      </motion.div>
    </div>
  );
}

/* ─── Language section ─────────────────────────────────────────────── */

function LanguageSettingsSection() {
  const { t, lang, setLang, contentFilter, setContentFilter, rtl } = useI18n();

  const uiLangOptions: Array<{ id: UiLang; label: string; native: string; dir: "ltr" | "rtl" }> = UI_LANGS.map(
    (code) => ({
      id: code,
      label: LANGUAGES[code].name,
      native: LANGUAGES[code].nativeName,
      dir: LANGUAGES[code].dir,
    }),
  );

  const contentFilterOptions: Array<{ id: ContentLangFilter; label: string }> = [
    { id: "all", label: t("settings.language.contentLangAll") },
    { id: "en", label: t("settings.language.contentLangEn") },
    { id: "ar", label: t("settings.language.contentLangAr") },
  ];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
          <Languages className="size-4 text-primary" />
          {t("settings.section.language")}
        </h2>
        <p className="text-xs text-muted-foreground mb-5">
          {t("settings.language.uiLangDesc")}
        </p>

        {/* UI language selector — large radio-card style */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">
            {t("settings.language.uiLang")}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {uiLangOptions.map((opt) => {
              const active = lang === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setLang(opt.id)}
                  className={cn(
                    "text-start p-3 rounded-lg border-2 transition-all flex items-center gap-3",
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40",
                  )}
                >
                  <div
                    className={cn(
                      "size-9 rounded-full flex items-center justify-center shrink-0",
                      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {opt.id === "ar" ? <span className="text-sm font-bold">ع</span> : <Globe className="size-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{opt.label}</div>
                    <div className="text-xs text-muted-foreground" dir={opt.dir} lang={opt.id}>
                      {opt.native} · {opt.dir.toUpperCase()}
                    </div>
                  </div>
                  {active && <Check className="size-4 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content-language filter */}
        <div className="space-y-2 mt-6">
          <label className="text-xs font-semibold text-muted-foreground">
            {t("settings.language.contentLang")}
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            {t("settings.language.contentLangDesc")}
          </p>
          <div className="flex flex-wrap gap-2">
            {contentFilterOptions.map((opt) => {
              const active = contentFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setContentFilter(opt.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40",
                    opt.id === "ar" && !active && "osler-content-ar",
                  )}
                  dir={opt.id === "ar" ? "rtl" : undefined}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* RTL note */}
        <div className="mt-6 p-3 rounded-lg bg-muted/30 border border-border/60 flex items-start gap-2 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 mt-0.5 shrink-0 text-primary" />
          <span>{t("settings.language.rtlNote")}</span>
        </div>
      </Card>

      {/* Quick preview block — shows the current UI direction live */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold mb-2">{t("settings.section.language")}</h3>
        <div
          className={cn(
            "rounded-lg border border-border p-4 bg-card text-sm",
            rtl && "osler-content-ar",
          )}
          dir={rtl ? "rtl" : "ltr"}
          lang={lang}
        >
          <div className="font-semibold mb-1">
            {lang === "ar" ? "معاينة الواجهة" : "UI preview"}
          </div>
          <p className="text-muted-foreground">
            {lang === "ar"
              ? "هذه معاينة مباشرة لكيفية ظهور النص العربي ضمن الواجهة. لاحظ كيف تنعكس اتجاهات المحاذاة والأيقونات تلقائيًا."
              : "This is a live preview of how your UI language renders. Notice how text alignment and icon directions flip automatically when you switch to Arabic."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <div className="size-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-semibold">
              {lang === "ar" ? "ع" : "EN"}
            </div>
            <div className="flex-1">
              <div className="text-xs font-medium">
                {lang === "ar" ? "العربية" : "English"}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {rtl ? "RTL" : "LTR"} · {lang}
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ─── AI Assistant section ──────────────────────────────────────────── */

interface AiFormState {
  apiKey: string;
  model: string;
  maxWait: string;
}

function loadAiForm(): AiFormState {
  return {
    apiKey: (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEYS.apiKey)) || "",
    model: (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEYS.model)) || MODELS[0][0],
    maxWait: (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEYS.maxWait)) || "30",
  };
}

function saveAiForm(state: AiFormState): void {
  localStorage.setItem(STORAGE_KEYS.apiKey, state.apiKey);
  localStorage.setItem(STORAGE_KEYS.model, state.model);
  localStorage.setItem(STORAGE_KEYS.maxWait, state.maxWait);
}

function validateAiForm(state: AiFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (state.apiKey && !/^[A-Za-z0-9_\-]{20,}$/.test(state.apiKey.trim())) {
    errors.apiKey = "API keys are usually 30+ characters of letters, digits, hyphens, and underscores.";
  }
  const mw = Number(state.maxWait);
  if (!Number.isFinite(mw) || mw < 5 || mw > 300) {
    errors.maxWait = "Max wait must be between 5 and 300 seconds.";
  }
  return errors;
}

function AiSettingsSection() {
  const { t } = useI18n();
  const [saved, setSaved] = React.useState<AiFormState>(() => loadAiForm());
  const [draft, setDraft] = React.useState<AiFormState>(() => saved);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [justSaved, setJustSaved] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<string | null>(null);

  const isDirty = React.useMemo(
    () => draft.apiKey !== saved.apiKey || draft.model !== saved.model || draft.maxWait !== saved.maxWait,
    [draft, saved],
  );

  const setField = <K extends keyof AiFormState>(key: K, value: AiFormState[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  const handleSave = () => {
    const errs = validateAiForm(draft);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    saveAiForm(draft);
    setSaved(draft);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const handleDiscard = () => {
    setDraft(saved);
    setErrors({});
  };

  const handleClearKey = () => {
    const next = { ...draft, apiKey: "" };
    setDraft(next);
    setErrors((prev) => { const n = { ...prev }; delete n.apiKey; return n; });
    saveAiForm(next);
    setSaved(next);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const handleTestKey = async () => {
    if (!draft.apiKey.trim()) {
      setTestResult("No key entered.");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": draft.apiKey },
      });
      const data = await res.json();
      if (data?.models?.length) {
        setTestResult(`✓ Valid key (${data.models.length} models available).`);
      } else {
        setTestResult("✗ Unexpected response. Check the key.");
      }
    } catch {
      setTestResult("✗ Connection failed. Check key or network.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
        <Sparkles className="size-4 text-primary" />
        {t("settings.ai.title")}
      </h2>
      <p className="text-xs text-muted-foreground mb-5">
        {t("settings.ai.subtitle")}
      </p>

      <div className="space-y-4">
        {/* API Key */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
            <span>{t("settings.ai.apiKey")}</span>
            {draft.apiKey !== saved.apiKey && (
              <span className="text-[10px] text-amber-500 font-normal">{t("settings.ai.unsaved")}</span>
            )}
          </label>
          <input
            type="password"
            value={draft.apiKey}
            onChange={(e) => setField("apiKey", e.target.value)}
            placeholder={t("settings.ai.apiKeyPlaceholder")}
            className={`flex-1 w-full h-9 rounded-lg border bg-card px-3 text-sm outline-none transition-colors ${
              errors.apiKey ? "border-destructive focus:border-destructive" : "border-border focus:border-primary"
            }`}
          />
          {errors.apiKey && <p className="text-[11px] text-destructive">{errors.apiKey}</p>}
          {!errors.apiKey && (
            <p className="text-[11px] text-muted-foreground">
              {t("settings.ai.getKey")}
            </p>
          )}
        </div>

        {/* Model + Max wait */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">{t("settings.ai.model")}</label>
            <select
              value={draft.model}
              onChange={(e) => setField("model", e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
            >
              {MODELS.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">{t("settings.ai.maxWait")}</label>
            <select
              value={draft.maxWait}
              onChange={(e) => setField("maxWait", e.target.value)}
              className={`w-full h-9 rounded-lg border bg-card px-3 text-sm outline-none transition-colors ${
                errors.maxWait ? "border-destructive" : "border-border focus:border-primary"
              }`}
            >
              <option value="15">{t("settings.ai.maxWait.15")}</option>
              <option value="30">{t("settings.ai.maxWait.30")}</option>
              <option value="60">{t("settings.ai.maxWait.60")}</option>
              <option value="120">{t("settings.ai.maxWait.120")}</option>
            </select>
            {errors.maxWait && <p className="text-[11px] text-destructive">{errors.maxWait}</p>}
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <p className={`text-xs ${testResult.startsWith("✓") ? "text-green-500" : "text-destructive"}`}>
            {testResult}
          </p>
        )}

        {/* ── OSCE Voice Settings ── */}
        <div className="pt-4 border-t border-border/60">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-1">
            <Sparkles className="size-4 text-primary" />
            {t("settings.ai.osceVoice")}
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            {t("settings.ai.osceVoiceDesc")}
          </p>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">{t("settings.ai.liveModel")}</label>
                <select
                  value={typeof window !== "undefined" ? localStorage.getItem(OSCE_STORAGE_KEYS.liveModel) || OSCE_VOICE_MODELS[0][0] : OSCE_VOICE_MODELS[0][0]}
                  onChange={(e) => { localStorage.setItem(OSCE_STORAGE_KEYS.liveModel, e.target.value); }}
                  className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
                >
                  {OSCE_VOICE_MODELS.map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.ai.liveModelDesc")}
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">{t("settings.ai.ttsRate")}</label>
                <select
                  value={typeof window !== "undefined" ? localStorage.getItem(OSCE_STORAGE_KEYS.ttsRate) || "0.95" : "0.95"}
                  onChange={(e) => { localStorage.setItem(OSCE_STORAGE_KEYS.ttsRate, e.target.value); }}
                  className="w-full h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="0.5">Very Slow (0.5x)</option>
                  <option value="0.75">Slow (0.75x)</option>
                  <option value="0.95">Normal (0.95x)</option>
                  <option value="1.2">Fast (1.2x)</option>
                  <option value="1.5">Very Fast (1.5x)</option>
                </select>
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.ai.ttsRateDesc")}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
          <Button size="sm" variant="default" onClick={handleSave} disabled={!isDirty} className="h-8 text-xs">
            {justSaved ? (
              <><Check className="size-3 me-1" /> {t("common.saved")}</>
            ) : (
              <><Save className="size-3 me-1" /> {t("common.saveChanges")}</>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDiscard} disabled={!isDirty} className="h-8 text-xs">
            <Undo2 className="size-3 me-1" /> {t("common.discard")}
          </Button>
          <Button size="sm" variant="secondary" onClick={handleTestKey} disabled={testing} className="h-8 text-xs">
            {testing ? t("settings.ai.testing") : t("settings.ai.testConnection")}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleClearKey} className="h-8 text-xs ms-auto">
            <Trash2 className="size-3 me-1" /> {t("settings.ai.clearKey")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ─── Keyboard shortcuts section ────────────────────────────────────── */

function ShortcutsSettingsSection() {
  const { t, tList } = useI18n();
  const [saved, setSaved] = React.useState<Record<string, string>>(() => loadBindings());
  const [draft, setDraft] = React.useState<Record<string, string>>(() => saved);
  const [justSaved, setJustSaved] = React.useState(false);

  const isDirty = React.useMemo(() => {
    for (const a of SHORTCUT_ACTIONS) {
      if ((draft[a.id] ?? "") !== (saved[a.id] ?? "")) return true;
    }
    return false;
  }, [draft, saved]);

  const setBinding = (actionId: string, binding: string) => {
    setDraft((d) => ({ ...d, [actionId]: binding }));
  };

  const handleSave = () => {
    saveBindings(draft);
    setSaved(draft);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  const handleDiscard = () => {
    setDraft(saved);
  };

  const handleResetAll = () => {
    setDraft(defaultBindings());
  };

  const handleResetOne = (actionId: string) => {
    const def = defaultBindings()[actionId] ?? "";
    setDraft((d) => ({ ...d, [actionId]: def }));
  };

  const scopeMeta: Record<ShortcutScope, { label: string; description: string }> = {
    global: { label: t("settings.shortcuts.scope.global"), description: t("settings.shortcuts.scope.globalDesc") },
    qbank: { label: t("settings.shortcuts.scope.qbank"), description: t("settings.shortcuts.scope.qbankDesc") },
    flashcard: { label: t("settings.shortcuts.scope.flashcard"), description: t("settings.shortcuts.scope.flashcardDesc") },
    reader: { label: t("settings.shortcuts.scope.reader"), description: t("settings.shortcuts.scope.readerDesc") },
    videos: { label: t("settings.shortcuts.scope.videos"), description: t("settings.shortcuts.scope.videosDesc") },
  };

  const scopes: ShortcutScope[] = ["global", "qbank", "flashcard", "reader", "videos"];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Keyboard className="size-4 text-primary" />
            {t("settings.shortcuts.title")}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          {t("settings.shortcuts.subtitle")}
        </p>

        <div className="space-y-6">
          {scopes.map((scope) => {
            const actions = SHORTCUT_ACTIONS.filter((a) => a.scope === scope);
            const meta = scopeMeta[scope];
            if (!actions.length) return null;
            return (
              <div key={scope}>
                <div className="mb-2">
                  <h3 className="text-sm font-semibold">{meta.label}</h3>
                  <p className="text-[11px] text-muted-foreground">{meta.description}</p>
                </div>
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  <table className="w-full">
                    <tbody>
                      {actions.map((a, idx) => {
                        const currentBinding = draft[a.id] ?? "";
                        const conflicts = findConflicts(draft, a.id, currentBinding);
                        const isDefault = currentBinding === a.defaultBinding;
                        const conflictNames = conflicts
                          .map((c) => SHORTCUT_ACTIONS.find((x) => x.id === c)?.label ?? c)
                          .join(", ");
                        return (
                          <tr key={a.id} className={idx > 0 ? "border-t border-border/60" : ""}>
                            <td className="py-2.5 px-3 align-middle w-1/2">
                              <div className="text-sm font-medium">{a.label}</div>
                              <div className="text-[11px] text-muted-foreground">{a.description}</div>
                              {conflicts.length > 0 && (
                                <div className="text-[11px] text-amber-500 mt-1">
                                  ⚠ {t("settings.shortcuts.conflictsWith", { names: conflictNames })}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 align-middle">
                              <KeyCaptureInput
                                value={currentBinding}
                                onChange={(b) => setBinding(a.id, b)}
                                onReset={() => handleResetOne(a.id)}
                              />
                              {!isDefault && currentBinding && (
                                <div className="text-[10px] text-muted-foreground mt-1">
                                  Default: <span className="font-mono">{describeBinding(a.defaultBinding)}</span>
                                </div>
                              )}
                              {!currentBinding && (
                                <div className="text-[10px] text-muted-foreground mt-1">Disabled</div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-4 mt-5 border-t border-border/60">
          <Button size="sm" variant="default" onClick={handleSave} disabled={!isDirty} className="h-8 text-xs">
            {justSaved ? (
              <><Check className="size-3 me-1" /> {t("common.saved")}</>
            ) : (
              <><Save className="size-3 me-1" /> {t("common.saveChanges")}</>
            )}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDiscard} disabled={!isDirty} className="h-8 text-xs">
            <Undo2 className="size-3 me-1" /> {t("common.discard")}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleResetAll} className="h-8 text-xs ms-auto">
            <RotateCcw className="size-3 me-1" /> {t("settings.shortcuts.resetAll")}
          </Button>
        </div>
      </Card>

      <Card className="p-4 bg-muted/30">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <CornerDownLeft className="size-3.5 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-foreground mb-1">{t("settings.shortcuts.tipsTitle")}</p>
            <ul className="space-y-1 list-disc list-inside">
              {tList("settings.shortcuts.tips").map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
            <p className="mt-2 text-foreground/80">{t("settings.shortcuts.scopeConflictNote")}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ─── Key capture input (inline) ────────────────────────────────────── */

function KeyCaptureInput({
  value,
  onChange,
  onReset,
}: {
  value: string;
  onChange: (binding: string) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const [capturing, setCapturing] = React.useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { setCapturing(false); return; }
    if (e.key === "Backspace") { onChange(""); setCapturing(false); return; }

    const parts: string[] = [];
    if (e.metaKey) parts.push("mod");
    else if (e.ctrlKey) parts.push("ctrl");
    if (e.altKey) parts.push("alt");
    if (e.shiftKey && !["Shift", "Control", "Alt", "Meta"].includes(e.key)) parts.push("shift");
    const key = e.key;
    if (!["Shift", "Control", "Alt", "Meta"].includes(key)) {
      parts.push(key.toLowerCase());
      onChange(parts.join("+"));
      setCapturing(false);
    }
  };

  if (capturing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          onKeyDown={handleKeyDown}
          onBlur={() => setCapturing(false)}
          className="w-full h-8 px-2 rounded border-2 border-primary bg-card text-xs font-mono outline-none"
          placeholder={t("settings.shortcuts.pressKeys")}
          value=""
          readOnly
        />
        <button
          onClick={() => setCapturing(false)}
          className="text-[10px] text-muted-foreground hover:text-foreground shrink-0"
        >
          {t("settings.shortcuts.cancel")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setCapturing(true)}
        className="w-full h-8 px-2 rounded border border-border bg-card text-xs font-mono text-left hover:border-primary/60 transition-colors"
      >
        {value ? describeBinding(value) : <span className="text-muted-foreground italic">{t("settings.shortcuts.clickToSet")}</span>}
      </button>
      {value && (
        <button
          onClick={onReset}
          className="size-6 rounded flex items-center justify-center hover:bg-muted shrink-0"
          title={t("settings.shortcuts.resetOne")}
          aria-label={t("settings.shortcuts.resetOne")}
        >
          <RotateCcw className="size-3" />
        </button>
      )}
    </div>
  );
}

/* ─── Downloads section (offline content cache management) ──────────── */

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function DownloadsSettingsSection() {
  const { t } = useI18n();
  const [stats, setStats] = React.useState<{ count: number; size: number } | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);

  const refreshStats = React.useCallback(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (!navigator.serviceWorker.controller) return;
    // Set up a one-time listener for the response
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "CONTENT_CACHE_STATS") {
        setStats({ count: event.data.count, size: event.data.size });
        navigator.serviceWorker.removeEventListener("message", handler);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    navigator.serviceWorker.controller.postMessage({ type: "GET_CONTENT_CACHE_STATS" });
    // Timeout to clean up listener if no response
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener("message", handler);
    }, 3000);
  }, []);

  React.useEffect(() => {
    refreshStats();
    // Re-check after a delay in case the SW wasn't ready yet
    const t = setTimeout(refreshStats, 2000);
    return () => clearTimeout(t);
  }, [refreshStats]);

  const handleClear = async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (!navigator.serviceWorker.controller) return;
    setClearing(true);
    navigator.serviceWorker.controller.postMessage({ type: "CLEAR_CONTENT_CACHE" });
    // Wait a moment for the SW to process, then refresh stats
    setTimeout(() => {
      setClearing(false);
      setConfirmClear(false);
      refreshStats();
    }, 800);
  };

  const swAvailable =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    !!navigator.serviceWorker.controller;

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
        <Download className="size-4 text-primary" />
        {t("settings.downloads.title")}
      </h2>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        {t("settings.downloads.subtitle")}
      </p>

      {!swAvailable ? (
        <div className="bg-muted/40 border border-border rounded-lg p-4 text-sm text-muted-foreground">
          {t("settings.downloads.swUnavailable")}
        </div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <HardDrive className="size-5" />
              </div>
              <div>
                <div className="text-sm font-medium">
                  {stats
                    ? stats.count === 1
                      ? t("settings.downloads.oneFileCached")
                      : t("settings.downloads.filesCached", { n: stats.count })
                    : t("settings.downloads.loading")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {stats ? formatBytes(stats.size) : ""}
                </div>
              </div>
            </div>
          </div>

          {!confirmClear ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmClear(true)}
              disabled={!stats || stats.count === 0 || clearing}
            >
              <Trash2 className="size-3.5 me-1.5" />
              {t("settings.downloads.clearAll")}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{t("settings.downloads.confirm")}</span>
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                onClick={handleClear}
                disabled={clearing}
              >
                {clearing ? t("settings.downloads.clearing") : t("settings.downloads.confirmYes")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setConfirmClear(false)}
                disabled={clearing}
              >
                {t("settings.downloads.cancel")}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ─── Backup & Restore section (file export/import) ──────────────────── */

function BackupSettingsSection() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <FileArchive className="size-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold">{t("settings.section.backup")}</h2>
          <p className="text-xs text-muted-foreground">{t("sync.tab.fileDesc")}</p>
        </div>
      </div>
      <FileSyncPanel />
    </div>
  );
}

/* ─── Danger Zone section ───────────────────────────────────────────── */

function DangerZoneSection() {
  const { t } = useI18n();
  const [progressCount, setProgressCount] = React.useState(0);
  const [confirmClear, setConfirmClear] = React.useState(false);

  React.useEffect(() => {
    const update = () => setProgressCount(storage.allProgress().length);
    update();
    return storage.subscribe(update);
  }, []);

  const handleClearProgress = () => {
    if (typeof window !== "undefined") {
      storage.clearAll();
      setProgressCount(0);
      setConfirmClear(false);
    }
  };

  return (
    <Card className="p-5 border-destructive/30">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-3 text-destructive">
        <AlertTriangle className="size-4" />
        {t("settings.danger.title")}
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        {t("settings.danger.subtitle")}
        <br />
        <strong className="text-destructive">{t("settings.danger.warning")}</strong>
      </p>

      <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-sm font-medium">{t("settings.danger.packsWithProgress", { n: progressCount })}</div>
          <div className="text-xs text-muted-foreground">{t("settings.danger.packsWithProgressSub")}</div>
        </div>
      </div>

      {!confirmClear ? (
        <Button variant="destructive" size="sm" onClick={() => setConfirmClear(true)} disabled={progressCount === 0}>
          <Trash2 className="size-3.5 me-1.5" />
          {t("settings.danger.clearAll")}
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-destructive font-medium">{t("settings.danger.confirm")}</span>
          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleClearProgress}>
            {t("settings.danger.confirmYes")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmClear(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      )}
    </Card>
  );
}
