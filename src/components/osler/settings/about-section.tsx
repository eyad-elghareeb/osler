"use client";

import * as React from "react";
import { Github, Info, ExternalLink, Palette, Puzzle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AnimatedDisclosure } from "@/components/osler/ui-primitives";
import { useI18n } from "@/components/osler/i18n-provider";
import { getConfig, getGithubRepo, getSiteName, getSiteTagline } from "@/lib/osler/config";
import { ENGINE_PLUGIN_IDS } from "@/lib/osler/config";
import { useOslerTheme } from "@/components/osler/theme-provider";
export function AboutSettingsSection() {
  const { t } = useI18n();
  const { availableThemes, theme: activeTheme } = useOslerTheme();
  const cfg = React.useMemo(() => getConfig(), []);
  const repo = getGithubRepo();

  const enabledPlugins = ENGINE_PLUGIN_IDS.filter((id) => cfg.engines[id]?.enabled ?? true);
  const disabledPlugins = ENGINE_PLUGIN_IDS.filter((id) => !(cfg.engines[id]?.enabled ?? true));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Info className="size-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold">{t("settings.section.about")}</h2>
          <p className="text-xs text-muted-foreground">{t("settings.about.subtitle")}</p>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("settings.about.siteIdentity")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">{t("settings.about.name")}</div>
            <div className="font-medium">{getSiteName()}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">{t("settings.about.tagline")}</div>
            <div className="font-medium">{getSiteTagline()}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">{t("settings.about.shortName")}</div>
            <div className="font-medium">{cfg.site.shortName}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">{t("settings.about.organisation")}</div>
            <div className="font-medium">{cfg.site.organisation || "—"}</div>
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Palette className="size-3.5" />
          {t("settings.about.themes")}
        </div>
        <div className="text-xs text-muted-foreground">
          {t("settings.about.activeTheme", { name: availableThemes.find((x) => x.id === activeTheme)?.name ?? activeTheme })}
        </div>
        <div className="text-xs text-muted-foreground">
          {t("settings.about.themesCount", { n: availableThemes.length })}
        </div>
      </Card>

      <AnimatedDisclosure
        label={t("settings.about.plugins")}
        icon={Puzzle}
        defaultOpen
        actions={
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-border bg-muted/40 text-muted-foreground">
            {t("settings.about.adminControlled")}
          </span>
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {enabledPlugins.map((id) => (
            <span key={id} className="text-xs px-2 py-1 rounded-full border border-primary/30 bg-primary-soft text-primary">
              {id}
            </span>
          ))}
        </div>
        {disabledPlugins.length > 0 && (
          <div className="text-xs text-muted-foreground mt-2">
            {t("settings.about.disabled", { n: disabledPlugins.length })}: {disabledPlugins.join(", ")}
          </div>
        )}
        <div className="text-xs text-muted-foreground mt-2">
          {t("settings.about.pluginsNote")}
        </div>
      </AnimatedDisclosure>

      <AnimatedDisclosure
        label={t("settings.about.github")}
        icon={Github}
      >
        <a
          href={repo}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          {repo}
          <ExternalLink className="size-3" />
        </a>
        <div className="text-xs text-muted-foreground mt-2">
          {t("settings.about.githubDesc")}
        </div>
      </AnimatedDisclosure>

      <Card className="p-4">
        <div className="text-xs text-muted-foreground">
          {t("settings.about.configPath", { path: "/osler.config.json" })}
        </div>
      </Card>
    </div>
  );
}

/* ─── Account & Security section ─────────────────────────────────────── */