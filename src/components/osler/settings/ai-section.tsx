"use client";

import * as React from "react";
import { Sparkles, Trash2, Check, Keyboard, Save, Undo2, Cloud } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { type StringKey } from "@/lib/osler/i18n";
import { cn } from "@/lib/utils";
import { cloudEnabled, applyGeminiKeyInfo, GEMINI_CLOUD_SYNCED_FLAG } from "@/lib/osler/cloud";
import { ToggleSwitch } from "./backup-native-section";
const MODELS = [
  ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite (default, fastest & cost-efficient)"],
  ["gemini-3.7-flash", "Gemini 3.7 Flash (newest, most capable Flash)"],
  ["gemini-3.6-flash", "Gemini 3.6 Flash (fast & efficient)"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash (stable, high-throughput)"],
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite (fast & modern)"],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview (most capable, premium)"],
  ["gemini-3-flash-preview", "Gemini 3 Flash Preview (experimental)"],
  ["gemma-4-26b-a4b-it", "Gemma 4 26B IT (open model, strong & free)"],
  ["gemma-4-31b-it", "Gemma 4 31B IT (larger open model)"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite (budget fallback)"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash (older fallback)"],
] as const;

const STORAGE_KEYS = {
  apiKey: "osler_gemini_api_key",
  model: "osler_gemini_model",
  maxWait: "osler_gemini_max_wait",
} as const;

const OSCE_VOICE_MODELS = [
  ["gemini-3.1-flash-live-preview", "Gemini 3.1 Flash Live (default, recommended)"],
  ["gemini-2.5-flash-native-audio-preview-12-2025", "Gemini 2.5 Flash Live — native audio"],
] as const;

const OSCE_STORAGE_KEYS = {
  liveModel: "osler_osce_live_model",
  voiceOn: "osler_osce_voice_on",
  ttsVoice: "osler_osce_tts_voice",
  ttsRate: "osler_osce_tts_rate",
  // Opt-in Live transcripts (default off — see STORAGE in osce-studio.tsx).
  liveTranscripts: "osler_osce_live_transcripts",
} as const;
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
  // A locally-edited key is no longer a pristine cloud-synced copy, so the
  // removal-reconciliation flag no longer applies.
  localStorage.removeItem(GEMINI_CLOUD_SYNCED_FLAG);
}

/**
 * Pull the user's saved Gemini key from the cloud DB (if cloud is enabled).
 * This is the "saved once" path — when a user signs in on a new device, we
 * fetch the key from /v1/account/gemini-key and write it to localStorage so
 * the AI assistant / qbank-studio / osce-studio pick it up.
 *
 * Best-effort: if the fetch fails we silently fall back to localStorage.
 */
async function syncAiFormFromCloud(onUpdate: (next: AiFormState) => void) {
  if (typeof window === "undefined") return;
  try {
    const { cloudEnabled } = await import("@/lib/osler/cloud");
    if (!(await cloudEnabled())) return;
    const { geminiApi } = await import("@/components/osler/admin/admin-api");
    const info = await geminiApi.get();
    if (info.hasKey && info.apiKey) {
      // Write to localStorage so the AI assistant etc. pick it up, flagged as
      // cloud-synced so a future removal can be reconciled across devices.
      applyGeminiKeyInfo(info);
      onUpdate({
        apiKey: info.apiKey,
        model: info.model || MODELS[0][0],
        maxWait: info.maxWait != null ? String(info.maxWait) : "30",
      });
    }
  } catch {
    // Cloud not configured or session expired — fall back to localStorage.
  }
}

/**
 * Push the user's Gemini key to the cloud DB so it's available on every
 * device they sign in from. Best-effort — if the push fails we still keep
 * the localStorage copy.
 */
async function syncAiFormToCloud(state: AiFormState) {
  if (typeof window === "undefined") return;
  try {
    const { cloudEnabled } = await import("@/lib/osler/cloud");
    if (!(await cloudEnabled())) return;
    const { geminiApi } = await import("@/components/osler/admin/admin-api");
    const key = state.apiKey.trim();
    const maxWaitNum = Number(state.maxWait);
    if (!key) {
      // Explicitly remove the cloud copy — PUT with null now means "keep",
      // so clearing an emptied field needs the DELETE endpoint.
      await geminiApi.clear();
    } else {
      await geminiApi.save(key, state.model || null, Number.isFinite(maxWaitNum) ? maxWaitNum : null);
    }
  } catch {
    // Silent fail — localStorage is still the source of truth for the session.
  }
}

function validateAiForm(
  state: AiFormState,
  t: (key: StringKey, params?: Record<string, string | number>) => string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (state.apiKey && !/^[A-Za-z0-9_\-.]{20,}$/.test(state.apiKey.trim())) {
    errors.apiKey = t("settings.ai.keyLengthError");
  }
  const mw = Number(state.maxWait);
  if (!Number.isFinite(mw) || mw < 5 || mw > 300) {
    errors.maxWait = t("settings.ai.maxWaitError");
  }
  return errors;
}

export function AiSettingsSection() {
  const { t } = useI18n();
  const [saved, setSaved] = React.useState<AiFormState>(() => loadAiForm());
  const [draft, setDraft] = React.useState<AiFormState>(() => saved);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [justSaved, setJustSaved] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<string | null>(null);
  const [cloudSynced, setCloudSynced] = React.useState(false);
  // Opt-in Live transcripts toggle. Defaults to OFF. Lives in localStorage so
  // the Live API WebSocket setup can read it on every connection without a
  // round-trip through the cloud DB.
  const [liveTranscripts, setLiveTranscripts] = React.useState<boolean>(() =>
    typeof window !== "undefined" && localStorage.getItem(OSCE_STORAGE_KEYS.liveTranscripts) === "true"
  );
  const toggleLiveTranscripts = React.useCallback(() => {
    setLiveTranscripts((prev) => {
      const next = !prev;
      localStorage.setItem(OSCE_STORAGE_KEYS.liveTranscripts, String(next));
      return next;
    });
  }, []);

  // On mount: try to pull the saved key from the cloud DB so the user doesn't
  // have to re-enter it on a new device.
  React.useEffect(() => {
    syncAiFormFromCloud((next) => {
      setSaved(next);
      setDraft(next);
      setCloudSynced(true);
    });
  }, []);

  const isDirty = React.useMemo(
    () => draft.apiKey !== saved.apiKey || draft.model !== saved.model || draft.maxWait !== saved.maxWait,
    [draft, saved],
  );

  const setField = <K extends keyof AiFormState>(key: K, value: AiFormState[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  const handleSave = () => {
    const errs = validateAiForm(draft, t);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    saveAiForm(draft);
    setSaved(draft);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
    // Async-push to cloud DB (best-effort)
    syncAiFormToCloud(draft).then(() => setCloudSynced(true));
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
    // Also clear the cloud copy
    (async () => {
      try {
        const { cloudEnabled } = await import("@/lib/osler/cloud");
        if (await cloudEnabled()) {
          const { geminiApi } = await import("@/components/osler/admin/admin-api");
          await geminiApi.clear();
        }
      } catch {}
    })();
  };

  const handleTestKey = async () => {
    if (!draft.apiKey.trim()) {
      setTestResult(t("settings.ai.noKeyEntered"));
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
        setTestResult(t("settings.ai.keyValid", { n: data.models.length }));
      } else {
        setTestResult(t("settings.ai.unexpectedResponse"));
      }
    } catch {
      setTestResult(t("settings.ai.connectionFailed"));
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
        {cloudSynced && (
          <span className="ml-2 inline-flex items-center gap-1 text-success">
            <Cloud className="size-3" /> {t("settings.ai.savedToAccount")}
          </span>
        )}
      </p>

      <div className="space-y-4">
        {/* API Key */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
            <span>{t("settings.ai.apiKey")}</span>
            {draft.apiKey !== saved.apiKey && (
              <span className="text-[10px] text-warning font-normal">{t("settings.ai.unsaved")}</span>
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
          <p className={cn("text-xs", testResult.startsWith("✓") ? "text-success" : "text-destructive")}>
            {testResult}
          </p>
        )}

        {/* ── OSCE Voice Settings ── */}
        <div className="pt-4 border-t border-border">
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
                  <option value="0.5">{t("settings.ai.ttsRate.slow")}</option>
                  <option value="0.75">{t("settings.ai.ttsRate.slowPlus")}</option>
                  <option value="0.95">{t("settings.ai.ttsRate.normal")}</option>
                  <option value="1.2">{t("settings.ai.ttsRate.fast")}</option>
                  <option value="1.5">{t("settings.ai.ttsRate.fastest")}</option>
                </select>
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.ai.ttsRateDesc")}
                </p>
              </div>
            </div>

            {/* Live transcripts opt-in (default off) */}
            <div className="flex items-start justify-between gap-3 pt-3 mt-1 border-t border-border/60">
              <div className="min-w-0 space-y-1">
                <div className="text-xs font-semibold text-foreground">{t("settings.ai.liveTranscripts")}</div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {t("settings.ai.liveTranscriptsDesc")}
                </p>
              </div>
              <ToggleSwitch
                checked={liveTranscripts}
                onChange={toggleLiveTranscripts}
                label={t("settings.ai.liveTranscripts")}
              />
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
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