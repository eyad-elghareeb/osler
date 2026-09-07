"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Cloud, CloudDownload, CloudUpload, GitMerge, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOslerSession, type ConflictResolution, type PendingConflict } from "@/lib/osler/session-context";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";

/**
 * AccountConflictDialog — surfaces when the session context detects that a
 *  fresh cloud session was established on a device that already holds
 *  non-trivial local data (guest-upgrade or account-switch). The user picks
 *  one of three resolutions:
 *
 *  - Keep this device's data  → push local to cloud, leave cloud empty of
 *    anything that wasn't already here.
 *  - Keep cloud's data         → wipe local (preserving the live session),
 *    pull everything from cloud.
 *  - Merge                     → same pull-then-push the sync loop does,
 *    executed inline so it works even when cloud sync is opt-in and off.
 *
 *  The dialog is mounted at the ROOT layout (sibling of RouteGuard, inside
 *  OslerSessionProvider) so it renders above /login too — a guest who
 *  registers sees the prompt before the redirect fires.
 */
export function AccountConflictDialog() {
  const { pendingConflict, conflictResolving, resolveConflict } = useOslerSession();
  const { t } = useI18n();
  const [busy, setBusy] = React.useState<ConflictResolution | null>(null);
  const [error, setError] = React.useState("");

  const handleResolve = React.useCallback(
    async (resolution: ConflictResolution) => {
      // Honour the authoritative state from session-context — a stale local
      // `busy` would re-enable buttons while a different effect (or the
      // session-refreshed listener) is mid-flight.
      if (busy || conflictResolving) return;
      setError("");
      setBusy(resolution);
      try {
        await resolveConflict(resolution);
        haptic("success");
      } catch (err) {
        setError((err as Error).message || t("conflict.errorGeneric"));
        haptic("error");
      } finally {
        setBusy(null);
      }
    },
    [busy, conflictResolving, resolveConflict, t]
  );

  return (
    <AnimatePresence>
      {pendingConflict && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 safe-pt safe-pb"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            className="bg-card border border-border rounded-xl p-6 max-w-lg w-full shadow-e4 space-y-4 max-h-[90vh] overflow-y-auto osler-scroll"
            role="dialog"
            aria-labelledby="account-conflict-title"
          >
            <div className="flex items-start gap-3">
              <div className="size-10 rounded-lg flex items-center justify-center shrink-0 bg-warning/15 text-warning">
                <AlertTriangle className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 id="account-conflict-title" className="text-base font-semibold">
                  {t("conflict.title")}
                </h2>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {t("conflict.body")}
                </p>
              </div>
            </div>

            <SummaryGrid summary={pendingConflict.local} title={t("conflict.localTitle")} icon={CloudUpload} />
            <SummaryGrid summary={pendingConflict.remote} title={t("conflict.cloudTitle")} icon={CloudDownload} />

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}

            <div className="grid gap-2">
              <ChoiceButton
                onClick={() => handleResolve("keep-local")}
                busy={busy}
                externallyBusy={conflictResolving}
                icon={CloudUpload}
                title={t("conflict.keepLocalTitle")}
                description={t("conflict.keepLocalDesc")}
                tone="primary"
              />
              <ChoiceButton
                onClick={() => handleResolve("keep-cloud")}
                busy={busy}
                externallyBusy={conflictResolving}
                icon={CloudDownload}
                title={t("conflict.keepCloudTitle")}
                description={t("conflict.keepCloudDesc")}
                tone="default"
              />
              <ChoiceButton
                onClick={() => handleResolve("merge")}
                busy={busy}
                externallyBusy={conflictResolving}
                icon={GitMerge}
                title={t("conflict.mergeTitle")}
                description={t("conflict.mergeDesc")}
                tone="ghost"
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SummaryGrid({
  summary,
  title,
  icon: Icon,
}: {
  summary: PendingConflict["local"];
  title: string;
  icon: typeof Cloud;
}) {
  const { t } = useI18n();
  const rows: Array<{ key: string; value: string }> = [
    { key: t("conflict.kindQbank"), value: summary.qbank.count.toString() },
    { key: t("conflict.kindFlashcards"), value: summary.flashcards.count.toString() },
    { key: t("conflict.kindSessions"), value: summary.sessions.count.toString() },
    { key: t("conflict.kindNotes"), value: summary.notes.count.toString() },
    { key: t("conflict.kindHighlights"), value: summary.articleHighlights.count.toString() },
    { key: t("conflict.kindAchievements"), value: summary.achievements.count.toString() },
  ];
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col">
            <dt className="text-muted-foreground truncate">{row.key}</dt>
            <dd className="font-semibold tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ChoiceButton({
  onClick,
  busy,
  externallyBusy,
  icon: Icon,
  title,
  description,
  tone,
}: {
  onClick: () => void;
  busy: ConflictResolution | null;
  externallyBusy: boolean;
  icon: typeof Cloud;
  title: string;
  description: string;
  tone: "primary" | "default" | "ghost";
}) {
  const cls = {
    primary: "border-primary/40 bg-primary/5 hover:bg-primary/10 text-foreground",
    default: "border-border bg-card hover:bg-muted/40 text-foreground",
    ghost: "border-border bg-transparent hover:bg-muted/40 text-muted-foreground",
  }[tone];
  const isBusy = busy !== null || externallyBusy;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isBusy}
      className={cn(
        "flex items-start gap-3 w-full p-3 rounded-lg border text-start transition-colors",
        cls,
        isBusy && "opacity-50 cursor-not-allowed"
      )}
    >
      <div className="size-9 rounded-lg bg-background/60 border border-border flex items-center justify-center shrink-0 mt-0.5">
        {isBusy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">
          {description}
        </div>
      </div>
    </button>
  );
}
