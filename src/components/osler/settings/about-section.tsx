"use client";

import * as React from "react";
import { Code2, Info, ExternalLink, Palette, Puzzle, ScrollText, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AnimatedDisclosure } from "@/components/osler/ui-primitives";
import { useI18n } from "@/components/osler/i18n-provider";
import { getConfig, getGithubRepo, getSiteName, getSiteTagline } from "@/lib/osler/config";
import { ENGINE_PLUGIN_IDS } from "@/lib/osler/config";
import { useOslerTheme } from "@/components/osler/theme-provider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const TOS_URL = "/docs/terms-of-service.md";
const PRIVACY_URL = "/docs/privacy-policy.md";

export function AboutSettingsSection() {
  const { t } = useI18n();
  const { availableThemes, theme: activeTheme } = useOslerTheme();
  const cfg = React.useMemo(() => getConfig(), []);
  const repo = getGithubRepo();

  const [openDoc, setOpenDoc] = React.useState<"tos" | "privacy" | null>(null);
  const [docContent, setDocContent] = React.useState<string>("");
  const [docLoading, setDocLoading] = React.useState(false);

  const enabledPlugins = ENGINE_PLUGIN_IDS.filter((id) => cfg.engines[id]?.enabled ?? true);
  const disabledPlugins = ENGINE_PLUGIN_IDS.filter((id) => !(cfg.engines[id]?.enabled ?? true));

  const openLegal = async (type: "tos" | "privacy") => {
    setOpenDoc(type);
    setDocLoading(true);
    setDocContent("");
    try {
      const url = type === "tos" ? TOS_URL : PRIVACY_URL;
      const res = await fetch(url);
      if (res.ok) {
        setDocContent(await res.text());
      } else {
        setDocContent(`# ${type === "tos" ? t("legal.tos") : t("legal.privacy")}\n\n_Content unavailable._`);
      }
    } catch {
      setDocContent(`# ${type === "tos" ? t("legal.tos") : t("legal.privacy")}\n\n_Could not load document._`);
    } finally {
      setDocLoading(false);
    }
  };

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
            <div className="text-[11px] uppercase text-muted-foreground">{t("settings.about.name")}</div>
            <div className="font-medium">{getSiteName()}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-muted-foreground">{t("settings.about.tagline")}</div>
            <div className="font-medium">{getSiteTagline()}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-muted-foreground">{t("settings.about.shortName")}</div>
            <div className="font-medium">{cfg.site.shortName}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-muted-foreground">{t("settings.about.organisation")}</div>
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
          <span className="text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-border bg-muted/40 text-muted-foreground">
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
        icon={Code2}
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

      {/* Legal Documents */}
      <Card className="p-4 space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{t("legal.tos")} & {t("legal.privacy")}</div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => openLegal("tos")} className="gap-1.5 text-xs">
            <ScrollText className="size-3.5" />
            {t("legal.openTos")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => openLegal("privacy")} className="gap-1.5 text-xs">
            <ShieldCheck className="size-3.5" />
            {t("legal.openPrivacy")}
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-xs text-muted-foreground">
          {t("settings.about.configPath", { path: "/osler.config.json" })}
        </div>
      </Card>

      {/* Legal document viewer dialog */}
      <Dialog open={openDoc !== null} onOpenChange={(open) => !open && setOpenDoc(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {openDoc === "tos" ? t("legal.tos") : t("legal.privacy")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto text-sm text-foreground/90 leading-relaxed space-y-3 py-2 font-[var(--font-serif)]">
            {docLoading ? (
              <div className="text-center text-muted-foreground py-8 text-sm">{t("common.loading")}</div>
            ) : (
              <pre className="whitespace-pre-wrap text-xs font-[var(--font-code)] text-muted-foreground leading-relaxed">
                {docContent}
              </pre>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDoc(null)}>{t("legal.closeDialog")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Account & Security section ─────────────────────────────────────── */