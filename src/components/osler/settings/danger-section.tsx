"use client";

import * as React from "react";
import { Trash2, AlertTriangle, GraduationCap, Timer, BookOpen, Compass, Stethoscope, Layers, House, Eraser, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { storage } from "@/lib/osler/storage";
import { clearWalkthroughCompleted, type TourId } from "@/components/osler/walkthrough";
import { useOslerRouter } from "@/lib/osler/navigation";
import { haptic } from "@/lib/osler/native";
import { useI18n } from "@/components/osler/i18n-provider";

const GUIDE_REPLAYS: Array<{ tour: TourId; view: "dashboard" | "qbank" | "library" | "osce" | "flashcards"; icon: typeof GraduationCap; titleKey: "settings.guides.dashboard" | "settings.guides.qbank" | "settings.guides.session" | "settings.guides.library" | "settings.guides.osce" | "settings.guides.flashcards"; subKey: "settings.guides.dashboardSub" | "settings.guides.qbankSub" | "settings.guides.sessionSub" | "settings.guides.librarySub" | "settings.guides.osceSub" | "settings.guides.flashcardsSub" }> = [
  { tour: "dashboard", view: "dashboard", icon: House, titleKey: "settings.guides.dashboard", subKey: "settings.guides.dashboardSub" },
  { tour: "qbank-hub", view: "qbank", icon: GraduationCap, titleKey: "settings.guides.qbank", subKey: "settings.guides.qbankSub" },
  { tour: "qbank-session", view: "qbank", icon: Timer, titleKey: "settings.guides.session", subKey: "settings.guides.sessionSub" },
  { tour: "library", view: "library", icon: BookOpen, titleKey: "settings.guides.library", subKey: "settings.guides.librarySub" },
  { tour: "flashcards", view: "flashcards", icon: Layers, titleKey: "settings.guides.flashcards", subKey: "settings.guides.flashcardsSub" },
  { tour: "osce", view: "osce", icon: Stethoscope, titleKey: "settings.guides.osce", subKey: "settings.guides.osceSub" },
];
export function DangerZoneSection() {
  const { t } = useI18n();
  const { navigate } = useOslerRouter();
  const [progressCount, setProgressCount] = React.useState(0);
  const [confirmClear, setConfirmClear] = React.useState(false);
  // Full-reset flow: typed-confirmation gate + busy state so a reload
  // after deletion shows the cleared state immediately.
  const [confirmResetAll, setConfirmResetAll] = React.useState(false);
  const [resetAllText, setResetAllText] = React.useState("");
  const [resetting, setResetting] = React.useState(false);
  const [resetError, setResetError] = React.useState("");

  React.useEffect(() => {
    const update = () => setProgressCount(storage.allProgress().length);
    update();
    const unsub = storage.subscribe(update);
    const unsubHydrated = storage.onHydrated(update);
    return () => {
      unsub();
      unsubHydrated();
    };
  }, []);

  const handleClearProgress = () => {
    if (typeof window !== "undefined") {
      storage.clearAll();
      setProgressCount(0);
      setConfirmClear(false);
    }
  };

  const handleResetAll = async () => {
    if (resetAllText !== "RESET") return;
    setResetting(true);
    setResetError("");
    haptic("warning");
    try {
      await storage.resetAll();
      haptic("success");
      // Hard reload so every store + cache rebuilds from empty IDB. The
      // session mirror is preserved so the user stays signed in.
      window.location.reload();
    } catch (err) {
      setResetting(false);
      setResetError(t("settings.danger.resetAllFailed", { error: (err as Error).message }));
      haptic("error");
    }
  };

  return (
    <>
    {/* Guides live here now that the per-view compass buttons are gone:
        replay any interactive tour on demand. Clearing the completion flag
        makes the tour auto-open the next time its view mounts. */}
    <Card className="p-5 mb-4">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
        <Compass className="size-4 text-primary" />
        {t("settings.guides.title")}
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        {t("settings.guides.subtitle")}
      </p>
      <div className="space-y-2">
        {GUIDE_REPLAYS.map((g) => {
          const Icon = g.icon;
          return (
            <div key={g.tour} className="bg-card border border-border rounded-lg p-3 flex items-center gap-3">
              <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
                <Icon className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{t(g.titleKey)}</div>
                <div className="text-xs text-muted-foreground">{t(g.subKey)}</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  haptic("selection");
                  clearWalkthroughCompleted(g.tour);
                  navigate(g.view);
                }}
              >
                {t("settings.guides.replay")}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
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

      {/* Hard reset — wipes every local store and bookmark. Distinct from
          "clear all progress" which only tombstones question records so
          the deletion propagates to other devices. */}
      <div className="mt-6 pt-4 border-t border-border/60">
        <div className="bg-destructive/5 border border-destructive/30 rounded-lg p-4 mb-3">
          <div className="flex items-start gap-3">
            <Eraser className="size-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-destructive">{t("settings.danger.resetAll")}</div>
              <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {t("settings.danger.resetAllSub")}
              </div>
            </div>
          </div>
        </div>

        {!confirmResetAll ? (
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={() => setConfirmResetAll(true)}
          >
            <Eraser className="size-3.5 me-1.5" />
            {t("settings.danger.resetAllButton")}
          </Button>
        ) : (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">
              {t("settings.danger.resetAllConfirm")}
            </label>
            <input
              type="text"
              value={resetAllText}
              onChange={(e) => setResetAllText(e.target.value)}
              placeholder="RESET"
              autoFocus
              className="w-full h-9 px-3 bg-background border border-destructive/40 rounded-md text-sm outline-none focus:border-destructive font-[var(--font-code)]"
            />
            {resetError && (
              <p className="text-xs text-destructive">{resetError}</p>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                onClick={handleResetAll}
                disabled={resetAllText !== "RESET" || resetting}
              >
                {resetting ? (
                  <Loader2 className="size-3.5 me-1.5 animate-spin" />
                ) : (
                  <Eraser className="size-3.5 me-1.5" />
                )}
                {t("settings.danger.resetAllButton")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setConfirmResetAll(false);
                  setResetAllText("");
                  setResetError("");
                }}
                disabled={resetting}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
    </>
  );
}

/* ─── About section (site identity, plugins, themes, GitHub repo) ──── */

/**
 * AboutSettingsSection — surfaces the osler.config-driven site identity, the
 * enabled engine plugins, the available themes, and the canonical GitHub repo
 * link. Always present, even if the user hasn't customised anything — the
 * GitHub repo link is mandatory per the project policy.
 */