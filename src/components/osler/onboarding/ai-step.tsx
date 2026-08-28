"use client";

import * as React from "react";
import {
  AudioLines,
  Check,
  ExternalLink,
  KeyRound,
  Loader2,
  MessageCircleQuestion,
  MessagesSquare,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";

// Same storage key + validation as settings/ai-section.tsx and
// ai-assistant.tsx — the key saved here is picked up everywhere.
const API_KEY_STORAGE = "osler_gemini_api_key";
const KEY_PATTERN = /^[A-Za-z0-9_\-.]{20,}$/;

const FEATURES = [
  { icon: MessageCircleQuestion, key: "onboarding.ai.featQbank" },
  { icon: MessagesSquare, key: "onboarding.ai.featAsk" },
  { icon: AudioLines, key: "onboarding.ai.featOsce" },
] as const;

export function AiStep() {
  const { t } = useI18n();
  const [key, setKey] = React.useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(API_KEY_STORAGE) || "" : "",
  );
  const [saved, setSaved] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<string | null>(null);

  const save = () => {
    const trimmed = key.trim();
    if (!trimmed || saved) return;
    if (!KEY_PATTERN.test(trimmed)) {
      setInvalid(true);
      return;
    }
    try {
      localStorage.setItem(API_KEY_STORAGE, trimmed);
      setSaved(true);
      setInvalid(false);
      haptic("success");
    } catch {
      // private mode — key just won't persist
    }
  };

  const testKey = async () => {
    if (!key.trim()) {
      setTestResult(t("settings.ai.noKeyEntered"));
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": key.trim() },
      });
      const data = await res.json();
      setTestResult(
        data?.models?.length
          ? t("settings.ai.keyValid", { n: data.models.length })
          : t("settings.ai.unexpectedResponse"),
      );
    } catch {
      setTestResult(t("settings.ai.connectionFailed"));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-bold tracking-tight">{t("onboarding.ai.title")}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">{t("onboarding.ai.subtitle")}</p>

      <div className="space-y-2 mb-5">
        {FEATURES.map(({ icon: Icon, key: featureKey }) => (
          <div key={featureKey} className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="size-7 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Icon className="size-3.5" />
            </span>
            <span>{t(featureKey)}</span>
          </div>
        ))}
      </div>

      <label htmlFor="onboarding-api-key" className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <KeyRound className="size-3.5" />
          {t("settings.ai.apiKey")}
        </span>
        {saved && (
          <span className="flex items-center gap-1 text-success font-normal">
            <Check className="size-3" />
            {t("onboarding.ai.saved")}
          </span>
        )}
      </label>
      <input
        id="onboarding-api-key"
        type="password"
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
          setSaved(false);
          setInvalid(false);
          setTestResult(null);
        }}
        onBlur={save}
        placeholder={t("settings.ai.apiKeyPlaceholder")}
        autoComplete="off"
        className={cn(
          "mt-1.5 w-full h-10 px-3 bg-background border rounded-md text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20",
          invalid ? "border-destructive focus:border-destructive" : "border-border-strong focus:border-primary",
        )}
      />
      {invalid ? (
        <p className="text-[11px] text-destructive mt-1">{t("settings.ai.keyLengthError")}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground mt-1">
          {t("settings.ai.getKey")}{" "}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 inline-flex items-center gap-0.5"
          >
            {t("onboarding.ai.aiStudio")}
            <ExternalLink className="size-3" />
          </a>
        </p>
      )}

      <div className="flex items-center gap-2 mt-3">
        <Button type="button" variant="secondary" size="sm" onClick={testKey} disabled={testing} className="h-8 text-xs">
          {testing ? <Loader2 className="size-3 animate-spin" /> : null}
          {t("settings.ai.testConnection")}
        </Button>
        <span className="text-[11px] text-muted-foreground">{t("onboarding.ai.optional")}</span>
      </div>
      {testResult && (
        <p className={cn("text-xs mt-1.5", testResult.startsWith("✓") ? "text-success" : "text-destructive")}>
          {testResult}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground mt-4 pt-3 border-t border-border">
        {t("onboarding.ai.manage")}
      </p>
    </div>
  );
}
