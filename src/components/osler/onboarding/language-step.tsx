"use client";

import { Check, Globe } from "lucide-react";

import { useI18n } from "@/components/osler/i18n-provider";
import { LANGUAGES, UI_LANGS, type ContentLangFilter, type StringKey, type UiLang } from "@/lib/osler/i18n";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";

export function LanguageStep() {
  const { t, lang, setLang, contentFilter, setContentFilter } = useI18n();

  // Content-filter options derived from LANGUAGES, mirroring
  // settings/language-section.tsx (per-language override key with a generic
  // fallback when the override is absent).
  const contentFilterOptions: Array<{ id: ContentLangFilter; label: string }> = [
    { id: "all", label: t("settings.language.contentLangAll") },
    ...UI_LANGS.map((code) => {
      const overrideKey = `settings.language.contentLang${code.toUpperCase().slice(0, 1)}${code.slice(1)}` as StringKey;
      const generic = t("settings.language.contentLangOnly", { name: LANGUAGES[code].name });
      const override = t(overrideKey);
      return { id: code, label: override === overrideKey ? generic : override };
    }),
  ];

  return (
    <div>
      <h2 className="text-lg font-bold tracking-tight">{t("onboarding.language.title")}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-5">{t("onboarding.language.subtitle")}</p>

      <label className="text-xs font-semibold text-muted-foreground">
        {t("settings.language.uiLang")}
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
        {UI_LANGS.map((code) => {
          const active = lang === code;
          const native = LANGUAGES[code].nativeName;
          return (
            <button
              key={code}
              onClick={() => {
                haptic("light");
                setLang(code);
              }}
              className={cn(
                "text-start p-3 rounded-lg border-2 transition-all flex items-center gap-3",
                active ? "border-primary bg-primary/5" : "border-border bg-background hover:border-primary/40",
              )}
            >
              <div
                className={cn(
                  "size-9 rounded-full flex items-center justify-center shrink-0",
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {/* First letter for non-Latin scripts, globe for Latin ones —
                    same heuristic as the language settings section. */}
                {/^[\u0000-\u007F]+$/.test(native)
                  ? <Globe className="size-4" />
                  : <span className="text-sm font-bold">{native.charAt(0)}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">{LANGUAGES[code].name}</div>
                <div className="text-xs text-muted-foreground" dir={LANGUAGES[code].dir} lang={code}>
                  {native}
                </div>
              </div>
              {active && <Check className="size-4 text-primary shrink-0" />}
            </button>
          );
        })}
      </div>

      <label className="text-xs font-semibold text-muted-foreground block mt-5">
        {t("settings.language.contentLang")}
      </label>
      <p className="text-xs text-muted-foreground mt-1 mb-2">
        {t("settings.language.contentLangDesc")}
      </p>
      <div className="flex flex-wrap gap-2">
        {contentFilterOptions.map((opt) => {
          const active = contentFilter === opt.id;
          const langDir = opt.id === "all" ? undefined : LANGUAGES[opt.id as UiLang]?.dir;
          const isRtl = langDir === "rtl";
          return (
            <button
              key={opt.id}
              onClick={() => {
                haptic("light");
                setContentFilter(opt.id);
              }}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-primary/40",
                isRtl && !active && "osler-content-ar",
              )}
              dir={isRtl ? "rtl" : undefined}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
