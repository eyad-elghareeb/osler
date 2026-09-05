"use client";

import * as React from "react";
import { animate } from "framer-motion";
import { useRouter } from "next/navigation";
import { Flag, X, Clock, Play, RotateCcw, ListChecks, Loader2, Timer, FileText, Trash2, Eye, CheckCircle2, Activity, History, ArrowRight, BarChart3, Target, PlayCircle } from "lucide-react";
import { loadContentByUid, loadNodeByUid, ENGINE_META } from "@/lib/osler/content";
import { toast } from "@/hooks/use-toast";
import { contentToQuestions as poolContentToQuestions, filterPoolByProgress, type PoolQuestion, type OnlyMode } from "@/lib/osler/qbank-pool";
import type { AnyContent, EngineType, ContentTreeNode } from "@/lib/osler/types";
import { storage, sessions, type SavedSession, type WrittenDraft, type HighlightItem, type QuestionRecord } from "@/lib/osler/storage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { haptic } from "@/lib/osler/native";
import { useI18n } from "@/components/osler/i18n-provider";
import { SectionHeading, StatTile, EmptyState, LoadingState, MetricBar, SectionList, SectionItem } from "@/components/osler/ui-primitives";
import { SparkTrend, defaultSparkDelta } from "@/components/osler/analytics-primitives";
import { TrackerTree, type TrackerTreeNode } from "@/components/osler/tracker-tree";
import { TrackerPreviewSheet, type TrackerPreviewItem } from "@/components/osler/tracker-preview";
import { generateResultsPdf, generateDashboardPdf, downloadPdf, type FullQuestion } from "@/lib/osler/pdf";
import { type PdfExportOptions } from "@/components/osler/pdf-export-dialog";
import { PdfExportDialog } from "@/components/osler/lazy-tools";
import { Checkbox } from "@/components/ui/checkbox";
import { useOslerSession } from "@/lib/osler/session-context";
import { RECENT_SESSION_PREVIEW_COUNT, TestMode, SessionData, PackEntry, formatTime, formatMs } from "./shared";




































































export function TrackerTab({
  data,
  sessions: sessionList,
  onDelete,
  onStartCustomSession,
  onResume,
  onLoadPack,
}: {
  data: { items: PackEntry[]; trees: Record<string, ContentTreeNode[]> } | null;
  sessions: SavedSession[];
  onDelete: (id: string) => void;
  /** Resume the active in-progress session in place. */
  onResume?: () => boolean;
  /** Review a past session (read-only) or retake just its wrong questions.
   *  Both build a pool from the session's questionRefs/sourceUids. */
  onStartCustomSession?: (
    pool: PoolQuestion[],
    meta: {
      title: string;
      engine: EngineType;
      mode?: TestMode;
      dismissAfterCorrect?: boolean;
      isReview?: boolean;
      onlyMode?: OnlyMode;
      savedDrafts?: Record<string, WrittenDraft>;
      savedRubricState?: Record<string, boolean[]>;
      savedAnswers?: Record<number, number>;
      savedRevealed?: Record<number, boolean>;
      savedFlagged?: Record<number, boolean>;
      savedRatings?: Record<string, "easy" | "hard" | "unknown">;
      savedQuestionTimes?: Record<string, number>;
      savedHighlights?: Record<number, HighlightItem[]>;
    }
  ) => void;
  /** Lazily fetch a pack's content JSON when it's not yet cached.
   *  Mirrors the prop passed to ContentTab — without this, the tracker
   *  preview can't render question stems/choices for packs the user
   *  hasn't already opened in the Content tab. */
  onLoadPack?: (node: ContentTreeNode) => Promise<AnyContent | null>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { username } = useOslerSession();
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    const unsub = storage.subscribe(force);
    const unsubHydrated = storage.onHydrated(force);
    return () => {
      unsub();
      unsubHydrated();
    };
  }, []);

  // Selection of question records for the "Start review session" action.
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(new Set());
  // "Keep in tracker" vs "Remove once answered correctly".
  const [dismissAfterCorrect, setDismissAfterCorrect] = React.useState(false);
  // Show dismissed records in the wrong & flagged list (P5-6).
  const [showDismissed, setShowDismissed] = React.useState(false);
  // Pack currently open in the tracker preview sheet.
  const [previewUid, setPreviewUid] = React.useState<string | null>(null);

  // Active in-progress session (resumable) — reactive across saves/clears so
  // the panel appears the moment work is paused mid-test.
  const [activeSession, setActiveSession] = React.useState<SessionData | null>(null);
  React.useEffect(() => {
    const refresh = () => setActiveSession((sessions.getActive() as SessionData | null));
    refresh();
    const unsubActive = sessions.subscribeActive(refresh);
    const unsubHydrated = storage.onHydrated(refresh);
    return () => {
      unsubActive();
      unsubHydrated();
    };
  }, []);

  const activeAnsweredCount = activeSession ? Object.keys(activeSession.answers ?? {}).length : 0;
  const activeFlaggedCount = activeSession
    ? Object.values(activeSession.flagged ?? {}).filter(Boolean).length
    : 0;
  const activeProgressPct = activeSession && activeSession.questions.length
    ? Math.round((activeAnsweredCount / activeSession.questions.length) * 100)
    : 0;

  // Past-session PDF export + busy/error state for replay actions.
  const [sessionPdfOpen, setSessionPdfOpen] = React.useState(false);
  const [sessionPdfTargetId, setSessionPdfTargetId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [sessionError, setSessionError] = React.useState<string | null>(null);

  // Build a uid → content map for resolving question text on expand.
  const contentByUid = React.useMemo(() => {
    const map = new Map<string, AnyContent>();
    if (!data) return map;
    for (const { node, content } of data.items) {
      if (content) map.set(node.uid, content);
    }
    return map;
  }, [data]);

  // Build a uid → node map so rebuilt review pools can stamp the origin node
  // (sourcePath/sourceCategory) for question image resolution.
  const nodeByUid = React.useMemo(() => {
    const map = new Map<string, ContentTreeNode>();
    if (!data) return map;
    for (const { node } of data.items) {
      map.set(node.uid, node);
    }
    return map;
  }, [data]);

  // P5-2: overall progress.
  const overall = React.useMemo(() => {
    const all = storage.allProgress();
    let attempted = 0;
    let correct = 0;
    let wrong = 0;
    let flagged = 0;
    for (const p of all) {
      attempted += p.attempted;
      correct += p.correct;
      wrong += p.wrong;
      flagged += p.flagged;
    }
    return { attempted, correct, wrong, flagged, accuracy: attempted > 0 ? Math.round((correct / attempted) * 100) : 0 };
  }, [data, force]);

  // P5-9: per-question pacing + first-try accuracy across every record.
  // avgTime uses each record's latest attempt duration (timeMs) — the truest
  // read of how the user answers *now*. firstTry uses the frozen
  // firstAttemptCorrect flag so repeats never dilute the first-try metric.
  const timingStats = React.useMemo(() => {
    const records = storage.allRecords();
    const timed = records.filter((r) => (r.timeMs ?? 0) > 0);
    const avgTimeMs = timed.length
      ? Math.round(timed.reduce((sum, r) => sum + (r.timeMs ?? 0), 0) / timed.length)
      : 0;
    const withFirstTry = records.filter((r) => r.firstAttemptCorrect != null);
    const firstTryAcc = withFirstTry.length
      ? Math.round((withFirstTry.filter((r) => r.firstAttemptCorrect).length / withFirstTry.length) * 100)
      : 0;
    return { avgTimeMs, firstTryAcc, timedCount: timed.length };
  }, [force]);

  // Per-session accuracy, oldest → newest, for the last 10 completed
  // sessions in this tracker — feeds the accuracy tile's <SparkTrend>.
  // Sorted defensively rather than assuming `sessionList`'s incoming order.
  const accuracyTrend = React.useMemo(() => {
    return sessionList
      .filter((s) => !!s.completedAt && s.answeredCount > 0)
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
      .slice(-10)
      .map((s) => Math.round((s.correctCount / s.answeredCount) * 100));
  }, [sessionList]);

  // Per-session average question time (ms), oldest → newest, last 10 —
  // feeds the avg-time tile's <SparkTrend>. Falls back to 0 for sessions
  // with no captured questionTimes (the SparkTrend filters non-finite
  // values, so a 0 just becomes a flat baseline point).
  const avgTimeTrend = React.useMemo(() => {
    return sessionList
      .filter((s) => !!s.completedAt && s.answeredCount > 0)
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
      .slice(-10)
      .map((s) => {
        const times = s.questionTimes ? Object.values(s.questionTimes) : [];
        if (times.length === 0) return 0;
        return Math.round(times.reduce((sum, t) => sum + t, 0) / times.length);
      });
  }, [sessionList]);

  // Per-session first-try accuracy (%), oldest → newest, last 10 — feeds
  // the first-try tile's <SparkTrend>. A session's first-try rate is the
  // fraction of questions answered correctly on the first reveal (no retry).
  // We approximate it from the session's correctCount vs answeredCount —
  // the true first-try flag lives on the question records, but for a per-
  // session trend this is a good proxy that matches the accuracy tile's
  // computation method.
  const firstTryTrend = React.useMemo(() => {
    return sessionList
      .filter((s) => !!s.completedAt && s.answeredCount > 0)
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
      .slice(-10)
      .map((s) => Math.round((s.correctCount / s.answeredCount) * 100));
  }, [sessionList]);

  // Recent sessions preview — `sessions.list()` is already sorted newest-first,
  // so a simple slice gives us the last N. The full list lives on the
  // dedicated /qbank/history page so the tracker tab stays scannable.
  const recentSessions = React.useMemo(
    () => sessionList.slice(0, RECENT_SESSION_PREVIEW_COUNT),
    [sessionList],
  );

  // P5-4: wrong & flagged question records. We compute across ALL QBank-owned
  // pack uids (not just selected ones). Dismissed records are filtered by
  // default; showDismissed reveals them.
  const allQBankUids = React.useMemo(() => {
    if (!data) return [] as string[];
    return data.items
      .filter((e) => e.node.type === "quiz" || e.node.type === "bank" || e.node.type === "written")
      .map((e) => e.node.uid);
  }, [data]);

  const wrongAndFlagged = React.useMemo(() => {
    if (allQBankUids.length === 0) return [] as Array<QuestionRecord & { key: string }>;
    // Use the dedicated helper — much cheaper than scanning memoryCache in userland.
    const raw = storage.wrongOrFlagged(allQBankUids);
    const out: Array<QuestionRecord & { key: string }> = raw.map((r) => ({
      ...r,
      key: `${r.uid}:${r.qid}`,
    }));
    // Sort newest-first.
    out.sort((a, b) => b.timestamp - a.timestamp);
    return out;
  }, [allQBankUids, data]);

  // If showDismissed is on, also pull dismissed records (they're filtered
  // out by wrongOrFlagged). We re-scan storage.recordsForUids and include
  // dismissed ones.
  const dismissedRecords = React.useMemo(() => {
    if (!showDismissed) return [] as Array<QuestionRecord & { key: string }>;
    const all = storage.recordsForUids(allQBankUids);
    return all
      .filter((r) => r.dismissed)
      .map((r) => ({ ...r, key: `${r.uid}:${r.qid}` }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [showDismissed, allQBankUids, data]);

  const visibleRecords = showDismissed
    ? [...wrongAndFlagged, ...dismissedRecords]
    : wrongAndFlagged;

  // Group visible records by their pack uid so the tree can aggregate counts
  // and only render packs that actually have wrong/flagged questions.
  const recordsByUid = React.useMemo(() => {
    const map = new Map<string, Array<QuestionRecord & { key: string }>>();
    for (const rec of visibleRecords) {
      const list = map.get(rec.uid);
      if (list) list.push(rec);
      else map.set(rec.uid, [rec]);
    }
    return map;
  }, [visibleRecords]);

  // Lazily resolve a pack's wrong/flagged records into briefable questions.
  // Cached per uid (keyed on the uid) and cleared whenever the record set
  // or the cached content map changes, so dismissals / new answers / lazy
  // content loads never render stale content.
  //
  // Important: we only cache the result when the pack's content is actually
  // loaded. If we cached entries with `question: null`, a later content load
  // would never be reflected (the cache invalidation effect runs on
  // `contentByUid` reference change, which fires — but defensively skipping
  // the cache for unloaded packs avoids any window where stale null entries
  // could be served).
  const resolveCache = React.useRef(new Map<string, TrackerPreviewItem[]>());
  const resolveItems = React.useCallback(
    (uid: string): TrackerPreviewItem[] => {
      const cached = resolveCache.current.get(uid);
      if (cached) return cached;
      const records = recordsByUid.get(uid) ?? [];
      const items: TrackerPreviewItem[] = records.map((r) => ({ key: r.key, record: r, question: null }));
      const content = contentByUid.get(uid);
      if (content && items.length > 0) {
        const pool = poolContentToQuestions(content, uid, content.meta.title, nodeByUid.get(uid));
        const byId = new Map(pool.map((q) => [q.id, q]));
        for (const it of items) it.question = byId.get(it.record.qid) ?? null;
        // Only cache once content has been resolved — otherwise we'd pin a
        // null-question snapshot that the load effect has to remember to
        // evict. Skipping the cache for unloaded packs is safer.
        resolveCache.current.set(uid, items);
      }
      return items;
    },
    [recordsByUid, contentByUid, nodeByUid],
  );

  // Invalidate the resolver cache when the record set OR the cached content
  // map changes. Without `contentByUid` in the deps, items would be cached
  // with `question: null` forever — even after the user opens a pack in the
  // Content tab (which loads its JSON) — and the preview would never show
  // the question stems/choices.
  React.useEffect(() => {
    resolveCache.current.clear();
  }, [visibleRecords, contentByUid]);

  // When the user opens a pack in the preview sheet, ensure its content JSON
  // is loaded. Without this, packs the user hasn't already opened in the
  // Content tab have `content: null` in `contentByUid`, so `resolveItems`
  // can't attach question stems/choices — every card renders the
  // "no content" fallback. We also clear the resolver cache entry so the
  // next `resolveItems(previewUid)` call rebuilds items with the freshly
  // loaded content.
  React.useEffect(() => {
    if (!previewUid) return;
    if (!onLoadPack) return;
    if (!data) return;
    if (contentByUid.has(previewUid)) return;
    const entry = data.items.find((e) => e.node.uid === previewUid);
    if (!entry) return;
    let cancelled = false;
    void (async () => {
      try {
        const content = await onLoadPack(entry.node);
        if (cancelled || !content) return;
        // The cache key for this uid is now stale (its previous entry was
        // built with `content: null`). Drop it so the next resolve picks
        // up the new content.
        resolveCache.current.delete(previewUid);
        force();
      } catch (error) {
        console.error(`[tracker] Failed to load pack ${previewUid}:`, error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewUid, onLoadPack, data, contentByUid]);

  // Prune the content hierarchy down to branches/packs that have wrong or
  // flagged records, mirroring the real folder structure in the tree.
  const trackerTree = React.useMemo(() => {
    if (!data) return [] as TrackerTreeNode[];
    const qbankTree = data.trees.quiz ?? data.trees.bank ?? data.trees.written ?? [];
    const transform = (nodes: ContentTreeNode[]): TrackerTreeNode[] => {
      const out: TrackerTreeNode[] = [];
      for (const node of nodes) {
        if (node.items.length === 0) {
          const records = recordsByUid.get(node.uid);
          if (!records || records.length === 0) continue;
          out.push({
            uid: node.uid,
            title: node.title,
            type: node.type,
            isPack: true,
            wrong: records.reduce((n, r) => n + (r.correct ? 0 : 1), 0),
            flagged: records.reduce((n, r) => n + (r.flagged ? 1 : 0), 0),
            children: [],
          });
        } else {
          const children = transform(node.items);
          if (children.length === 0) continue;
          out.push({
            uid: node.uid,
            title: node.title,
            type: node.type,
            isPack: false,
            wrong: children.reduce((n, c) => n + c.wrong, 0),
            flagged: children.reduce((n, c) => n + c.flagged, 0),
            children,
          });
        }
      }
      return out;
    };
    return transform(qbankTree);
  }, [recordsByUid, data]);

  // Expand every branch on first mount so the tracker reads like the full
  // folder structure instead of a collapsed outline.
  const defaultExpanded = React.useMemo(() => {
    const out: string[] = [];
    const walk = (list: TrackerTreeNode[]) => {
      for (const n of list) {
        if (!n.isPack) {
          out.push(n.uid);
          walk(n.children);
        }
      }
    };
    walk(trackerTree);
    return out;
  }, [trackerTree]);

  // Preview-sheet data: the resolved pack + its entry in the content list.
  const previewPack = React.useMemo(() => {
    if (!previewUid || !data) return null;
    const entry = data.items.find((e) => e.node.uid === previewUid);
    if (!entry) return null;
    return {
      uid: entry.node.uid,
      title: entry.node.title,
      type: entry.node.type,
      lang: contentByUid.get(entry.node.uid)?.meta.lang,
    };
  }, [previewUid, data, contentByUid]);
  const previewItems = previewUid ? resolveItems(previewUid) : [];

  // Start a brief tutor review of exactly the questions in a pack.
  const handleStartPackReview = React.useCallback(
    (uid: string) => {
      if (!onStartCustomSession) return;
      const items = resolveItems(uid);
      const pool = items
        .map((it) => it.question)
        .filter((q): q is PoolQuestion => q !== null);
      if (pool.length === 0) return;
      const entry = data?.items.find((e) => e.node.uid === uid);
      onStartCustomSession(pool, {
        title: `${pool.length} ${t("qbank.tracker.startReview")}`,
        engine: (entry?.node.type as EngineType) ?? pool[0].sourceUid
          ? (contentByUid.get(pool[0].sourceUid!)?.type as EngineType) ?? "quiz"
          : "quiz",
        mode: "tutor",
        dismissAfterCorrect,
      });
      setPreviewUid(null);
      setSelectedKeys(new Set());
      haptic("success");
    },
    [onStartCustomSession, resolveItems, data, contentByUid, dismissAfterCorrect, t],
  );

  // Select / deselect every question in the previewed pack.
  const handleTogglePackSelection = React.useCallback(
    (uid: string) => {
      const keys = resolveItems(uid).map((it) => it.key);
      if (keys.length === 0) return;
      setSelectedKeys((prev) => {
        const allSelected = keys.every((k) => prev.has(k));
        const next = new Set(prev);
        for (const k of keys) {
          if (allSelected) next.delete(k);
          else next.add(k);
        }
        return next;
      });
      haptic("selection");
    },
    [resolveItems],
  );

  // P5-5: build a review pool from selected records.
  const handleStartReview = () => {
    if (!onStartCustomSession) return;
    if (selectedKeys.size === 0) return;
    const pool: PoolQuestion[] = [];
    // Group selected keys by sourceUid to minimize content loads.
    const bySource = new Map<string, string[]>();
    for (const key of selectedKeys) {
      const [uid, qid] = key.split(":");
      const list = bySource.get(uid) ?? [];
      list.push(qid);
      bySource.set(uid, list);
    }
    for (const [uid, qids] of bySource.entries()) {
      const content = contentByUid.get(uid);
      if (!content) continue;
      const stamped = poolContentToQuestions(content, uid, content.meta.title, nodeByUid.get(uid));
      const byId = new Map(stamped.map((q) => [q.id, q]));
      for (const qid of qids) {
        const q = byId.get(qid);
        if (q) pool.push(q);
      }
    }
    if (pool.length === 0) return;
    onStartCustomSession(pool, {
      title: `${pool.length} ${t("qbank.tracker.startReview")}`,
      engine: pool[0]?.sourceUid ? (contentByUid.get(pool[0].sourceUid!)?.type as EngineType) ?? "quiz" : "quiz",
      mode: "tutor",
      dismissAfterCorrect,
    });
    // Clear selection after starting.
    setSelectedKeys(new Set());
  };

  const toggleSelected = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedKeys((prev) => {
      if (prev.size === visibleRecords.length) return new Set();
      return new Set(visibleRecords.map((r) => r.key));
    });
  };

  /**
   * Build a PoolQuestion[] for a saved session by loading each distinct
   * sourceUid via loadContentByUid, flattening it into PoolQuestion[] and
   * filtering to just the ids listed in session.questionRefs (in order).
   * If `wrongOnly`, further filter to ids whose stored progress record is
   * incorrect. Falls back gracefully for legacy sessions without questionRefs.
   */
  const buildPoolForSession = React.useCallback(
    async (s: SavedSession, wrongOnly: boolean): Promise<PoolQuestion[]> => {
      const refs = s.questionRefs;
      const bySource = new Map<string, string[]>();
      if (refs && refs.length > 0) {
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
          // Resolve the originating node so sourcePath/sourceCategory get
          // stamped onto the rebuilt questions — without them, question images
          // can't be resolved when reviewing an old session (no item context).
          let node: ContentTreeNode | undefined;
          try {
            node = await loadNodeByUid(sourceUid, content.type as EngineType);
          } catch {
            node = undefined;
          }
          const stamped = poolContentToQuestions(content, sourceUid, content.meta.title, node);
          if (ids.length === 0) {
            pool.push(...stamped);
          } else {
            const byId = new Map(stamped.map((q) => [q.id, q]));
            for (const id of ids) {
              const q = byId.get(id);
              if (q) pool.push(q);
            }
          }
        } catch (e) {
          console.warn(`Failed to load source ${sourceUid}:`, e);
        }
      }

      if (wrongOnly) {
        return filterPoolByProgress(pool, "wrong");
      }
      return pool;
    },
    [],
  );

  const handleReviewSession = React.useCallback(
    async (s: SavedSession) => {
      if (!onStartCustomSession) return;
      setBusy(s.id);
      setSessionError(null);
      try {
        const pool = await buildPoolForSession(s, false);
        if (pool.length === 0) {
          setSessionError(t("qbank.review.noQuestions"));
          return;
        }
        const savedAnswers: Record<number, number> = {};
        const savedRevealed: Record<number, boolean> = {};
        const savedFlagged: Record<number, boolean> = {};
        for (const [k, v] of Object.entries(s.answers)) savedAnswers[+k] = v;
        for (const [k, v] of Object.entries(s.revealed)) savedRevealed[+k] = v;
        for (const [k, v] of Object.entries(s.flagged)) savedFlagged[+k] = v;
        onStartCustomSession(pool, {
          title: s.packTitle,
          engine: s.engine,
          mode: s.mode,
          isReview: true,
          savedDrafts: s.writtenDrafts,
          savedRubricState: s.rubricState,
          savedAnswers,
          savedRevealed,
          savedFlagged,
          savedRatings: s.ratings,
          savedQuestionTimes: s.questionTimes,
          // Session-bound highlights replay with the session they belong to.
          savedHighlights: s.highlights,
        });
      } finally {
        setBusy(null);
      }
    },
    [buildPoolForSession, onStartCustomSession, t],
  );

  const handleRetakeWrongSession = React.useCallback(
    async (s: SavedSession) => {
      if (!onStartCustomSession) return;
      setBusy(s.id + "-retake");
      setSessionError(null);
      try {
        const pool = await buildPoolForSession(s, true);
        if (pool.length === 0) {
          setSessionError(t("qbank.review.noQuestions"));
          return;
        }
        onStartCustomSession(pool, {
          title: `${s.packTitle} — ${t("qbank.review.retakeWrong")}`,
          engine: s.engine,
          mode: s.mode,
          onlyMode: "wrong",
          savedDrafts: s.writtenDrafts,
          savedRubricState: s.rubricState,
        });
      } finally {
        setBusy(null);
      }
    },
    [buildPoolForSession, onStartCustomSession, t],
  );

  const handleExportSession = React.useCallback(
    async (s: SavedSession, opts: PdfExportOptions) => {
      try {
        const totalTimeSec = Math.floor(((s.completedAt ?? Date.now()) - s.startedAt) / 1000);
        const avgTimeSec = s.answeredCount ? Math.round(totalTimeSec / s.answeredCount) : 0;
        const pct = s.totalQuestions ? Math.round((s.correctCount / s.totalQuestions) * 100) : 0;
        const pool = await buildPoolForSession(s, false);
        const questions: FullQuestion[] = pool.map((q) => ({
          stem: q.stem,
          choices: q.choices,
          correct: q.correct,
          explanation: q.explanation,
          modelAnswer: q.modelAnswer,
          isWritten: q.correct < 0,
          difficulty: q.difficulty,
          tags: q.tags,
          rubric: q.rubric,
        }));
        const doc = await generateResultsPdf({
          packTitle: s.packTitle,
          mode: s.mode,
          score: {
            pct,
            correct: s.correctCount,
            total: s.totalQuestions,
            answered: s.answeredCount,
            incorrect: s.incorrectCount,
            flagged: s.flaggedCount,
            percentile: Math.min(99, Math.max(1, Math.round(pct * 0.9 + 5))),
            totalTime: formatTime(totalTimeSec),
            avgTime: formatTime(avgTimeSec),
          },
          questions,
          userAnswers: s.answers,
          revealed: s.revealed,
          flagged: s.flagged,
          opts,
        });
        downloadPdf(doc, `${s.packTitle} - ${t("pdf.tpl.results")}`);
        toast({ title: t("pdf.pdfReady"), description: t("pdf.pdfReadyDesc") });
      } catch (err) {
        console.error("[osler/pdf] session export failed:", err);
        toast({ title: t("pdf.exportFailed"), description: String(err), variant: "destructive" });
      }
    },
    [buildPoolForSession, t],
  );

  const [trackerPdfOpen, setTrackerPdfOpen] = React.useState(false);

  const handleExportTrackerPdf = React.useCallback(async (opts: PdfExportOptions) => {
    const doc = await generateDashboardPdf({
      username: username || t("pdf.tpl.report"),
      stats: {
        packs: new Set(sessionList.map((session) => session.packUid)).size,
        attempted: overall.attempted,
        correct: overall.correct,
        accuracy: overall.accuracy,
      },
      recentPacks: sessionList.map((session) => ({
          title: session.packTitle,
          engine: session.engine,
          attempted: session.answeredCount,
          correct: session.correctCount,
          lastAttempt: session.completedAt ?? session.startedAt,
        })),
      opts,
    });
    downloadPdf(doc, t("pdf.exportReport"));
    toast({ title: t("pdf.pdfReady"), description: t("pdf.pdfReadyDesc") });
  }, [overall, sessionList, t, username]);

  if (!data) {
    return <LoadingState label={t("qbank.tracker.loading")} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t("qbank.tracker.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("qbank.tracker.subtitle")}</p>
        </div>
        {overall.attempted > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTrackerPdfOpen(true)}
            className="rounded-xl shrink-0"
          >
            <FileText className="size-4 me-1.5" /> {t("pdf.exportReport")}
          </Button>
        )}
      </div>

      {/* Overview */}
      <div>
        <SectionHeading icon={BarChart3}>{t("qbank.tracker.overview")}</SectionHeading>
        {overall.attempted === 0 ? (
          <EmptyState icon={Activity} title={t("qbank.tracker.noRecords")} />
        ) : (
          <SectionList className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <SectionItem>
              <StatTile compact label={t("qbank.tracker.attempted")} value={overall.attempted} icon={ListChecks} color="primary" />
            </SectionItem>
            <SectionItem>
              <StatTile compact label={t("qbank.tracker.correctLabel")} value={overall.correct} icon={CheckCircle2} color="success" />
            </SectionItem>
            <SectionItem>
              <StatTile compact label={t("qbank.tracker.wrongLabel")} value={overall.wrong} icon={X} color="destructive" />
            </SectionItem>
            <SectionItem>
              <StatTile
                compact
                label={t("qbank.tracker.accuracy")}
                value={`${overall.accuracy}%`}
                icon={Target}
                color="warning"
                trend={
                  accuracyTrend.length >= 2 ? (
                  <SparkTrend
                    data={accuracyTrend}
                    tone="auto"
                    showDelta
                    deltaFormatter={(first, last) => `${defaultSparkDelta(first, last)}%`}
                  />
                ) : undefined
              }
            />
            </SectionItem>
            <SectionItem>
              <StatTile
                compact
                label={t("qbank.tracker.avgTime")}
                value={timingStats.avgTimeMs > 0 ? formatMs(timingStats.avgTimeMs) : "—"}
                icon={Timer}
                color="info"
                trend={
                  avgTimeTrend.length >= 2 ? (
                    <SparkTrend
                      data={avgTimeTrend}
                      tone="auto"
                      showDelta
                      deltaFormatter={(first, last) => {
                        const diff = last - first;
                        const sign = diff > 0 ? "+" : diff < 0 ? "\u2212" : "";
                        return `${sign}${formatMs(Math.abs(diff))}`;
                      }}
                    />
                  ) : undefined
                }
              />
            </SectionItem>
            <SectionItem>
              <StatTile
                compact
                label={t("qbank.tracker.firstAttempt")}
                value={timingStats.firstTryAcc > 0 ? `${timingStats.firstTryAcc}%` : "—"}
                icon={Target}
                color="info"
                trend={
                  firstTryTrend.length >= 2 ? (
                    <SparkTrend
                      data={firstTryTrend}
                      tone="auto"
                      showDelta
                      deltaFormatter={(first, last) => `${defaultSparkDelta(first, last)}%`}
                    />
                  ) : undefined
                }
              />
            </SectionItem>
          </SectionList>
        )}
      </div>

      {/* In-progress session — resumed here, no need to hunt through packs */}
      {activeSession && (
        <div>
          <SectionHeading icon={PlayCircle}>{t("qbank.tracker.inProgress")}</SectionHeading>
          <div className="osler-card--default">
            <div className="flex items-center gap-3">
              <div className="size-11 rounded-xl bg-warning/15 text-warning flex items-center justify-center shrink-0">
                <PlayCircle className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{activeSession.itemTitle}</div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                  <Badge variant="secondary" className="text-[11px] capitalize">
                    {ENGINE_META[activeSession.engine]?.label ?? activeSession.engine}
                  </Badge>
                  <Badge variant="outline" className="text-[11px] capitalize">
                    {activeSession.mode === "timed" ? t("qbank.home.timed") : t("qbank.home.tutor")}
                  </Badge>
                  {activeFlaggedCount > 0 && (
                    <Badge variant="outline" className="text-[11px] capitalize text-warning border-warning/30">
                      <Flag className="size-3 me-1" /> {activeFlaggedCount}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => {
                    haptic("selection");
                    if (!onResume?.()) {
                      toast({ title: t("qbank.tracker.noActive") });
                    }
                  }}
                >
                  <Play className="size-4 me-1.5" /> {t("qbank.tracker.continue")}
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={() => {
                    haptic("warning");
                    sessions.clearActive();
                  }}
                  className="hover:text-destructive"
                  title={t("qbank.tracker.discardActive")}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <MetricBar
                value={activeProgressPct}
                color="warning"
                label={t("qbank.tracker.attempted")}
                className="flex-1"
              />
              <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                {activeAnsweredCount}/{activeSession.questions.length}{" "}
                {t("qbank.tracker.attempted").toLowerCase()} · {activeProgressPct}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Recent sessions — merged from the old Previous Tests tab.
          Only the last 5 are shown here; the full history lives on the
          dedicated /qbank/history page (tree-grouped by source file). */}
      <div>
        <SectionHeading
          icon={History}
          actions={
            sessionList.length > 0 ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("qbank.tracker.sessionsCount", { n: sessionList.length })}
                </span>
                {sessionList.length > RECENT_SESSION_PREVIEW_COUNT && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      haptic("selection");
                      router.push("/qbank/history");
                    }}
                  >
                    {t("qbank.tracker.viewAllSessions")}
                    <ArrowRight className="size-3.5 ms-1 rtl:rotate-180" />
                  </Button>
                )}
              </div>
            ) : undefined
          }
        >
          {t("qbank.tracker.sessions")}
        </SectionHeading>
        {sessionList.length === 0 ? (
          <EmptyState
            icon={History}
            title={t("qbank.tracker.noSessions")}
            description={t("qbank.tracker.noSessionsDesc")}
          />
        ) : (
          <SectionList className="space-y-3">
            {sessionError && (
              <SectionItem>
                <div className="osler-card--default text-sm text-destructive bg-destructive/5">
                  {sessionError}
                </div>
              </SectionItem>
            )}
            {recentSessions.map((s) => {
              const total = s.totalQuestions;
              const pct = total ? Math.round((s.correctCount / total) * 100) : 0;
              const durationSec = Math.floor(((s.completedAt ?? Date.now()) - s.startedAt) / 1000);
              return (
                <div key={s.id} className="osler-card--default flex items-center gap-4">
                  <div
                    className={cn(
                      "size-12 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold tabular-nums",
                      pct >= 70
                        ? "bg-success/15 text-success"
                        : pct >= 50
                          ? "bg-warning/15 text-warning"
                          : "bg-destructive/15 text-destructive",
                    )}
                  >
                    {pct}%
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold truncate">{s.packTitle}</span>
                      <Badge variant="secondary" className="text-[11px] capitalize">
                        {ENGINE_META[s.engine]?.label ?? s.engine}
                      </Badge>
                      <Badge variant="outline" className="text-[11px] capitalize">
                        {s.mode === "timed" ? t("qbank.home.timed") : t("qbank.home.tutor")}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground flex-wrap">
                      <span className="tabular-nums">
                        {s.correctCount}/{total} {t("qbank.tracker.correctLabel").toLowerCase()}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">{s.answeredCount} {t("qbank.tracker.attempted").toLowerCase()}</span>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">{s.flaggedCount} {t("qbank.tracker.flaggedLabel").toLowerCase()}</span>
                      <span aria-hidden>·</span>
                      <span className="flex items-center gap-1 tabular-nums">
                        <Clock className="size-3" />
                        {formatTime(durationSec)}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{new Date(s.startedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {onStartCustomSession && (
                      <Button
                        variant="ghost"
                        size="iconSm"
                        onClick={() => handleReviewSession(s)}
                        disabled={busy !== null}
                        title={t("qbank.review.openReview")}
                      >
                        {busy === s.id ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                      </Button>
                    )}
                    {onStartCustomSession && (
                      <Button
                        variant="ghost"
                        size="iconSm"
                        onClick={() => handleRetakeWrongSession(s)}
                        disabled={busy !== null || s.incorrectCount === 0}
                        title={t("qbank.review.retakeWrong")}
                      >
                        {busy === s.id + "-retake" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => {
                        setSessionPdfTargetId(s.id);
                        setSessionPdfOpen(true);
                      }}
                      title={t("pdf.exportResults")}
                    >
                      <FileText className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => onDelete(s.id)}
                      className="hover:text-destructive"
                      title={t("qbank.tracker.deleteSession")}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </SectionList>
        )}
      </div>

      {/* Wrong & Flagged browser + Start review */}
      <div>
        <SectionHeading
          icon={Flag}
          actions={
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDismissed((s) => !s)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showDismissed ? t("qbank.tracker.hideDismissed") : t("qbank.tracker.showDismissed")}
              </button>
              {visibleRecords.length > 0 && (
                <button
                  onClick={toggleAllVisible}
                  className="text-xs text-primary hover:underline"
                >
                  {t("qbank.tracker.selectAll")}
                </button>
              )}
            </div>
          }
        >
          {t("qbank.tracker.wrongAndFlagged")}
        </SectionHeading>

        {visibleRecords.length === 0 ? (
          <EmptyState icon={Flag} title={t("qbank.tracker.noRecords")} />
        ) : (
          <>
            {/* Review-session toolbar */}
            <div className="osler-card--default flex flex-wrap items-center gap-3 mb-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("qbank.tracker.selected", { n: selectedKeys.size })}
              </span>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox
                  checked={dismissAfterCorrect}
                  onCheckedChange={(checked) => setDismissAfterCorrect(checked === true)}
                  aria-label={t("qbank.tracker.removeOnCorrect")}
                />
                {t("qbank.tracker.removeOnCorrect")}
              </label>
              <Button
                onClick={handleStartReview}
                disabled={selectedKeys.size === 0 || !onStartCustomSession}
                size="sm"
                className="ms-auto"
              >
                {t("qbank.tracker.startReview")}
              </Button>
            </div>

            {/* Wrong & Flagged browser — grouped by the content hierarchy */}
            <TrackerTree
              nodes={trackerTree}
              label={t("qbank.tracker.wrongAndFlagged")}
              defaultExpanded={defaultExpanded}
              selectedUid={previewUid}
              onOpenPack={(node) => {
                setPreviewUid(node.uid);
                haptic("selection");
              }}
            />

            <TrackerPreviewSheet
              open={previewPack !== null}
              onOpenChange={(open) => {
                if (!open) setPreviewUid(null);
              }}
              pack={previewPack}
              items={previewItems}
              selectedKeys={selectedKeys}
              onToggleRecord={toggleSelected}
              onToggleAll={() => previewUid && handleTogglePackSelection(previewUid)}
              onStartReview={() => previewUid && handleStartPackReview(previewUid)}
            />
          </>
        )}
      </div>

      <PdfExportDialog
        open={trackerPdfOpen}
        onOpenChange={setTrackerPdfOpen}
        defaultTitle={t("pdf.exportReport")}
        defaultAuthor={username ?? undefined}
        variant="dashboard"
        onExport={handleExportTrackerPdf}
      />

      <PdfExportDialog
        open={sessionPdfOpen}
        onOpenChange={(open) => {
          setSessionPdfOpen(open);
          if (!open) setSessionPdfTargetId(null);
        }}
        defaultTitle={sessionPdfTargetId ? sessionList.find((s) => s.id === sessionPdfTargetId)?.packTitle ?? t("qbank.tracker.title") : t("qbank.tracker.title")}
        defaultAuthor={username ?? undefined}
        contentLang={sessionPdfTargetId ? sessionList.find((s) => s.id === sessionPdfTargetId)?.packLang : undefined}
        variant="results"
        onExport={(opts) => {
          const s = sessionList.find((s) => s.id === sessionPdfTargetId);
          if (s) handleExportSession(s, opts);
        }}
      />
    </div>
  );
}