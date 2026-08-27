"use client";

import * as React from "react";
import { AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { X, Home, ListChecks } from "lucide-react";
import { loadContentByUid, loadNodeByUid, nodeUrls } from "@/lib/osler/content";
import { toast } from "@/hooks/use-toast";
import { contentToQuestions as poolContentToQuestions, filterPoolByProgress, pickQuestions, type PoolQuestion, type OnlyMode } from "@/lib/osler/qbank-pool";
import type { AnyContent, EngineType, ContentTreeNode } from "@/lib/osler/types";
import { storage, sessions, writtenDrafts, quizSettings as quizSettingsStore, type SavedSession, type WrittenDraft, type HighlightItem } from "@/lib/osler/storage";
import { listAllArticles } from "@/lib/osler/articles";
import type { ArticleMeta } from "@/lib/osler/articles";
import { Button, buttonVariants } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  LabValuesSidebar,
  CalculatorModal,
  FloatingArticleModal,
  AiAssistant,
  QuizSettingsPanel,
  NotesPanel,
  SessionStartDialog,
} from "@/components/osler/lazy-tools";
import { useContentCache } from "@/hooks/use-content-cache";
import { useLightbox } from "@/components/osler/lightbox-provider";
import { setImmersiveMode } from "@/components/osler/immersive-mode";
import { haptic } from "@/lib/osler/native";
import { useI18n } from "@/components/osler/i18n-provider";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/osler/ui-primitives";
import type { SessionMode, SessionOrder, SessionStartOptions } from "@/lib/osler/session-options";
import { routeFor, useOslerRouter } from "@/lib/osler/navigation";
import { markSessionDismissed, isSessionDismissed, clearSessionDismissed } from "@/components/osler/resume-session-dialog";
import { queueChoiceStat, flushQuestionStats, type QuestionChoiceStats } from "@/lib/osler/question-stats";
import { useQuestionStats } from "@/hooks/use-question-stats";
import { HomeView } from "./qbank/home-view";
import { ResultsView } from "./qbank/results-view";
import { QuizView } from "./qbank/quiz-view";
import { nodeFromPack, QuizMode, TestMode, HomeTab, SessionData, SessionQuestion, contentToQuestions, archiveDisplacedActive, saveSession } from "./qbank/shared";


interface QBankStudioProps {
  activeItem?: ContentTreeNode | null;
  activeContent?: AnyContent | null;
  onExit?: () => void;
  onOpenPack?: (item: ContentTreeNode) => void;
  /** Arrived via /qbank?resume=1 — restore the active in-progress session
   *  even when a pack uid is present in the URL. */
  forceResume?: boolean;
  /** Self-load a pack by uid (keeps the hub mounted across /qbank → /qbank?uid=X).
   *  When set, the studio loads the pack content itself and feeds it through
   *  the same activeItem/activeContent machinery instead of the page swapping
   *  component types (which unmounted the whole hub and reloaded its data). */
  uid?: string | null;
  /** Arrived via /qbank?review=SESSION_ID — open the saved session in
   *  read-only review mode. The session's questionRefs are rebuilt into a
   *  PoolQuestion[] and pushed through `startCustomSession({ isReview: true })`. */
  reviewSessionId?: string | null;
  /** Arrived via /qbank?retake=SESSION_ID — restart a saved session with
   *  only its previously-wrong questions. Same rebuild path as `reviewSessionId`
   *  but with `onlyMode: "wrong"` and no `isReview` flag. */
  retakeSessionId?: string | null;
}
export function QBankStudio({
  activeItem: activeItemProp,
  activeContent: activeContentProp,
  onExit: propOnExit,
  onOpenPack: propOnOpenPack,
  forceResume = false,
  uid,
  reviewSessionId,
  retakeSessionId,
}: QBankStudioProps = {}) {
  const { navigate } = useOslerRouter();
  const router = useRouter();
  const onExit = propOnExit || (() => navigate("qbank"));
  const onOpenPack = propOnOpenPack || ((item: ContentTreeNode) => navigate("qbank", { uid: item.uid }));

  // Self-load a pack by uid so the studio never unmounts when the URL gains
  // ?uid=X. The page used to swap to a separate pack view (component-type
  // swap = React unmounts the hub + boots a fresh studio, reloading its
  // tree and session state). Keeping the studio mounted with a uid prop
  // preserves the hub, then feeds the loaded pack through the same
  // activeItem/activeContent path below.
  const [selfPack, setSelfPack] = React.useState<{ item: ContentTreeNode; content: AnyContent } | null>(null);
  const [selfPackError, setSelfPackError] = React.useState(false);

  React.useEffect(() => {
    if (!uid || activeItemProp || activeContentProp) {
      setSelfPack(null);
      setSelfPackError(false);
      return;
    }
    let cancelled = false;
    setSelfPack(null);
    setSelfPackError(false);
    loadContentByUid(uid)
      .then(async (loaded) => {
        if (cancelled) return;
        if (loaded.type === "flashcard") {
          router.replace(routeFor("flashcards", { uid }));
          return;
        }
        if (loaded.type === "osce") {
          router.replace(routeFor("osce", { uid }));
          return;
        }
        // Resolve the real manifest node so the pack folder path is
        // available — question/choice/explanation images resolve against
        // `item.path`, and the synthetic nodeFromPack node carries an empty
        // path, which 404s every image in an active session (review mode
        // re-resolves the node, which is why images worked there).
        // loadNodeByUid hits the node cache, so this is usually free.
        let node: ContentTreeNode;
        try {
          node = await loadNodeByUid(uid, loaded.type as EngineType);
        } catch {
          node = nodeFromPack(uid, loaded);
        }
        if (cancelled) return;
        setSelfPack({ item: node, content: loaded });
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to load QBank pack:", e);
        setSelfPackError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid, activeItemProp, activeContentProp, router]);

  const activeItem = activeItemProp ?? selfPack?.item ?? null;
  const activeContent = activeContentProp ?? selfPack?.content ?? null;
  const [mode, setMode] = React.useState<QuizMode>("home");
  const [session, setSession] = React.useState<SessionData | null>(null);
  const [testMode, setTestMode] = React.useState<TestMode>("tutor");
  const [homeTab, setHomeTab] = React.useState<HomeTab>(() => {
    try {
      const stored = sessionStorage.getItem("osler_qbank_initial_tab");
      if (stored === "create" || stored === "tracker" || stored === "content") {
        sessionStorage.removeItem("osler_qbank_initial_tab");
        return stored as HomeTab;
      }
    } catch {}
    return "content";
  });
  const [startDialogOpen, setStartDialogOpen] = React.useState(false);
  const [startPromptUid, setStartPromptUid] = React.useState<string | null>(null);
  const [launchOnlyMode, setLaunchOnlyMode] = React.useState<OnlyMode>("new");
  const [, force] = React.useReducer((x) => x + 1, 0);
  const pendingQuestionLimitRef = React.useRef(0);
  const { t } = useI18n();
  const { openLightbox } = useLightbox();

  // ── Per-question timing (pause-adjusted, idle-aware) ────────────────
  // Each unanswered question gets a timer { start, pausedMs, idleMs } in a
  // ref so re-renders don't disturb it. When the answer is revealed, the
  // elapsed time (minus paused intervals and idle stretches) is stamped onto
  // session.questionTimes and passed through to storage.recordAnswer for the
  // analytics layer.
  const qTimersRef = React.useRef<Record<number, { start: number; pausedMs: number; idleMs: number }>>({});
  const pauseStartRef = React.useRef<number | null>(null);
  // Gaps longer than this with zero pointer/key input don't count toward
  // "active" study time — only the first minute of each gap does, so normal
  // quiet thinking still accrues but an abandoned tab doesn't.
  const IDLE_GAP_MS = 60_000;
  const lastActivityRef = React.useRef<number>(Date.now());

  // Seed a timer whenever we land on a new, unanswered question.
  React.useEffect(() => {
    if (!session) return;
    const idx = session.current;
    if (session.revealed[idx]) return;
    qTimersRef.current[idx] ??= { start: Date.now(), pausedMs: 0, idleMs: 0 };
  }, [session?.current, session?.revealed, session?.isReview]);

  // Track idle stretches so unattended time never counts toward a question.
  // Only timers that already existed when a gap began are discounted.
  React.useEffect(() => {
    const markActivity = () => {
      const now = Date.now();
      const gapStart = lastActivityRef.current;
      const gap = now - gapStart;
      if (gap > IDLE_GAP_MS) {
        for (const timer of Object.values(qTimersRef.current)) {
          if (timer.start <= gapStart) timer.idleMs += gap - IDLE_GAP_MS;
        }
      }
      lastActivityRef.current = now;
    };
    window.addEventListener("pointerdown", markActivity, true);
    window.addEventListener("keydown", markActivity, true);
    return () => {
      window.removeEventListener("pointerdown", markActivity, true);
      window.removeEventListener("keydown", markActivity, true);
    };
  }, []);

  // Track pause intervals so paused time never counts toward a question.
  React.useEffect(() => {
    if (!session) return;
    if (session.examPaused) {
      pauseStartRef.current = Date.now();
    } else if (pauseStartRef.current != null) {
      const paused = Date.now() - pauseStartRef.current;
      const pauseStart = pauseStartRef.current;
      pauseStartRef.current = null;
      // Credit the pause to every timer that already existed when it began,
      // so navigating while paused never misattributes the paused interval to
      // a question that was opened afterwards.
      for (const timer of Object.values(qTimersRef.current)) {
        if (timer.start <= pauseStart) timer.pausedMs += paused;
      }
      // Advance the timed-exam deadline by the paused interval too, so the
      // stored absolute expiry keeps matching the live countdown.
      if (session.timeEndsAt != null) {
        setSession((s) =>
          s && s.timeEndsAt != null ? { ...s, timeEndsAt: s.timeEndsAt + paused } : s
        );
      }
    }
  }, [session?.examPaused]);

  const getQuestionTimeMs = (idx: number): number | undefined => {
    const timer = qTimersRef.current[idx];
    if (!timer) return undefined;
    const elapsed = Date.now() - timer.start - timer.pausedMs;
    return elapsed > 0 ? Math.round(elapsed) : undefined;
  };

  const stampQuestionTime = (idx: number, q: SessionQuestion): number | undefined => {
    const timeMs = getQuestionTimeMs(idx);
    if (timeMs == null) return undefined;
    setSession((s) => (s ? { ...s, questionTimes: { ...s.questionTimes, [q.id]: timeMs } } : s));
    return timeMs;
  };

  // ── Auto-persist active session to IndexedDB ─────────────────────
  // Prevents data loss on hard refresh (Ctrl+Shift+R, Cmd+Shift+R, etc.)
  // Three layers of protection (modeled after MU61S8 reference):
  //   1. Debounced save (500ms) on every session state change
  //   2. Periodic interval save (5s) as a safety net
  //   3. beforeunload handler for immediate save on tab close / refresh
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = React.useRef(session);
  sessionRef.current = session;

  // Track whether this component instance has ever owned a live session.
  // The auto-save effect must NOT clear the active record on initial mount
  // (when `session` starts null) — otherwise a session saved via "Save &
  // exit" or still in-flight from a refresh gets wiped from IDB before the
  // restore effect can pick it up. Only clear when we actually transition
  // out of a session we owned (endSession / exitToHome / discard).
  const hadSessionRef = React.useRef(false);

  // Debounced save on state change
  React.useEffect(() => {
    if (session) {
      hadSessionRef.current = true;
    }
    if (!session || session.isReview || session.completedAt) {
      // "Save & exit" nulls the session on purpose — the active in-progress
      // record was already persisted before the navigation, so don't wipe it.
      if (!session && keepProgressOnExitRef.current) {
        keepProgressOnExitRef.current = false;
        return;
      }
      // Initial-mount guard: if we never owned a session in this component
      // instance, there is nothing to clear — wiping the active record here
      // would destroy a session saved by a previous mount (Save & exit,
      // refresh, or cross-tab resume). Only clear on a real transition out
      // of a live session we controlled.
      if (!session && !hadSessionRef.current) {
        return;
      }
      sessions.clearActive();
      if (!session) hadSessionRef.current = false;
      return;
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      sessions.saveActive(session);
    }, 500);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [session]);

  // Periodic backup save every 5 seconds
  React.useEffect(() => {
    const id = setInterval(() => {
      const s = sessionRef.current;
      if (s && !s.isReview && !s.completedAt) {
        sessions.saveActive(s);
      }
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Force-save on tab close / browser refresh
  React.useEffect(() => {
    const handleBeforeUnload = () => {
      const s = sessionRef.current;
      if (s && !s.isReview && !s.completedAt) {
        sessions.saveActive(s);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Force-save on pagehide too — fires on iOS Safari and bfcache round-trips
  // where `beforeunload` is unreliable or suppressed entirely.
  React.useEffect(() => {
    const handlePageHide = () => {
      const s = sessionRef.current;
      if (s && !s.isReview && !s.completedAt) {
        sessions.saveActive(s);
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, []);

  // Save when tab goes hidden (app switch, tab switch, screen lock)
  React.useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        const s = sessionRef.current;
        if (s && !s.isReview && !s.completedAt) {
          sessions.saveActive(s);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Save on unmount (client-side navigation away from /qbank). The handlers
  // above cover page unload and tab switching, but NONE of them fire on a
  // Next.js router push (e.g. clicking "Dashboard" in the nav while mid-quiz).
  // Without this, the latest answers could be lost if the user navigates
  // away within the 500ms debounce window. The empty dependency array means
  // the cleanup runs only on true unmount, not on every session state change.
  React.useEffect(() => {
    return () => {
      const s = sessionRef.current;
      if (s && !s.isReview && !s.completedAt) {
        sessions.saveActive(s);
      }
    };
  }, []);

  // ── Restore active session from IndexedDB on mount ─────────────────
  // Only restores when no pack is selected via URL (activeItem is null),
  // so the startSession effect for URL packs is never overridden. An
  // explicit /qbank?resume=1 arrival overrides that rule and restores even
  // when a pack uid is present.
  const restoreBlockedRef = React.useRef(false);
  // Set by "Save & exit": the session state is cleared on purpose but the
  // active in-progress record stays in IndexedDB for later resumption.
  const keepProgressOnExitRef = React.useRef(false);

  // Cache lever: when a real pack session (re)starts, quietly ask the service
  // worker to precache the pack's data + images so resume stays snappy and
  // works offline. Custom-built sessions carry a "custom-" id and are skipped.
  const { precache: cachePrecache } = useContentCache();
  const precacheSessionPack = React.useCallback(
    async (itemId?: string, engine?: EngineType) => {
      if (!itemId || itemId.startsWith("custom-")) return;
      try {
        const node = await loadNodeByUid(itemId, engine);
        const urls = nodeUrls(node);
        if (urls.length > 0) cachePrecache(itemId, urls);
      } catch {
        // Non-fatal — the session still resumes from IndexedDB regardless.
      }
    },
    [cachePrecache],
  );

  // Restore an unfinished active session in place (shared by the mount
  // restore effect and the in-progress Resume actions in Tracker/Home).
  const resumeActiveSession = React.useCallback((saved?: SessionData | null) => {
    const candidate = saved ?? (sessions.getActive() as SessionData | null);
    if (
      candidate &&
      candidate.sessionId &&
      !candidate.completedAt &&
      !candidate.isReview &&
      Array.isArray(candidate.questions) &&
      candidate.questions.length > 0 &&
      Date.now() - (candidate.startedAt ?? 0) < 7 * 24 * 60 * 60 * 1000
    ) {
      restoreBlockedRef.current = true;
      keepProgressOnExitRef.current = false;
      // Clear the dismissed flag — the user is back in the quiz, so if they
      // navigate away again the auto-pop SHOULD fire (they didn't dismiss
      // it this time, they just left mid-quiz).
      clearSessionDismissed(candidate.sessionId);
      setSession(candidate);
      setTestMode(candidate.mode);
      setMode("quiz");
      setImmersiveMode(true);
      precacheSessionPack(candidate.itemId, candidate.engine);
      return true;
    }
    if (candidate) sessions.clearActive();
    return false;
  }, [precacheSessionPack]);

  React.useEffect(() => {
    if (mode !== "home" || session || ((uid || activeItem) && !forceResume)) {
      restoreBlockedRef.current = true;
      return;
    }
    // Suppress auto-restore for sessions the user explicitly dismissed via
    // "Save & exit" — they chose to leave, so landing on /qbank shouldn't
    // pull them back in. They can still resume from the dashboard card,
    // the tracker's "In progress" panel, or an explicit /qbank?resume=1
    // (forceResume bypasses this check). A non-dismissed active session
    // (e.g. the user navigated to /library mid-quiz and came back) DOES
    // auto-restore, preserving the original refresh-recovery behavior.
    if (!forceResume) {
      const activeRaw = sessions.getActive() as SessionData | null;
      if (activeRaw?.sessionId && isSessionDismissed(activeRaw.sessionId)) {
        restoreBlockedRef.current = true;
        return;
      }
    }
    restoreBlockedRef.current = false;
    const restore = () => {
      if (restoreBlockedRef.current) return;
      resumeActiveSession();
    };
    restore();
    const unsub = storage.onHydrated(restore);
    return unsub;
  }, [resumeActiveSession, forceResume]);

  // Cross-tab plumbing (P0-4): a pack picked from Content tab gets handed to
  // Create Test as `initialSourceUid`. The custom-session callback is
  // implemented here so Create Test / Tracker / Previous Tests can all
  // spin up a session from a built question pool without going through the
  // `activeItem`/`activeContent` effect.
  const [pendingCreateTestSourceUid, setPendingCreateTestSourceUid] =
    React.useState<string | null>(() => {
      try {
        const stored = sessionStorage.getItem("osler_qbank_initial_source");
        if (stored) {
          sessionStorage.removeItem("osler_qbank_initial_source");
          return stored;
        }
      } catch {}
      return null;
    });

  const handlePickForCreateTest = React.useCallback(
    (node: ContentTreeNode) => {
      setPendingCreateTestSourceUid(node.uid);
      setHomeTab("create");
    },
    [],
  );

  const startCustomSession = React.useCallback(
    async (pool: PoolQuestion[], meta: { title: string; engine: EngineType; mode?: TestMode; timerMinutes?: number; dismissAfterCorrect?: boolean; tagsFilter?: string[]; onlyMode?: OnlyMode; isReview?: boolean; savedDrafts?: Record<string, WrittenDraft>; savedRubricState?: Record<string, boolean[]>; savedAnswers?: Record<number, number>; savedRevealed?: Record<number, boolean>; savedFlagged?: Record<number, boolean>; savedRatings?: Record<string, "easy" | "hard" | "unknown">; savedQuestionTimes?: Record<string, number>; savedHighlights?: Record<number, HighlightItem[]> }) => {
      if (pool.length === 0) return;
      const sessionId = `custom-${Date.now()}`;
      const totalTime = (meta.timerMinutes ?? pool.length) * 60;
      await archiveDisplacedActive();
      setImmersiveMode(true);
      setSession({
        itemId: sessionId,
        itemTitle: meta.title,
        engine: meta.engine,
        mode: meta.mode ?? testMode,
        questions: pool as SessionQuestion[],
        answers: meta.savedAnswers ?? {},
        revealed: meta.savedRevealed ?? {},
        flagged: meta.savedFlagged ?? {},
        current: 0,
        startedAt: Date.now(),
        examTimeRemaining: totalTime,
        timeEndsAt: (meta.mode ?? testMode) === "timed" ? Date.now() + totalTime * 1000 : undefined,
        examPaused: false,
        sessionId,
        writtenDrafts: meta.savedDrafts ?? {},
        rubricState: meta.savedRubricState ?? {},
        ratings: meta.savedRatings ?? {},
        questionTimes: meta.savedQuestionTimes ?? {},
        highlights: meta.savedHighlights ?? {},
        strikethroughs: {},
        tagsFilter: meta.tagsFilter,
        onlyMode: meta.onlyMode,
        dismissAfterCorrect: meta.dismissAfterCorrect,
        isReview: meta.isReview,
      });
      setMode(meta.isReview ? "review" : "quiz");
    },
    [testMode],
  );

  // /qbank?review=SESSION_ID or /qbank?retake=SESSION_ID — rebuild a saved
  // session's pool from its questionRefs and push it through the same
  // startCustomSession path used by the Tracker tab. Fires once when the
  // studio mounts with one of these params, then clears the URL so a refresh
  // doesn't replay the action. The `reviewSessionId` / `retakeSessionId`
  // props are read from the URL by the page component (see src/app/(app)/qbank/page.tsx).
  const consumedDeepLinkRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const targetId = reviewSessionId ?? retakeSessionId ?? null;
    if (!targetId) return;
    // Guard against StrictMode double-invoke + re-runs when unrelated state changes.
    if (consumedDeepLinkRef.current === targetId) return;
    consumedDeepLinkRef.current = targetId;
    const isReview = !!reviewSessionId;
    let cancelled = false;
    void (async () => {
      try {
        const s = sessions.get(targetId);
        if (!s) {
          toast({ title: t("qbank.review.noQuestions") });
          return;
        }
        const refs = s.questionRefs ?? [];
        const bySource = new Map<string, string[]>();
        if (refs.length > 0) {
          for (const r of refs) {
            const list = bySource.get(r.sourceUid) ?? [];
            list.push(r.id);
            bySource.set(r.sourceUid, list);
          }
        } else {
          bySource.set(s.packUid, []);
        }
        const pool: PoolQuestion[] = [];
        for (const [sourceUid, ids] of bySource.entries()) {
          try {
            const content = await loadContentByUid(sourceUid);
            let node: ContentTreeNode | undefined;
            try {
              node = await loadNodeByUid(sourceUid, content.type as EngineType);
            } catch {
              node = undefined;
            }
            const stamped = poolContentToQuestions(content, sourceUid, content.meta.title, node) as PoolQuestion[];
            if (ids.length === 0) pool.push(...stamped);
            else {
              const byId = new Map(stamped.map((q) => [q.id, q]));
              for (const id of ids) {
                const q = byId.get(id);
                if (q) pool.push(q);
              }
            }
          } catch (e) {
            console.warn(`[deep-link] Failed to load source ${sourceUid}:`, e);
          }
        }
        if (cancelled) return;
        const finalPool = isReview ? pool : filterPoolByProgress(pool, "wrong");
        if (finalPool.length === 0) {
          toast({ title: t("qbank.review.noQuestions") });
          return;
        }
        const meta: Parameters<typeof startCustomSession>[1] = {
          title: isReview ? s.packTitle : `${s.packTitle} — ${t("qbank.review.retakeWrong")}`,
          engine: s.engine,
          mode: s.mode,
        };
        if (isReview) {
          meta.isReview = true;
          meta.savedDrafts = s.writtenDrafts;
          meta.savedRubricState = s.rubricState;
          const savedAnswers: Record<number, number> = {};
          const savedRevealed: Record<number, boolean> = {};
          const savedFlagged: Record<number, boolean> = {};
          for (const [k, v] of Object.entries(s.answers)) savedAnswers[+k] = v;
          for (const [k, v] of Object.entries(s.revealed)) savedRevealed[+k] = v;
          for (const [k, v] of Object.entries(s.flagged)) savedFlagged[+k] = v;
          meta.savedAnswers = savedAnswers;
          meta.savedRevealed = savedRevealed;
          meta.savedFlagged = savedFlagged;
          meta.savedRatings = s.ratings;
          meta.savedQuestionTimes = s.questionTimes;
        } else {
          meta.onlyMode = "wrong";
          meta.savedDrafts = s.writtenDrafts;
          meta.savedRubricState = s.rubricState;
        }
        await archiveDisplacedActive();
        startCustomSession(finalPool, meta);
        // Clean the URL so a refresh doesn't replay the deep link.
        router.replace("/qbank");
      } catch (e) {
        console.error("[deep-link] Failed to load session", targetId, e);
        toast({ title: t("qbank.review.noQuestions") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reviewSessionId, retakeSessionId]);

  // Tools state (calculator, lab values, article modal, AI, quiz settings, notes)
  const [calculatorOpen, setCalculatorOpen] = React.useState(false);
  const [labValuesOpen, setLabValuesOpen] = React.useState(false);
  const [articleModalId, setArticleModalId] = React.useState<string | null>(null);
  const [aiAssistantOpen, setAiAssistantOpen] = React.useState(false);
  const [quizSettingsOpen, setQuizSettingsOpen] = React.useState(false);
  const [notesOpen, setNotesOpen] = React.useState(false);
  // Incremented to request "create a note now" from the qbank.notesNew
  // shortcut — NotesPanel consumes it via its `createSignal` prop.
  const [notesCreateSeq, setNotesCreateSeq] = React.useState(0);
  const [exitConfirmOpen, setExitConfirmOpen] = React.useState(false);
  const [navOpenMobile, setNavOpenMobile] = React.useState(false);
  const [articleList, setArticleList] = React.useState<ArticleMeta[]>([]);

  React.useEffect(() => {
    (async () => {
      try {
        const all = await listAllArticles();
        setArticleList(all);
      } catch {}
    })();
  }, []);

  const startSession = React.useCallback(
    async (
      item: ContentTreeNode,
      content: AnyContent,
      options: { maxQuestions?: number; order?: SessionOrder; mode?: SessionMode; timerMinutes?: number; onlyMode?: OnlyMode } = {},
    ) => {
      let questions = contentToQuestions(content, item.uid, item.title, item);
      if (questions.length === 0) return;
      const sessionMode = options.mode ?? testMode;
      // Apply progress filter (new/wrong/flagged/all) before picking questions.
      // Pass the pack uid as fallbackUid so single-pack paths (where
      // sourceUid may not be stamped on every question) still resolve
      // progress records correctly.
      if (options.onlyMode && options.onlyMode !== "all") {
        const filtered = filterPoolByProgress(questions as PoolQuestion[], options.onlyMode, item.uid);
        if (filtered.length > 0) questions = filtered as typeof questions;
        else {
          // No questions matched the filter — inform the user instead of
          // silently falling back to the full pool.
          toast({ title: "No matching questions", variant: "destructive", description: "No questions found for the selected filter. Try a different filter or start with all questions." });
          return;
        }
      }
      if (options.maxQuestions && options.maxQuestions > 0 && options.maxQuestions < questions.length) {
        questions = pickQuestions(questions, options.maxQuestions, options.order ?? "sequential");
      }
      const totalTime = (options.timerMinutes ?? questions.length) * 60;
      const sessionId = `${item.uid}-${Date.now()}`;

      // Resume-aware: if an unfinished active session exists for the SAME
      // pack and question set, restore it instead of silently restarting —
      // this is what makes a hard refresh on /qbank?uid=<pack> mid-session
      // resume exactly where you left off. Custom pools bypass this (their
      // itemId is `custom-<ts>` so the match below never fires).
      let active: SessionData | null = null;
      try {
        active = (await sessions.getActiveFromDb()) as SessionData | null;
        if (
          active &&
          active.sessionId &&
          active.itemId === item.uid &&
          !active.completedAt &&
          !active.isReview &&
          Array.isArray(active.questions) &&
          active.questions.length === questions.length &&
          active.questions[0]?.id === questions[0]?.id &&
          // Staleness check: discard if older than 7 days
          Date.now() - (active.startedAt ?? 0) < 7 * 24 * 60 * 60 * 1000
        ) {
          restoreBlockedRef.current = true;
          setImmersiveMode(true);
          setSession(active);
          setTestMode(active.mode);
          setMode("quiz");
          precacheSessionPack(active.itemId, active.engine);
          return;
        }
      } catch {}

      // The active record couldn't be resumed (different pack / different
      // question set). Preserve it as a saved session before the fresh session
      // overwrites it — a mid-session hard refresh on /qbank?uid=<other> (or
      // starting another pack from the hub) must never silently destroy the
      // in-progress progress. Stale and review sessions are skipped.
      await archiveDisplacedActive();

      setImmersiveMode(true);

      // Load existing written drafts
      const drafts = writtenDrafts.get(item.uid);

      setSession({
        itemId: item.uid,
        itemTitle: item.title,
        engine: item.type,
        mode: sessionMode,
        questions,
        answers: {},
        revealed: {},
        flagged: {},
        current: 0,
        startedAt: Date.now(),
        examTimeRemaining: totalTime,
        timeEndsAt: sessionMode === "timed" ? Date.now() + totalTime * 1000 : undefined,
        examPaused: false,
        sessionId,
        writtenDrafts: drafts,
        rubricState: {},
        ratings: {},
        questionTimes: {},
        highlights: {},
        strikethroughs: {},
      });
      setMode("quiz");
      precacheSessionPack(item.uid, item.type);
    },
    [testMode, precacheSessionPack]
  );

  // First-time entry uses a shared launch dialog for quiz and bank packs.
  // The bank dialog adds session sizing and can hand off to the advanced
  // Create tab without losing the selected source.
  //
  // IMPORTANT: this effect must only re-run when the *pack identity*
  // (activeItem/activeContent) changes — NOT on every `session`/`mode`
  // change. `session` gets a new object reference on every quiz
  // interaction (selecting an answer, pausing, flagging, navigating
  // questions...). If it were a dependency here, each of those
  // interactions would re-trigger this effect while activeItem/activeContent
  // are still set, falling through to `startSession(...)` again — silently
  // restoring a stale auto-saved copy (or a completely unrelated pack's
  // session, e.g. one left over from launching a custom session while a
  // pack was still open) and clobbering whatever the user just did. That's
  // what made pause/select/exit/custom-sessions appear broken. `mode` and
  // `session` are only read here, never watched.
  React.useEffect(() => {
    if (activeItem && activeContent) {
      if ((activeContent.type === "quiz" || activeContent.type === "bank" || activeContent.type === "written") && !session && mode === "home") {
        if (startPromptUid !== activeItem.uid) {
          setStartPromptUid(activeItem.uid);
          setStartDialogOpen(true);
        }
        return;
      }
      if (session || mode !== "home") return;
      const limit = pendingQuestionLimitRef.current;
      pendingQuestionLimitRef.current = 0;
      startSession(activeItem, activeContent, { maxQuestions: limit || undefined });
    } else if (!activeItem) {
      // Reset unconditionally on `!activeItem` (not gated on `mode`) — by
      // the time the URL actually drops `uid`, `exitToHome` has usually
      // already set mode to "home" synchronously, so a `mode !== "home"`
      // guard here would never run and `startPromptUid` would stay stale,
      // permanently blocking the launch dialog from reopening if the user
      // navigates back to the same pack later. These setters are all
      // idempotent no-ops when already at their reset values.
      setMode("home");
      setSession(null);
      setStartDialogOpen(false);
      setStartPromptUid(null);
    }
  }, [activeItem?.uid, activeContent?.meta.uid, activeContent?.type, startPromptUid, startSession]);

  const handleStartPrompt = React.useCallback((options: SessionStartOptions) => {
    if (!activeItem || !activeContent) return;
    setTestMode(options.mode);
    setStartDialogOpen(false);
    startSession(activeItem, activeContent, {
      maxQuestions: options.questionCount,
      order: options.order,
      mode: options.mode,
      timerMinutes: options.timerMinutes,
      onlyMode: options.onlyMode,
    });
  }, [activeContent, activeItem, startSession]);

  const openBankMoreOptions = React.useCallback(() => {
    if (!activeItem) return;
    haptic("selection");
    setStartDialogOpen(false);
    setStartPromptUid(activeItem.uid);
    try {
      sessionStorage.setItem("osler_qbank_initial_tab", "create");
      sessionStorage.setItem("osler_qbank_initial_source", activeItem.uid);
    } catch {}
    setPendingCreateTestSourceUid(activeItem.uid);
    setHomeTab("create");
    setMode("home");
    setImmersiveMode(false);
    navigate("qbank");
  }, [activeItem, navigate]);

  const endSession = React.useCallback(() => {
    setSession((s) => {
      if (!s) return s;
      const completed = { ...s, completedAt: Date.now() };
      // P3-1: don't persist review sessions — they're read-only replays.
      if (!s.isReview) {
        saveSession(completed);
        if (!s.itemId.startsWith("custom-")) {
          writtenDrafts.clear(s.itemId);
        }
      }
      return completed;
    });
    sessions.clearActive();
    // Flush buffered first-attempt choice stats — one small POST per pack,
    // exactly once per finished session.
    void flushQuestionStats();
    // P3-1: review sessions skip the results view and exit straight to home
    // (no score to show — answers were already known at save time).
    if (session?.isReview) {
      exitToHome();
      return;
    }
    setMode("results");
  }, [session?.isReview]);

  const restartSession = () => {
    if (activeItem && activeContent) {
      storage.clearPack(activeItem.uid);
      writtenDrafts.clear(activeItem.uid);
      startSession(activeItem, activeContent);
    }
  };

  const exitToHome = React.useCallback(() => {
    sessions.clearActive();
    setMode("home");
    setSession(null);
    setStartDialogOpen(false);
    // NOTE: do NOT reset `startPromptUid` here. It's a dependency of the
    // auto-open effect above, and `navigate("qbank")` below is async
    // (router.push) — activeItem/activeContent stay non-null for at least
    // one more render. Clearing startPromptUid synchronously would make
    // that effect re-fire immediately (before the URL actually changes),
    // see `!session && mode === "home"` as true again, and reopen the
    // dialog it was just asked to close. The effect's own `!activeItem`
    // branch clears startPromptUid once the navigation has truly landed.
    setImmersiveMode(false);
    // Always land on the bare /qbank URL: deep-link params (?uid / ?resume /
    // ?review / ?retake) must not survive an exit, or the next mount replays
    // them. Sessions resumed via ?resume=1 (and custom sessions) have no
    // activeItem, which previously skipped the navigation entirely and left
    // the stale query in the address bar.
    if (activeItem || (typeof window !== "undefined" && !!window.location.search)) {
      navigate("qbank");
    }
  }, [activeItem?.uid, navigate]);

  // "Save & exit": persist the in-progress session, then leave the quiz view
  // WITHOUT clearing it, so a refresh or the Resume flow picks it back up.
  // The session appears in the Tracker's "In progress" panel (via
  // sessions.getActive()). It is NOT also saved as a SavedSession here —
  // that would create a duplicate in the tracker's "Recent sessions" list.
  // It gets archived to a SavedSession only when another session later
  // displaces it (see archiveDisplacedActive).
  const saveAndExit = () => {
    const s = sessionRef.current;
    if (s && !s.isReview && !s.completedAt) {
      sessions.saveActive(s);
      // Suppress the auto-pop resume dialog on the immediately-following
      // /qbank navigation — the user just chose to leave, so prompting
      // them to resume right away would be annoying. They can still resume
      // from the dashboard card or the tracker's "In progress" panel.
      markSessionDismissed(s.sessionId);
    }
    keepProgressOnExitRef.current = true;
    setMode("home");
    setSession(null);
    setImmersiveMode(false);
    onExit();
  };

  // Request exit confirmation — opens a modal when there is an in-progress
  // session; otherwise just exits immediately. Review sessions skip confirmation.
  const requestExit = () => {
    if (mode === "review" || (mode === "quiz" && session?.isReview)) {
      exitToHome();
    } else if (mode === "quiz" && session) {
      setExitConfirmOpen(true);
    } else {
      exitToHome();
    }
  };

  // Live remaining time for timed mode is owned by the isolated <QBankTimer>
  // component below, so per-second ticks re-render only that small subtree
  // instead of the whole QuizView (which would disturb the highlighter).

  // Record answers to storage when revealed
  const recordAnswer = (idx: number, q: SessionQuestion) => {
    if (!session) return;
    // P3-1: read-only review mode — no progress writes.
    if (session.isReview) return;
    // P2-5: route progress through the question's real sourceUid, not the
    // synthetic session id. Fall back to activeItem.uid (single-pack path)
    // and finally session.itemId (legacy compat).
    const uid = q.sourceUid ?? activeItem?.uid ?? session.itemId;
    if (!uid) return;
    const selected = session.answers[idx];
    const correct = selected === q.correct;
    // P5-6: dismiss-after-correct semantics — if the session was started
    // with dismissAfterCorrect=true and the answer is correct, mark the
    // record as dismissed (Tracker will hide it from the default view).
    const shouldDismiss = !!session.dismissAfterCorrect && correct;
    // Per-question engine detection for mixed sessions.
    const qEngine = q.correct >= 0 ? "quiz" : (q.rubric?.length ? "written" : session.engine);
    storage.recordAnswer(uid, q.id, qEngine, {
      selected,
      correct,
      flagged: !!session.flagged[idx],
      dismissed: shouldDismiss,
      timeMs: stampQuestionTime(idx, q),
      tags: q.tags,
      difficulty: q.difficulty,
    });
    // Peer stats: report every answered MCQ — the worker dedupes per
    // contributor, so repeats never inflate the aggregates.
    if (selected !== undefined && q.correct >= 0) {
      queueChoiceStat(uid, q.id, selected, q.choices.length);
    }
    force();
  };

  // Peer choice stats — resolve once per session across the questions'
  // distinct source packs, then flatten to a `${uid}::${qid}` map for
  // QuizView's choice rows.
  const statsUids = React.useMemo(
    () =>
      session
        ? [...new Set(session.questions.map((q) => q.sourceUid ?? activeItem?.uid ?? session.itemId))]
        : [],
    [session, activeItem?.uid]
  );
  const packStatsMap = useQuestionStats(statsUids);
  const peerStats = React.useMemo(() => {
    const out: Record<string, QuestionChoiceStats> = {};
    for (const [uid, pack] of Object.entries(packStatsMap)) {
      for (const [qid, s] of Object.entries(pack)) out[`${uid}::${qid}`] = s;
    }
    return out;
  }, [packStatsMap]);

  if ((mode === "quiz" || mode === "review") && session) {
    return (
      <>
        <QuizView
          session={session}
          activeItem={activeItem ?? undefined}
          peerStats={peerStats}
          calculatorOpen={calculatorOpen}
          labValuesOpen={labValuesOpen}
          aiAssistantOpen={aiAssistantOpen}
          quizSettingsOpen={quizSettingsOpen}
          notesOpen={notesOpen}
          navOpenMobile={navOpenMobile}
          articleList={articleList}
          onToggleCalculator={() => setCalculatorOpen((o) => !o)}
          onToggleLabValues={() => setLabValuesOpen((o) => !o)}
          onToggleAiAssistant={() => setAiAssistantOpen((o) => !o)}
          onToggleQuizSettings={() => setQuizSettingsOpen((o) => !o)}
          onToggleNotes={() => setNotesOpen((o) => !o)}
          onNewNote={() => { setNotesOpen(true); setNotesCreateSeq((n) => n + 1); }}
          onNavMobileChange={(open) => setNavOpenMobile(open)}
          onOpenArticle={(id) => setArticleModalId(id)}
          onExitRequest={requestExit}
          onSelect={(idx) => {
            if (session.isReview) return;
            if (session.revealed[session.current]) return;
            const q = session.questions[session.current];
            const isMCQ = !!q && q.correct >= 0;
            const settings = quizSettingsStore.getSync();
            const willAutoSubmit =
              settings.autoSubmit && session.mode === "tutor" && isMCQ;

            setSession((s) => {
              if (!s) return s;
              const next = { ...s, answers: { ...s.answers, [s.current]: idx } };
              if (willAutoSubmit && !next.revealed[s.current]) {
                next.revealed = { ...next.revealed, [s.current]: true };
              }
              return next;
            });

            if (willAutoSubmit && q && isMCQ) {
              // Record progress for the auto-submitted answer.
              const correct = idx === q.correct;
              // P2-5: route through sourceUid if present (merged/custom sessions).
              const uid = q.sourceUid ?? activeItem?.uid ?? session.itemId;
              const shouldDismiss = !!session.dismissAfterCorrect && correct;
              storage.recordAnswer(uid, q.id, session.engine, {
                selected: idx,
                correct,
                flagged: !!session.flagged[session.current],
                dismissed: shouldDismiss,
                timeMs: stampQuestionTime(session.current, q),
                tags: q.tags,
                difficulty: q.difficulty,
              });
              queueChoiceStat(uid, q.id, idx, q.choices.length);
              force();
            }
          }}
          onToggleStrikethrough={(idx) => {
            setSession((s) => {
              if (!s) return s;
              const cur = s.strikethroughs[s.current] ?? [];
              const next = cur.includes(idx)
                ? cur.filter((i) => i !== idx)
                : [...cur, idx];
              return {
                ...s,
                strikethroughs: { ...s.strikethroughs, [s.current]: next },
              };
            });
          }}
          onSubmit={() => {
            const q = session.questions[session.current];
            setSession((s) =>
              s
                ? { ...s, revealed: { ...s.revealed, [s.current]: true } }
                : s
            );
            if (q && q.correct >= 0) {
              recordAnswer(session.current, q);
            } else if (q) {
              // Non-MCQ: record based on rubric/written
              const rubricState = session.rubricState[q.id] ?? [];
              const rubricScore = rubricState.filter(Boolean).length;
              const correct =
                q.rubric && q.rubric.length > 0
                  ? rubricScore / q.rubric.length >= 0.6
                  : true;
              const uid = q.sourceUid ?? activeItem?.uid ?? session.itemId;
              const shouldDismiss = !!session.dismissAfterCorrect && correct;
              const qEngine = q.rubric?.length ? "written" : session.engine;
              storage.recordAnswer(uid, q.id, qEngine, {
                selected: undefined,
                correct,
                flagged: !!session.flagged[session.current],
                dismissed: shouldDismiss,
                timeMs: stampQuestionTime(session.current, q),
                tags: q.tags,
                difficulty: q.difficulty,
              });
              force();
            }
          }}
          onWrittenDraftChange={(qid, draft) => {
            setSession((s) => {
              if (!s) return s;
              const drafts = { ...s.writtenDrafts, [qid]: draft };
              // Only persist to IndexedDB for single-pack sessions (restorable
              // via writtenDrafts.get). Custom sessions don't have an IndexedDB
              // restore path — their drafts are passed via SavedSession.writtenDrafts.
              if (!s.itemId.startsWith("custom-")) {
                writtenDrafts.save(s.itemId, drafts);
              }
              // Auto-reveal when evaluation is set (shows the right 45% column)
              const next: SessionData = { ...s, writtenDrafts: drafts };
              if (draft.evaluation && !next.revealed[next.current]) {
                next.revealed = { ...next.revealed, [next.current]: true };
              }
              return next;
            });
          }}
          onRubricToggle={(qid, idx) => {
            setSession((s) => {
              if (!s) return s;
              const cur = s.rubricState[qid] ?? [];
              const q = s.questions.find((q) => q.id === qid);
              const maxLen = q?.rubric?.length ?? 0;
              const next = [...cur];
              while (next.length < maxLen) next.push(false);
              next[idx] = !next[idx];
              return {
                ...s,
                rubricState: { ...s.rubricState, [qid]: next },
              };
            });
          }}
          onRate={(qid, rating) => {
            setSession((s) => {
              if (!s) return s;
              return {
                ...s,
                ratings: { ...s.ratings, [qid]: rating },
              };
            });
            // Record answer for flashcard
            const q = session.questions.find((q) => q.id === qid);
            if (q) {
              const correct = rating === "easy";
              const uid = q.sourceUid ?? activeItem?.uid ?? session.itemId;
              const shouldDismiss = !!session.dismissAfterCorrect && correct;
              const qIdx = session.questions.findIndex((x) => x.id === qid);
              storage.recordAnswer(uid, qid, session.engine, {
                selected: undefined,
                correct,
                flagged: !!session.flagged[session.current],
                dismissed: shouldDismiss,
                timeMs: stampQuestionTime(qIdx, q),
                tags: q.tags,
                difficulty: q.difficulty,
              });
            }
            force();
          }}
          onToggleFlag={() => {
            if (session.isReview) return;
            const nextFlagged = !session.flagged[session.current];
            setSession((s) =>
              s
                ? {
                    ...s,
                    flagged: {
                      ...s.flagged,
                      [s.current]: nextFlagged,
                    },
                  }
                : s
            );
            // Persist flag change to storage immediately so that
            // "flagged only" sessions can find this question later.
            const q = session.questions[session.current];
            if (q) {
              const uid = q.sourceUid ?? activeItem?.uid ?? session.itemId;
              if (uid) {
                const existing = storage.getRecord(uid, q.id);
                const qEngine = q.correct >= 0 ? "quiz" : (q.rubric?.length ? "written" : session.engine);
                storage.recordAnswer(uid, q.id, qEngine, {
                  selected: existing?.selected,
                  correct: existing?.correct ?? false,
                  flagged: nextFlagged,
                  dismissed: existing?.dismissed,
                  timeMs: existing?.timeMs,
                  tags: existing?.tags ?? q.tags,
                  difficulty: existing?.difficulty ?? q.difficulty,
                });
                force();
              }
            }
          }}
          onTogglePause={() => {
            if (session.isReview) return;
            setSession((s) => (s ? { ...s, examPaused: !s.examPaused } : s));
          }}
          onTimeUp={endSession}
          onPrev={() =>
            setSession((s) =>
              s ? { ...s, current: Math.max(0, s.current - 1) } : s
            )
          }
          onNext={() => {
            if (session.current >= session.questions.length - 1) {
              endSession();
            } else {
              setSession((s) => (s ? { ...s, current: s.current + 1 } : s));
            }
          }}
          onJumpTo={(i) =>
            setSession((s) => (s ? { ...s, current: i } : s))
          }
          onRetry={() => {
            setSession((s) => {
              if (!s) return s;
              const q = s.questions[s.current];
              const newAnswers = { ...s.answers };
              delete newAnswers[s.current];
              const newRevealed = { ...s.revealed };
              delete newRevealed[s.current];
              const newRatings = { ...s.ratings };
              delete newRatings[q.id];
              const newDrafts = { ...s.writtenDrafts };
              delete newDrafts[q.id];
              // Clear session-bound highlights for this question on retry
              const newHighlights = { ...s.highlights };
              delete newHighlights[s.current];
              return {
                ...s,
                answers: newAnswers,
                revealed: newRevealed,
                ratings: newRatings,
                writtenDrafts: newDrafts,
                highlights: newHighlights,
              };
            });
            // Restart the per-question timer so the retried attempt isn't
            // measured from the original (already-answered) reading.
            delete qTimersRef.current[session.current];
          }}
          onGoHome={requestExit}
          onSaveAndExit={saveAndExit}
          onFinish={endSession}
          onHighlightAdd={(questionIdx, item) => {
            setSession((s) => {
              if (!s) return s;
              const prev = s.highlights?.[questionIdx] ?? [];
              return { ...s, highlights: { ...s.highlights, [questionIdx]: [...prev, item] } };
            });
          }}
          onHighlightRemove={(questionIdx, id) => {
            setSession((s) => {
              if (!s) return s;
              const prev = s.highlights?.[questionIdx] ?? [];
              return { ...s, highlights: { ...s.highlights, [questionIdx]: prev.filter((h) => h.id !== id) } };
            });
          }}
          onHighlightClearAll={() => {
            setSession((s) => s ? { ...s, highlights: {} } : s);
          }}
        />
        {/* Floating tools */}
        <AnimatePresence>
          {calculatorOpen && (
            <CalculatorModal onClose={() => setCalculatorOpen(false)} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {labValuesOpen && (
            <LabValuesSidebar
              open={labValuesOpen}
              onClose={() => setLabValuesOpen(false)}
            />
          )}
        </AnimatePresence>
        <FloatingArticleModal
          articleId={articleModalId}
          onClose={() => setArticleModalId(null)}
        />
        <AiAssistant
          open={aiAssistantOpen}
          onClose={() => setAiAssistantOpen(false)}
          questionContext={
            session.questions[session.current]
              ? {
                  stem: session.questions[session.current].stem,
                  choices: session.questions[session.current].choices,
                  correct: session.questions[session.current].correct,
                  engine: session.engine,
                  submitted: session.revealed[session.current] || false,
                }
              : undefined
          }
        />
        <QuizSettingsPanel
          open={quizSettingsOpen}
          onClose={() => setQuizSettingsOpen(false)}
          tone="header"
        />
        <NotesPanel
          open={notesOpen}
          onClose={() => setNotesOpen(false)}
          createSignal={notesCreateSeq}
          packUid={activeItem?.uid}
          packTitle={activeItem?.title}
          currentQuestionIdx={session.current}
        />
        <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("qbank.exit.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("qbank.exit.bodyResumable")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialogCancel asChild>
                <Button variant="ghost">{t("qbank.exit.stay")}</Button>
              </AlertDialogCancel>
              <AlertDialogAction
                className={cn(buttonVariants({ variant: "destructive" }))}
                onClick={exitToHome}
              >
                {t("qbank.exit.discard")}
              </AlertDialogAction>
              <AlertDialogAction asChild>
                <Button onClick={saveAndExit}>
                  {t("qbank.exit.saveLater")}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  if (mode === "results" && session) {
    const isCustom = session.itemId.startsWith("custom-");
    const resultsItem = activeItem ?? {
      uid: session.itemId,
      title: session.itemTitle,
      type: session.engine,
      path: "",
      items: [],
    } as ContentTreeNode;
    return (
      <ResultsView
        session={session}
        item={resultsItem}
        onGoHome={exitToHome}
        onRestart={isCustom ? () => {
          // For custom sessions, go back to home since we can't easily rebuild
          exitToHome();
        } : restartSession}
      />
    );
  }

  if (selfPackError && uid && !activeItem && !activeContent) {
    return (
      <div className="osler-page">
        <div className="osler-page__inner flex min-h-[60vh] items-center">
          <EmptyState
            icon={ListChecks}
            title={t("empty.qbank.title")}
            description={t("empty.qbank.description")}
            actions={
              <Button variant="outline" size="lg" onClick={() => navigate("qbank")}>
                {t("empty.qbank.back")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <HomeView
        testMode={testMode}
        onTestModeChange={setTestMode}
        onOpenPack={onOpenPack}
        homeTab={homeTab}
        onHomeTabChange={setHomeTab}
        onSetQuestionLimit={(n) => { pendingQuestionLimitRef.current = n; }}
        pendingCreateTestSourceUid={pendingCreateTestSourceUid}
        onPickForCreateTest={handlePickForCreateTest}
        onClearPendingCreateTestSource={() => setPendingCreateTestSourceUid(null)}
        onStartCustomSession={startCustomSession}
        onResumeActive={resumeActiveSession}
      />
      {startDialogOpen && activeItem && activeContent && (activeContent.type === "quiz" || activeContent.type === "bank" || activeContent.type === "written") && (
        <SessionStartDialog
          open={startDialogOpen}
          item={activeItem}
          content={activeContent}
          mode={testMode}
          onModeChange={setTestMode}
          onlyMode={launchOnlyMode}
          onOnlyModeChange={setLaunchOnlyMode}
          onStart={handleStartPrompt}
          onMoreOptions={(activeContent.type === "bank" || activeContent.type === "written") ? openBankMoreOptions : undefined}
          onClose={exitToHome}
        />
      )}
    </>
  );
}