"use client";

import * as React from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { storage } from "@/lib/osler/storage";
import { useI18n } from "@/components/osler/i18n-provider";
export function DangerZoneSection() {
  const { t } = useI18n();
  const [progressCount, setProgressCount] = React.useState(0);
  const [confirmClear, setConfirmClear] = React.useState(false);

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

/* ─── About section (site identity, plugins, themes, GitHub repo) ──── */

/**
 * AboutSettingsSection — surfaces the osler.config-driven site identity, the
 * enabled engine plugins, the available themes, and the canonical GitHub repo
 * link. Always present, even if the user hasn't customised anything — the
 * GitHub repo link is mandatory per the project policy.
 */