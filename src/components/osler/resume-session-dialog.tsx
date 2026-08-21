"use client";

import * as React from "react";
import {
  RotateCcw,
  Trash2,
  Clock,
} from "lucide-react";
import { sessions, storage } from "@/lib/osler/storage";
import { haptic } from "@/lib/osler/native";
import { useOslerRouter } from "@/lib/osler/navigation";
import { useI18n } from "./i18n-provider";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { EngineType } from "@/lib/osler/types";

/**
 * Resume-session dialog — shared between the Dashboard's "Continue learning"
 * card (click-to-open) and the AppShell auto-pop on non-dashboard pages.
 *
 * Why this exists as a separate module:
 *   - The dashboard used to own the only instance and auto-popped on mount.
 *     That meant a saved-and-exited session was invisible everywhere else,
 *     and the dismiss/discard/continue buttons were wired only there.
 *   - This module exposes:
 *       • `useActiveSession()`         — reactive active-session reader
 *       • `ResumeSessionDialog`        — controlled dialog (Resume/Dismiss/Discard)
 *       • `AutoResumeSessionDialog`    — auto-pop wrapper for non-dashboard pages
 *
 * Behavior:
 *   - Resume    → navigates to /qbank?resume=1 (does NOT mark as dismissed,
 *     so if the resume fails the user can still see the prompt again).
 *   - Dismiss   → closes the dialog, remembers this sessionId so it won't
 *     auto-pop again until the active session changes. Does NOT clear the
 *     session — the user can still resume from the Tracker or Dashboard card.
 *   - Discard   → clears the active session from IDB. Permanent.
 */

export interface ActiveSessionInfo {
  itemTitle: string;
  engine: EngineType;
  current: number;
  total: number;
  startedAt: number;
  mode: string;
  sessionId?: string;
}

/**
 * Validate + normalize a raw active-session record into a UI-safe shape.
 * Returns null if the record is missing, completed, a review replay, stale
 * (>7 days), or has no questions — same rules as the Tracker's "In progress"
 * panel so the dialog and the tracker stay in sync.
 */
function toActiveInfo(raw: unknown): ActiveSessionInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.completedAt || r.isReview) return null;
  if (typeof r.itemTitle !== "string" || !r.itemTitle) return null;
  if (typeof r.engine !== "string") return null;
  if (typeof r.current !== "number") return null;
  if (!Array.isArray(r.questions) || r.questions.length === 0) return null;
  const startedAt = typeof r.startedAt === "number" ? r.startedAt : 0;
  if (Date.now() - startedAt > 7 * 24 * 60 * 60 * 1000) return null;
  return {
    itemTitle: r.itemTitle,
    engine: r.engine as EngineType,
    current: r.current,
    total: (r.questions as unknown[]).length,
    startedAt,
    mode: typeof r.mode === "string" ? r.mode : "tutor",
    sessionId: typeof r.sessionId === "string" ? r.sessionId : undefined,
  };
}

/**
 * Module-level set of sessionIds the user has dismissed (without discarding)
 * during this page load. Prevents the auto-pop from re-appearing when the
 * user navigates between non-dashboard pages after dismissing the same
 * active session. Cleared implicitly on a full page reload.
 */
const dismissedSessionIds = new Set<string>();

/**
 * Mark a session as "seen and dismissed" so the auto-pop dialog won't
 * reappear for it. Used by QBank's "Save & exit" to suppress the auto-pop
 * on the immediately-following /qbank navigation — the user just chose to
 * leave the session, so prompting them to resume it would be annoying.
 * The session itself is NOT cleared; the user can still resume from the
 * dashboard card or the tracker's "In progress" panel.
 */
export function markSessionDismissed(sessionId: string | undefined) {
  if (sessionId) dismissedSessionIds.add(sessionId);
}

/**
 * Check whether a session has been dismissed (via "Save & exit" or the
 * Dismiss button) during this page load. Used by the QBank restore effect
 * to decide whether to auto-restore on /qbank: a dismissed session should
 * NOT auto-restore (the user chose to leave), but a non-dismissed session
 * SHOULD (the user navigated away mid-quiz and came back).
 */
export function isSessionDismissed(sessionId: string | undefined): boolean {
  return !!sessionId && dismissedSessionIds.has(sessionId);
}

/**
 * Clear the dismissed flag for a session. Called when a session is
 * successfully resumed — the user is back in the quiz, so if they navigate
 * away again the auto-pop SHOULD fire to remind them (they didn't dismiss
 * it this time, they just navigated away mid-quiz).
 */
export function clearSessionDismissed(sessionId: string | undefined) {
  if (sessionId) dismissedSessionIds.delete(sessionId);
}

/**
 * Reactively track the active in-progress QBank session.
 * Re-reads on `osler-active-session-changed` (save/clear) and on
 * `osler-hydrated` (initial IDB → memoryCache hydration).
 */
export function useActiveSession(): ActiveSessionInfo | null {
  const [activeSession, setActiveSession] = React.useState<ActiveSessionInfo | null>(null);
  React.useEffect(() => {
    const refresh = () => {
      setActiveSession(toActiveInfo(sessions.getActive()));
    };
    refresh();
    const unsubActive = sessions.subscribeActive(refresh);
    const unsubHydrated = storage.onHydrated(refresh);
    return () => {
      unsubActive();
      unsubHydrated();
    };
  }, []);
  return activeSession;
}

function timeAgoLabel(ts: number, t: (k: string, p?: Record<string, unknown>) => string): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("dash.timeAgo.justNow");
  if (mins < 60) return t("dash.timeAgo.minutes", { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("dash.timeAgo.hours", { n: hrs });
  return t("dash.timeAgo.days", { n: Math.floor(hrs / 24) });
}

interface ResumeSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Controlled resume-session dialog. The parent decides when to open it
 * (Dashboard card click or the AutoResumeSessionDialog wrapper).
 */
export function ResumeSessionDialog({ open, onOpenChange }: ResumeSessionDialogProps) {
  const { t } = useI18n();
  const { navigate } = useOslerRouter();
  const activeSession = useActiveSession();

  // Distinguish a user-initiated dismissal (Dismiss button / overlay / Esc)
  // from a programmatic close after Resume or Discard. Only true dismissals
  // add the sessionId to the dismissed set, so a failed Resume can still
  // re-prompt the user later.
  const closingFromActionRef = React.useRef(false);
  const activeSessionId = activeSession?.sessionId;

  const handleDiscard = React.useCallback(() => {
    haptic("warning");
    sessions.clearActive();
    closingFromActionRef.current = true;
    onOpenChange(false);
  }, [onOpenChange]);

  const handleResume = React.useCallback(() => {
    closingFromActionRef.current = true;
    onOpenChange(false);
    navigate("qbank", { resume: true });
  }, [navigate, onOpenChange]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!next && !closingFromActionRef.current) {
        // User dismissed without taking action — remember this sessionId so
        // the auto-pop doesn't reappear on the next non-dashboard page.
        if (activeSessionId) {
          dismissedSessionIds.add(activeSessionId);
        }
      }
      closingFromActionRef.current = false;
      onOpenChange(next);
    },
    [activeSessionId, onOpenChange],
  );

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <RotateCcw className="size-5 text-primary" />
            {t("dash.resumeSession")}
          </AlertDialogTitle>
          {/* Meta lives OUTSIDE AlertDialogDescription (a <p>) — block
              elements nested inside it caused hydration errors. */}
          {activeSession && (
            <div className="space-y-2 mt-2 text-start">
              <div className="text-sm text-foreground font-medium">{activeSession.itemTitle}</div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span>
                  {t("dash.sessionProgress", {
                    n: activeSession.current + 1,
                    total: activeSession.total,
                  })}
                </span>
                <span aria-hidden>·</span>
                <span className="capitalize">{activeSession.mode}</span>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {timeAgoLabel(activeSession.startedAt, t as (k: string, p?: Record<string, unknown>) => string)}
                </span>
              </div>
            </div>
          )}
          <AlertDialogDescription>
            {t("dash.resumePrompt")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive self-start sm:self-auto"
            onClick={handleDiscard}
          >
            <Trash2 className="size-3.5 ms-1.5" />
            {t("dash.discardSession")}
          </Button>
          <div className="flex flex-col-reverse sm:flex-row gap-2">
            <AlertDialogCancel className="text-muted-foreground">
              {t("common.dismiss")}
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button onClick={handleResume}>
                <RotateCcw className="size-3.5 ms-1.5" />
                {t("common.resume")}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Auto-pop wrapper for non-dashboard pages. Opens the dialog automatically
 * when there's an active in-progress session, unless the user has already
 * dismissed this particular session during this page load.
 */
export function AutoResumeSessionDialog() {
  const activeSession = useActiveSession();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!activeSession) {
      setOpen(false);
      return;
    }
    const sid = activeSession.sessionId;
    // Only auto-pop if this session hasn't been dismissed yet. Once
    // dismissed, it stays dismissed until the active session changes
    // (a new session gets a new sessionId, which won't be in the set).
    if (sid && dismissedSessionIds.has(sid)) return;
    setOpen(true);
    // Intentionally only depends on sessionId + startedAt so it doesn't
    // re-pop on every answer (which updates the active record).
  }, [activeSession?.sessionId, activeSession?.startedAt]);

  return <ResumeSessionDialog open={open} onOpenChange={setOpen} />;
}
