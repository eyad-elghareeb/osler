"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Award,
  ChevronDown,
  Target,
  Clock,
  TrendingUp,
  Calendar,
  CalendarDays,
  Zap,
  Flame,
  Star,
  ShieldCheck,
  Medal,
  CheckCircle2,
  BookOpen,
  Settings as SettingsIcon,
  Cog,
  NotebookPen,
  Plus,
  Trash2,
  Folder,
  ExternalLink,
  Wifi,
  Cloud,
  User,
  LineChart,
  Timer,
  Repeat2,
  Gauge,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";
import {
  storage,
  notes as notesStore,
  achievements as achievementsStore,
  sessions,
  flashcardReview,
  streak,
  type NoteRecord,
  type DailyActivity,
} from "@/lib/osler/storage";
import {
  ACHIEVEMENTS,
  evaluateAchievements,
  type AchievementIconKey,
  type AchievementRecord,
  type AchievementStats,
} from "@/lib/osler/achievements";
import { summarizeMetrics, weakestTopics, type MetricsSummary } from "@/lib/osler/metrics";
import type { OslerView } from "./app-shell";
import { useI18n } from "./i18n-provider";
import type { StringKey } from "@/lib/osler/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { NotesPanel } from "./lazy-tools";
import { SyncModal } from "./sync/sync-modal";
import { haptic } from "@/lib/osler/native";
import {
  PageHeader,
  StatTile as SharedStatTile,
  OslerCard,
  type StatTileProps,
} from "./ui-primitives";

import { useOslerRouter } from "@/lib/osler/navigation";
import { useOslerSession } from "@/lib/osler/session-context";
import { useChartTooltip } from "@/hooks/use-chart-tooltip";
import { SparkTrend } from "./analytics-primitives";
import { AnimatedFlame } from "./animated-icons";
import { StreakRestoreBanner } from "./streak-card";
import { MOTION_TRANSITION } from "@/lib/osler/motion";

interface ProfileProps {
  username?: string;
  onViewChange?: (v: OslerView) => void;
  onOpenSettingsSection?: (section: "account" | "language" | "ai" | "shortcuts" | "downloads" | "sync" | "backup" | "danger") => void;
}

export function Profile({
  username: propUsername,
  onViewChange: propOnViewChange,
  onOpenSettingsSection: propOnOpenSettingsSection,
}: ProfileProps = {}) {
  const { t } = useI18n();
  const session = useOslerSession();
  const { navigate } = useOslerRouter();

  const username = propUsername || session.username || t("profile.user");
  const onViewChange = propOnViewChange || navigate;
  const onOpenSettingsSection = propOnOpenSettingsSection || ((section: any) => navigate("settings", { section }));
  const [syncOpen, setSyncOpen] = React.useState(false);
  const [progress, setProgress] = React.useState(storage.allProgress());
  const [unlockedAchievements, setUnlockedAchievements] = React.useState<Record<string, AchievementRecord>>({});
  const [, force] = React.useReducer((x) => x + 1, 0);

  React.useEffect(() => {
    const update = () => setProgress(storage.allProgress());
    update();
    const unsub = storage.subscribe(update);
    const unsubHydrated = storage.onHydrated(update);
    const unsubAch = achievementsStore.subscribe(() => {
      setUnlockedAchievements(achievementsStore.getAll());
      force();
    });
    const unsubSessions = sessions.subscribe(() => force());
    const unsubFlash = flashcardReview.subscribe(() => force());
    const unsubNotes = notesStore.subscribe(() => force());
    return () => {
      unsub();
      unsubHydrated();
      unsubAch();
      unsubSessions();
      unsubFlash();
      unsubNotes();
    };
  }, []);

  const attemptedTotal = progress.reduce((a, b) => a + b.attempted, 0);
  const correctTotal = progress.reduce((a, b) => a + b.correct, 0);
  const wrongTotal = progress.reduce((a, b) => a + b.wrong, 0);
  const accuracy = attemptedTotal
    ? Math.round((correctTotal / attemptedTotal) * 100)
    : 0;

  // Performance Insights — derived from per-question records (which carry
  // timeMs / attempts / firstAttemptCorrect). `progress` changes on every
  // storage write, so keying the memo off it keeps the section live without
  // a second subscription.
  const metrics = React.useMemo(
    () => summarizeMetrics(storage.allRecords()),
    [progress],
  );

  // Per-session accuracy, oldest → newest, for the last 10 completed
  // sessions — real data from `sessions.list()`, not a fabricated series.
  // Feeds the accuracy stat tile's `<SparkTrend>`. Needs 2+ completed
  // sessions with attempts to draw a line; `SparkTrend` itself no-ops
  // below that, so no extra guard is needed here.
  const accuracyTrend = React.useMemo(() => {
    return sessions
      .list()
      .filter((s) => !!s.completedAt && s.answeredCount > 0)
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
      .slice(-10)
      .map((s) => Math.round((s.correctCount / s.answeredCount) * 100));
    // `progress` changes whenever storage updates, which is also when a
    // session completes — using it as the recompute trigger avoids a
    // second subscription just for this derived series.
  }, [progress]);

  const sessionsCompleted = sessions.list().filter((s) => !!s.completedAt).length;
  const flashcardsReviewed = Object.values(flashcardReview.getAll()).reduce(
    (sum, r) => sum + (r.reviewCount ?? 0),
    0,
  );
  const notesCount = notesStore.listSync().length;

  const achievementStats: AchievementStats = {
    attempted: attemptedTotal,
    correct: correctTotal,
    accuracy,
    packsStarted: progress.length,
    sessionsCompleted,
    flashcardsReviewed,
    notesCount,
    currentStreak: streak.compute().current,
  };
  const earned = evaluateAchievements(achievementStats);
  const earnedKey = earned.join(",");
  // Persist newly-earned achievements so the unlock record survives refresh
  // and travels through cloud / P2P sync (idempotent — unlock() no-ops when
  // already unlocked, so re-running on re-render is safe).
  React.useEffect(() => {
    if (!earnedKey) return;
    for (const id of earnedKey.split(",")) achievementsStore.unlock(id);
  }, [earnedKey]);
  const unlockedIds = new Set<string>([...Object.keys(unlockedAchievements), ...earned]);

  return (
    <div className="osler-page">
      <div className="osler-page__inner--narrow">
        {/* Profile header */}
        {(() => {
          const cloudSession = session.cloudSession;
          return (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="osler-card--roomy mb-6 flex items-center gap-4"
            >
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center text-2xl font-bold text-primary-foreground shrink-0 shadow-sm">
                {(cloudSession?.user.displayName || username).slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl md:text-2xl font-bold tracking-tight truncate">
                    {cloudSession?.user.displayName || username}
                  </h1>
                  {cloudSession && (
                    <Badge variant="outline" className="text-[11px] bg-primary/10 text-primary border-primary/30">
                      <Cloud className="size-3 me-1" />
                      {cloudSession.user.role === "admin"
                        ? t("settings.account.admin")
                        : cloudSession.user.role === "student"
                          ? t("settings.account.student")
                          : t("admin.users.roles.content_admin")}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {cloudSession ? (cloudSession.user.email || `@${cloudSession.user.username}`) : t("nav.localSession")} · {t("login.footer")}
                </p>
              </div>
              <div className="hidden sm:flex flex-col items-end gap-1">
                <Badge variant="secondary" className="text-[11px]">
                  <AnimatedFlame className="size-3 me-1" />
                  {progress.length > 0 ? t("profile.activeLearner") : t("profile.newHere")}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {t("profile.questionsAnswered", { n: attemptedTotal })}
                </span>
              </div>
              {onViewChange && (
                <>
                  <button
                    onClick={() => {
                      if (onOpenSettingsSection) onOpenSettingsSection("account");
                      else onViewChange("settings");
                    }}
                    className="osler-icon-btn shrink-0"
                    aria-label={t("settings.section.account")}
                    title={t("settings.section.account")}
                  >
                    <User className="size-4" />
                  </button>
                  <button
                    onClick={() => setSyncOpen(true)}
                    className="osler-icon-btn shrink-0"
                    aria-label={t("sync.title")}
                    title={t("sync.title")}
                  >
                    <Wifi className="size-4" />
                  </button>
                  <button
                    onClick={() => onViewChange("settings")}
                    className="osler-icon-btn shrink-0"
                    aria-label={t("nav.settings")}
                    title={t("nav.settings")}
                  >
                    <Cog className="size-4" />
                  </button>
                </>
              )}
            </motion.div>
          );
        })()}

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatTile
            label={t("dash.attemptedLabel")}
            value={attemptedTotal}
            icon={Target}
            color="primary"
          />
          <StatTile
            label={t("dash.correctLabel")}
            value={correctTotal}
            icon={Award}
            color="success"
          />
          <StatTile
            label={t("profile.wrongLabel")}
            value={wrongTotal}
            icon={TrendingUp}
            color="destructive"
          />
          <StatTile
            label={t("dash.accuracy")}
            value={`${accuracy}%`}
            icon={Zap}
            color="warning"
            trend={
              accuracyTrend.length >= 2 ? (
                <SparkTrend data={accuracyTrend} tone="auto" showDelta />
              ) : undefined
            }
          />
        </div>

        {/* Detailed Streak & Consistency Section */}
        <ProfileStreakSection />

        {/* Performance Insights */}
        <PerformanceInsights metrics={metrics} />

        {/* Notes */}
        <ProfileNotesSection onViewChange={onViewChange} />

        {/* Achievements — only earned ones are shown; beyond five the rest
            live behind a Show more toggle. */}
        <AchievementsSection unlockedIds={unlockedIds} />
      </div>

      <SyncModal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        onOpenSettings={() => {
          setSyncOpen(false);
          onOpenSettingsSection?.("sync");
        }}
      />
    </div>
  );
}

/* ── GitHub-style Activity Heatmap ───────────────────────────────────── */

const HEATMAP_DAYS = 182;
const HEATMAP_LEVELS = [
  "bg-muted/60",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/65",
  "bg-primary",
] as const;

/**
 * GitHub-style activity heatmap body — self-contained data subscription,
 * no card chrome of its own so it can live inside the consistency card.
 */
function ActivityHeatmapGrid() {
  const { t } = useI18n();
  const [activity, setActivity] = React.useState<DailyActivity[]>(() =>
    streak.dailyActivity(HEATMAP_DAYS),
  );

  React.useEffect(() => {
    const update = () => setActivity(streak.dailyActivity(HEATMAP_DAYS));
    update();
    const unsub = streak.subscribe(update);
    return unsub;
  }, []);

  const maxCount = Math.max(...activity.map((a) => a.count), 1);

  // Align days into week columns (rows = Sun..Sat), padding the head so the
  // first column starts on Sunday. Timeline stays LTR in RTL locales.
  const weeks = React.useMemo(() => {
    if (activity.length === 0) return [];
    const shift = new Date(activity[0].date + "T00:00:00Z").getUTCDay();
    const cells: (DailyActivity | null)[] = [
      ...Array.from({ length: shift }, () => null),
      ...activity,
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const out: (DailyActivity | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [activity]);

  // Month labels follow GitHub's convention: a week is labeled by the month
  // of its MIDDLE day (Thursday), and a new label only appears once the
  // month actually changes — never twice within three weeks of each other.
  const monthLabels = React.useMemo(() => {
    const labels: { week: number; label: string }[] = [];
    let lastMonth = -1;
    let lastLabelWeek = -3;
    weeks.forEach((week, wi) => {
      if (wi >= weeks.length - 1) return; // skip the trailing partial week
      const mid = week[4] ?? week.find(Boolean);
      if (!mid) return;
      const d = new Date(mid.date + "T00:00:00Z");
      if (d.getUTCMonth() !== lastMonth && wi - lastLabelWeek >= 3) {
        labels.push({ week: wi, label: d.toLocaleDateString(undefined, { month: "short" }) });
        lastMonth = d.getUTCMonth();
        lastLabelWeek = wi;
      }
    });
    return labels;
  }, [weeks]);

  const levelOf = (count: number): number => {
    if (count <= 0) return 0;
    const q = count / maxCount;
    if (q <= 0.25) return 1;
    if (q <= 0.5) return 2;
    if (q <= 0.75) return 3;
    return 4;
  };

  return (
    <div className="overflow-x-auto osler-scroll-x pb-1" dir="ltr">
          <div className="flex flex-col items-center min-w-max mx-auto">
            {/* Weekday + month label gutter */}
            <div className="flex gap-[3px]">
              {/* Weekday gutter (rows Sun..Sat — label Mon/Wed/Fri like GitHub) */}
              <div className="flex flex-col gap-[3px] me-1.5 w-7 shrink-0">
                {[...Array(7)].map((_, di) => (
                  <div
                    key={di}
                    className="h-3 flex items-center text-[11px] font-medium text-muted-foreground"
                  >
                    {[1, 3, 5].includes(di)
                      ? new Date(Date.UTC(2024, 0, 7 + di)).toLocaleDateString(undefined, { weekday: "short" })
                      : ""}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                {/* Month labels */}
                <div className="flex gap-[3px] h-4 text-[11px] font-medium text-muted-foreground">
                  {weeks.map((_, wi) => {
                    const label = monthLabels.find((m) => m.week === wi);
                    return (
                      <div key={wi} className="w-3 shrink-0 relative">
                        {label && (
                          <span className="absolute whitespace-nowrap start-0">{label.label}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Week columns × 7 day rows */}
                <div className="flex gap-[3px]">
                  {weeks.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-[3px]">
                      {week.map((day, di) =>
                        day ? (
                          <div
                            key={day.date}
                            title={new Date(day.date + "T00:00:00Z").toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            }) + ` · ${t("dash.streak.questions", { n: day.count })}`}
                            className={cn(
                              "size-3 rounded-[3px] transition-all duration-150 hover:scale-125 hover:ring-1 hover:ring-primary/50",
                              HEATMAP_LEVELS[levelOf(day.count)],
                              day.count === 0 && "ring-1 ring-inset ring-border/50",
                            )}
                          />
                        ) : (
                          <div key={`pad-${wi}-${di}`} className="size-3 rounded-[3px]" />
                        ),
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-1.5 mt-3 text-[11px] text-muted-foreground">
              <span>{t("profile.activity.less")}</span>
              {HEATMAP_LEVELS.map((cls) => (
                <div key={cls} className={cn("size-3 rounded-[3px]", cls)} />
              ))}
              <span>{t("profile.activity.more")}</span>
            </div>
          </div>
        </div>
  );
}

/* ── Profile Streak & Detailed Consistency Section ───────────────────── */

function formatDurationShort(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatStudyTime(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const CALLOUT_TONES = {
  success: "border-success/30 bg-success/5 text-success",
  warning: "border-warning/30 bg-warning/5 text-warning",
  destructive: "border-destructive/30 bg-destructive/5 text-destructive",
  info: "border-info/30 bg-info/5 text-info",
} as const;

type CalloutTone = keyof typeof CALLOUT_TONES;

const PerformanceInsights = React.memo(function PerformanceInsights({ metrics }: { metrics: MetricsSummary }) {
  const { t } = useI18n();

  const weak = React.useMemo(
    () => weakestTopics(metrics.topicStats),
    [metrics.topicStats],
  );

  const callout = React.useMemo(() => {
    const m = metrics;
    if (m.totalAttempted === 0) return null;
    const sec = m.avgTimeMs != null ? Math.round(m.avgTimeMs / 1000) : null;
    if (m.overallAccuracy != null && m.overallAccuracy < 60) {
      return {
        tone: "warning" as CalloutTone,
        title: t("profile.insights.focusTitle"),
        body: t("profile.insights.focusBody", { n: m.overallAccuracy }),
      };
    }
    if (
      m.repeatCount >= 3 &&
      m.repeatGain != null &&
      m.repeatGain > 0 &&
      m.repeatFirstAcc != null &&
      m.repeatLastAcc != null
    ) {
      return {
        tone: "success" as CalloutTone,
        title: t("profile.insights.reviewTitle"),
        body: t("profile.insights.reviewBody", { first: m.repeatFirstAcc, last: m.repeatLastAcc }),
      };
    }
    if (sec != null && m.overallAccuracy != null) {
      if (m.avgTimeMs != null && m.avgTimeMs > 120000 && m.overallAccuracy < 60) {
        return {
          tone: "destructive" as CalloutTone,
          title: t("profile.insights.overthinkingTitle"),
          body: t("profile.insights.overthinkingBody", { n: sec }),
        };
      }
      if (m.avgTimeMs != null && m.avgTimeMs < 30000 && m.overallAccuracy < 60) {
        return {
          tone: "warning" as CalloutTone,
          title: t("profile.insights.rushedTitle"),
          body: t("profile.insights.rushedBody", { n: sec }),
        };
      }
      if (m.avgTimeMs != null && m.avgTimeMs > 120000) {
        return {
          tone: "info" as CalloutTone,
          title: t("profile.insights.pacingTitle"),
          body: t("profile.insights.pacingBody", { n: sec }),
        };
      }
    }
    return {
      tone: "success" as CalloutTone,
      title: t("profile.insights.strongTitle"),
      body: t("profile.insights.strongBody"),
    };
  }, [metrics, t]);

  return (
    <CollapsibleSection id="insights" icon={LineChart} title={t("profile.insights.title")}>
      {metrics.totalAttempted === 0 ? (
        <div className="osler-card--default text-center text-sm text-muted-foreground py-8">
          {t("profile.insights.empty")}
        </div>
      ) : (
        <div className="space-y-4">
          {callout && (
            <div className={cn("osler-card--default flex items-start gap-3 border", CALLOUT_TONES[callout.tone])}>
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{callout.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{callout.body}</p>
              </div>
            </div>
          )}

          {/* Metric tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile
              label={t("profile.insights.firstTry")}
              value={metrics.firstTryAccuracy != null ? `${metrics.firstTryAccuracy}%` : "—"}
              icon={Gauge}
              color="primary"
            />
            <StatTile
              label={t("profile.insights.avgTime")}
              value={metrics.avgTimeMs != null ? formatDurationShort(metrics.avgTimeMs) : "—"}
              icon={Timer}
              color="info"
            />
            <StatTile
              label={t("profile.insights.reviewGain")}
              value={
                metrics.repeatGain != null
                  ? `${metrics.repeatGain > 0 ? "+" : ""}${metrics.repeatGain}%`
                  : "—"
              }
              icon={Repeat2}
              color={
                metrics.repeatGain == null
                  ? "info"
                  : metrics.repeatGain >= 0
                    ? "success"
                    : "destructive"
              }
            />
            <StatTile
              label={t("profile.insights.studyTime")}
              value={metrics.totalStudyMs > 0 ? formatStudyTime(metrics.totalStudyMs) : "—"}
              icon={Clock}
              color="warning"
              trend={
                metrics.byDay.some((d) => d.minutes > 0) ? (
                  <SparkTrend data={metrics.byDay.map((d) => d.minutes)} tone="neutral" />
                ) : undefined
              }
            />
          </div>

          {/* Weakest topics + difficulty */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <OslerCard padding="default">
              <h4 className="text-sm font-semibold mb-1">{t("profile.insights.weakTopics")}</h4>
              <p className="text-xs text-muted-foreground mb-3">
                {t("profile.insights.weakTopicsHint", { n: 3 })}
              </p>
              {weak.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t("profile.insights.noWeakTopics")}
                </p>
              ) : (
                <div className="space-y-2.5">
                  {weak.map((s) => (
                    <div key={s.label}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium truncate me-2">{s.label}</span>
                        <span
                          className={cn(
                            "tabular-nums font-semibold shrink-0",
                            s.accuracy != null && s.accuracy < 50 ? "text-destructive" : "text-warning",
                          )}
                        >
                          {s.accuracy}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-warning transition-all"
                          style={{ width: `${s.accuracy ?? 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </OslerCard>

            <OslerCard padding="default">
              <h4 className="text-sm font-semibold mb-1">{t("profile.insights.byDifficulty")}</h4>
              <p className="text-xs text-muted-foreground mb-3">
                {t("profile.insights.byDifficultyHint")}
              </p>
              {metrics.difficultyStats.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t("profile.insights.noDifficulty")}
                </p>
              ) : (
                <div className="space-y-2.5">
                  {metrics.difficultyStats.map((s) => (
                    <div key={s.label}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium capitalize me-2">{s.label}</span>
                        <span className="tabular-nums text-muted-foreground shrink-0">
                          {s.correct}/{s.attempts}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            s.accuracy != null && s.accuracy < 50
                              ? "bg-destructive"
                              : s.accuracy != null && s.accuracy < 75
                                ? "bg-warning"
                                : "bg-success",
                          )}
                          style={{ width: `${s.accuracy ?? 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </OslerCard>
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
});

/* ── Collapsible profile sections ──────────────────────────────────────── */
/* Every profile section (streak, insights, notes, achievements) collapses.
 * Open/closed state persists per section in localStorage so the page keeps
 * the visitor's preferred density. */

const PROFILE_SECTIONS_KEY = "osler-profile-sections";

function loadProfileSectionOpen(id: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(PROFILE_SECTIONS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    return map[id] ?? true;
  } catch {
    return true;
  }
}

function saveProfileSectionOpen(id: string, open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(PROFILE_SECTIONS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    map[id] = open;
    window.localStorage.setItem(PROFILE_SECTIONS_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures (private mode)
  }
}

function CollapsibleSection({
  id,
  icon: Icon,
  title,
  actions,
  children,
}: {
  id: string;
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  /** Right-aligned extras shown on the heading row (kept visible when collapsed). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { rtl } = useI18n();
  const [open, setOpen] = React.useState(() => loadProfileSectionOpen(id));

  return (
    <Collapsible
      open={open}
      onOpenChange={(o) => {
        haptic("selection");
        setOpen(o);
        saveProfileSectionOpen(id, o);
      }}
      className="mb-6"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <CollapsibleTrigger className="group flex flex-1 items-center gap-1.5 text-start">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors group-hover:text-foreground">
            {Icon && <Icon className="size-3.5 text-primary" />}
            <span>{title}</span>
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              open && "rotate-180",
              rtl && "rtl-flip-x",
            )}
            aria-hidden
          />
        </CollapsibleTrigger>
        {actions}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

const PROFILE_STREAK_DAYS = 30;

const ProfileStreakSection = React.memo(function ProfileStreakSection() {
  const { t } = useI18n();
  const [view, setView] = React.useState<"chart" | "heatmap">("chart");
  const [streakData, setStreakData] = React.useState(() => streak.compute());
  const [activity, setActivity] = React.useState(() =>
    streak.dailyActivity(PROFILE_STREAK_DAYS),
  );

  React.useEffect(() => {
    const update = () => {
      setStreakData(streak.compute());
      setActivity(streak.dailyActivity(PROFILE_STREAK_DAYS));
    };
    update();
    const unsub = streak.subscribe(update);
    return unsub;
  }, []);

  const activeDaysCount = activity.filter((a) => a.count > 0).length;
  const totalQuestions = activity.reduce((sum, a) => sum + a.count, 0);
  const avgDaily = activeDaysCount ? Math.round(totalQuestions / activeDaysCount) : 0;
  const peakDay = Math.max(...activity.map((a) => a.count), 0);
  const today = new Date().toISOString().slice(0, 10);

  const chartW = 560;
  const chartH = 110;
  const barGap = 4;
  const barW = Math.max(4, Math.floor((chartW - barGap * (PROFILE_STREAK_DAYS - 1)) / PROFILE_STREAK_DAYS));
  const maxCount = Math.max(peakDay, 1);

  const { wrapRef, svgRef, tipRef, hovered, left, show, hide } = useChartTooltip({
    chartW,
    chartH,
    barW,
    barGap,
  });

  const toggleControls = (
    <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border">
      <button
        type="button"
        onClick={() => { haptic("selection"); setView("chart"); }}
        className={cn(
          "px-2.5 py-0.5 text-xs font-semibold rounded-md transition-colors cursor-pointer",
          view === "chart" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {t("profile.streak.days30")}
      </button>
      <button
        type="button"
        onClick={() => { haptic("selection"); setView("heatmap"); }}
        className={cn(
          "px-2.5 py-0.5 text-xs font-semibold rounded-md transition-colors cursor-pointer",
          view === "heatmap" ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {t("profile.streak.modeActivity")}
      </button>
    </div>
  );

  return (
    <CollapsibleSection id="streak" icon={Flame} title={t("profile.streak.title")} actions={toggleControls}>
      <OslerCard padding="roomy">
        {/* Top metrics summary bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-card border border-border rounded-xl p-3 text-start">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1">
              <AnimatedFlame className="size-3.5 text-warning" />
              <span>{t("dash.streak.title")}</span>
            </div>
            <div className="text-2xl font-extrabold tabular-nums flex items-baseline gap-1">
              <span>{streakData.current}</span>
              <span className="text-xs font-normal text-muted-foreground">
                / {t("profile.streak.best", { n: streakData.longest })}
              </span>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-3 text-start">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1">
              <Calendar className="size-3.5 text-primary" />
              <span>{t("profile.streak.activeRatio")}</span>
            </div>
            <div className="text-2xl font-extrabold tabular-nums flex items-baseline gap-1">
              <span>{activeDaysCount}</span>
              <span className="text-xs font-normal text-muted-foreground">/ {PROFILE_STREAK_DAYS}d ({Math.round((activeDaysCount / PROFILE_STREAK_DAYS) * 100)}%)</span>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-3 text-start">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1">
              <Activity className="size-3.5 text-success" />
              <span>{t("profile.streak.avgDaily")}</span>
            </div>
            <div className="text-2xl font-extrabold tabular-nums">
              {avgDaily}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-3 text-start">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1">
              <TrendingUp className="size-3.5 text-info" />
              <span>{t("profile.streak.peakDay")}</span>
            </div>
            <div className="text-2xl font-extrabold tabular-nums">
              {peakDay}
            </div>
          </div>
        </div>

        {/* 48h restore-window indicator when the streak is at risk */}
        {!streakData.activeToday && streakData.current > 0 && streakData.restoreDeadlineMs != null && (
          <StreakRestoreBanner deadline={streakData.restoreDeadlineMs} />
        )}

        {view === "heatmap" ? (
          <ActivityHeatmapGrid />
        ) : (
        <div className="relative select-none w-full" ref={wrapRef}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${chartW} ${chartH}`}
            className="w-full overflow-visible"
            style={{ height: chartH }}
            aria-label="Study activity timeline graph"
          >
            <defs>
              <linearGradient id="profile-bar-active" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.95" />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.3" />
              </linearGradient>
              <linearGradient id="profile-bar-today" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--warning)" stopOpacity="1" />
                <stop offset="100%" stopColor="var(--warning)" stopOpacity="0.5" />
              </linearGradient>
              <linearGradient id="profile-bar-empty" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--muted-foreground)" stopOpacity="0.15" />
                <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity="0.05" />
              </linearGradient>
            </defs>

            {/* Horizontal guideline */}
            <line
              x1={0}
              y1={chartH / 2}
              x2={chartW}
              y2={chartH / 2}
              stroke="var(--border)"
              strokeDasharray="4 4"
              strokeOpacity={0.4}
            />

            {activity.map((d, i) => {
              const x = i * (barW + barGap);
              const isToday = d.date === today;
              const isEmpty = d.count === 0;
              const barH = isEmpty
                ? 4
                : Math.max(10, Math.round((d.count / maxCount) * (chartH - 12)));
              const y = chartH - barH;
              const fill = isToday
                ? "url(#profile-bar-today)"
                : isEmpty
                ? "url(#profile-bar-empty)"
                : "url(#profile-bar-active)";
              const isHovered = hovered === i;

              return (
                <g key={d.date}>
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={barH}
                    rx={Math.min(3, barW / 2)}
                    fill={fill}
                    opacity={isHovered ? 1 : 0.85}
                    style={{ transition: "opacity 0.15s, height 0.3s" }}
                  />
                  <rect
                    x={x}
                    y={0}
                    width={barW}
                    height={chartH}
                    fill="transparent"
                    onMouseEnter={() => show(i)}
                    onMouseLeave={hide}
                    className="cursor-pointer"
                  />
                </g>
              );
            })}
          </svg>

          {/* Interactive Tooltip */}
          <AnimatePresence>
            {hovered !== null && activity[hovered] && (
              <motion.div
                key={hovered}
                ref={tipRef}
                initial={{ opacity: 0, y: 4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.95 }}
                transition={MOTION_TRANSITION.fast}
                className="absolute -top-11 z-20 pointer-events-none -translate-x-1/2"
                style={{
                  left: `${left}px`,
                }}
              >
                <div className="bg-popover border border-border text-popover-foreground rounded-lg px-2.5 py-1 text-[11px] font-medium shadow-lg whitespace-nowrap flex items-center gap-1.5">
                  <span className="text-foreground">
                    {activity[hovered].date === today
                      ? t("dash.streak.today")
                      : new Date(activity[hovered].date + "T00:00:00Z").toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-primary font-bold">
                    {t("dash.streak.questions", { n: activity[hovered].count })}
                  </span>
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-popover" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Timeline Date Footer */}
          <div className="flex justify-between items-center text-[11px] text-muted-foreground/70 mt-2 font-medium">
            <span>
              {activity[0]?.date ? new Date(activity[0].date + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
            </span>
            <span>
              {activity[Math.floor(activity.length / 2)]?.date ? new Date(activity[Math.floor(activity.length / 2)].date + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
            </span>
            <span className="font-semibold text-warning">
              {t("dash.streak.today")}
            </span>
          </div>
        </div>
        )}
      </OslerCard>
    </CollapsibleSection>
  );
});

function StatTile({
  label,
  value,
  icon: Icon,
  color = "primary",
  trend,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color?: StatTileProps["color"];
  trend?: React.ReactNode;
}) {
  return (
    <SharedStatTile
      label={label}
      value={value}
      icon={Icon as any}
      color={color}
      trend={trend}
    />
  );
}

/* ── Achievements section ─────────────────────────────────────────── */
/* Locked achievements are hidden entirely. The visible list is capped at
 * five with a Show more toggle revealing the rest. */

const MAX_VISIBLE_ACHIEVEMENTS = 5;

function AchievementsSection({ unlockedIds }: { unlockedIds: Set<string> }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = React.useState(false);

  const unlocked = React.useMemo(
    () => ACHIEVEMENTS.filter((a) => unlockedIds.has(a.id)),
    [unlockedIds],
  );
  const visible = showAll ? unlocked : unlocked.slice(0, MAX_VISIBLE_ACHIEVEMENTS);
  const hiddenCount = unlocked.length - MAX_VISIBLE_ACHIEVEMENTS;

  return (
    <CollapsibleSection
      id="achievements"
      icon={Medal}
      title={t("profile.achievements")}
      actions={
        <span className="text-xs text-muted-foreground">
          {unlocked.length}/{ACHIEVEMENTS.length} {t("profile.achievements").toLowerCase()}
        </span>
      }
    >
      {unlocked.length === 0 ? (
        <div className="osler-card--default text-center text-sm text-muted-foreground py-8">
          {t("profile.achievements.empty")}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((a) => (
              <Achievement
                key={a.id}
                icon={ACHIEVEMENT_ICONS[a.icon]}
                title={t(a.titleKey)}
                description={t(a.descKey)}
                unlocked
              />
            ))}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => {
                haptic("selection");
                setShowAll((v) => !v);
              }}
              className="mt-3 mx-auto flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              {showAll ? (
                <>
                  <ChevronDown className="size-3.5 rotate-180" />
                  {t("profile.achievements.showLess")}
                </>
              ) : (
                <>
                  <ChevronDown className="size-3.5" />
                  {t("profile.achievements.showMore", { n: hiddenCount })}
                </>
              )}
            </button>
          )}
        </>
      )}
    </CollapsibleSection>
  );
}

const ACHIEVEMENT_ICONS: Record<
  AchievementIconKey,
  React.ComponentType<{ className?: string }>
> = {
  target: Target,
  award: Award,
  zap: Zap,
  calendar: Calendar,
  trending: TrendingUp,
  flame: Flame,
  star: Star,
  shield: ShieldCheck,
  medal: Medal,
  session: CheckCircle2,
  flashcard: BookOpen,
  notes: NotebookPen,
};

function Achievement({
  icon: Icon,
  title,
  description,
  unlocked,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  unlocked: boolean;
}) {
  return (
    <div
      className={cn(
        "osler-card--default flex items-center gap-3 transition-all",
        unlocked
          ? "border-primary/40 bg-primary/5"
          : "opacity-60"
      )}
    >
      {/* Unlocked achievements keep a slow celebratory pulse on their icon
       *  chip — locked ones stay perfectly still. Gated by the global
       *  MotionConfig (animations toggle + prefers-reduced-motion). */}
      <motion.div
        className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
          unlocked
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground"
        )}
        animate={unlocked ? { scale: [1, 1.08, 1] } : undefined}
        transition={unlocked ? { duration: 2.6, repeat: Infinity, ease: "easeInOut" } : undefined}
      >
        <Icon className="size-5" />
      </motion.div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

/* ── Profile Notes Section ───────────────────────────────────────────── */

function timeAgo(
  ts: number,
  t: (key: StringKey, params?: Record<string, string | number>) => string,
): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("dash.timeAgo.justNow");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("dash.timeAgo.minutes", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("dash.timeAgo.hours", { n: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t("dash.timeAgo.days", { n: day });
  return new Date(ts).toLocaleDateString();
}

function ProfileNotesSection({
  onViewChange,
}: {
  onViewChange?: (v: OslerView) => void;
}) {
  const { t } = useI18n();
  const [allNotes, setAllNotes] = React.useState<NoteRecord[]>([]);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const list = await notesStore.list();
    setAllNotes(list);
  }, []);

  React.useEffect(() => {
    refresh();
    const unsub = notesStore.subscribe(() => refresh());
    return unsub;
  }, [refresh]);

  const visibleNotes = React.useMemo(() => allNotes, [allNotes]);

  const handleCreate = async () => {
    const note = await notesStore.create({ title: "", body: "" });
    setEditingId(note.id);
    setPanelOpen(true);
  };

  const handleOpen = (note: NoteRecord) => {
    setEditingId(note.id);
    setPanelOpen(true);
  };

  return (
    <>
      <CollapsibleSection id="notes" icon={NotebookPen} title={t("qbank.notes.title")}>
      <div className="osler-card--default">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-4">
          <Button
            size="sm"
            onClick={handleCreate}
            className="h-9 rounded-lg shrink-0"
            title={t("qbank.notes.new")}
          >
            <Plus className="size-3.5 mr-1" />
            {t("qbank.notes.new")}
          </Button>
        </div>

        {/* Notes list */}
        {visibleNotes.length === 0 ? (
          <div className="py-10 text-center">
            <div className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
              <NotebookPen className="size-6" />
            </div>
            <h3 className="text-base font-semibold mb-1">
              {t("qbank.notes.empty.title")}
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-4">
              {t("qbank.notes.empty.body")}
            </p>
            <Button onClick={handleCreate} size="sm" variant="outline" className="rounded-lg">
              <Plus className="size-3.5 mr-1" />
              {t("qbank.notes.empty.createFirst")}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visibleNotes.map((note) => (
              <ProfileNoteCard
                key={note.id}
                note={note}
                onOpen={() => handleOpen(note)}
                onDelete={async () => {
                  await notesStore.delete(note.id);
                }}
                onOpenInQBank={
                  note.packUid && onViewChange
                    ? () => onViewChange("qbank")
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {/* Stats footer */}
        {allNotes.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border text-[11px] text-muted-foreground flex items-center justify-between">
            <span>{allNotes.length} {t("qbank.notes.title").toLowerCase()}</span>
            <span>
              {allNotes.length > 0
                ? timeAgo(Math.max(...allNotes.map((n) => n.updatedAt)), t)
                : "—"}
            </span>
          </div>
        )}
      </div>

      {/* Full notes panel (sidebar on desktop, fullscreen on mobile) */}
      <AnimatePresence>
        {panelOpen && (
          <NotesPanel
            open={panelOpen}
            onClose={() => {
              setPanelOpen(false);
              setEditingId(null);
            }}
            variant="sidebar"
          />
        )}
      </AnimatePresence>
      </CollapsibleSection>
    </>
  );
}

function ProfileNoteCard({
  note,
  onOpen,
  onDelete,
  onOpenInQBank,
}: {
  note: NoteRecord;
  onOpen: () => void;
  onDelete: () => void;
  onOpenInQBank?: () => void;
}) {
  const { t } = useI18n();
  const preview = React.useMemo(() => {
    const body = note.body || "";
    return body
      .replace(/^#+\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/`/g, "")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .replace(/^\s*[-+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^\s*>\s+/gm, "")
      .replace(/\n+/g, " ")
      .trim()
      .slice(0, 160);
  }, [note.body]);

  return (
    <div className="group rounded-lg border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors p-3.5 cursor-pointer">
      <div onClick={onOpen} className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold truncate flex-1">
            {note.title || <span className="italic text-muted-foreground">{t("qbank.notes.card.untitled")}</span>}
          </h4>
          <div className="flex items-center gap-0.5 text-[11px] text-muted-foreground shrink-0">
            <Clock className="size-3" />
            <span>{timeAgo(note.updatedAt, t)}</span>
          </div>
        </div>
        {preview && (
          <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
            {preview}
          </p>
        )}
        {note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {note.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded text-[11px] bg-muted text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {note.tags.length > 5 && (
              <span className="text-[11px] text-muted-foreground">
                +{note.tags.length - 5}
              </span>
            )}
          </div>
        )}
        {note.packTitle && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground pt-0.5">
            <Folder className="size-3" />
            <span className="truncate">{note.packTitle}</span>
            {note.questionIdx !== undefined && (
              <>
                <span>·</span>
                <span>Q{note.questionIdx + 1}</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-border opacity-0 group-hover:opacity-100 transition-opacity">
        {onOpenInQBank && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenInQBank();
            }}
            className="px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
            title={t("qbank.notes.card.openInQBank")}
          >
            <ExternalLink className="size-3" />
            {t("nav.qbank")}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-1"
          title={t("qbank.notes.card.delete")}
        >
          <Trash2 className="size-3" />
          {t("qbank.notes.card.delete")}
        </button>
      </div>
    </div>
  );
}
