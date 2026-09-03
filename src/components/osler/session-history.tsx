"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  Clock,
  Eye,
  FileText,
  History,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  loadCategoryTree,
  flattenTree,
  loadContentByUid,
  loadNodeByUid,
  ENGINE_META,
} from "@/lib/osler/content";
import {
  sessions as sessionsStore,
  storage,
  type SavedSession,
} from "@/lib/osler/storage";
import {
  contentToQuestions as poolContentToQuestions,
  filterPoolByProgress,
  type PoolQuestion,
} from "@/lib/osler/qbank-pool";
import type {
  ContentTreeNode,
  EngineType,
} from "@/lib/osler/types";
import {
  generateResultsPdf,
  downloadPdf,
  type FullQuestion,
  type ResultsPdfConfig,
} from "@/lib/osler/pdf";
import { type PdfExportOptions } from "./pdf-export-dialog";
import { PdfExportDialog } from "./lazy-tools";
import { TrackerTree, type TrackerTreeNode } from "./tracker-tree";
import { useI18n } from "./i18n-provider";
import { haptic } from "@/lib/osler/native";
import { toast } from "@/hooks/use-toast";
import { formatTime } from "@/lib/osler/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  EmptyState,
  LoadingState,
  PageHeader,
  PackSheetHeader,
  SectionHeading,
  SwipeableSideSheet,
} from "./ui-primitives";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────────────
 * SessionHistoryView — full-page version of the Tracker tab's "Recent
 * sessions" section. Renders every saved session grouped by its source
 * pack/file in the same TrackerTree component the wrong & flagged browser
 * uses, so users can drill into any file and see every session they've
 * ever taken on it.
 *
 * Actions on each session (Review / Retake wrong / PDF / Delete) are wired
 * through URL deep-links back to /qbank so the heavy pool-rebuild + session
 * bootstrapping lives in exactly one place (QBankStudio's deep-link effect).
 * ───────────────────────────────────────────────────────────────────────── */

const ORPHAN_UID = "__osler_orphan_sessions__";

interface PackSessionsState {
  packByUid: Map<string, ContentTreeNode>;
  leafUids: Set<string>;
  tree: ContentTreeNode[];
}

export function SessionHistoryView() {
  const { t, rtl } = useI18n();
  const router = useRouter();
  const [, force] = React.useReducer((x) => x + 1, 0);

  // Subscribe to storage so deletes/finishes from other tabs reflect live.
  React.useEffect(() => {
    const unsub = storage.subscribe(force);
    const unsubHydrated = storage.onHydrated(force);
    const unsubSessions = sessionsStore.subscribe(force);
    return () => {
      unsub();
      unsubHydrated();
      unsubSessions();
    };
  }, []);

  const [packs, setPacks] = React.useState<PackSessionsState | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    loadCategoryTree("quiz")
      .then((tree) => {
        if (cancelled) return;
        const leaves = flattenTree(tree).filter(
          (node) => node.type === "quiz" || node.type === "bank" || node.type === "written",
        );
        const map = new Map<string, ContentTreeNode>();
        const uids = new Set<string>();
        for (const leaf of leaves) {
          map.set(leaf.uid, leaf);
          uids.add(leaf.uid);
        }
        setPacks({ packByUid: map, leafUids: uids, tree });
      })
      .catch((err) => {
        console.error("[session-history] Failed to load pack tree:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sessionList = React.useMemo<SavedSession[]>(
    () => sessionsStore.list(),
    [force],
  );

  // Group every saved session by its source pack uid. A session may pull
  // questions from multiple source packs (custom tests, multi-pack builds);
  // we attribute it to every distinct sourceUid listed in `questionRefs`
  // so the same session appears under each of its source files. Sessions
  // with no resolvable source (older saves without questionRefs and a
  // packUid that's no longer on disk) land in the "Other sessions" bucket.
  const sessionsByUid = React.useMemo(() => {
    const map = new Map<string, SavedSession[]>();
    const orphan: SavedSession[] = [];
    for (const s of sessionList) {
      const refs = s.questionRefs ?? [];
      const sources = new Set<string>();
      if (refs.length > 0) {
        for (const r of refs) sources.add(r.sourceUid);
      } else {
        sources.add(s.packUid);
      }
      let attached = false;
      for (const uid of sources) {
        if (packs?.leafUids.has(uid)) {
          attached = true;
          const list = map.get(uid) ?? [];
          list.push(s);
          map.set(uid, list);
        }
      }
      if (!attached) orphan.push(s);
    }
    if (orphan.length > 0) map.set(ORPHAN_UID, orphan);
    return map;
  }, [sessionList, packs]);

  // Build a TrackerTreeNode tree pruned to branches/packs that have at
  // least one session. Mirrors the Tracker tab's `trackerTree` transform
  // but aggregates session counts instead of wrong/flagged counts.
  const historyTree = React.useMemo<TrackerTreeNode[]>(() => {
    if (!packs) return [];
    const transform = (nodes: ContentTreeNode[]): TrackerTreeNode[] => {
      const out: TrackerTreeNode[] = [];
      for (const node of nodes) {
        if (node.items.length === 0) {
          const sessionsForPack = sessionsByUid.get(node.uid);
          if (!sessionsForPack || sessionsForPack.length === 0) continue;
          const lastSessionAt = sessionsForPack.reduce(
            (max, s) => Math.max(max, s.startedAt),
            0,
          );
          out.push({
            uid: node.uid,
            title: node.title,
            type: node.type,
            isPack: true,
            wrong: 0,
            flagged: 0,
            sessions: sessionsForPack.length,
            lastSessionAt,
            children: [],
          });
        } else {
          const children = transform(node.items);
          if (children.length === 0) continue;
          const allSessions = children.reduce((n, c) => n + (c.sessions ?? 0), 0);
          const lastSessionAt = children.reduce(
            (max, c) => Math.max(max, c.lastSessionAt ?? 0),
            0,
          );
          out.push({
            uid: node.uid,
            title: node.title,
            type: node.type,
            isPack: false,
            wrong: 0,
            flagged: 0,
            sessions: allSessions,
            lastSessionAt,
            children,
          });
        }
      }
      return out;
    };
    const tree = transform(packs.tree);
    // Append the orphan bucket if there are unattributed sessions.
    const orphan = sessionsByUid.get(ORPHAN_UID);
    if (orphan && orphan.length > 0) {
      tree.push({
        uid: ORPHAN_UID,
        title: t("qbank.history.orphanGroup"),
        type: "quiz",
        isPack: false,
        wrong: 0,
        flagged: 0,
        sessions: orphan.length,
        lastSessionAt: orphan.reduce((max, s) => Math.max(max, s.startedAt), 0),
        children: [
          {
            uid: `${ORPHAN_UID}:pack`,
            title: t("qbank.history.orphanGroup"),
            type: "quiz",
            isPack: true,
            wrong: 0,
            flagged: 0,
            sessions: orphan.length,
            lastSessionAt: orphan.reduce((max, s) => Math.max(max, s.startedAt), 0),
            children: [],
          },
        ],
      });
    }
    return tree;
  }, [packs, sessionsByUid, t]);

  // Expand every branch on mount so the file tree reads at a glance.
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
    walk(historyTree);
    return out;
  }, [historyTree]);

  // Pack whose sessions sheet is currently open.
  const [previewUid, setPreviewUid] = React.useState<string | null>(null);

  const previewPack = React.useMemo(() => {
    if (!previewUid) return null;
    if (previewUid === `${ORPHAN_UID}:pack`) {
      return {
        uid: previewUid,
        title: t("qbank.history.orphanGroup"),
        type: "quiz" as EngineType,
      };
    }
    const node = packs?.packByUid.get(previewUid);
    if (!node) return null;
    return {
      uid: node.uid,
      title: node.title,
      type: node.type,
    };
  }, [previewUid, packs, t]);

  const previewSessions = React.useMemo<SavedSession[]>(() => {
    if (!previewUid) return [];
    if (previewUid === `${ORPHAN_UID}:pack`) {
      return sessionsByUid.get(ORPHAN_UID) ?? [];
    }
    return sessionsByUid.get(previewUid) ?? [];
  }, [previewUid, sessionsByUid]);

  // PDF export state.
  const [pdfOpen, setPdfOpen] = React.useState(false);
  const [pdfTargetId, setPdfTargetId] = React.useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = React.useState<string | null>(null);

  const buildPoolForSession = React.useCallback(
    async (s: SavedSession, wrongOnly: boolean): Promise<PoolQuestion[]> => {
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
          console.warn(`[session-history] Failed to load source ${sourceUid}:`, e);
        }
      }
      return wrongOnly ? filterPoolByProgress(pool, "wrong") : pool;
    },
    [],
  );

  const handleExportSession = React.useCallback(
    async (s: SavedSession, opts: PdfExportOptions) => {
      setPdfBusy(s.id);
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
      } finally {
        setPdfBusy(null);
      }
    },
    [buildPoolForSession, t],
  );

  const handleDelete = React.useCallback(
    (id: string) => {
      haptic("warning");
      sessionsStore.delete(id);
      // If the open sheet's only session was deleted, close it.
      if (previewSessions.length <= 1) setPreviewUid(null);
    },
    [previewSessions.length],
  );

  const handleReview = React.useCallback(
    (s: SavedSession) => {
      haptic("selection");
      router.push(`/qbank?review=${encodeURIComponent(s.id)}`);
    },
    [router],
  );

  const handleRetake = React.useCallback(
    (s: SavedSession) => {
      haptic("selection");
      router.push(`/qbank?retake=${encodeURIComponent(s.id)}`);
    },
    [router],
  );

  if (!packs) {
    return <LoadingState label={t("qbank.history.loading")} />;
  }

  const totalSessions = sessionList.length;

  return (
    <div className="osler-page">
      <div className="osler-page__inner space-y-6">
        {/* Header — back button + PageHeader with the history icon chip */}
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 -ms-2 text-muted-foreground"
            onClick={() => {
              haptic("selection");
              router.push("/qbank");
            }}
          >
            {rtl ? (
              <ChevronRight className="size-4 me-1 rtl:rotate-180" />
            ) : (
              <ArrowLeft className="size-4 me-1 rtl:rotate-180" />
            )}
            {t("qbank.history.back")}
          </Button>
          <PageHeader
            inline
            inlineIcon={History}
            title={t("qbank.history.title")}
            subtitle={t("qbank.history.subtitle")}
            actions={
              totalSessions > 0 ? (
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {t("qbank.history.sessionCount", { n: totalSessions })}
                </span>
              ) : undefined
            }
          />
        </div>

        {/* Tree-grouped history */}
        <div>
          <SectionHeading icon={History}>{t("qbank.history.byFile")}</SectionHeading>
          {totalSessions === 0 ? (
            <EmptyState
              icon={History}
              title={t("qbank.history.noSessions")}
              description={t("qbank.history.noSessionsDesc")}
            />
          ) : (
            <TrackerTree
              nodes={historyTree}
              label={t("qbank.history.byFile")}
              defaultExpanded={defaultExpanded}
              selectedUid={previewUid}
              mode="sessions"
              onOpenPack={(node) => {
                // Orphan branch exposes a synthetic leaf — clicking it opens
                // the orphan bucket.
                const targetUid =
                  node.uid === ORPHAN_UID ? `${ORPHAN_UID}:pack` : node.uid;
                setPreviewUid(targetUid);
                haptic("selection");
              }}
            />
          )}
        </div>

        {/* Sheet showing every session for a given pack */}
        <SessionsSheet
          open={previewPack !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewUid(null);
          }}
          pack={previewPack}
          sessions={previewSessions}
          pdfBusyId={pdfBusy}
          onReview={handleReview}
          onRetake={handleRetake}
          onExport={(sessionId) => {
            setPdfTargetId(sessionId);
            setPdfOpen(true);
          }}
          onDelete={handleDelete}
        />

        <PdfExportDialog
          open={pdfOpen}
          onOpenChange={(open) => {
            setPdfOpen(open);
            if (!open) setPdfTargetId(null);
          }}
          defaultTitle={
            pdfTargetId
              ? previewSessions.find((s) => s.id === pdfTargetId)?.packTitle ?? t("pdf.tpl.results")
              : t("pdf.tpl.results")
          }
          variant="results"
          contentLang={pdfTargetId ? previewSessions.find((sess) => sess.id === pdfTargetId)?.packLang : undefined}
          onExport={(opts) => {
            const s = previewSessions.find((sess) => sess.id === pdfTargetId);
            if (s) void handleExportSession(s, opts);
          }}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * SessionsSheet — right-side sheet that lists every saved session under a
 * clicked pack, with the same review/retake/PDF/delete actions the Tracker
 * tab exposes inline.
 * ───────────────────────────────────────────────────────────────────────── */

interface SessionsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pack: { uid: string; title: string; type: EngineType } | null;
  sessions: SavedSession[];
  pdfBusyId: string | null;
  onReview: (s: SavedSession) => void;
  onRetake: (s: SavedSession) => void;
  onExport: (sessionId: string) => void;
  onDelete: (id: string) => void;
}

function SessionsSheet({
  open,
  onOpenChange,
  pack,
  sessions,
  pdfBusyId,
  onReview,
  onRetake,
  onExport,
  onDelete,
}: SessionsSheetProps) {
  const { t, rtl } = useI18n();
  // Keep the last non-null pack around so the sheet stays populated while
  // its exit animation plays.
  const snapshot = React.useRef<{ pack: { uid: string; title: string; type: EngineType }; sessions: SavedSession[] } | null>(null);
  if (pack && sessions.length > 0) {
    snapshot.current = { pack, sessions };
  }
  const shown = snapshot.current;
  if (!shown) return null;
  const shownPack = shown.pack;
  const shownSessions = shown.sessions;
  const meta = ENGINE_META[shownPack.type] ?? ENGINE_META.quiz;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        dir={rtl ? "rtl" : "ltr"}
        className="w-full gap-0 bg-background p-0 sm:max-w-xl"
      >
        <SwipeableSideSheet onClose={() => onOpenChange(false)} rtl={rtl} className="gap-0">
        <PackSheetHeader
          title={t("qbank.history.sessionsForPack", { title: shownPack.title })}
          meta={
            <>
              <span>{meta.label}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                {t("qbank.history.sessionCount", { n: shownSessions.length })}
              </span>
            </>
          }
        />

        <ScrollArea className="min-h-0 flex-1" dir={rtl ? "rtl" : "ltr"}>
          <div className="space-y-3 pt-6 pb-4 px-4">
            {shownSessions.length === 0 ? (
              <EmptyState icon={History} title={t("qbank.history.noSessions")} />
            ) : (
              shownSessions.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  pdfBusy={pdfBusyId === s.id}
                  onReview={() => onReview(s)}
                  onRetake={() => onRetake(s)}
                  onExport={() => onExport(s.id)}
                  onDelete={() => onDelete(s.id)}
                />
              ))
            )}
          </div>
        </ScrollArea>
        </SwipeableSideSheet>
      </SheetContent>
    </Sheet>
  );
}

function SessionRow({
  session: s,
  pdfBusy,
  onReview,
  onRetake,
  onExport,
  onDelete,
}: {
  session: SavedSession;
  pdfBusy: boolean;
  onReview: () => void;
  onRetake: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const total = s.totalQuestions;
  const pct = total ? Math.round((s.correctCount / total) * 100) : 0;
  const durationSec = Math.floor(((s.completedAt ?? Date.now()) - s.startedAt) / 1000);
  return (
    <div className="osler-card--default flex items-center gap-4">
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
          <span className="tabular-nums">
            {s.answeredCount} {t("qbank.tracker.attempted").toLowerCase()}
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {s.flaggedCount} {t("qbank.tracker.flaggedLabel").toLowerCase()}
          </span>
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
        <Button
          variant="ghost"
          size="iconSm"
          onClick={onReview}
          title={t("qbank.review.openReview")}
        >
          <Eye className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          onClick={onRetake}
          disabled={s.incorrectCount === 0}
          title={t("qbank.review.retakeWrong")}
        >
          <RotateCcw className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          onClick={onExport}
          disabled={pdfBusy}
          title={t("pdf.exportResults")}
        >
          {pdfBusy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          onClick={onDelete}
          className="hover:text-destructive"
          title={t("qbank.tracker.deleteSession")}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
