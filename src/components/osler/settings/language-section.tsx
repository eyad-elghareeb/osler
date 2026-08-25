"use client";

import * as React from "react";
import { Sparkles, Check, Globe, Languages } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/components/osler/i18n-provider";
import { LANGUAGES, UI_LANGS, type UiLang, type ContentLangFilter, type StringKey } from "@/lib/osler/i18n";
import { cn } from "@/lib/utils";
export function LanguageSettingsSection() {
  const { t, lang, setLang, contentFilter, setContentFilter, rtl } = useI18n();

  const uiLangOptions: Array<{ id: UiLang; label: string; native: string; dir: "ltr" | "rtl" }> = UI_LANGS.map(
    (code) => ({
      id: code,
      label: LANGUAGES[code].name,
      native: LANGUAGES[code].nativeName,
      dir: LANGUAGES[code].dir,
    }),
  );

  // Content-language filter options are derived entirely from `LANGUAGES`
  // so adding a new language is a one-file edit (languages.ts). The label
  // falls back to a generic `contentLangOnly` template keyed by the
  // language's English name, with a per-language override key
  // (`contentLangEn`, `contentLangAr`, …) when it exists.
  const contentFilterOptions: Array<{ id: ContentLangFilter; label: string }> = [
    { id: "all", label: t("settings.language.contentLangAll") },
    ...UI_LANGS.map((code) => {
      // Build the per-language override key (e.g. "en" → "contentLangEn").
      // If the override exists in the i18n table, use it; otherwise fall
      // back to the generic `contentLangOnly` template with the language's
      // English name interpolated.
      const overrideKey = `settings.language.contentLang${code.toUpperCase().slice(0, 1)}${code.slice(1)}` as StringKey;
      const generic = t("settings.language.contentLangOnly", { name: LANGUAGES[code].name });
      const override = t(overrideKey);
      return { id: code, label: override === overrideKey ? generic : override };
    }),
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
                    {/* Show the first letter of the native name for non-Latin
                     * scripts; use a globe icon for Latin-script languages. */}
                    {/^[\u0000-\u007F]+$/.test(opt.native)
                      ? <Globe className="size-4" />
                      : <span className="text-sm font-bold">{opt.native.charAt(0)}</span>}
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
              // Look up the language direction for RTL pills. `opt.id` is
              // either "all" (no dir) or a UiLang code.
              const langDir = opt.id === "all" ? undefined : LANGUAGES[opt.id as UiLang]?.dir;
              const isRtl = langDir === "rtl";
              return (
                <button
                  key={opt.id}
                  onClick={() => setContentFilter(opt.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40",
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

        {/* RTL note */}
        <div className="mt-6 p-3 rounded-lg bg-muted/30 border border-border flex items-start gap-2 text-xs text-muted-foreground">
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